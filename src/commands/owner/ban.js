import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { isGenuineUserReply } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';
import { isOwnerUserRecord, sendUserDm } from '../../services/antiCheat.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

async function resolveBanTargetAndReason(ctx) {
  const rawInput = (
    (typeof ctx.match === 'string' && ctx.match.trim())
      ? ctx.match.trim()
      : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
  );
  const tokens = rawInput ? rawInput.split(/\s+/).filter(Boolean) : [];

  // 1. Explicit @username token anywhere
  const atIdx = tokens.findIndex(t => t.startsWith('@') && t.length > 1);
  if (atIdx !== -1) {
    const cleanUsername = tokens[atIdx].replace(/^@+/, '').trim();
    const reason = tokens.filter((_, idx) => idx !== atIdx).join(' ').trim();
    const user = await userRepo.getUserByUsername(cleanUsername);
    if (!user) {
      return {
        notFound: true,
        errorMessage: `❌ User @${sanitizeHtml(cleanUsername)} has not registered/played TeleMemer yet!`
      };
    }
    return { user, targetLabel: user.username || cleanUsername, reason };
  }

  // 2. Text mention entity (users without @username)
  const entities = ctx.message?.entities || [];
  const textMention = entities.find(e => e.type === 'text_mention' && e.user && !e.user.is_bot);
  if (textMention?.user) {
    const u = textMention.user;
    let remaining = [...tokens];
    if (typeof ctx.message?.text === 'string') {
      const mentionText = ctx.message.text.slice(textMention.offset, textMention.offset + textMention.length).trim();
      for (const mt of mentionText.split(/\s+/).filter(Boolean)) {
        const idx = remaining.indexOf(mt);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }
    const user = await userRepo.getUser(u.id);
    if (!user) {
      const label = u.username || u.first_name || String(u.id);
      return {
        notFound: true,
        errorMessage: `❌ User ${sanitizeHtml(label)} has not registered/played TeleMemer yet!`
      };
    }
    return { user, targetLabel: user.username || user.first_name || String(user.user_id), reason: remaining.join(' ').trim() };
  }

  // 3. Explicit numeric Telegram user ID in first token
  if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
    const targetId = Number(tokens[0]);
    const reason = tokens.slice(1).join(' ').trim();
    const user = await userRepo.getUser(targetId);
    if (!user) {
      return {
        notFound: true,
        errorMessage: `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`
      };
    }
    return { user, targetLabel: user.username || String(user.user_id), reason };
  }

  // 4. Genuine human reply (topic-safe) -> all tokens become the reason
  if (isGenuineUserReply(ctx)) {
    const replied = ctx.message.reply_to_message.from;
    const user = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
    return {
      user,
      targetLabel: user.username || user.first_name || String(user.user_id),
      reason: tokens.join(' ').trim()
    };
  }

  return { user: null, notFound: false, reason: '' };
}

export const ban = {
  name: 'ban',
  aliases: ['banuser'],
  category: 'owner',
  description: 'Owner: Ban a user while preserving all coins, items, and progression for appeals',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const { user: target, notFound, errorMessage, targetLabel, reason } = await resolveBanTargetAndReason(ctx);

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\n' +
        'Usage: <code>/ban &lt;@username|user_id|reply&gt; &lt;reason&gt;</code>\n\n' +
        'Examples:\n' +
        '• <code>/ban @cheater Exploiting infinite coins</code>\n' +
        '• <code>/ban 123456789 Alt-account farming</code>\n' +
        '• Or reply to a message with <code>/ban Rule violation</code>',
        { parse_mode: 'HTML' }
      );
    }

    if (isOwnerUserRecord(target) || Number(target.user_id) === Number(ctx.from.id)) {
      return ctx.reply('❌ You cannot ban the Bot Owner!');
    }

    if (!reason || reason.trim().length === 0) {
      return ctx.reply(
        '❌ <b>Reason is required!</b> Usage: <code>/ban @username &lt;reason&gt;</code>',
        { parse_mode: 'HTML' }
      );
    }

    const callerId = ctx.from.id;
    const displayHandle = target.username ? `@${target.username}` : targetLabel;

    const token = createConfirmation('ban', {
      callerId,
      targetId: target.user_id,
      targetUsername: displayHandle,
      reason: reason.trim(),
      existingFlagged: Number(target.flagged_amount || 0)
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `ban:no:${token}:${callerId}`)
      .text('✅ Confirm', `ban:yes:${token}:${callerId}`);

    return ctx.reply(
      `🔨 <b>Confirm Account Ban</b>\n` +
      `Target: <b>${sanitizeHtml(displayHandle)}</b> (<code>${target.user_id}</code>)\n` +
      `Reason: <i>${sanitizeHtml(reason.trim())}</i>\n` +
      `<i>(All user data, coins, and items will be preserved for appeal purposes)</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.answerCallbackQuery({ text: '❌ Unauthorized.', show_alert: true }).catch(() => {});
    }

    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const token = parts[2];
    const ownerId = Number(parts[3]);

    if (ctx.from.id !== ownerId) {
      return ctx.answerCallbackQuery({ text: "🚫 This isn't your confirmation!", show_alert: true }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.callerId !== ownerId) {
      await ctx.editMessageText('⏳ This ban confirmation has expired. Please run <code>/ban</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Account ban cancelled.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Ban cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    consumeConfirmation(token);

    await userRepo.setAccountStatus(pending.targetId, 'banned', pending.reason, pending.existingFlagged);

    // Notify banned user privately (preserving all coins/items)
    await sendUserDm(
      pending.targetId,
      `🔨 <b>ACCOUNT BANNED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `❌ Your TeleMemer account has been <b>BANNED</b>.\n` +
      `📝 <b>Reason:</b> ${sanitizeHtml(pending.reason)}\n\n` +
      `<i>All your coins, items, and progress have been preserved. You may appeal once every 24 hours using:</i>\n` +
      `<code>/appeal &lt;your explanation&gt;</code>`
    );

    await ctx.editMessageText(
      `🔨 <b>ACCOUNT BANNED:</b> <b>${sanitizeHtml(pending.targetUsername)}</b> (<code>${pending.targetId}</code>)\n` +
      `📝 <b>Reason:</b> ${sanitizeHtml(pending.reason)}\n` +
      `✅ <i>All user data, coins, and items were preserved.</i>`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCallbackQuery({ text: 'User banned.' }).catch(() => {});
  }
};

export default ban;
