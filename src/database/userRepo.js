import { query, getClient } from './db.js';

export const userRepo = {
  async upsertUser(userId, username, firstName) {
    const cleanUsername = username ? username.replace(/^@/, '') : null;
    const cleanFirstName = firstName || 'Meme Lord';

    const sql = `
      INSERT INTO users (user_id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT(user_id) DO UPDATE SET
        username = COALESCE($2, users.username),
        first_name = COALESCE($3, users.first_name)
      RETURNING *;
    `;
    const res = await query(sql, [userId, cleanUsername, cleanFirstName]);
    return res.rows[0];
  },

  async getUser(userId) {
    const res = await query('SELECT * FROM users WHERE user_id = $1;', [userId]);
    return res.rows[0] || null;
  },

  async getUserByUsername(username) {
    if (!username) return null;
    const clean = username.replace(/^@/, '').trim();
    const res = await query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1;', [clean]);
    return res.rows[0] || null;
  },

  async getOrInitUser(userId, username, firstName) {
    let user = await this.getUser(userId);
    if (!user) {
      user = await this.upsertUser(userId, username, firstName);
    }
    return user;
  },

  async linkGroupMember(chatId, userId) {
    await query(
      'INSERT INTO group_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT(chat_id, user_id) DO NOTHING;',
      [chatId, userId]
    );
  },

  /**
   * Centralized coin movement handler with automatic currency logging and log pruning.
   * Runs in an atomic PostgreSQL transaction.
   */
  async updateCoins(userId, { walletDelta = 0, bankDelta = 0, sourceCommand = '/system', details = 'Coin update' } = {}) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Lock the user row for atomic consistency
      let res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
      let user = res.rows[0];

      if (!user) {
        // Auto-create user if not yet initialized
        const insertRes = await client.query(
          'INSERT INTO users (user_id, first_name) VALUES ($1, $2) RETURNING *;',
          [userId, 'Meme Lord']
        );
        user = insertRes.rows[0];
      }

      const oldWallet = Number(user.wallet || 0);
      const oldBank = Number(user.bank || 0);

      const newWallet = Math.max(0, oldWallet + Number(walletDelta || 0));
      const newBank = Math.max(0, oldBank + Number(bankDelta || 0));

      const updateRes = await client.query(
        'UPDATE users SET wallet = $1, bank = $2, updated_at = NOW() WHERE user_id = $3 RETURNING *;',
        [newWallet, newBank, userId]
      );
      const updatedUser = updateRes.rows[0];

      // 1. Log wallet change if any
      if (walletDelta !== 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [userId, walletDelta, 'wallet', newWallet, newBank, sourceCommand, details]
        );
      }

      // 2. Log bank change if any
      if (bankDelta !== 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [userId, bankDelta, 'bank', newWallet, newBank, sourceCommand, details]
        );
      }

      // 3. Prune old logs beyond 100 entries for this user
      if (walletDelta !== 0 || bankDelta !== 0) {
        await client.query(
          `DELETE FROM currency_logs
           WHERE id IN (
             SELECT id FROM currency_logs
             WHERE user_id = $1
             ORDER BY created_at DESC
             OFFSET 100
           );`,
          [userId]
        );
      }

      await client.query('COMMIT');
      return {
        ...updatedUser,
        wallet: newWallet,
        bank: newBank,
        oldWallet,
        oldBank
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[userRepo.updateCoins Error user:${userId}]:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  },

  async updateWallet(userId, delta, sourceCommand = '/system', details = 'Wallet update') {
    return await this.updateCoins(userId, { walletDelta: delta, sourceCommand, details });
  },

  async setWallet(userId, amount, sourceCommand = '/system', details = 'Set wallet') {
    const user = await this.getOrInitUser(userId);
    const delta = amount - user.wallet;
    return await this.updateCoins(userId, { walletDelta: delta, sourceCommand, details });
  },

  async addWallet(userId, amount, sourceCommand = '/system', details = 'Add coins') {
    return await this.updateCoins(userId, { walletDelta: amount, sourceCommand, details });
  },

  async updateBank(userId, delta, sourceCommand = '/system', details = 'Bank update') {
    return await this.updateCoins(userId, { bankDelta: delta, sourceCommand, details });
  },

  async increaseBankMax(userId, increase) {
    const res = await query(
      'UPDATE users SET bank_max = bank_max + $1 WHERE user_id = $2 RETURNING *;',
      [increase, userId]
    );
    return res.rows[0];
  },

  async deposit(userId, amount) {
    const user = await this.getUser(userId);
    if (!user) return { success: false, reason: 'User not found' };

    const availableSpace = Math.max(0, user.bank_max - user.bank);
    if (availableSpace <= 0) {
      return { success: false, reason: 'Bank vault is already full!' };
    }

    const depositAmount = Math.min(user.wallet, availableSpace, amount);
    if (depositAmount <= 0) {
      return { success: false, reason: 'Not enough coins in wallet!' };
    }

    const updated = await this.updateCoins(userId, {
      walletDelta: -depositAmount,
      bankDelta: depositAmount,
      sourceCommand: '/deposit',
      details: 'Deposited into Bank Vault'
    });

    return {
      success: true,
      deposited: depositAmount,
      newWallet: updated.wallet,
      newBank: updated.bank
    };
  },

  async withdraw(userId, amount) {
    const user = await this.getUser(userId);
    if (!user) return { success: false, reason: 'User not found' };

    const withdrawAmount = Math.min(user.bank, amount);
    if (withdrawAmount <= 0) {
      return { success: false, reason: 'Not enough coins in bank vault!' };
    }

    const updated = await this.updateCoins(userId, {
      walletDelta: withdrawAmount,
      bankDelta: -withdrawAmount,
      sourceCommand: '/withdraw',
      details: 'Withdrawn from Bank Vault'
    });

    return {
      success: true,
      withdrawn: withdrawAmount,
      newWallet: updated.wallet,
      newBank: updated.bank
    };
  },

  async transferWallet(fromUserId, toUserId, amount, taxRate = 0.05, senderUsername = 'Player', recipientUsername = 'Player') {
    const sender = await this.getUser(fromUserId);
    const recipient = await this.getUser(toUserId);

    if (!sender || !recipient) {
      return { success: false, reason: 'User not found' };
    }
    if (sender.wallet < amount) {
      return { success: false, reason: 'Insufficient wallet balance' };
    }

    const tax = Math.floor(amount * taxRate);
    const netAmount = amount - tax;

    // Deduct full amount from sender
    await this.updateCoins(fromUserId, {
      walletDelta: -amount,
      sourceCommand: '/give',
      details: `Transferred to @${recipient.username || toUserId} (Tax: 🪙 ${tax.toLocaleString()})`
    });

    // Award net amount to recipient
    await this.updateCoins(toUserId, {
      walletDelta: netAmount,
      sourceCommand: '/give',
      details: `Received from @${sender.username || fromUserId}`
    });

    return { success: true, amount, netAmount, tax };
  },

  async setJob(userId, jobId) {
    await query('UPDATE users SET job_id = $1 WHERE user_id = $2;', [jobId, userId]);
  },

  async incrementWorkShifts(userId) {
    await query('UPDATE users SET work_shifts = work_shifts + 1 WHERE user_id = $1;', [userId]);
  },

  async updateDailyStreak(userId, streak, timestamp) {
    await query(
      'UPDATE users SET streak_daily = $1, last_daily = $2 WHERE user_id = $3;',
      [streak, timestamp, userId]
    );
  },

  async setPassiveMode(userId, passiveMode) {
    await query('UPDATE users SET passive_mode = $1 WHERE user_id = $2;', [passiveMode ? 1 : 0, userId]);
  },

  // Premium Features
  async isPremium(userId) {
    const user = await this.getUser(userId);
    if (!user) return false;
    return Number(user.premium_until || 0) > Date.now();
  },

  async getPremiumRemaining(userId) {
    const user = await this.getUser(userId);
    if (!user || !user.premium_until) return 0;
    return Math.max(0, Number(user.premium_until) - Date.now());
  },

  async setPremium(userId, durationMs) {
    const user = await this.getUser(userId);
    const currentExpiry = (user && Number(user.premium_until) > Date.now()) ? Number(user.premium_until) : Date.now();
    const newExpiry = currentExpiry + durationMs;
    await query('UPDATE users SET premium_until = $1 WHERE user_id = $2;', [newExpiry, userId]);
    return newExpiry;
  },

  async removePremium(userId) {
    await query('UPDATE users SET premium_until = 0 WHERE user_id = $1;', [userId]);
  },

  // Custom Luck (Underground Owner System)
  async setCustomLuck(userId, percentage) {
    await query(
      'UPDATE users SET custom_luck = $1 WHERE user_id = $2;',
      [Math.max(0, Math.floor(percentage)), userId]
    );
  },

  async getCustomLuck(userId) {
    const user = await this.getUser(userId);
    return user ? Number(user.custom_luck || 0) : 0;
  },

  async prestigeReset(userId, newPrestige, newBankMax) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT wallet, bank FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
      const currentWallet = Number(res.rows[0]?.wallet || 0);

      await client.query(
        `UPDATE users
         SET wallet = 0,
             bank = 0,
             level = 1,
             xp = 0,
             prestige = $1,
             bank_max = $2,
             updated_at = NOW()
         WHERE user_id = $3;`,
        [newPrestige, newBankMax, userId]
      );

      if (currentWallet > 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, 0, 0, '/prestige', $4);`,
          [userId, -currentWallet, 'wallet', `Prestige Tier ${newPrestige} reset`]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async getLeaderboard(chatId = null, type = 'coins', limit = 10) {
    const isCoins = type === 'coins';
    const orderBy = isCoins ? '(u.wallet + u.bank) DESC' : 'u.level DESC, u.xp DESC';

    if (chatId) {
      const sql = `
        SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until,
               (u.wallet + u.bank) AS total_coins
        FROM users u
        INNER JOIN group_members gm ON u.user_id = gm.user_id
        WHERE gm.chat_id = $1
        ORDER BY ${orderBy}
        LIMIT $2;
      `;
      const res = await query(sql, [chatId, limit]);
      return res.rows;
    }

    const sql = `
      SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until,
             (u.wallet + u.bank) AS total_coins
      FROM users u
      ORDER BY ${orderBy}
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows;
  }
};

export default userRepo;
