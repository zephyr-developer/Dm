import db from './db.js';

const stmtGetCooldown = db.prepare(`
  SELECT expires_at FROM cooldowns WHERE user_id = ? AND command = ?
`);

const stmtSetCooldown = db.prepare(`
  INSERT INTO cooldowns (user_id, command, expires_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, command) DO UPDATE SET expires_at = excluded.expires_at
`);

const stmtRemoveCooldown = db.prepare(`
  DELETE FROM cooldowns WHERE user_id = ? AND command = ?
`);

const stmtCleanExpired = db.prepare(`
  DELETE FROM cooldowns WHERE expires_at <= ?
`);

const stmtGetPremiumUntil = db.prepare(`
  SELECT premium_until FROM users WHERE user_id = ?
`);

export const cooldownRepo = {
  isPremium(userId) {
    const row = stmtGetPremiumUntil.get(userId);
    return row ? (row.premium_until || 0) > Date.now() : false;
  },

  getEffectiveCooldown(userId, baseSeconds) {
    if (!baseSeconds || baseSeconds <= 0) return 0;
    if (this.isPremium(userId)) {
      // 50% reduction for Premium users, minimum 3s
      return Math.max(3, Math.floor(baseSeconds * 0.5));
    }
    return baseSeconds;
  },

  checkCooldown(userId, command) {
    const now = Math.floor(Date.now() / 1000);
    const row = stmtGetCooldown.get(userId, command);

    if (!row) {
      return { onCooldown: false, remainingSeconds: 0 };
    }

    if (row.expires_at <= now) {
      stmtRemoveCooldown.run(userId, command);
      return { onCooldown: false, remainingSeconds: 0 };
    }

    return {
      onCooldown: true,
      remainingSeconds: row.expires_at - now
    };
  },

  setCooldown(userId, command, durationSeconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
    stmtSetCooldown.run(userId, command, expiresAt);
    return expiresAt;
  },

  applyEffectiveCooldown(userId, command, baseSeconds) {
    const effective = this.getEffectiveCooldown(userId, baseSeconds);
    return this.setCooldown(userId, command, effective);
  },

  resetCooldown(userId, command) {
    stmtRemoveCooldown.run(userId, command);
  },

  cleanExpired() {
    const now = Math.floor(Date.now() / 1000);
    stmtCleanExpired.run(now);
  }
};

export default cooldownRepo;
