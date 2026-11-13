import { getClient, query } from './db.js';
import { getItem, getAllItems } from '../config/items.js';

const DAILY_MS = 86_400_000;
const WEEKLY_MS = 604_800_000;

export function getPeriodDurationMs(stockPeriod) {
  if (stockPeriod === 'weekly') return WEEKLY_MS;
  return DAILY_MS;
}

export const shopStockRepo = {
  /**
   * Returns current global stock info for an item, automatically replenishing if the reset window elapsed.
   */
  async getItemStock(itemId) {
    const item = getItem(itemId);
    if (!item || !item.stockLimit) {
      return {
        limited: false,
        itemId,
        currentStock: Infinity,
        stockLimit: null,
        nextResetAt: null,
        stockPeriod: null
      };
    }

    const now = Date.now();
    const periodMs = getPeriodDurationMs(item.stockPeriod);
    const res = await query('SELECT * FROM shop_stock WHERE item_id = $1;', [item.id]);
    let row = res.rows[0];

    if (!row) {
      const nextResetAt = now + periodMs;
      const insertRes = await query(
        `INSERT INTO shop_stock (item_id, current_stock, next_reset_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (item_id) DO NOTHING
         RETURNING *;`,
        [item.id, item.stockLimit, nextResetAt]
      );
      row = insertRes.rows[0];
      if (!row) {
        const refetch = await query('SELECT * FROM shop_stock WHERE item_id = $1;', [item.id]);
        row = refetch.rows[0];
      }
    }

    let currentStock = Number(row?.current_stock ?? item.stockLimit);
    let nextResetAt = Number(row?.next_reset_at ?? (now + periodMs));

    if (now >= nextResetAt) {
      currentStock = item.stockLimit;
      nextResetAt = now + periodMs;
      await query(
        'UPDATE shop_stock SET current_stock = $1, next_reset_at = $2 WHERE item_id = $3;',
        [currentStock, nextResetAt, item.id]
      );
    }

    return {
      limited: true,
      itemId: item.id,
      currentStock,
      stockLimit: item.stockLimit,
      nextResetAt,
      stockPeriod: item.stockPeriod || 'daily'
    };
  },

  async getAllLimitedStocks() {
    const limitedItems = getAllItems().filter(i => i.stockLimit && i.stockLimit > 0);
    const stockMap = new Map();
    for (const item of limitedItems) {
      const info = await this.getItemStock(item.id);
      stockMap.set(item.id, info);
    }
    return stockMap;
  },

  /**
   * Atomically checks & deducts global limited stock inside a PostgreSQL transaction (FOR UPDATE).
   */
  async purchaseLimitedStock(itemId, quantity = 1) {
    const item = getItem(itemId);
    if (!item || !item.stockLimit) {
      return { success: true, limited: false, remainingStock: Infinity, nextResetAt: null };
    }

    const qty = Math.floor(Number(quantity));
    if (isNaN(qty) || qty <= 0) {
      return { success: false, limited: true, reason: 'INVALID_QTY', currentStock: 0, nextResetAt: Date.now() };
    }

    const client = await getClient();
    const now = Date.now();
    const periodMs = getPeriodDurationMs(item.stockPeriod);

    try {
      await client.query('BEGIN');

      // Ensure row exists
      await client.query(
        `INSERT INTO shop_stock (item_id, current_stock, next_reset_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (item_id) DO NOTHING;`,
        [item.id, item.stockLimit, now + periodMs]
      );

      const lockRes = await client.query('SELECT * FROM shop_stock WHERE item_id = $1 FOR UPDATE;', [item.id]);
      const row = lockRes.rows[0];

      let currentStock = Number(row.current_stock);
      let nextResetAt = Number(row.next_reset_at);

      if (now >= nextResetAt) {
        currentStock = item.stockLimit;
        nextResetAt = now + periodMs;
      }

      if (currentStock < qty) {
        await client.query(
          'UPDATE shop_stock SET current_stock = $1, next_reset_at = $2 WHERE item_id = $3;',
          [currentStock, nextResetAt, item.id]
        );
        await client.query('COMMIT');
        return {
          success: false,
          limited: true,
          reason: currentStock <= 0 ? 'OUT_OF_STOCK' : 'EXCEEDS_STOCK',
          currentStock,
          stockLimit: item.stockLimit,
          nextResetAt
        };
      }

      const remainingStock = currentStock - qty;
      await client.query(
        'UPDATE shop_stock SET current_stock = $1, next_reset_at = $2 WHERE item_id = $3;',
        [remainingStock, nextResetAt, item.id]
      );

      await client.query('COMMIT');
      return {
        success: true,
        limited: true,
        remainingStock,
        stockLimit: item.stockLimit,
        nextResetAt
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[shopStockRepo.purchaseLimitedStock Error item:${itemId}]:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  },

  async restockItem(itemId, customAmount = null) {
    const item = getItem(itemId);
    if (!item || !item.stockLimit) {
      return null;
    }

    const targetStock = customAmount !== null && customAmount !== undefined
      ? Math.max(0, Math.floor(Number(customAmount)))
      : item.stockLimit;
    const nextResetAt = Date.now() + getPeriodDurationMs(item.stockPeriod);

    await query(
      `INSERT INTO shop_stock (item_id, current_stock, next_reset_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_id) DO UPDATE SET
         current_stock = EXCLUDED.current_stock,
         next_reset_at = EXCLUDED.next_reset_at;`,
      [item.id, targetStock, nextResetAt]
    );

    return {
      limited: true,
      itemId: item.id,
      currentStock: targetStock,
      stockLimit: item.stockLimit,
      nextResetAt,
      stockPeriod: item.stockPeriod || 'daily'
    };
  },

  async restockAllLimited() {
    const limitedItems = getAllItems().filter(i => i.stockLimit && i.stockLimit > 0);
    const results = new Map();
    for (const item of limitedItems) {
      const res = await this.restockItem(item.id, item.stockLimit);
      results.set(item.id, res);
    }
    return results;
  }
};

export default shopStockRepo;
