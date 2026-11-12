import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';

export const givepremium = {
  name: 'givepremium',
  aliases: ['addpremium', 'grantpremium'],
  description: 'Underground: Grant TeleMemer Premium membership to a player',
  cooldown: 0,

  async execute(ctx) {
    let target = null;
    let days = 30;

    const rawArgs = ctx.message.text.trim().split(/\s+/).slice(1);

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
      days = parseInt(rawArgs[0] || '30', 10);
    } else if (rawArgs[0]?.startsWith('@')) {
      target = await userRepo.getUserByUsername(rawArgs[0]);
      days = parseInt(rawArgs[1] || '30', 10);
    } else if (rawArgs[1]?.startsWith('@')) {
      target = await userRepo.getUserByUsername(rawArgs[1]);
      days = parseInt(rawArgs[0] || '30', 10);
    } else {
      // Default to caller
      target = await userRepo.getOrInitUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
      days = parseInt(rawArgs[0] || '30', 10);
    }

    if (isNaN(days) || days <= 0) {
      return ctx.reply('⚠️ Usage: <code>/givepremium &lt;@user|reply&gt; [days]</code>', { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply('❌ Target player not found.');
    }

    const durationMs = days * 86400 * 1000;
    const newExpiry = await userRepo.setPremium(target.user_id, durationMs);

    // Welcome care package: 1x banknote + 1x lifesaver
    await inventoryRepo.addItem(target.user_id, 'banknote', 1);
    await inventoryRepo.addItem(target.user_id, 'lifesaver', 1);

    const expiryDateStr = new Date(newExpiry).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const userMention = target.username ? `@${target.username}` : `<b>${sanitizeHtml(target.first_name)}</b>`;

    return ctx.reply(
      `💎 <b>PREMIUM MEMBERSHIP ACTIVATED!</b> 💎\n\n` +
      `Congratulations ${userMention}!\n` +
      `Your account has been granted <b>${days} days</b> of TeleMemer Premium access (Valid until <b>${expiryDateStr}</b>).\n\n` +
      `<b>⚡ Premium Perks Unlocked:</b>\n` +
      `• ⚡ <b>50% Shorter Cooldowns</b> on all grinding, PvP, and gambling commands!\n` +
      `• 🧲 <b>+10% Permanent Passive Luck</b> on all drop rolls & RNG\n` +
      `• 💰 <b>2x Rewards</b> on Daily, Weekly, and Monthly paychecks\n` +
      `• 🎁 Welcome Care Package: +1x 📜 Bank Note & +1x 🛟 Life Saver added to your backpack!`,
      { parse_mode: 'HTML' }
    );
  }
};

export default givepremium;
