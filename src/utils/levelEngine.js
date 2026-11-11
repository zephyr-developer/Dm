import db from '../database/db.js';
import userRepo from '../database/userRepo.js';
import { randomBetween, formatCoins } from './formatters.js';

export function getXpThreshold(level) {
  return Math.max(100, level * 100);
}

export function addXp(userId, xpAmount = null) {
  const earnedXp = xpAmount !== null ? xpAmount : randomBetween(15, 35);

  const tx = db.transaction(() => {
    let user = userRepo.getUser(userId);
    if (!user) return { leveledUp: false, earnedXp, newLevel: 1, message: '' };

    let currentXp = user.xp + earnedXp;
    let currentLevel = user.level;
    let leveledUp = false;
    let totalCoinsRewarded = 0;
    let totalBankCapacityAdded = 0;
    const oldLevel = currentLevel;

    while (currentXp >= getXpThreshold(currentLevel)) {
      currentXp -= getXpThreshold(currentLevel);
      currentLevel += 1;
      leveledUp = true;

      const coinReward = currentLevel * 1000;
      const bankMaxReward = currentLevel * 2500;

      totalCoinsRewarded += coinReward;
      totalBankCapacityAdded += bankMaxReward;
    }

    if (leveledUp) {
      db.prepare(`
        UPDATE users
        SET level = ?,
            xp = ?,
            wallet = wallet + ?,
            bank_max = bank_max + ?
        WHERE user_id = ?
      `).run(currentLevel, currentXp, totalCoinsRewarded, totalBankCapacityAdded, userId);

      const message = `\n🎉 <b>LEVEL UP!</b> You reached <b>Level ${currentLevel}</b>!\n` +
        `🎁 <b>Rewards:</b> +${formatCoins(totalCoinsRewarded)} to Wallet & +${totalBankCapacityAdded.toLocaleString()} Bank Capacity!`;

      return {
        leveledUp: true,
        earnedXp,
        oldLevel,
        newLevel: currentLevel,
        totalCoinsRewarded,
        totalBankCapacityAdded,
        message
      };
    } else {
      db.prepare(`UPDATE users SET xp = ? WHERE user_id = ?`).run(currentXp, userId);
      return {
        leveledUp: false,
        earnedXp,
        newLevel: currentLevel,
        message: ''
      };
    }
  });

  return tx();
}

export function getXpProgress(user) {
  if (!user) return { current: 0, max: 100, percent: 0 };
  const max = getXpThreshold(user.level);
  const current = Math.min(user.xp, max);
  const percent = Math.floor((current / max) * 100);
  return { current, max, percent };
}

export default {
  getXpThreshold,
  addXp,
  getXpProgress
};
