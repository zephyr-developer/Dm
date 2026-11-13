import userRepo from '../../database/userRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

export const incluck = {
  name: 'incluck',
  aliases: [],
  description: 'Underground: Set custom luck percentage boost for RNG rolls',
  cooldown: 0,

  async execute(ctx) {
    const { user: target, notFound, errorMessage, remainingArgs } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: true,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    const percentage = parseInt(remainingArgs[0] || '', 10);

    if (isNaN(percentage) || percentage < 0) {
      return ctx.reply('⚠️ Usage: <code>/incluck &lt;percentage&gt; [@user_optional]</code> (e.g., <code>/incluck 100</code>)', { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply('❌ Target user not found.');
    }

    // Set custom luck in database
    await userRepo.setCustomLuck(target.user_id, percentage);

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
