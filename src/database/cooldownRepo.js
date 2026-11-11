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

export const cooldownRepo = {
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

  resetCooldown(userId, command) {
    stmtRemoveCooldown.run(userId, command);
  },

  cleanExpired() {
    const now = Math.floor(Date.now() / 1000);
    stmtCleanExpired.run(now);
  }
};

export default cooldownRepo;
