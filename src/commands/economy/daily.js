import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, formatTime } from '../../utils/formatters.js';

export const daily = {
  name: 'daily',
  aliases: [],
  description: 'Claim your daily coin salary and build a loyalty streak',
  cooldown: 0, // Handled internally via last_daily timestamp

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const now = Math.floor(Date.now() / 1000);
    const lastClaim = user.last_daily || 0;
    const oneDay = 86400;
    const twoDays = 172800;

    const timeSinceLastClaim = now - lastClaim;

    // Check if 24 hours have passed
    if (timeSinceLastClaim < oneDay) {
      const remainingSeconds = oneDay - timeSinceLastClaim;
      return ctx.reply(
        `⏳ <b>Daily already claimed!</b>\n` +
        `You must wait <b>${formatTime(remainingSeconds)}</b> before claiming your next daily paycheck.\n` +
        `🔥 <b>Current Streak:</b> ${user.streak_daily} days`,
        { parse_mode: 'HTML' }
      );
    }

    // Determine streak
    let newStreak = 1;
    if (lastClaim > 0 && timeSinceLastClaim <= twoDays) {
      newStreak = (user.streak_daily || 0) + 1;
    }

    // Calculate reward
    const baseReward = 15000;
    const streakBonus = newStreak * 1500;
    const totalCoins = baseReward + streakBonus;

    // Save streak & timestamp
    userRepo.updateDailyStreak(userId, newStreak, now);
    userRepo.updateWallet(userId, totalCoins);

    // Every 7th day, award 1x banknote
    let specialRewardText = '';
    if (newStreak % 7 === 0) {
      inventoryRepo.addItem(userId, 'banknote', 1);
      specialRewardText = `\n🎁 <b>7-DAY STREAK BONUS:</b> You received 1x 📜 <b>Bank Note</b>!`;
    }

    // Add XP
    const xpResult = addXp(userId, 50);

    const msg = `📅 <b>Daily Paycheck Claimed!</b>\n\n` +
      `🪙 <b>Base Salary:</b> ${formatCoins(baseReward)}\n` +
      `🔥 <b>Streak Bonus:</b> +${formatCoins(streakBonus)} (${newStreak} Day Streak!)\n` +
      `💰 <b>Total Received:</b> <b>${formatCoins(totalCoins)}</b>\n` +
      `⭐ <b>XP Earned:</b> +50 XP` +
      specialRewardText +
      (xpResult.message ? `\n${xpResult.message}` : '');

    return ctx.reply(msg, { parse_mode: 'HTML' });
  }
};

export default daily;
