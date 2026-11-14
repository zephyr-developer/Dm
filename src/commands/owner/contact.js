import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { sendUserDm } from '../../services/antiCheat.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

export const contact = {
  name: 'contact',
  aliases: ['msguser', 'askuser', 'dm'],
  category: 'owner',
  description: 'Owner: Send an official DM inquiry to a user and unlock /replyowner for their response',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const rawInput = (
      typeof ctx.match === 'string' && ctx.match.trim()
        ? ctx.match
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ') || '')
    ).trim();
    const tokens = rawInput ? rawInput.split(/\s+/).filter(Boolean) : [];

    let target = null;
    let remainingArgs = [];

    // 1. Numeric user_id in first token
    if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
      target = await userRepo.getUser(Number(tokens[0]));
      if (!target) {
        return ctx.reply(
          `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`,
          { parse_mode: 'HTML' }
        );
      }
      remainingArgs = tokens.slice(1);
    } else {
      const resolved = await resolveTargetUser(ctx, rawInput, {
        fallbackToCaller: false,
        allowBareUsername: false,
        allowNumericId: false,
        initRepliedUser: true
      });

      if (resolved.notFound) {
        return ctx.reply(resolved.errorMessage, { parse_mode: 'HTML' });
      }

      target = resolved.user;
      remainingArgs = resolved.remainingArgs || [];
    }

    const messageText = remainingArgs.join(' ').trim();

    if (!target || !messageText) {
      return ctx.reply(
        '📩 <b>Owner Two-Way Contact</b>\n' +
        'Usage: <code>/contact &lt;@username|user_id|reply&gt; &lt;message&gt;</code>\n\n' +
        'Examples:\n' +
        '• <code>/contact @user Where did you obtain those 600B coins?</code>\n' +
        '• <code>/contact 123456789 Please clarify your transfer history.</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = Number(target.user_id);
    const targetHandle = target.username ? `@${target.username}` : (target.first_name || String(targetId));

    // Unlock /replyowner for this user
    await userRepo.setCanReplyOwner(targetId, 1);

    const dmPayload =
      `📩 <b>OFFICIAL MESSAGE FROM BOT OWNER</b> 📩\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👑 <b>From:</b> Bot Administration (@tzhunyuan)\n` +
      `💬 <b>Message:</b>\n` +
      `"<i>${sanitizeHtml(messageText)}</i>"\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>You have been granted permission to reply directly to this inquiry (even if your account is frozen/banned). Type:</i>\n` +
      `<code>/replyowner &lt;your response&gt;</code>`;

    const delivered = await sendUserDm(targetId, dmPayload);

    if (!delivered) {
      return ctx.reply(
        `⚠️ <b>Could not DM ${sanitizeHtml(targetHandle)}</b> (<code>${targetId}</code>) — they may have blocked the bot or never started a Private DM with it.\n` +
        `✅ <i>Their <code>/replyowner</code> channel is still unlocked if they start the bot or reply in a group.</i>`,
        { parse_mode: 'HTML' }
      );
    }

    return ctx.reply(
      `✅ <b>Inquiry Delivered!</b>\n` +
      `👤 <b>To:</b> ${sanitizeHtml(targetHandle)} (<code>${targetId}</code>)\n` +
      `💬 <b>Message:</b> "<i>${sanitizeHtml(messageText)}</i>"\n` +
      `🔓 <i><code>/replyowner</code> has been unlocked for their next response.</i>`,
      { parse_mode: 'HTML' }
    );
  }
};

export default contact;
