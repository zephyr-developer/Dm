import db from './db.js';

// Prepared statements for maximum performance
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (user_id, username, first_name)
  VALUES (@user_id, @username, @first_name)
  ON CONFLICT(user_id) DO UPDATE SET
    username = COALESCE(excluded.username, users.username),
    first_name = COALESCE(excluded.first_name, users.first_name)
`);

const stmtGetUser = db.prepare(`
  SELECT * FROM users WHERE user_id = ?
`);

const stmtGetUserByUsername = db.prepare(`
  SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1
`);

const stmtLinkGroup = db.prepare(`
  INSERT INTO group_members (chat_id, user_id)
  VALUES (?, ?)
  ON CONFLICT(chat_id, user_id) DO NOTHING
`);

export const userRepo = {
  upsertUser(userId, username, firstName) {
    stmtUpsertUser.run({
      user_id: userId,
      username: username ? username.replace(/^@/, '') : null,
      first_name: firstName || 'Meme Lord'
    });
    return this.getUser(userId);
  },

  getUser(userId) {
    return stmtGetUser.get(userId) || null;
  },

  getUserByUsername(username) {
    if (!username) return null;
    const clean = username.replace(/^@/, '').trim();
    return stmtGetUserByUsername.get(clean) || null;
  },

  getOrInitUser(userId, username, firstName) {
    let user = this.getUser(userId);
    if (!user) {
      user = this.upsertUser(userId, username, firstName);
    }
    return user;
  },

  linkGroupMember(chatId, userId) {
    stmtLinkGroup.run(chatId, userId);
  },

  updateWallet(userId, delta) {
    const info = db.prepare(`
      UPDATE users
      SET wallet = MAX(0, wallet + ?)
      WHERE user_id = ?
    `).run(delta, userId);
    return info.changes > 0;
  },

  setWallet(userId, amount) {
    db.prepare(`UPDATE users SET wallet = ? WHERE user_id = ?`).run(Math.max(0, amount), userId);
  },

  addWallet(userId, amount) {
    db.prepare(`UPDATE users SET wallet = wallet + ? WHERE user_id = ?`).run(amount, userId);
  },

  updateBank(userId, delta) {
    const info = db.prepare(`
      UPDATE users
      SET bank = MAX(0, bank + ?)
      WHERE user_id = ?
    `).run(delta, userId);
    return info.changes > 0;
  },

  increaseBankMax(userId, increase) {
    db.prepare(`
      UPDATE users
      SET bank_max = bank_max + ?
      WHERE user_id = ?
    `).run(increase, userId);
  },

  deposit(userId, amount) {
    const tx = db.transaction(() => {
      const user = stmtGetUser.get(userId);
      if (!user) return { success: false, reason: 'User not found' };

      const availableSpace = Math.max(0, user.bank_max - user.bank);
      if (availableSpace <= 0) {
        return { success: false, reason: 'Bank is already full!' };
      }

      const depositAmount = Math.min(user.wallet, availableSpace, amount);
      if (depositAmount <= 0) {
        return { success: false, reason: 'Not enough coins in wallet!' };
      }

      db.prepare(`UPDATE users SET wallet = wallet - ?, bank = bank + ? WHERE user_id = ?`)
        .run(depositAmount, depositAmount, userId);

      return { success: true, deposited: depositAmount, newWallet: user.wallet - depositAmount, newBank: user.bank + depositAmount };
    });

    return tx();
  },

  withdraw(userId, amount) {
    const tx = db.transaction(() => {
      const user = stmtGetUser.get(userId);
      if (!user) return { success: false, reason: 'User not found' };

      const withdrawAmount = Math.min(user.bank, amount);
      if (withdrawAmount <= 0) {
        return { success: false, reason: 'Not enough coins in bank!' };
      }

      db.prepare(`UPDATE users SET bank = bank - ?, wallet = wallet + ? WHERE user_id = ?`)
        .run(withdrawAmount, withdrawAmount, userId);

      return { success: true, withdrawn: withdrawAmount, newWallet: user.wallet + withdrawAmount, newBank: user.bank - withdrawAmount };
    });

    return tx();
  },

  transferWallet(fromUserId, toUserId, amount, taxRate = 0.05) {
    const tx = db.transaction(() => {
      const sender = stmtGetUser.get(fromUserId);
      const recipient = stmtGetUser.get(toUserId);

      if (!sender || !recipient) {
        return { success: false, reason: 'User not found' };
      }
      if (sender.wallet < amount) {
        return { success: false, reason: 'Insufficient wallet balance' };
      }

      const tax = Math.floor(amount * taxRate);
      const netAmount = amount - tax;

      db.prepare(`UPDATE users SET wallet = wallet - ? WHERE user_id = ?`).run(amount, fromUserId);
      db.prepare(`UPDATE users SET wallet = wallet + ? WHERE user_id = ?`).run(netAmount, toUserId);

      return { success: true, amount, netAmount, tax };
    });

    return tx();
  },

  setJob(userId, jobId) {
    db.prepare(`UPDATE users SET job_id = ? WHERE user_id = ?`).run(jobId, userId);
  },

  incrementWorkShifts(userId) {
    db.prepare(`UPDATE users SET work_shifts = work_shifts + 1 WHERE user_id = ?`).run(userId);
  },

  updateDailyStreak(userId, streak, timestamp) {
    db.prepare(`UPDATE users SET streak_daily = ?, last_daily = ? WHERE user_id = ?`)
      .run(streak, timestamp, userId);
  },

  setPassiveMode(userId, passiveMode) {
    db.prepare(`UPDATE users SET passive_mode = ? WHERE user_id = ?`)
      .run(passiveMode ? 1 : 0, userId);
  },

  // Premium Features
  isPremium(userId) {
    const user = this.getUser(userId);
    if (!user) return false;
    return (user.premium_until || 0) > Date.now();
  },

  getPremiumRemaining(userId) {
    const user = this.getUser(userId);
    if (!user || !user.premium_until) return 0;
    return Math.max(0, user.premium_until - Date.now());
  },

  setPremium(userId, durationMs) {
    const user = this.getUser(userId);
    const currentExpiry = (user && user.premium_until > Date.now()) ? user.premium_until : Date.now();
    const newExpiry = currentExpiry + durationMs;
    db.prepare(`UPDATE users SET premium_until = ? WHERE user_id = ?`).run(newExpiry, userId);
    return newExpiry;
  },

  removePremium(userId) {
    db.prepare(`UPDATE users SET premium_until = 0 WHERE user_id = ?`).run(userId);
  },

  // Custom Luck (Underground Owner System)
  setCustomLuck(userId, percentage) {
    db.prepare(`UPDATE users SET custom_luck = ? WHERE user_id = ?`).run(Math.max(0, Math.floor(percentage)), userId);
  },

  getCustomLuck(userId) {
    const user = this.getUser(userId);
    return user ? (user.custom_luck || 0) : 0;
  },

  prestigeReset(userId, newPrestige, newBankMax) {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET wallet = 0,
            bank = 0,
            level = 1,
            xp = 0,
            prestige = ?,
            bank_max = ?
        WHERE user_id = ?
      `).run(newPrestige, newBankMax, userId);
    });
    return tx();
  },

  getLeaderboard(chatId = null, type = 'coins', limit = 10) {
    const isCoins = type === 'coins';
    const orderBy = isCoins ? '(u.wallet + u.bank) DESC' : 'u.level DESC, u.xp DESC';

    if (chatId) {
      return db.prepare(`
        SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until,
               (u.wallet + u.bank) AS total_coins
        FROM users u
        INNER JOIN group_members gm ON u.user_id = gm.user_id
        WHERE gm.chat_id = ?
        ORDER BY ${orderBy}
        LIMIT ?
      `).all(chatId, limit);
    }

    return db.prepare(`
      SELECT u.user_id, u.username, u.first_name, u.wallet, u.bank, u.level, u.xp, u.prestige, u.premium_until,
             (u.wallet + u.bank) AS total_coins
      FROM users u
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(limit);
  }
};

export default userRepo;
