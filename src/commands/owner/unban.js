import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { isGenuineUserReply, resolveTargetUser } from '../../utils/targetResolver.js';
import { sendUserDm } from '../../services/antiCheat.js';

const DEFAULT_UNBAN_REASON = 'Account cleared and restored by Bot Owner.';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

export const unban = {
  name: 'unban',
  aliases: ['unfreeze'],
  category: 'owner',
  description: 'Owner: Restore a banned or frozen user account with an optional reason',
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
    let targetLabel = '';

    // 1. Numeric ID in first token
    if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
      target = await userRepo.getUser(Number(tokens[0]));
      if (!target) {
        return ctx.reply(
          `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`,
          { parse_mode: 'HTML' }
        );
      }
      remainingArgs = tokens.slice(1);
      targetLabel = target.username ? `@${target.username}` : String(target.user_id);
    } else {
      // 2. Prioritize @username, text_mention, or genuine reply (without letting reply text get treated as bare username)
      const resolved = await resolveTargetUser(ctx, rawInput, {
        fallbackToCaller: false,
        allowBareUsername: !isGenuineUserReply(ctx) && tokens.length === 1,
        allowNumericId: false,
        initRepliedUser: false
      });

      if (resolved.notFound) {
        return ctx.reply(resolved.errorMessage, { parse_mode: 'HTML' });
      }

      target = resolved.user;
      remainingArgs = resolved.remainingArgs || [];
      targetLabel = resolved.explicitUsername
        ? (resolved.explicitUsername.startsWith('@') ? resolved.explicitUsername : `@${resolved.explicitUsername}`)
        : '';
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\n' +
        'Usage: <code>/unban &lt;@username|user_id|reply&gt; [reason]</code> (or <code>/unfreeze</code>)\n' +
        'Example: <code>/unban @user Appeal accepted - false alarm</code>',
        { parse_mode: 'HTML' }
      );
    }

    const unbanReason = remainingArgs.join(' ').trim() || DEFAULT_UNBAN_REASON;
    const previousStatus = String(target.account_status || 'active').toUpperCase();
    const targetHandle = targetLabel || (target.username ? `@${target.username}` : target.first_name || String(target.user_id));

    await userRepo.setAccountStatus(target.user_id, 'active', null, 0, null);

    await sendUserDm(
      target.user_id,
      `🎉 <b>ACCOUNT RESTORED / UNBANNED</b> 🎉\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Your TeleMemer account status has been restored to <b>ACTIVE</b>!\n` +
      `📝 <b>Admin Note / Reason:</b> ${sanitizeHtml(unbanReason)}\n\n` +
      `You may now use all bot commands again. Play fair!`
    );

    return ctx.reply(
      `✅ <b>ACCOUNT RESTORED:</b> <b>${sanitizeHtml(targetHandle)}</b> (<code>${target.user_id}</code>) is now <b>ACTIVE</b>.\n` +
      `📝 <b>Reason:</b> ${sanitizeHtml(unbanReason)}\n` +
      `<i>Previous Status: ${sanitizeHtml(previousStatus)} • Expiry &amp; case appeal timer cleared.</i>`,
      { parse_mode: 'HTML' }
    );
  }
};

export default unban;
