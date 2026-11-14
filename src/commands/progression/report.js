import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { formatTime, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';
import { getOwnerDmTargetId, isOwnerUserRecord } from '../../services/antiCheat.js';

const REPORT_COOLDOWN_KEY = 'report_cd';
const REPORT_COOLDOWN_SECONDS = 600; // 10 minutes
const MAX_REASON_LENGTH = 500;

function formatUserHandle(user) {
  if (!user) return 'Unknown User';
  if (user.username) return `@${sanitizeHtml(user.username)}`;
  return sanitizeHtml(user.first_name || String(user.user_id));
}

function getChatLabel(ctx) {
  const chat = ctx.chat;
  if (!chat) return 'Unknown Chat';
  if (chat.type === 'private') return 'Private DM';
  const title = chat.title ? sanitizeHtml(chat.title) : `Group ${chat.id}`;
  return `${title} (<code>${chat.id}</code>)`;
}

export const report = {
  name: 'report',
  aliases: ['reportuser'],
  description: 'Report rulebreakers, exploiters, or RMT sellers directly to the Bot Owner',
  cooldown: 0,

  async execute(ctx) {
    const reporterId = ctx.from.id;
    const reporter = await userRepo.getOrInitUser(reporterId, ctx.from.username, ctx.from.first_name);

    const rawArgs = (
      typeof ctx.match === 'string' && ctx.match.trim()
        ? ctx.match
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ') || '')
    ).trim();

    const tokens = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    const invalidFormatMsg =
      `❌ <b>Invalid Format!</b> Please specify who you are reporting and why.\n` +
      `Usage: <code>/report @username &lt;reason&gt;</code> (or reply to their message with <code>/report &lt;reason&gt;</code>).`;

    let target = null;
    let remainingArgs = [];

    // Support numeric user_id as first argument (e.g. `/report 123456789 selling coins`)
    if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
      const numericId = Number(tokens[0]);
      target = await userRepo.getUser(numericId);
      if (!target) {
        return ctx.reply(
          `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`,
          { parse_mode: 'HTML' }
        );
      }
      remainingArgs = tokens.slice(1);
    } else {
      // Topic-safe resolver: prioritizes explicit @username or text_mention over genuine human reply (ignoring Forum Topic headers)
      const resolved = await resolveTargetUser(ctx, rawArgs, {
        fallbackToCaller: false,
        allowBareUsername: false,
        initRepliedUser: true
      });

      if (resolved.notFound) {
        return ctx.reply(resolved.errorMessage, { parse_mode: 'HTML' });
      }

      target = resolved.user;
      remainingArgs = resolved.remainingArgs || [];
    }

    const reason = remainingArgs.join(' ').trim();
    if (!target || !reason) {
      return ctx.reply(invalidFormatMsg, { parse_mode: 'HTML' });
    }

    if (reason.length > MAX_REASON_LENGTH) {
      return ctx.reply(`❌ Report reason is too long (max ${MAX_REASON_LENGTH} characters). Please keep it concise.`);
    }

    if (Number(target.user_id) === Number(reporterId)) {
      return ctx.reply('❌ You cannot report yourself!');
    }

    if (isOwnerUserRecord(target)) {
      return ctx.reply('❌ You cannot report the Bot Owner!');
    }

    // Check 10-minute anti-spam cooldown before allowing a new report
    const { onCooldown, remainingSeconds } = await cooldownRepo.checkCooldown(reporterId, REPORT_COOLDOWN_KEY);
    if (onCooldown) {
      return ctx.reply(
        `⏳ <b>Report Cooldown Active!</b> Please wait <b>${formatTime(remainingSeconds)}</b> before submitting another report.`,
        { parse_mode: 'HTML' }
      );
    }

    const targetId = Number(target.user_id);
    const targetHandle = formatUserHandle(target);
    const chatLabel = getChatLabel(ctx);

    const token = createConfirmation('rp', {
      reporterId: Number(reporterId),
      reporterUsername: reporter?.username || ctx.from.username || null,
      reporterFirstName: reporter?.first_name || ctx.from.first_name || 'Player',
      targetId,
      targetUsername: target.username || null,
      targetFirstName: target.first_name || 'Player',
      chatLabel,
      reason
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `report:no:${token}:${reporterId}`)
      .text('✅ Confirm Report', `report:yes:${token}:${reporterId}`);

    return ctx.reply(
      `🚨 <b>Confirm Player Report</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Reported User:</b> ${targetHandle} (<code>${targetId}</code>)\n` +
      `📝 <b>Reason:</b> <i>${sanitizeHtml(reason)}</i>\n\n` +
      `⚠️ <i>False or troll reports may result in account penalties. Are you sure you want to submit this report to the Bot Owner?</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  },

  async handleCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const token = parts[2];
    const callerId = Number(parts[3]);

    if (ctx.from.id !== callerId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your report confirmation!",
        show_alert: true
      }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.reporterId !== callerId) {
      await ctx.editMessageText(
        '⏳ This report confirmation has expired. Please run <code>/report</code> again.',
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Report cancelled.').catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Report cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    // Re-check 10-minute cooldown before consuming to protect against parallel prompts
    const { onCooldown, remainingSeconds } = await cooldownRepo.checkCooldown(callerId, REPORT_COOLDOWN_KEY);
    if (onCooldown) {
      deleteConfirmation(token);
      await ctx.editMessageText(
        `⏳ <b>Report Cooldown Active!</b> Please wait <b>${formatTime(remainingSeconds)}</b> before submitting another report.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return ctx.answerCallbackQuery({ text: `Wait ${formatTime(remainingSeconds)}.`, show_alert: true }).catch(() => {});
    }

    consumeConfirmation(token);
    await cooldownRepo.setCooldown(callerId, REPORT_COOLDOWN_KEY, REPORT_COOLDOWN_SECONDS);

    const freshTarget = await userRepo.getUser(pending.targetId);
    const targetId = pending.targetId;
    const targetHandle = freshTarget
      ? formatUserHandle(freshTarget)
      : (pending.targetUsername ? `@${sanitizeHtml(pending.targetUsername)}` : sanitizeHtml(pending.targetFirstName));
    const reporterHandle = pending.reporterUsername
      ? `@${sanitizeHtml(pending.reporterUsername)}`
      : sanitizeHtml(pending.reporterFirstName || String(callerId));

    const suspectWallet = Number(freshTarget?.wallet || 0).toLocaleString('en-US');
    const suspectBank = Number(freshTarget?.bank || 0).toLocaleString('en-US');
    const suspectStatus = String(freshTarget?.account_status || 'active').toUpperCase();

    const ownerChatId = await getOwnerDmTargetId();
    if (ownerChatId) {
      const dossier =
        `🚨 <b>NEW PLAYER REPORT SUBMITTED</b> 🚨\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕵️ <b>Reporter:</b> ${reporterHandle} (<code>${callerId}</code>)\n` +
        `📍 <b>Chat / Group:</b> ${pending.chatLabel}\n\n` +
        `🎯 <b>Reported Suspect:</b> ${targetHandle} (<code>${targetId}</code>)\n` +
        `👛 <b>Suspect Wallet:</b> <code>🪙 ${suspectWallet}</code>\n` +
        `🏦 <b>Suspect Bank:</b> <code>🪙 ${suspectBank}</code>\n` +
        `🔒 <b>Current Status:</b> <code>${sanitizeHtml(suspectStatus)}</code>\n\n` +
        `📝 <b>Report Reason:</b>\n` +
        `"<i>${sanitizeHtml(pending.reason)}</i>"\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `Select a moderation action below:`;

      const ownerKeyboard = new InlineKeyboard()
        .text('❄️ Freeze Suspect', `rep:freeze:${targetId}:${callerId}`)
        .row()
        .text('🔨 Ban Suspect (Keep Data)', `rep:ban:${targetId}:${callerId}`)
        .row()
        .text('❌ Dismiss Report', `rep:dismiss:${targetId}:${callerId}`);

      await ctx.api.sendMessage(ownerChatId, dossier, {
        parse_mode: 'HTML',
        reply_markup: ownerKeyboard
      }).catch((err) => {
        console.warn('[TeleMemer Report] Failed to deliver report DM to Owner:', err?.message || err);
      });
    } else {
      console.warn('[TeleMemer Report] Owner chat ID not found yet; report logged only.');
    }

    await ctx.editMessageText(
      `✅ <b>Report Submitted!</b> Thank you for helping keep TeleMemer fair. The Bot Owner has received your report for review.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.answerCallbackQuery({ text: '✅ Report submitted to the Bot Owner!' }).catch(() => {});
  }
};

export default report;
