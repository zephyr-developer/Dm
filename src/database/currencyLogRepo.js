import { query } from './db.js';

export const currencyLogRepo = {
  /**
   * Insert a new currency log record and prune old logs beyond 100 entries.
   * Accepts an optional transaction client.
   */
  async addLog(userId, { changeAmount, location, walletAfter, bankAfter, sourceCommand, details }, client = null) {
    const q = client ? client.query.bind(client) : query;

    const insertSql = `
      INSERT INTO currency_logs (user_id, change_amount, location, wallet_after, bank_after, source_command, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const res = await q(insertSql, [
      userId,
      changeAmount,
      location,
      walletAfter,
      bankAfter,
      sourceCommand,
      details
    ]);

    // Prune logs exceeding 100 entries for this user to keep query performance lightning fast
    const pruneSql = `
      DELETE FROM currency_logs
      WHERE id IN (
        SELECT id FROM currency_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        OFFSET 100
      );
    `;
    await q(pruneSql, [userId]);

    return res.rows[0];
  },

  /**
   * Fetch paginated currency logs for a user with optional filter ('all', 'gains', 'losses')
   */
  async getLogs(userId, { limit = 10, offset = 0, filter = 'all' } = {}) {
    let whereClause = 'WHERE user_id = $1';
    if (filter === 'gains') {
      whereClause += ' AND change_amount > 0';
    } else if (filter === 'losses') {
      whereClause += ' AND change_amount < 0';
    }

    const sql = `
      SELECT id, user_id, change_amount, location, wallet_after, bank_after, source_command, details, created_at
      FROM currency_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const res = await query(sql, [userId, limit, offset]);
    return res.rows;
  },

  /**
   * Count total logs for a user matching the filter (up to 100 max)
   */
  async getLogCount(userId, filter = 'all') {
    let whereClause = 'WHERE user_id = $1';
    if (filter === 'gains') {
      whereClause += ' AND change_amount > 0';
    } else if (filter === 'losses') {
      whereClause += ' AND change_amount < 0';
    }

    const sql = `
      SELECT COUNT(*) as count
      FROM (
        SELECT id FROM currency_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 100
      ) sub;
    `;

    const res = await query(sql, [userId]);
    return Number(res.rows[0]?.count || 0);
  }
};

export default currencyLogRepo;
