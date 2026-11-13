import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { sendUserDm } from '../../services/antiCheat.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

export const unban = {
  name: 'unban',
  aliases: ['unfreeze'],
  category: 'owner',
  description: 'Owner: Restore a banned or frozen user account to active status',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const { user: target, notFound, errorMessage, explicitUsername } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: true,
      allowNumericId: true,
      initRepliedUser: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\n' +
        'Usage: <code>/unban &lt;@username|user_id|reply&gt;</code> (or <code>/unfreeze</code>)',
        { parse_mode: 'HTML' }
      );
    }

    const previousStatus = String(target.account_status || 'active').toUpperCase();
    const targetHandle = explicitUsername
      ? (explicitUsername.startsWith('@') ? explicitUsername : `@${explicitUsername}`)
      : (target.username ? `@${target.username}` : target.first_name || String(target.user_id));

    await userRepo.setAccountStatus(target.user_id, 'active', null, 0);

    await sendUserDm(
      target.user_id,
      `✅ <b>ACCOUNT RESTORED!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 Your TeleMemer account has been restored to <b>ACTIVE</b> status by the Bot Owner.\n` +
      `All your data, coins, and items remain intact. Welcome back!`
    );

    return ctx.reply(
      `✅ <b>ACCOUNT RESTORED:</b> <b>${sanitizeHtml(targetHandle)}</b> (<code>${target.user_id}</code>) is now <b>ACTIVE</b>.\n` +
      `<i>Previous Status: ${sanitizeHtml(previousStatus)} • Reason &amp; flagged gain cleared.</i>`,
      { parse_mode: 'HTML' }
    );
  }
};

export default unban;
