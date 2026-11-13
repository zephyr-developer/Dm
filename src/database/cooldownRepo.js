import { query } from './db.js';

export const cooldownRepo = {
  async isPremium(userId) {
    const res = await query('SELECT premium_until FROM users WHERE user_id = $1;', [userId]);
    const row = res.rows[0];
    return row ? Number(row.premium_until || 0) > Date.now() : false;
  },

  async getEffectiveCooldown(userId, baseSeconds) {
    if (!baseSeconds || baseSeconds <= 0) return 0;
    const isPrem = await this.isPremium(userId);
    if (isPrem) {
      // 50% reduction for Premium users, minimum 3s
      return Math.max(3, Math.floor(baseSeconds * 0.5));
    }
    return baseSeconds;
  },

  async checkCooldown(userId, command) {
    const now = Math.floor(Date.now() / 1000);
    const res = await query(
      'SELECT expires_at FROM cooldowns WHERE user_id = $1 AND command = $2;',
      [userId, command]
    );
    const row = res.rows[0];

    if (!row) {
      return { onCooldown: false, remainingSeconds: 0 };
    }

    const expiresAt = Number(row.expires_at);
    if (expiresAt <= now) {
      await this.resetCooldown(userId, command);
      return { onCooldown: false, remainingSeconds: 0 };
    }

    return {
      onCooldown: true,
      remainingSeconds: expiresAt - now
    };
  },

  async getCooldown(userId, command) {
    const res = await this.checkCooldown(userId, command);
    if (!res.onCooldown) return null;
    return {
      onCooldown: true,
      remaining: res.remainingSeconds,
      remainingSeconds: res.remainingSeconds
    };
  },

  async setCooldown(userId, command, durationSeconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
    const sql = `
      INSERT INTO cooldowns (user_id, command, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT(user_id, command) DO UPDATE SET expires_at = $3;
    `;
    await query(sql, [userId, command, expiresAt]);
    return expiresAt;
  },

  async applyEffectiveCooldown(userId, command, baseSeconds) {
    const effective = await this.getEffectiveCooldown(userId, baseSeconds);
    return await this.setCooldown(userId, command, effective);
  },

  async resetCooldown(userId, command) {
    await query('DELETE FROM cooldowns WHERE user_id = $1 AND command = $2;', [userId, command]);
  },

  async cleanExpired() {
    const now = Math.floor(Date.now() / 1000);
    await query('DELETE FROM cooldowns WHERE expires_at <= $1;', [now]);
  }
};

export default cooldownRepo;
