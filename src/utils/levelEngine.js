import { getClient } from '../database/db.js';
import userRepo from '../database/userRepo.js';
import { randomBetween, formatCoins } from './formatters.js';

export function getXpThreshold(level) {
  return Math.max(100, Number(level) * 100);
}

const MAX_BALANCE = 1_000_000_000_000_000;

export async function addXp(userId, baseAmount = null) {
  const rawBase = baseAmount !== null ? baseAmount : randomBetween(15, 35);
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
    let user = res.rows[0];

    if (!user) {
      await client.query('COMMIT');
      return { leveledUp: false, earnedXp: rawBase, newLevel: 1, message: '' };
    }

    const prestigeLevel = Number(user.prestige || 0);
    const finalXp = Math.floor(rawBase * (1 + (prestigeLevel * 0.01)));

    let currentXp = Number(user.xp || 0) + finalXp;
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
      const oldWallet = Number(user.wallet || 0);
      const newWallet = Math.min(MAX_BALANCE, oldWallet + totalCoinsRewarded);
      const actualWalletAdded = Math.max(0, newWallet - oldWallet);
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
      if (actualWalletAdded > 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, 'wallet', $3, $4, '/level-up', $5);`,
          [
            userId,
            actualWalletAdded,
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
        earnedXp: finalXp,
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
        earnedXp: finalXp,
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

export async function addLevels(userId, levelsToAdd = 10, sourceCommand = '/use gtkcondom') {
  const count = Math.max(1, Math.floor(Number(levelsToAdd || 1)));
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
    const user = res.rows[0];

    if (!user) {
      await client.query('COMMIT');
      return { oldLevel: 1, newLevel: 1, totalCoinsRewarded: 0, totalBankCapacityAdded: 0 };
    }

    const oldLevel = Number(user.level || 1);
    let currentLevel = oldLevel;
    let totalCoinsRewarded = 0;
    let totalBankCapacityAdded = 0;

    for (let i = 0; i < count; i++) {
      currentLevel += 1;
      totalCoinsRewarded += currentLevel * 1000;
      totalBankCapacityAdded += currentLevel * 2500;
    }

    const oldWallet = Number(user.wallet || 0);
    const newWallet = Math.min(MAX_BALANCE, oldWallet + totalCoinsRewarded);
    const actualWalletAdded = Math.max(0, newWallet - oldWallet);
    const newBankMax = Number(user.bank_max || 5000) + totalBankCapacityAdded;

    await client.query(
      `UPDATE users
       SET level = $1,
           wallet = $2,
           bank_max = $3,
           updated_at = NOW()
       WHERE user_id = $4;`,
      [currentLevel, newWallet, newBankMax, userId]
    );

    if (actualWalletAdded > 0) {
      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'wallet', $3, $4, $5, $6);`,
        [
          userId,
          actualWalletAdded,
          newWallet,
          Number(user.bank || 0),
          sourceCommand,
          `Instant +${count} Levels (${oldLevel} -> ${currentLevel})`
        ]
      );
    }

    await client.query('COMMIT');
    return {
      oldLevel,
      newLevel: currentLevel,
      totalCoinsRewarded,
      totalBankCapacityAdded,
      newWallet,
      newBankMax
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[levelEngine.addLevels Error user:${userId}]:`, err.message);
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
  addLevels,
  getXpProgress
};
