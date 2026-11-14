import { InlineKeyboard } from 'grammy';
import userRepo from '../database/userRepo.js';
import { isOwner } from './ownerGuard.js';
import { sanitizeHtml } from '../utils/formatters.js';

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

  // Allow /appeal command and appeal: callbacks through unconditionally
  if (isSlashCommand) {
    const cmdToken = messageText.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
    if (cmdToken === 'appeal' || cmdToken === 'unbanappeal') {
      return next();
    }
  }

  if (isCallback && (callbackData.startsWith('appeal:') || callbackData === 'gamble:warning')) {
    return next();
  }

  // Fetch authoritative user record from DB
  const user = await userRepo.getUser(from.id) || ctx.dbUser;
  const status = String(user?.account_status || 'active').toLowerCase();

  if (status === 'frozen' || status === 'banned') {
    const statusUpper = status.toUpperCase();
    const reasonText = sanitizeHtml(user?.status_reason || 'Suspicious / Illogical Economy Activity Detected');
    const blockMsg =
      `🚨 <b>ACCOUNT ${statusUpper}</b> 🚨\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `❌ Your TeleMemer account is currently <b>${statusUpper}</b> and cannot use any bot commands.\n` +
      `📝 <b>Reason:</b> ${reasonText}\n\n` +
      `📨 <b>Want to Appeal?</b>\n` +
      `You may submit an appeal to the Bot Owner once every <b>24 hours</b> using:\n` +
      `<code>/appeal &lt;your explanation&gt;</code>`;

    const appealKb = new InlineKeyboard().text('📨 Submit Appeal', `appeal:prompt:${from.id}`);

    if (isCallback) {
      await ctx.answerCallbackQuery({
        text: `🚨 Your account is ${statusUpper}! Use /appeal <explanation> to appeal.`,
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
