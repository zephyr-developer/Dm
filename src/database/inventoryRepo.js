import { query } from './db.js';

export const inventoryRepo = {
  async getItem(userId, itemId) {
    const res = await query(
      'SELECT quantity FROM inventories WHERE user_id = $1 AND item_id = $2;',
      [userId, itemId]
    );
    return res.rows[0] ? Number(res.rows[0].quantity) : 0;
  },

  async hasItem(userId, itemId, requiredQuantity = 1) {
    const qty = await this.getItem(userId, itemId);
    return qty >= requiredQuantity;
  },

  async getUserInventory(userId) {
    const res = await query(
      'SELECT item_id, quantity FROM inventories WHERE user_id = $1 AND quantity > 0 ORDER BY quantity DESC;',
      [userId]
    );
    return res.rows.map(r => ({ ...r, quantity: Number(r.quantity) }));
  },

  async addItem(userId, itemId, quantity = 1) {
    const qty = Number(quantity);
    if (qty <= 0) return false;

    const sql = `
      INSERT INTO inventories (user_id, item_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = inventories.quantity + $3;
    `;
    await query(sql, [userId, itemId, qty]);
    return true;
  },

  async removeItem(userId, itemId, quantity = 1) {
    const qty = Number(quantity);
    if (qty <= 0) return false;

    const current = await this.getItem(userId, itemId);
    if (current < qty) return false;

    if (current === qty) {
      await query('DELETE FROM inventories WHERE user_id = $1 AND item_id = $2;', [userId, itemId]);
    } else {
      await query(
        'UPDATE inventories SET quantity = quantity - $1 WHERE user_id = $2 AND item_id = $3;',
        [qty, userId, itemId]
      );
    }
    return true;
  },

  async wipeNonCollectibleInventory(userId, collectibleItemIds = []) {
    if (collectibleItemIds.length === 0) {
      await query('DELETE FROM inventories WHERE user_id = $1;', [userId]);
    } else {
      const placeholders = collectibleItemIds.map((_, i) => `$${i + 2}`).join(',');
      await query(
        `DELETE FROM inventories WHERE user_id = $1 AND item_id NOT IN (${placeholders});`,
        [userId, ...collectibleItemIds]
      );
    }
  },

  // Active Buffs
  async setBuff(userId, buffType, durationSeconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
    const sql = `
      INSERT INTO active_buffs (user_id, buff_type, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT(user_id, buff_type) DO UPDATE SET expires_at = $3;
    `;
    await query(sql, [userId, buffType, expiresAt]);
    return expiresAt;
  },

  async hasBuff(userId, buffType) {
    const now = Math.floor(Date.now() / 1000);
    const res = await query(
      'SELECT expires_at FROM active_buffs WHERE user_id = $1 AND buff_type = $2;',
      [userId, buffType]
    );
    const buff = res.rows[0];
    if (!buff) return false;

    if (Number(buff.expires_at) <= now) {
      await this.removeBuff(userId, buffType);
      return false;
    }
    return true;
  },

  async getBuffRemaining(userId, buffType) {
    const now = Math.floor(Date.now() / 1000);
    const res = await query(
      'SELECT expires_at FROM active_buffs WHERE user_id = $1 AND buff_type = $2;',
      [userId, buffType]
    );
    const buff = res.rows[0];
    if (!buff || Number(buff.expires_at) <= now) {
      if (buff) await this.removeBuff(userId, buffType);
      return 0;
    }
    return Number(buff.expires_at) - now;
  },

  async removeBuff(userId, buffType) {
    await query('DELETE FROM active_buffs WHERE user_id = $1 AND buff_type = $2;', [userId, buffType]);
  },

  async getActiveBuffs(userId) {
    const now = Math.floor(Date.now() / 1000);
    // Prune expired
    await query('DELETE FROM active_buffs WHERE expires_at <= $1;', [now]);

    const res = await query(
      `SELECT buff_type, expires_at, (expires_at - $1) AS remaining_seconds
       FROM active_buffs
       WHERE user_id = $2 AND expires_at > $1;`,
      [now, userId]
    );
    return res.rows.map(r => ({
      ...r,
      expires_at: Number(r.expires_at),
      remaining_seconds: Number(r.remaining_seconds)
    }));
  }
};

export default inventoryRepo;
