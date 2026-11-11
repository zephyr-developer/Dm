import userRepo from '../../database/userRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';

export const incluck = {
  name: 'incluck',
  aliases: [],
  description: 'Underground: Set custom luck percentage boost for RNG rolls',
  cooldown: 0,

  async execute(ctx) {
    const callerId = ctx.from.id;
    let target = null;
    let percentage = 0;

    const rawArgs = ctx.message.text.trim().split(/\s+/).slice(1);

    // Case 1: Reply to a user with /incluck <percentage>
    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
      percentage = parseInt(rawArgs[0] || '0', 10);
    } 
    // Case 2: /incluck <percentage> @username
    else if (rawArgs[1]?.startsWith('@')) {
      target = userRepo.getUserByUsername(rawArgs[1]);
      percentage = parseInt(rawArgs[0] || '0', 10);
    } 
    // Case 3: /incluck @username <percentage>
    else if (rawArgs[0]?.startsWith('@')) {
      target = userRepo.getUserByUsername(rawArgs[0]);
      percentage = parseInt(rawArgs[1] || '0', 10);
    } 
    // Case 4: /incluck <percentage> (applies to owner themselves)
    else {
      target = userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);
      percentage = parseInt(rawArgs[0] || '0', 10);
    }

    if (isNaN(percentage) || percentage < 0) {
      return ctx.reply('⚠️ Usage: <code>/incluck &lt;percentage&gt; [@user_optional]</code> (e.g., <code>/incluck 100</code>)', { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply('❌ Target user not found.');
    }

    // Set custom luck in database
    userRepo.setCustomLuck(target.user_id, percentage);

    return ctx.reply(
      `🧲 <b>Luck Injected Successfully!</b>\n\n` +
      `👤 <b>Target:</b> ${sanitizeHtml(target.first_name)} (<code>${target.user_id}</code>)\n` +
      `🎲 <b>Custom Luck:</b> <b>+${percentage}%</b>\n\n` +
      `<i>All RNG rolls, coin ranges, and rare drop chances (Dragon, Kraken, Banknotes) are now magnified by this modifier!</i>`,
      { parse_mode: 'HTML' }
    );
  }
};

export default incluck;
