import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, formatTime } from '../../utils/formatters.js';

export const daily = {
  name: 'daily',
  aliases: [],
  description: 'Claim your daily coin salary and build a loyalty streak (2x for Premium)',
  cooldown: 0, // Handled internally via last_daily timestamp (calendar 24h)

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const now = Math.floor(Date.now() / 1000);
    const lastClaim = Number(user.last_daily || 0);
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
      newStreak = (Number(user.streak_daily) || 0) + 1;
    }

    const isPremium = await userRepo.isPremium(userId);

    // Calculate reward: 15,000 + (streak * 2,000), doubled if Premium!
    const baseReward = 15000;
    const streakBonus = newStreak * 2000;
    const standardTotal = baseReward + streakBonus;
    const totalCoins = isPremium ? standardTotal * 2 : standardTotal;

    // Save streak & timestamp
    await userRepo.updateDailyStreak(userId, newStreak, now);
    await userRepo.updateCoins(userId, {
      walletDelta: totalCoins,
      sourceCommand: '/daily',
      details: `Daily Claim (${newStreak}d streak${isPremium ? ' • 2x VIP' : ''})`
    });

    // Every 7th day, award 1x banknote
    let specialRewardText = '';
    if (newStreak % 7 === 0) {
      const notesToGive = isPremium ? 2 : 1;
      await inventoryRepo.addItem(userId, 'banknote', notesToGive);
      specialRewardText = `\n🎁 <b>7-DAY STREAK BONUS:</b> You received <b>${notesToGive}x</b> 📜 <b>Bank Note</b>!`;
    }

    // Add XP
    const xpResult = await addXp(userId, isPremium ? 80 : 50);

    const premiumText = isPremium ? '\n💎 <b>2x PREMIUM MULTIPLIER APPLIED!</b>' : '\n💡 <i>Tip: Premium members get 2x Daily Coins!</i>';

    const msg = `📅 <b>Daily Paycheck Claimed!</b>\n\n` +
      `🪙 <b>Base Salary:</b> ${formatCoins(baseReward)}\n` +
      `🔥 <b>Streak Bonus:</b> +${formatCoins(streakBonus)} (${newStreak} Day Streak!)\n` +
      `💰 <b>Total Received:</b> <b>${formatCoins(totalCoins)}</b>` +
      premiumText +
      specialRewardText +
      `\n⭐ <b>XP Earned:</b> +${xpResult.earnedXp} XP` +
      (xpResult.message ? `\n${xpResult.message}` : '');

    return ctx.reply(msg, { parse_mode: 'HTML' });
  }
};

export default daily;
