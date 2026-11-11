import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, formatTime } from '../../utils/formatters.js';

export const weekly = {
  name: 'weekly',
  aliases: [],
  description: 'Claim your massive 7-day loyalty stipend and rare supply crates',
  cooldown: 0, // Handled internally for exact 7-day calendar cycle

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const WEEK_SECONDS = 604800; // 7 days
    const cd = cooldownRepo.checkCooldown(userId, 'weekly');

    if (cd.onCooldown) {
      return ctx.reply(
        `⏳ <b>Weekly already claimed!</b>\n` +
        `Your weekly care package will arrive in <b>${formatTime(cd.remainingSeconds)}</b>.`,
        { parse_mode: 'HTML' }
      );
    }

    const isPremium = userRepo.isPremium(userId);

    // Rewards
    let coins = 0;
    let itemsGiven = [];

    if (isPremium) {
      coins = 175000;
      inventoryRepo.addItem(userId, 'banknote', 3);
      inventoryRepo.addItem(userId, 'lifesaver', 1);
      inventoryRepo.addItem(userId, 'coinbomb', 1);
      itemsGiven = [
        '3x 📜 <b>Bank Note</b>',
        '1x 🛟 <b>Life Saver</b>',
        '1x 💣 <b>Coin Bomb</b>'
      ];
    } else {
      coins = 75000;
      inventoryRepo.addItem(userId, 'banknote', 1);
      inventoryRepo.addItem(userId, 'horseshoe', 1);
      itemsGiven = [
        '1x 📜 <b>Bank Note</b>',
        '1x 🧲 <b>Lucky Horseshoe</b>'
      ];
    }

    userRepo.updateWallet(userId, coins);
    cooldownRepo.setCooldown(userId, 'weekly', WEEK_SECONDS);
    const xpResult = addXp(userId, isPremium ? 200 : 100);

    const banner = isPremium
      ? '💎 <b>PREMIUM WEEKLY AIRDROP!</b> 💎'
      : '📦 <b>WEEKLY CARE PACKAGE CLAIMED!</b>';

    const tip = isPremium
      ? '\n✨ <i>Premium tier benefits applied!</i>'
      : '\n💡 <i>Tip: Premium members receive 175,000 coins + Life Saver + Coin Bomb!</i>';

    const msg = `${banner}\n\n` +
      `🪙 <b>Coin Stipend:</b> +${formatCoins(coins)}\n` +
      `🎒 <b>Items Unboxed:</b>\n` +
      itemsGiven.map(i => `• ${i}`).join('\n') +
      `\n\n⭐ <b>XP Earned:</b> +${xpResult.earnedXp} XP` +
      tip +
      (xpResult.message ? `\n${xpResult.message}` : '');

    return ctx.reply(msg, { parse_mode: 'HTML' });
  }
};

export default weekly;
