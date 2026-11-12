import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// Parse PostgreSQL BIGINT (OID 20) as JavaScript Number
types.setTypeParser(20, (val) => (val === null ? 0 : parseInt(val, 10)));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const isLocalhost = connectionString ? (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) : true;

export let pool = null;
export let isPostgresConfigured = Boolean(connectionString);

// In-memory fallback storage if DATABASE_URL is not yet provided in the dev environment
const memoryDb = {
  users: new Map(),
  inventories: new Map(), // key: `${userId}:${itemId}`
  active_buffs: new Map(), // key: `${userId}:${buffType}`
  cooldowns: new Map(), // key: `${userId}:${command}`
  group_members: new Set(), // key: `${chatId}:${userId}`
  settings: new Map(),
  currency_logs: [],
  logAutoInc: 1
};

if (isPostgresConfigured) {
  pool = new Pool({
    connectionString,
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('⚠️ [PostgreSQL Pool Error]:', err.message);
  });
}

/**
 * Primary parameterized query executor
 */
export async function query(text, params = []) {
  if (pool) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('[PostgreSQL Query Error]:', err.message, '\nQuery:', text, '\nParams:', params);
      throw err;
    }
  }

  // In-memory query fallback (used only when no DATABASE_URL is supplied)
  return executeMemoryQuery(text, params);
}

/**
 * Get a client for manual transaction control (BEGIN ... COMMIT ... ROLLBACK)
 */
export async function getClient() {
  if (pool) {
    return await pool.connect();
  }

  // Mock client for memory fallback
  return {
    async query(text, params = []) {
      return executeMemoryQuery(text, params);
    },
    release() {}
  };
}

/**
 * Initialize all database schemas.
 * CRITICAL RULE: NEVER use DROP TABLE anywhere. Only CREATE TABLE IF NOT EXISTS.
 */
export async function initDatabase() {
  if (!isPostgresConfigured || !pool) {
    console.warn('⚠️ [PostgreSQL] No DATABASE_URL or POSTGRES_URL detected.');
    console.warn('👉 Add DATABASE_URL to your .env to connect to persistent cloud PostgreSQL (Neon, Supabase, Render, Railway).');
    console.log('📦 Using in-memory fallback store until DATABASE_URL is set.');
    return;
  }

  console.log('🔄 Initializing PostgreSQL schemas with zero data loss protection...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        wallet BIGINT DEFAULT 500,
        bank BIGINT DEFAULT 0,
        bank_max BIGINT DEFAULT 5000,
        xp BIGINT DEFAULT 0,
        level INT DEFAULT 1,
        prestige INT DEFAULT 0,
        job_id TEXT DEFAULT NULL,
        work_shifts INT DEFAULT 0,
        streak_daily INT DEFAULT 0,
        last_daily BIGINT DEFAULT 0,
        passive_mode INT DEFAULT 0,
        premium_until BIGINT DEFAULT 0,
        custom_luck INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Inventories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventories (
        user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        item_id VARCHAR(64) NOT NULL,
        quantity INT DEFAULT 0,
        PRIMARY KEY (user_id, item_id)
      );
    `);

    // 3. Active Buffs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS active_buffs (
        user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        buff_type VARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, buff_type)
      );
    `);

    // 4. Cooldowns Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cooldowns (
        user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        command VARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, command)
      );
    `);

    // 5. Group Members Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        chat_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        PRIMARY KEY (chat_id, user_id)
      );
    `);

    // 6. Settings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 7. Currency Logs Table (Automated Financial Audit Trail)
    await client.query(`
      CREATE TABLE IF NOT EXISTS currency_logs (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        change_amount BIGINT NOT NULL,
        location VARCHAR(16) NOT NULL,
        wallet_after BIGINT NOT NULL,
        bank_after BIGINT NOT NULL,
        source_command VARCHAR(64) NOT NULL,
        details TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(chat_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_networth ON users((wallet + bank) DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_active_buffs_expiry ON active_buffs(expires_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_currency_logs_user_time ON currency_logs(user_id, created_at DESC);`);

    // Auto-migration checks for backwards-compatibility
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'premium_until') THEN
          ALTER TABLE users ADD COLUMN premium_until BIGINT DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'custom_luck') THEN
          ALTER TABLE users ADD COLUMN custom_luck INT DEFAULT 0;
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL schemas initialized and verified (Zero-Drop policy enforced).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Failed to initialize PostgreSQL schemas:', err);
    throw err;
  } finally {
    client.release();
  }
}

export const initDb = initDatabase;

/**
 * Lightweight mock SQL executor for dev environment when DATABASE_URL is not set
 */
function executeMemoryQuery(text, params = []) {
  const norm = text.replace(/\s+/g, ' ').trim().toUpperCase();

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  // 1. Users Queries
  if (norm.includes('FROM USERS') && (norm.includes('WHERE USER_ID = $1') || norm.includes('USER_ID = $1 FOR UPDATE'))) {
    const userId = Number(params[0]);
    const u = memoryDb.users.get(userId);
    return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
  }

  if (norm.startsWith('SELECT * FROM USERS WHERE LOWER(USERNAME) = LOWER($1)')) {
    const uname = String(params[0] || '').toLowerCase();
    for (const u of memoryDb.users.values()) {
      if (u.username && u.username.toLowerCase() === uname) {
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO USERS (USER_ID, USERNAME, FIRST_NAME)')) {
    const userId = Number(params[0]);
    const username = params[1] ? String(params[1]).replace(/^@/, '') : null;
    const firstName = params[2] || 'Meme Lord';

    let existing = memoryDb.users.get(userId);
    if (!existing) {
      existing = {
        user_id: userId,
        username,
        first_name: firstName,
        wallet: 500,
        bank: 0,
        bank_max: 5000,
        xp: 0,
        level: 1,
        prestige: 0,
        job_id: null,
        work_shifts: 0,
        streak_daily: 0,
        last_daily: 0,
        passive_mode: 0,
        premium_until: 0,
        custom_luck: 0,
        created_at: new Date(),
        updated_at: new Date()
      };
      memoryDb.users.set(userId, existing);
    } else {
      if (username) existing.username = username;
      if (firstName) existing.first_name = firstName;
    }
    return { rows: [{ ...existing }], rowCount: 1 };
  }

  if (norm.startsWith('UPDATE USERS')) {
    if (norm.includes('SET WALLET = $1, BANK = $2')) {
      const newWallet = Number(params[0]);
      const newBank = Number(params[1]);
      const userId = Number(params[2]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.wallet = newWallet;
        u.bank = newBank;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('BANK_MAX = BANK_MAX + $1')) {
      const inc = Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.bank_max = (u.bank_max || 5000) + inc;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET PASSIVE_MODE = $1')) {
      const mode = Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.passive_mode = mode;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET PREMIUM_UNTIL = $1')) {
      const until = Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.premium_until = until;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET CUSTOM_LUCK = $1')) {
      const luck = Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.custom_luck = luck;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET XP = $1, LEVEL = $2')) {
      const xp = Number(params[0]);
      const level = Number(params[1]);
      const userId = Number(params[2]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.xp = xp;
        u.level = level;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET PRESTIGE = $1')) {
      const prestige = Number(params[0]);
      const bankMax = Number(params[1]);
      const userId = Number(params[2]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.prestige = prestige;
        u.bank_max = bankMax;
        u.level = 1;
        u.xp = 0;
        u.wallet = 0;
        u.bank = 0;
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // 2. Currency Logs
  if (norm.startsWith('INSERT INTO CURRENCY_LOGS')) {
    const log = {
      id: memoryDb.currency_logs.length + 1,
      user_id: Number(params[0]),
      change_amount: Number(params[1]),
      location: String(params[2]),
      wallet_after: Number(params[3]),
      bank_after: Number(params[4]),
      source_command: String(params[5]),
      details: String(params[6]),
      created_at: new Date()
    };
    memoryDb.currency_logs.unshift(log);
    return { rows: [log], rowCount: 1 };
  }

  if (norm.includes('DELETE FROM CURRENCY_LOGS')) {
    const userId = Number(params[0]);
    const userLogs = memoryDb.currency_logs.filter(l => l.user_id === userId);
    if (userLogs.length > 100) {
      const keepIds = new Set(userLogs.slice(0, 100).map(l => l.id));
      memoryDb.currency_logs = memoryDb.currency_logs.filter(l => l.user_id !== userId || keepIds.has(l.id));
    }
    return { rows: [], rowCount: 1 };
  }

  if (norm.includes('COUNT(*)') && norm.includes('CURRENCY_LOGS')) {
    const userId = Number(params[0]);
    let logs = memoryDb.currency_logs.filter(l => l.user_id === userId);
    if (norm.includes('CHANGE_AMOUNT > 0')) logs = logs.filter(l => l.change_amount > 0);
    if (norm.includes('CHANGE_AMOUNT < 0')) logs = logs.filter(l => l.change_amount < 0);
    return { rows: [{ total: logs.length, count: logs.length }], rowCount: 1 };
  }

  if (norm.includes('FROM CURRENCY_LOGS')) {
    const userId = Number(params[0]);
    let logs = memoryDb.currency_logs.filter(l => l.user_id === userId);
    if (norm.includes('CHANGE_AMOUNT > 0')) logs = logs.filter(l => l.change_amount > 0);
    if (norm.includes('CHANGE_AMOUNT < 0')) logs = logs.filter(l => l.change_amount < 0);
    const limit = Number(params[1] || 10);
    const offset = Number(params[2] || 0);
    return { rows: logs.slice(offset, offset + limit), rowCount: logs.length };
  }

  // 3. Inventories
  if (norm.startsWith('INSERT INTO INVENTORIES')) {
    const userId = Number(params[0]);
    const itemId = String(params[1]);
    const qty = Number(params[2]);
    const key = `${userId}:${itemId}`;
    const current = memoryDb.inventories.get(key) || { user_id: userId, item_id: itemId, quantity: 0 };
    current.quantity += qty;
    if (current.quantity <= 0) {
      memoryDb.inventories.delete(key);
    } else {
      memoryDb.inventories.set(key, current);
    }
    return { rows: [{ ...current }], rowCount: 1 };
  }

  if (norm.includes('FROM INVENTORIES') && norm.includes('WHERE USER_ID = $1 AND ITEM_ID = $2')) {
    const userId = Number(params[0]);
    const itemId = String(params[1]);
    const item = memoryDb.inventories.get(`${userId}:${itemId}`);
    return { rows: item && item.quantity > 0 ? [{ ...item }] : [], rowCount: item ? 1 : 0 };
  }

  if (norm.includes('FROM INVENTORIES') && norm.includes('WHERE USER_ID = $1')) {
    const userId = Number(params[0]);
    const items = [];
    for (const [k, v] of memoryDb.inventories.entries()) {
      if (k.startsWith(`${userId}:`) && v.quantity > 0) items.push({ ...v });
    }
    return { rows: items, rowCount: items.length };
  }

  if (norm.startsWith('DELETE FROM INVENTORIES')) {
    const userId = Number(params[0]);
    for (const k of Array.from(memoryDb.inventories.keys())) {
      if (k.startsWith(`${userId}:`)) memoryDb.inventories.delete(k);
    }
    return { rows: [], rowCount: 1 };
  }

  // 4. Cooldowns
  if (norm.startsWith('INSERT INTO COOLDOWNS')) {
    const userId = Number(params[0]);
    const cmd = String(params[1]);
    const exp = Number(params[2]);
    memoryDb.cooldowns.set(`${userId}:${cmd}`, exp);
    return { rows: [], rowCount: 1 };
  }

  if (norm.includes('FROM COOLDOWNS') && norm.includes('WHERE USER_ID = $1 AND COMMAND = $2')) {
    const userId = Number(params[0]);
    const cmd = String(params[1]);
    const exp = memoryDb.cooldowns.get(`${userId}:${cmd}`);
    return { rows: exp ? [{ expires_at: exp }] : [], rowCount: exp ? 1 : 0 };
  }

  // 5. Active Buffs
  if (norm.startsWith('INSERT INTO ACTIVE_BUFFS')) {
    const userId = Number(params[0]);
    const buff = String(params[1]);
    const exp = Number(params[2]);
    memoryDb.active_buffs.set(`${userId}:${buff}`, exp);
    return { rows: [], rowCount: 1 };
  }

  if (norm.includes('FROM ACTIVE_BUFFS') && norm.includes('WHERE USER_ID = $1')) {
    const userId = Number(params[0]);
    const now = Math.floor(Date.now() / 1000);
    const buffs = [];
    for (const [k, exp] of memoryDb.active_buffs.entries()) {
      if (k.startsWith(`${userId}:`) && exp > now) {
        const buffType = k.split(':')[1];
        buffs.push({ buff_type: buffType, expires_at: exp });
      }
    }
    return { rows: buffs, rowCount: buffs.length };
  }

  // 6. Group Members
  if (norm.includes('INSERT INTO GROUP_MEMBERS')) {
    memoryDb.group_members.add(`${params[0]}:${params[1]}`);
    return { rows: [], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

export default {
  pool,
  query,
  getClient,
  initDatabase,
  initDb
};
