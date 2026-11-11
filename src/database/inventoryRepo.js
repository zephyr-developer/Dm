import db from './db.js';

const stmtGetItem = db.prepare(`
  SELECT item_id, quantity FROM inventories WHERE user_id = ? AND item_id = ?
`);

const stmtGetUserInventory = db.prepare(`
  SELECT item_id, quantity FROM inventories WHERE user_id = ? AND quantity > 0 ORDER BY quantity DESC
`);

const stmtUpsertItem = db.prepare(`
  INSERT INTO inventories (user_id, item_id, quantity)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
`);

const stmtSetBuff = db.prepare(`
  INSERT INTO active_buffs (user_id, buff_type, expires_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, buff_type) DO UPDATE SET expires_at = excluded.expires_at
`);

const stmtGetBuff = db.prepare(`
  SELECT buff_type, expires_at FROM active_buffs WHERE user_id = ? AND buff_type = ?
`);

const stmtRemoveBuff = db.prepare(`
  DELETE FROM active_buffs WHERE user_id = ? AND buff_type = ?
`);

const stmtCleanExpiredBuffs = db.prepare(`
  DELETE FROM active_buffs WHERE expires_at <= ?
`);

export const inventoryRepo = {
  getItem(userId, itemId) {
    const row = stmtGetItem.get(userId, itemId);
    return row ? row.quantity : 0;
  },

  hasItem(userId, itemId, requiredQuantity = 1) {
    return this.getItem(userId, itemId) >= requiredQuantity;
  },

  getUserInventory(userId) {
    return stmtGetUserInventory.all(userId);
  },

  addItem(userId, itemId, quantity = 1) {
    if (quantity <= 0) return false;
    stmtUpsertItem.run(userId, itemId, quantity);
    return true;
  },

  removeItem(userId, itemId, quantity = 1) {
    if (quantity <= 0) return false;
    const current = this.getItem(userId, itemId);
    if (current < quantity) return false;

    if (current === quantity) {
      db.prepare(`DELETE FROM inventories WHERE user_id = ? AND item_id = ?`).run(userId, itemId);
    } else {
      db.prepare(`UPDATE inventories SET quantity = quantity - ? WHERE user_id = ? AND item_id = ?`)
        .run(quantity, userId, itemId);
    }
    return true;
  },

  wipeNonCollectibleInventory(userId, collectibleItemIds = []) {
    if (collectibleItemIds.length === 0) {
      db.prepare(`DELETE FROM inventories WHERE user_id = ?`).run(userId);
    } else {
      const placeholders = collectibleItemIds.map(() => '?').join(',');
      db.prepare(`
        DELETE FROM inventories
        WHERE user_id = ? AND item_id NOT IN (${placeholders})
      `).run(userId, ...collectibleItemIds);
    }
  },

  // Active Buffs
  setBuff(userId, buffType, durationSeconds) {
    const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
    stmtSetBuff.run(userId, buffType, expiresAt);
    return expiresAt;
  },

  hasBuff(userId, buffType) {
    const now = Math.floor(Date.now() / 1000);
    const buff = stmtGetBuff.get(userId, buffType);
    if (!buff) return false;
    if (buff.expires_at <= now) {
      stmtRemoveBuff.run(userId, buffType);
      return false;
    }
    return true;
  },

  getBuffRemaining(userId, buffType) {
    const now = Math.floor(Date.now() / 1000);
    const buff = stmtGetBuff.get(userId, buffType);
    if (!buff || buff.expires_at <= now) {
      if (buff) stmtRemoveBuff.run(userId, buffType);
      return 0;
    }
    return buff.expires_at - now;
  },

  removeBuff(userId, buffType) {
    stmtRemoveBuff.run(userId, buffType);
  },

  getActiveBuffs(userId) {
    const now = Math.floor(Date.now() / 1000);
    stmtCleanExpiredBuffs.run(now);
    return db.prepare(`
      SELECT buff_type, expires_at, (expires_at - ?) AS remaining_seconds
      FROM active_buffs
      WHERE user_id = ? AND expires_at > ?
    `).all(now, userId, now);
  }
};

export default inventoryRepo;
