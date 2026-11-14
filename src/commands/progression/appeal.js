import userRepo from '../../database/userRepo.js';
import { formatTime, sanitizeHtml } from '../../utils/formatters.js';
import { sendAppealReviewCard } from '../../services/antiCheat.js';

const APPEAL_COOLDOWN_MS = 86_400_000; // 24 hours

function getRemainingCooldownSeconds(lastAppealAt) {
  const last = Number(lastAppealAt || 0);
  if (last <= 0) return 0;
  const elapsed = Date.now() - last;
  if (elapsed >= APPEAL_COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((APPEAL_COOLDOWN_MS - elapsed) / 1000));
}

export const appeal = {
  name: 'appeal',
  aliases: ['unbanappeal'],
  description: 'Submit an account freeze/ban appeal to the Bot Owner (24h cooldown)',
  cooldown: 0,

  async execute(ctx) {
    const callerId = ctx.from.id;
    let user = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);
    let status = String(user?.account_status || 'active').toLowerCase();

    if ((status === 'frozen' || status === 'banned') && user?.ban_expires_at && Number(user.ban_expires_at) > 0) {
      if (Date.now() >= Number(user.ban_expires_at)) {
        user = await userRepo.setAccountStatus(callerId, 'active', null, 0, null);
        status = 'active';
      }
    }

    // 1. Account must actually be frozen or banned
    if (status === 'active') {
      return ctx.reply('✅ Your account is active and in good standing! You do not need to appeal.');
    }

    // 2. Require appeal explanation text
    const appealText = (
      (typeof ctx.match === 'string' && ctx.match.trim())
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    );

    if (!appealText) {
      return ctx.reply(
        '❌ Please include your appeal explanation! Example:\n<code>/appeal I won the coins fairly from...</code>',
        { parse_mode: 'HTML' }
      );
    }

    // 3. Enforce 24-hour appeal cooldown
    const remainingSeconds = getRemainingCooldownSeconds(user.last_appeal_at);
    if (remainingSeconds > 0) {
      return ctx.reply(
        `⏳ <b>Appeal Cooldown Active!</b> You can only submit an appeal once every <b>24 hours</b>. ` +
        `Please wait <b>${formatTime(remainingSeconds)}</b> before appealing again.`,
        { parse_mode: 'HTML' }
      );
    }

    // 4. Record appeal timestamp and forward interactive review card to Owner DM
    await userRepo.setLastAppealAt(callerId, Date.now());
    const delivery = await sendAppealReviewCard(user, appealText);

    if (!delivery.sent) {
      console.warn(`[Appeal] Could not DM Owner (@tzhunyuan) for user ${callerId}: ${delivery.reason}`);
    }

    return ctx.reply(
      `📨 <b>Appeal Submitted!</b> Your appeal has been sent to the Bot Owner for review. You may submit another appeal in 24 hours if needed.`,
      { parse_mode: 'HTML' }
    );
  },

  async handleCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const targetUid = Number(parts[2]);

    if (targetUid && ctx.from.id !== targetUid) {
      return ctx.answerCallbackQuery({ text: "🚫 This isn't your appeal button!", show_alert: true }).catch(() => {});
    }

    if (action === 'prompt') {
      const user = await userRepo.getUser(ctx.from.id);
      const remainingSeconds = getRemainingCooldownSeconds(user?.last_appeal_at);

      if (remainingSeconds > 0) {
        await ctx.answerCallbackQuery({
          text: `⏳ Appeal cooldown active! Wait ${formatTime(remainingSeconds)}.`,
          show_alert: true
        }).catch(() => {});
        return;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.reply(
        `📨 <b>How to Submit Your Appeal</b>\n` +
        `Reply in this chat with your explanation using:\n` +
        `<code>/appeal &lt;your explanation message&gt;</code>\n\n` +
        `<i>Example:</i> <code>/appeal I earned those coins from /scratch and /give with a friend.</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return;
    }

    return ctx.answerCallbackQuery().catch(() => {});
  }
};

export default appeal;
