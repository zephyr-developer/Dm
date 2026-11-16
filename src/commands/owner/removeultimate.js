import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { isGenuineUserReply, resolveTargetUser } from '../../utils/targetResolver.js';
import { sendUserDm } from '../../services/antiCheat.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

export const removeultimate = {
  name: 'removeultimate',
  aliases: ['revokeultimate', 'removeelite'],
  category: 'owner',
  description: 'Owner: Revoke a user\'s Ultimate Gambler (Elite) membership',
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

    if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
      target = await userRepo.getUser(Number(tokens[0]));
      if (!target) {
        return ctx.reply(
          `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`,
          { parse_mode: 'HTML' }
        );
      }
    } else {
      const resolved = await resolveTargetUser(ctx, rawInput, {
        fallbackToCaller: false,
        allowBareUsername: !isGenuineUserReply(ctx) && tokens.length >= 1,
        allowNumericId: false,
        initRepliedUser: false
      });

      if (resolved.notFound) {
        return ctx.reply(resolved.errorMessage, { parse_mode: 'HTML' });
      }

      target = resolved.user;
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\nUsage: <code>/removeultimate &lt;@username|user_id|reply&gt;</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = Number(target.user_id);
    const targetDisplay = target.username ? `@${target.username}` : (target.first_name || String(targetId));

    await userRepo.setUltimateGambler(targetId, null);

    await sendUserDm(
      targetId,
      `⚠️ <b>ULTIMATE GAMBLER REVOKED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your <b>🎰 Ultimate Gambler (Elite Membership)</b> has been revoked by the Bot Owner (@tzhunyuan).\n` +
      `Standard 🪙 100,000,000 casino table bet limits now apply to your account.`
    );

    return ctx.reply(
      `🚫 <b>Ultimate Gambler Revoked:</b> <b>${sanitizeHtml(targetDisplay)}</b> (<code>${targetId}</code>) is back to standard table limits.`,
      { parse_mode: 'HTML' }
    );
  }
};

export default removeultimate;
