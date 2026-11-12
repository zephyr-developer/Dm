import { getClient } from '../database/db.js';
import userRepo from '../database/userRepo.js';
import { randomBetween, formatCoins } from './formatters.js';

export function getXpThreshold(level) {
  return Math.max(100, Number(level) * 100);
}

export async function addXp(userId, xpAmount = null) {
  const earnedXp = xpAmount !== null ? xpAmount : randomBetween(15, 35);
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
    let user = res.rows[0];

    if (!user) {
      await client.query('COMMIT');
      return { leveledUp: false, earnedXp, newLevel: 1, message: '' };
    }

    let currentXp = Number(user.xp || 0) + earnedXp;
    let currentLevel = Number(user.level || 1);
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
      const newWallet = Number(user.wallet || 0) + totalCoinsRewarded;
      const newBankMax = Number(user.bank_max || 5000) + totalBankCapacityAdded;

      await client.query(
        `UPDATE users
         SET level = $1,
             xp = $2,
             wallet = $3,
             bank_max = $4,
             updated_at = NOW()
         WHERE user_id = $5;`,
        [currentLevel, currentXp, newWallet, newBankMax, userId]
      );

      // Log currency reward for level-up
      if (totalCoinsRewarded > 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, 'wallet', $3, $4, '/level-up', $5);`,
          [
            userId,
            totalCoinsRewarded,
            newWallet,
            Number(user.bank || 0),
            `Promoted from Level ${oldLevel} to Level ${currentLevel}`
          ]
        );
      }

      await client.query('COMMIT');

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
      await client.query('UPDATE users SET xp = $1, updated_at = NOW() WHERE user_id = $2;', [currentXp, userId]);
      await client.query('COMMIT');

      return {
        leveledUp: false,
        earnedXp,
        newLevel: currentLevel,
        message: ''
      };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[levelEngine.addXp Error user:${userId}]:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

export function getXpProgress(user) {
  if (!user) return { current: 0, max: 100, percent: 0 };
  const max = getXpThreshold(user.level);
  const current = Math.min(Number(user.xp || 0), max);
  const percent = Math.floor((current / max) * 100);
  return { current, max, percent };
}

export default {
  getXpThreshold,
  addXp,
  getXpProgress
};
