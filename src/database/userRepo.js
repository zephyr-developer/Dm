import { query, getClient } from './db.js';

export const OVERFLOW_THRESHOLD = 1_000_000_000_000_000;   // 1 Quadrillion
export const OVERFLOW_BASE = 900_000_000_000_000;         // 900 Trillion baseline
export const SHARD_RATE = 100_000_000_000_000;            // 100 Trillion coins = 1 Sovereign Shard
export const FRENZY_TARGET_AMOUNT = 5_000_000_000_000_000; // 5 Quadrillion Global Frenzy goal

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

  async setAccountStatus(userId, status, reason = null, flaggedAmount = 0, banExpiresAt = null) {
    const validStatus = ['active', 'frozen', 'banned'].includes(status) ? status : 'active';
    const flagged = validStatus === 'active' ? 0 : Math.max(0, Math.floor(Number(flaggedAmount || 0)));
    const finalReason = validStatus === 'active' ? null : reason;
    const finalExpiry = validStatus === 'active'
      ? null
      : (banExpiresAt && Number(banExpiresAt) > 0 ? Math.floor(Number(banExpiresAt)) : null);

    // Per-case appeal cooldown: ALWAYS reset last_appeal_at = 0 when unbanning/unfreezing OR starting a new ban/freeze case
    const res = await query(
      `UPDATE users
       SET account_status = $1,
           status_reason = $2,
           flagged_amount = $3,
           ban_expires_at = $4,
           last_appeal_at = 0,
           updated_at = NOW()
       WHERE user_id = $5
       RETURNING *;`,
      [validStatus, finalReason, flagged, finalExpiry, userId]
    );
    return res.rows[0] || null;
  },

  async setCanReplyOwner(userId, canReply) {
    const val = canReply ? 1 : 0;
    const res = await query(
      `UPDATE users SET can_reply_owner = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [val, userId]
    );
    return res.rows[0] || null;
  },

  async setUltimateGambler(userId, expiresAt = null) {
    let val = null;
    if (Number(expiresAt) === -1) {
      val = -1;
    } else if (expiresAt !== null && expiresAt !== undefined && Number(expiresAt) > 0) {
      val = Math.floor(Number(expiresAt));
    }
    const res = await query(
      `UPDATE users SET ultimate_expires_at = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [val, userId]
    );
    return res.rows[0] || null;
  },

  async isUltimateGambler(userOrId) {
    if (!userOrId) return false;
    const user = typeof userOrId === 'object' ? userOrId : await this.getUser(Number(userOrId));
    if (!user) return false;

    const exp = user.ultimate_expires_at === null || user.ultimate_expires_at === undefined
      ? 0
      : Number(user.ultimate_expires_at);

    if (exp === -1) return true;
    if (exp > 0 && exp > Date.now()) return true;

    if (exp > 0 && Date.now() >= exp) {
      user.ultimate_expires_at = null;
      await this.setUltimateGambler(user.user_id, null).catch(() => {});
    }
    return false;
  },

  async setLastAppealAt(userId, timestamp = Date.now()) {
    const res = await query(
      `UPDATE users SET last_appeal_at = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [Math.floor(Number(timestamp || Date.now())), userId]
    );
    return res.rows[0] || null;
  },

  async setOwnerChatId(userId, chatId) {
    const res = await query(
      `UPDATE users SET owner_chat_id = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [Number(chatId), userId]
    );
    return res.rows[0] || null;
  },

  async getOwnerUser() {
    const res = await query(`SELECT * FROM users WHERE LOWER(username) = 'tzhunyuan' LIMIT 1;`);
    if (res.rows[0]) return res.rows[0];
    if (process.env.OWNER_ID) {
      return await this.getUser(Number(process.env.OWNER_ID));
    }
    return null;
  },

  async setEquippedTitle(userId, title) {
    const cleanTitle = String(title || 'Newbie').trim().slice(0, 64) || 'Newbie';
    const res = await query(
      `UPDATE users SET equipped_title = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [cleanTitle, userId]
    );
    return res.rows[0] || null;
  },

  async setCustomTitle(userId, customTitle, timestamp = Date.now()) {
    const cleanTitle = String(customTitle || '').trim().slice(0, 64);
    const ts = Math.floor(Number(timestamp || Date.now()));
    const res = await query(
      `UPDATE users
       SET custom_title = $1, equipped_title = $2, last_custom_title_at = $3, updated_at = NOW()
       WHERE user_id = $4
       RETURNING *;`,
      [cleanTitle, cleanTitle, ts, userId]
    );
    return res.rows[0] || null;
  },

  /**
   * Centralized coin movement handler with automatic currency logging and log pruning.
   * Runs in an atomic PostgreSQL transaction with Sovereign Shard overflow conversion and anti-cheat checks.
   */
  async updateCoins(userId, { walletDelta = 0, bankDelta = 0, sourceCommand = '/system', details = 'Coin update', skipAntiCheat = false } = {}) {
    const OVERFLOW_THRESHOLD_BIG = BigInt(OVERFLOW_THRESHOLD);
    const OVERFLOW_BASE_BIG = BigInt(OVERFLOW_BASE);
    const SHARD_RATE_BIG = BigInt(SHARD_RATE);

    const convertOverflow = (currentBalance, delta) => {
      const baseNum = Number(currentBalance);
      const deltaNum = Number(delta || 0);
      const safeBase = Number.isFinite(baseNum) && !isNaN(baseNum) ? Math.trunc(baseNum) : 0;
      const safeDelta = Number.isFinite(deltaNum) && !isNaN(deltaNum) ? Math.trunc(deltaNum) : 0;
      const rawBig = BigInt(safeBase) + BigInt(safeDelta);

      if (rawBig <= 0n) {
        return { balance: 0, shards: 0 };
      }
      if (rawBig <= OVERFLOW_THRESHOLD_BIG) {
        return { balance: Number(rawBig), shards: 0 };
      }

      const shardsBig = (rawBig - OVERFLOW_BASE_BIG) / SHARD_RATE_BIG;
      const remainderBig = rawBig - (shardsBig * SHARD_RATE_BIG);

      return {
        balance: Math.max(0, Number(remainderBig)),
        shards: Number(shardsBig)
      };
    };

    const client = await getClient();
    let resultData = null;
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
      const oldShards = Number(user.sovereign_shards || 0);

      const walletConv = convertOverflow(oldWallet, walletDelta);
      const bankConv = convertOverflow(oldBank, bankDelta);

      const newWallet = walletConv.balance;
      const newBank = bankConv.balance;
      const shardsGained = walletConv.shards + bankConv.shards;
      const newShards = oldShards + shardsGained;

      const actualWalletDelta = newWallet - oldWallet;
      const actualBankDelta = newBank - oldBank;

      const updateRes = await client.query(
        'UPDATE users SET wallet = $1, bank = $2, sovereign_shards = $3, updated_at = NOW() WHERE user_id = $4 RETURNING *;',
        [newWallet, newBank, newShards, userId]
      );
      const updatedUser = updateRes.rows[0];

      // 1. Log wallet change if any
      if (actualWalletDelta !== 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [userId, actualWalletDelta, 'wallet', newWallet, newBank, sourceCommand, details]
        );
      }

      // 2. Log bank change if any
      if (actualBankDelta !== 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [userId, actualBankDelta, 'bank', newWallet, newBank, sourceCommand, details]
        );
      }

      // 3. Log Sovereign Shard overflow conversion if any
      if (shardsGained > 0) {
        await client.query(
          `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [userId, shardsGained, 'shards', newWallet, newBank, sourceCommand, `${details} (Converted 100T overflow into +${shardsGained} Sovereign Shard${shardsGained > 1 ? 's' : ''})`]
        );
      }

      // 4. Prune old logs beyond 100 entries for this user
      if (actualWalletDelta !== 0 || actualBankDelta !== 0 || shardsGained > 0) {
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
      resultData = {
        ...updatedUser,
        wallet: newWallet,
        bank: newBank,
        sovereign_shards: newShards,
        overflowShards: shardsGained,
        shardsGained,
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

    if (!skipAntiCheat && resultData) {
      const gamblingSources = new Set(['/blackjack', '/slots', '/scratch', '/highlow']);
      const isGambleSource = gamblingSources.has(String(sourceCommand || '').trim().toLowerCase());
      const isUltimate = isGambleSource ? await this.isUltimateGambler(resultData) : false;

      if (!(isGambleSource && isUltimate)) {
        const { evaluateTransactionAnomaly } = await import('../services/antiCheat.js');
        const acResult = await evaluateTransactionAnomaly({
          user: resultData,
          oldWallet: resultData.oldWallet,
          oldBank: resultData.oldBank,
          newWallet: resultData.wallet,
          newBank: resultData.bank,
          walletDelta: Number(walletDelta || 0),
          bankDelta: Number(bankDelta || 0),
          sourceCommand,
          details
        });
        if (acResult?.triggered && acResult.user) {
          resultData.account_status = acResult.user.account_status;
          resultData.status_reason = acResult.user.status_reason;
          resultData.flagged_amount = acResult.user.flagged_amount;
        }
      }
    }

    return resultData;
  },

  async updateWallet(userId, delta, sourceCommand = '/system', details = 'Wallet update') {
    return await this.updateCoins(userId, { walletDelta: delta, sourceCommand, details });
  },

  async setWallet(userId, amount, sourceCommand = '/system', details = 'Set wallet') {
    const MAX_BALANCE = 1_000_000_000_000_000;
    const clampedTarget = Math.min(MAX_BALANCE, Math.max(0, Math.floor(Number(amount || 0))));
    const user = await this.getOrInitUser(userId);
    const delta = clampedTarget - Number(user.wallet || 0);
    return await this.updateCoins(userId, { walletDelta: delta, sourceCommand, details });
  },

  async setBank(userId, amount, sourceCommand = '/system', details = 'Set bank') {
    const MAX_BALANCE = 1_000_000_000_000_000;
    const clampedTarget = Math.min(MAX_BALANCE, Math.max(0, Math.floor(Number(amount || 0))));
    const user = await this.getOrInitUser(userId);
    const delta = clampedTarget - Number(user.bank || 0);
    return await this.updateCoins(userId, { bankDelta: delta, sourceCommand, details });
  },

  async addWallet(userId, amount, sourceCommand = '/system', details = 'Add coins') {
    return await this.updateCoins(userId, { walletDelta: amount, sourceCommand, details });
  },

  async updateBank(userId, delta, sourceCommand = '/system', details = 'Bank update') {
    return await this.updateCoins(userId, { bankDelta: delta, sourceCommand, details });
  },

  async increaseBankMax(userId, increase) {
    const inc = Math.max(0, Math.floor(Number(increase || 0)));
    const res = await query(
      'UPDATE users SET bank_max = LEAST(bank_max + $1, 9000000000000000), updated_at = NOW() WHERE user_id = $2 RETURNING *;',
      [inc, userId]
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

  async transferWallet(
    fromUserId,
    toUserId,
    amount,
    taxRate = 0.05,
    senderUsername = 'Player',
    recipientUsername = 'Player',
    { skipAntiCheat = false } = {}
  ) {
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
    const updatedSender = await this.updateCoins(fromUserId, {
      walletDelta: -amount,
      sourceCommand: '/give',
      details: `Transferred to @${recipient.username || toUserId} (Tax: 🪙 ${tax.toLocaleString()})`,
      skipAntiCheat
    });

    // Award net amount to recipient
    const updatedRecipient = await this.updateCoins(toUserId, {
      walletDelta: netAmount,
      sourceCommand: '/give',
      details: `Received from @${sender.username || fromUserId}`,
      skipAntiCheat
    });

    return {
      success: true,
      amount,
      netAmount,
      tax,
      senderAfter: updatedSender,
      recipientAfter: updatedRecipient
    };
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

  async addShards(userId, amount) {
    const add = Math.max(0, Math.floor(Number(amount || 0)));
    if (add <= 0) return await this.getUser(userId);
    const res = await query(
      `UPDATE users SET sovereign_shards = COALESCE(sovereign_shards, 0) + $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [add, userId]
    );
    return res.rows[0] || null;
  },

  async compressShardsAtomic(userId, shardsCount) {
    const count = Math.floor(Number(shardsCount || 0));
    if (!Number.isSafeInteger(count) || count <= 0 || count > 100) {
      return { success: false, reason: 'INVALID_AMOUNT' };
    }
    const coinsCost = count * SHARD_RATE;
    if (!Number.isSafeInteger(coinsCost) || coinsCost <= 0) {
      return { success: false, reason: 'INVALID_AMOUNT' };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
      const user = res.rows[0];
      if (!user || Number(user.wallet || 0) < coinsCost) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_FUNDS' };
      }

      const upd = await client.query(
        `UPDATE users
         SET wallet = wallet - $1,
             sovereign_shards = COALESCE(sovereign_shards, 0) + $2,
             updated_at = NOW()
         WHERE user_id = $3 AND wallet >= $1
         RETURNING *;`,
        [coinsCost, count, userId]
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_FUNDS' };
      }

      const updatedUser = upd.rows[0];
      const newWallet = Number(updatedUser.wallet || 0);
      const newBank = Number(updatedUser.bank || 0);
      const newShards = Number(updatedUser.sovereign_shards || 0);

      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'wallet', $3, $4, '/compress', $5);`,
        [userId, -coinsCost, newWallet, newBank, `Compressed into +${count} Sovereign Shard${count > 1 ? 's' : ''}`]
      );

      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'shards', $3, $4, '/compress', $5);`,
        [userId, count, newWallet, newBank, `Forged ${count} Sovereign Shard${count > 1 ? 's' : ''} from wallet`]
      );

      await client.query('COMMIT');
      return {
        success: true,
        shardsAdded: count,
        coinsSpent: coinsCost,
        newWallet,
        newShards
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async decompressShardsAtomic(userId, shardsCount) {
    const count = Math.floor(Number(shardsCount || 0));
    if (!Number.isSafeInteger(count) || count <= 0) {
      return { success: false, reason: 'INVALID_AMOUNT' };
    }
    if (count > 9) {
      return { success: false, reason: 'EXCEEDS_WALLET_CAP' };
    }
    const coinsAdd = count * SHARD_RATE;

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM users WHERE user_id = $1 FOR UPDATE;', [userId]);
      const user = res.rows[0];
      if (!user || Number(user.sovereign_shards || 0) < count) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_SHARDS' };
      }

      const currentWallet = Number(user.wallet || 0);
      if (currentWallet + coinsAdd > OVERFLOW_BASE) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'EXCEEDS_WALLET_CAP' };
      }

      const upd = await client.query(
        `UPDATE users
         SET wallet = wallet + $1,
             sovereign_shards = sovereign_shards - $2,
             updated_at = NOW()
         WHERE user_id = $3 AND COALESCE(sovereign_shards, 0) >= $2
         RETURNING *;`,
        [coinsAdd, count, userId]
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_SHARDS' };
      }

      const updatedUser = upd.rows[0];
      const newWallet = Number(updatedUser.wallet || 0);
      const newBank = Number(updatedUser.bank || 0);
      const newShards = Number(updatedUser.sovereign_shards || 0);

      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'wallet', $3, $4, '/decompress', $5);`,
        [userId, coinsAdd, newWallet, newBank, `Decompressed ${count} Sovereign Shard${count > 1 ? 's' : ''}`]
      );

      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'shards', $3, $4, '/decompress', $5);`,
        [userId, -count, newWallet, newBank, `Melted ${count} Sovereign Shard${count > 1 ? 's' : ''} into wallet`]
      );

      await client.query('COMMIT');
      return {
        success: true,
        shardsConverted: count,
        coinsAdded: coinsAdd,
        newWallet,
        newShards
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async spendShardsAtomic(userId, costShards) {
    const cost = Math.floor(Number(costShards || 0));
    if (!Number.isSafeInteger(cost) || cost <= 0) {
      return { success: false, remainingShards: 0 };
    }
    const res = await query(
      `UPDATE users
       SET sovereign_shards = sovereign_shards - $1,
           updated_at = NOW()
       WHERE user_id = $2 AND COALESCE(sovereign_shards, 0) >= $1
       RETURNING *;`,
      [cost, userId]
    );
    if (res.rows.length === 0) {
      return { success: false, remainingShards: 0 };
    }
    const updatedUser = res.rows[0];
    return {
      success: true,
      remainingShards: Math.max(0, Number(updatedUser.sovereign_shards || 0)),
      user: updatedUser
    };
  },

  async addPermLuck(userId, addAmount, maxCap = 25) {
    const add = Math.max(0, Math.floor(Number(addAmount || 0)));
    const cap = Math.max(0, Math.floor(Number(maxCap || 25)));
    const res = await query(
      `UPDATE users
       SET perm_luck_bonus = LEAST($2, COALESCE(perm_luck_bonus, 0) + $1),
           updated_at = NOW()
       WHERE user_id = $3
       RETURNING *;`,
      [add, cap, userId]
    );
    return res.rows[0] || null;
  },

  async unlockTitle(userId, titleName) {
    const clean = String(titleName || '').trim().replace(/\|/g, '');
    if (!clean) return null;
    const user = await this.getUser(userId);
    if (!user) return null;

    const existing = String(user.unlocked_titles || '')
      .split('|')
      .map(s => s.trim())
      .filter(Boolean);

    if (existing.some(t => t.toLowerCase() === clean.toLowerCase())) {
      return user;
    }

    existing.push(clean);
    const serialized = existing.join('|');
    const res = await query(
      `UPDATE users SET unlocked_titles = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
      [serialized, userId]
    );
    return res.rows[0] || user;
  },

  async getFrenzyEvent() {
    await query(
      `INSERT INTO global_events (event_key, current_amount, target_amount, frenzy_expires_at, top_donor_id, top_donor_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(event_key) DO NOTHING;`,
      ['frenzy_altar', 0, FRENZY_TARGET_AMOUNT, 0, null, 0]
    );

    const res = await query(`SELECT * FROM global_events WHERE event_key = $1;`, ['frenzy_altar']);
    const row = res.rows[0] || {
      current_amount: 0,
      target_amount: FRENZY_TARGET_AMOUNT,
      frenzy_expires_at: 0,
      top_donor_id: null,
      top_donor_amount: 0
    };

    const now = Date.now();
    const frenzyExpiresAt = Number(row.frenzy_expires_at || 0);
    const isActive = frenzyExpiresAt > now;
    const remainingSeconds = isActive ? Math.ceil((frenzyExpiresAt - now) / 1000) : 0;
    const topDonorId = row.top_donor_id !== null && row.top_donor_id !== undefined ? Number(row.top_donor_id) : null;
    const topDonorUser = topDonorId ? await this.getUser(topDonorId) : null;

    return {
      currentAmount: Math.max(0, Number(row.current_amount || 0)),
      targetAmount: Math.max(1, Number(row.target_amount || FRENZY_TARGET_AMOUNT)),
      frenzyExpiresAt,
      isActive,
      remainingSeconds,
      topDonorId,
      topDonorAmount: Math.max(0, Number(row.top_donor_amount || 0)),
      topDonorUser
    };
  },

  async donateToFrenzyAtomic(userId, amount) {
    const amt = Math.floor(Number(amount || 0));
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      return { success: false, reason: 'INVALID_AMOUNT' };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO global_events (event_key, current_amount, target_amount, frenzy_expires_at, top_donor_id, top_donor_amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(event_key) DO NOTHING;`,
        ['frenzy_altar', 0, FRENZY_TARGET_AMOUNT, 0, null, 0]
      );

      const uRes = await client.query(
        `UPDATE users
         SET wallet = wallet - $1,
             frenzy_donated = COALESCE(frenzy_donated, 0) + $1,
             frenzy_cycle_donated = COALESCE(frenzy_cycle_donated, 0) + $1,
             updated_at = NOW()
         WHERE user_id = $2 AND wallet >= $1
         RETURNING *;`,
        [amt, userId]
      );

      if (uRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'INSUFFICIENT_FUNDS' };
      }

      const updatedUser = uRes.rows[0];
      const newWallet = Number(updatedUser.wallet || 0);
      const newBank = Number(updatedUser.bank || 0);
      const donorCycleTotal = Number(updatedUser.frenzy_cycle_donated || amt);

      await client.query(
        `INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
         VALUES ($1, $2, 'wallet', $3, $4, '/frenzy', $5);`,
        [userId, -amt, newWallet, newBank, `Burned coins into the Group Frenzy Altar`]
      );

      const evRes = await client.query(`SELECT * FROM global_events WHERE event_key = $1 FOR UPDATE;`, ['frenzy_altar']);
      const ev = evRes.rows[0] || {
        current_amount: 0,
        target_amount: FRENZY_TARGET_AMOUNT,
        frenzy_expires_at: 0,
        top_donor_id: null,
        top_donor_amount: 0
      };

      const targetAmount = Math.max(1, Number(ev.target_amount || FRENZY_TARGET_AMOUNT));
      const newTotalAmount = Number(ev.current_amount || 0) + amt;

      let topDonorId = ev.top_donor_id !== null && ev.top_donor_id !== undefined ? Number(ev.top_donor_id) : null;
      let topDonorAmount = Number(ev.top_donor_amount || 0);
      if (donorCycleTotal > topDonorAmount || !topDonorId) {
        topDonorId = Number(userId);
        topDonorAmount = donorCycleTotal;
      }

      if (newTotalAmount >= targetAmount) {
        const twoHoursMs = 2 * 60 * 60 * 1000;
        const expiresAt = Date.now() + twoHoursMs;
        const winnerTopDonorId = topDonorId;
        const winnerTopDonorAmount = topDonorAmount;

        await client.query(
          `UPDATE global_events
           SET current_amount = $1,
               frenzy_expires_at = $2,
               top_donor_id = $3,
               top_donor_amount = $4
           WHERE event_key = $5;`,
          [0, expiresAt, null, 0, 'frenzy_altar']
        );

        await client.query(`UPDATE users SET frenzy_cycle_donated = 0;`, []);

        let winnerUser = null;
        if (winnerTopDonorId) {
          await client.query(
            `UPDATE users SET sovereign_shards = COALESCE(sovereign_shards, 0) + $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
            [5, winnerTopDonorId]
          );
          const wRes = await client.query(`SELECT * FROM users WHERE user_id = $1;`, [winnerTopDonorId]);
          winnerUser = wRes.rows[0] || null;
          if (winnerUser) {
            const existingTitles = String(winnerUser.unlocked_titles || '')
              .split('|')
              .map(s => s.trim())
              .filter(Boolean);
            if (!existingTitles.some(t => t.toLowerCase() === 'meme patron')) {
              existingTitles.push('Meme Patron');
              const serialized = existingTitles.join('|');
              const updTitleRes = await client.query(
                `UPDATE users SET unlocked_titles = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *;`,
                [serialized, winnerTopDonorId]
              );
              winnerUser = updTitleRes.rows[0] || winnerUser;
            }
          }
        }

        await client.query('COMMIT');
        return {
          success: true,
          donated: amt,
          newWallet,
          currentAmount: 0,
          targetAmount,
          goalReached: true,
          frenzyExpiresAt: expiresAt,
          topDonorId: null,
          topDonorAmount: 0,
          winnerTopDonorId,
          winnerTopDonorAmount,
          winnerUser
        };
      }

      await client.query(
        `UPDATE global_events
         SET current_amount = $1,
             top_donor_id = $2,
             top_donor_amount = $3
         WHERE event_key = $4;`,
        [newTotalAmount, topDonorId, topDonorAmount, 'frenzy_altar']
      );

      await client.query('COMMIT');
      return {
        success: true,
        donated: amt,
        newWallet,
        currentAmount: newTotalAmount,
        targetAmount,
        goalReached: false,
        topDonorId,
        topDonorAmount
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async getLeaderboard(chatId = null, type = 'coins', limit = 10) {
    let orderBy = 'u.level DESC, u.xp DESC';
    if (type === 'shards') {
      orderBy = 'COALESCE(u.sovereign_shards, 0) DESC, (u.wallet + u.bank) DESC';
    } else if (type === 'coins') {
      orderBy = '(u.wallet + u.bank) DESC';
    }

    if (chatId) {
      const sql = `
        SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until, u.sovereign_shards,
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
      SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until, u.sovereign_shards,
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
