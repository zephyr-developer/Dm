import { InlineKeyboard } from 'grammy';
import userRepo from '../database/userRepo.js';
import { isOwner } from './ownerGuard.js';
import { formatTime, sanitizeHtml } from '../utils/formatters.js';

export async function accountGuard(ctx, next) {
  const from = ctx.from;
  if (!from) {
    return next();
  }

  // Never block @tzhunyuan / Bot Owner
  if (isOwner(ctx)) {
    return next();
  }

  // Only intercept slash commands or callback queries so regular group chat isn't spammed
  const messageText = ctx.message?.text?.trim() || '';
  const isSlashCommand = messageText.startsWith('/');
  const callbackData = ctx.callbackQuery?.data || '';
  const isCallback = Boolean(ctx.callbackQuery);

  if (!isSlashCommand && !isCallback) {
    return next();
  }

  // Fetch authoritative user record from DB early so auto-expiry runs consistently
  let user = await userRepo.getUser(from.id) || ctx.dbUser;
  let status = String(user?.account_status || 'active').toLowerCase();

  // Auto-expire temporary bans/freezes before enforcing restrictions or handling commands
  if ((status === 'frozen' || status === 'banned') && user?.ban_expires_at && Number(user.ban_expires_at) > 0) {
    if (Date.now() >= Number(user.ban_expires_at)) {
      user = await userRepo.setAccountStatus(from.id, 'active', null, 0, null);
      status = 'active';
      if (ctx.dbUser) {
        ctx.dbUser.account_status = 'active';
        ctx.dbUser.status_reason = null;
        ctx.dbUser.ban_expires_at = null;
        ctx.dbUser.last_appeal_at = 0;
      }
      await ctx.api.sendMessage(
        from.id,
        '✅ <b>Ban Expired!</b> Your temporary suspension has ended and your TeleMemer account is now active again.',
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return next();
    }
  }

  // Allow /appeal, /replyowner, appeal: callbacks, and gamble:warning through unconditionally
  if (isSlashCommand) {
    const cmdToken = messageText.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
    if (
      cmdToken === 'appeal' ||
      cmdToken === 'unbanappeal' ||
      cmdToken === 'replyowner' ||
      cmdToken === 'replyadmin'
    ) {
      return next();
    }
  }

  if (isCallback && (callbackData.startsWith('appeal:') || callbackData === 'gamble:warning')) {
    return next();
  }

  if (status === 'frozen' || status === 'banned') {
    const statusUpper = status.toUpperCase();
    const reasonText = sanitizeHtml(user?.status_reason || 'Suspicious / Illogical Economy Activity Detected');
    const hasTempExpiry = Boolean(user?.ban_expires_at && Number(user.ban_expires_at) > Date.now());
    const remainingSecs = hasTempExpiry
      ? Math.max(1, Math.ceil((Number(user.ban_expires_at) - Date.now()) / 1000))
      : 0;
    const expiryDisplay = hasTempExpiry
      ? formatTime(remainingSecs)
      : 'Permanent (Until Appealed)';

    const replyHint = Number(user?.can_reply_owner) === 1
      ? `\n\n💬 <b>Owner Inquiry Active:</b> You may reply directly to the Bot Owner using <code>/replyowner &lt;your response&gt;</code>.`
      : '';

    const blockMsg =
      `🚨 <b>ACCOUNT ${statusUpper}</b> 🚨\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `❌ Your TeleMemer account is currently <b>${statusUpper}</b> and cannot use any bot commands.\n` +
      `📝 <b>Reason:</b> ${reasonText}\n` +
      `⏳ <b>Duration / Expires In:</b> ${expiryDisplay}\n\n` +
      `📨 <b>Want to Appeal?</b>\n` +
      `You may submit an appeal to the Bot Owner once every <b>24 hours</b> using:\n` +
      `<code>/appeal &lt;your explanation&gt;</code>${replyHint}`;

    const appealKb = new InlineKeyboard().text('📨 Submit Appeal', `appeal:prompt:${from.id}`);

    if (isCallback) {
      await ctx.answerCallbackQuery({
        text: `🚨 Your account is ${statusUpper}! Expires: ${expiryDisplay}. Use /appeal <explanation>.`,
        show_alert: true
      }).catch(() => {});
      await ctx.reply(blockMsg, { parse_mode: 'HTML', reply_markup: appealKb }).catch(() => {});
      return;
    }

    return ctx.reply(blockMsg, { parse_mode: 'HTML', reply_markup: appealKb });
  }

  return next();
}

export default accountGuard;
