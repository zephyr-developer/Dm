import userRepo from '../../database/userRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';

export const removepremium = {
  name: 'removepremium',
  aliases: ['delpremium', 'revokepremium'],
  description: 'Underground: Revoke TeleMemer Premium membership from a player',
  cooldown: 0,

  async execute(ctx) {
    let target = null;
    const rawArgs = ctx.message.text.trim().split(/\s+/).slice(1);

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = userRepo.getUser(replied.id);
    } else if (rawArgs[0]?.startsWith('@')) {
      target = userRepo.getUserByUsername(rawArgs[0]);
    } else if (rawArgs[0]) {
      const parsedId = Number(rawArgs[0]);
      if (!isNaN(parsedId)) {
        target = userRepo.getUser(parsedId);
      }
    }

    if (!target) {
      return ctx.reply('⚠️ Usage: Reply to a user with <code>/removepremium</code> or type <code>/removepremium @username</code>', { parse_mode: 'HTML' });
    }

    userRepo.removePremium(target.user_id);

    return ctx.reply(
      `🚫 <b>Premium Membership Revoked</b>\n\n` +
      `Player <b>${sanitizeHtml(target.first_name)}</b> (<code>${target.user_id}</code>) has been reverted to standard cooldowns and perks.`,
      { parse_mode: 'HTML' }
    );
  }
};

export default removepremium;
