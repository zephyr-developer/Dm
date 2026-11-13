import userRepo from '../../database/userRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

export const removepremium = {
  name: 'removepremium',
  aliases: ['delpremium', 'revokepremium'],
  description: 'Underground: Revoke TeleMemer Premium membership from a player',
  cooldown: 0,

  async execute(ctx) {
    const { user: target, notFound, errorMessage } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: true,
      allowNumericId: true,
      initRepliedUser: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply('⚠️ Usage: Reply to a user with <code>/removepremium</code> or type <code>/removepremium @username</code>', { parse_mode: 'HTML' });
    }

    await userRepo.removePremium(target.user_id);

    return ctx.reply(
      `🚫 <b>Premium Membership Revoked</b>\n\n` +
      `Player <b>${sanitizeHtml(target.first_name)}</b> (<code>${target.user_id}</code>) has been reverted to standard cooldowns and perks.`,
      { parse_mode: 'HTML' }
    );
  }
};

export default removepremium;
