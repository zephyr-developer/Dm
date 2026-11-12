import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, formatTime } from '../../utils/formatters.js';

export const monthly = {
  name: 'monthly',
  aliases: [],
  description: 'Claim your massive 30-day milestone stipend and mythic loot',
  cooldown: 0, // Handled internally for exact 30-day calendar cycle

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const MONTH_SECONDS = 2592000; // 30 days
    const cd = await cooldownRepo.checkCooldown(userId, 'monthly');

    if (cd.onCooldown) {
      return ctx.reply(
        `⏳ <b>Monthly already claimed!</b>\n` +
        `Your monthly milestone rewards will unlock in <b>${formatTime(cd.remainingSeconds)}</b>.`,
        { parse_mode: 'HTML' }
      );
    }

    const isPremium = await userRepo.isPremium(userId);

    // Rewards
    let coins = 0;
    let itemsGiven = [];

    if (isPremium) {
      coins = 800000;
      await inventoryRepo.addItem(userId, 'banknote', 5);
      await inventoryRepo.addItem(userId, 'lifesaver', 3);
      await inventoryRepo.addItem(userId, 'pepecoin', 1);
      itemsGiven = [
        '5x 📜 <b>Bank Note</b>',
        '3x 🛟 <b>Life Saver</b>',
        '1x 🪙 <b>Pepe Coin</b> (Collectible!)'
      ];
    } else {
      coins = 350000;
      await inventoryRepo.addItem(userId, 'banknote', 3);
      await inventoryRepo.addItem(userId, 'lifesaver', 2);
      await inventoryRepo.addItem(userId, 'adventureticket', 1);
      itemsGiven = [
        '3x 📜 <b>Bank Note</b>',
        '2x 🛟 <b>Life Saver</b>',
        '1x 🎟️ <b>Adventure Ticket</b>'
      ];
    }

    await userRepo.updateCoins(userId, {
      walletDelta: coins,
      sourceCommand: '/monthly',
      details: `Monthly Milestone Vault (${isPremium ? 'VIP Vault' : 'Standard'})`
    });

    await cooldownRepo.setCooldown(userId, 'monthly', MONTH_SECONDS);
    const xpResult = await addXp(userId, isPremium ? 500 : 250);

    const banner = isPremium
      ? '👑 <b>PREMIUM MONTHLY VAULT UNLOCKED!</b> 👑'
      : '🏛️ <b>MONTHLY MILESTONE VAULT UNLOCKED!</b>';

    const tip = isPremium
      ? '\n✨ <i>Premium tier benefits applied!</i>'
      : '\n💡 <i>Tip: Premium members receive 800,000 coins + 5 Bank Notes + Pepe Coin!</i>';

    const msg = `${banner}\n\n` +
      `🪙 <b>Treasury Bounty:</b> +${formatCoins(coins)}\n` +
      `🎒 <b>Vault Items Stashed:</b>\n` +
      itemsGiven.map(i => `• ${i}`).join('\n') +
      `\n\n⭐ <b>XP Earned:</b> +${xpResult.earnedXp} XP` +
      tip +
      (xpResult.message ? `\n${xpResult.message}` : '');

    return ctx.reply(msg, { parse_mode: 'HTML' });
  }
};

export default monthly;
