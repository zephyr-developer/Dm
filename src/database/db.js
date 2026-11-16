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
  shop_stock: new Map(), // key: item_id -> { item_id, current_stock, next_reset_at }
  currency_logs: [],
  logAutoInc: 1,
  fights: [],
  fightAutoInc: 1,
  fight_reputations: new Set(), // key: `${giverId}:${receiverId}`
  fight_daily_pairs: new Map() // key: `${dayKey}:${pairKey}` -> count
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
        account_status VARCHAR(20) DEFAULT 'active',
        status_reason TEXT DEFAULT NULL,
        flagged_amount BIGINT DEFAULT 0,
        last_appeal_at BIGINT DEFAULT 0,
        owner_chat_id BIGINT DEFAULT NULL,
        equipped_title VARCHAR(64) DEFAULT 'Newbie',
        custom_title VARCHAR(64) DEFAULT NULL,
        last_custom_title_at BIGINT DEFAULT 0,
        ban_expires_at BIGINT DEFAULT NULL,
        can_reply_owner INTEGER DEFAULT 0,
        ultimate_expires_at BIGINT DEFAULT NULL,
        fight_rep INTEGER DEFAULT 0,
        fight_streak INTEGER DEFAULT 0,
        fight_wins INTEGER DEFAULT 0,
        fight_losses INTEGER DEFAULT 0,
        fight_rank VARCHAR(20) DEFAULT 'Bronze',
        fight_score INTEGER DEFAULT 0,
        fight_bucket_id VARCHAR(32) DEFAULT 'default_bucket',
        fight_unlocked_ranks TEXT DEFAULT 'Bronze',
        fight_action_counts JSONB DEFAULT '{}'::jsonb,
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

    // 8. Global Limited Shop Stock Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shop_stock (
        item_id VARCHAR(64) PRIMARY KEY,
        current_stock INTEGER NOT NULL,
        next_reset_at BIGINT NOT NULL
      );
    `);

    // 9. Fight 2.0 Stateless Records Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fights (
        fight_id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL,
        mode VARCHAR(30) NOT NULL,
        wager_coins BIGINT DEFAULT 0,
        left_team JSONB NOT NULL,
        right_team JSONB NOT NULL,
        winner_side VARCHAR(10),
        rounds_log JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    // 10. Fight Reputations Table (Enforces 1 rep per unique giver->receiver pair lifetime)
    await client.query(`
      CREATE TABLE IF NOT EXISTS fight_reputations (
        giver_id BIGINT NOT NULL,
        receiver_id BIGINT NOT NULL,
        PRIMARY KEY (giver_id, receiver_id)
      );
    `);

    // 11. Fight Daily Pairs (Anti-Farming diminishing returns tracker)
    await client.query(`
      CREATE TABLE IF NOT EXISTS fight_daily_pairs (
        day_key VARCHAR(16) NOT NULL,
        pair_key VARCHAR(64) NOT NULL,
        fight_count INTEGER DEFAULT 0,
        PRIMARY KEY (day_key, pair_key)
      );
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(chat_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_networth ON users((wallet + bank) DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_active_buffs_expiry ON active_buffs(expires_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_currency_logs_user_time ON currency_logs(user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fights_created_at ON fights(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_fight_score ON users(fight_score DESC, fight_rep DESC);`);

    // Auto-migration checks for backwards-compatibility
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until BIGINT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_luck INT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged_amount BIGINT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_appeal_at BIGINT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_chat_id BIGINT DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_title VARCHAR(64) DEFAULT 'Newbie';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_title VARCHAR(64) DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_custom_title_at BIGINT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_expires_at BIGINT DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_reply_owner INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ultimate_expires_at BIGINT DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_rep INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_streak INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_wins INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_losses INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_rank VARCHAR(20) DEFAULT 'Bronze';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_score INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_bucket_id VARCHAR(32) DEFAULT 'default_bucket';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_unlocked_ranks TEXT DEFAULT 'Bronze';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fight_action_counts JSONB DEFAULT '{}'::jsonb;`);

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

  if (norm.startsWith("SELECT * FROM USERS WHERE LOWER(USERNAME) = 'TZHUNYUAN'") || norm.includes("LOWER(USERNAME) = 'TZHUNYUAN'")) {
    for (const u of memoryDb.users.values()) {
      if (u.username && u.username.toLowerCase() === 'tzhunyuan') {
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
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
        account_status: 'active',
        status_reason: null,
        flagged_amount: 0,
        last_appeal_at: 0,
        owner_chat_id: null,
        equipped_title: 'Newbie',
        custom_title: null,
        last_custom_title_at: 0,
        ban_expires_at: null,
        can_reply_owner: 0,
        ultimate_expires_at: null,
        fight_rep: 0,
        fight_streak: 0,
        fight_wins: 0,
        fight_losses: 0,
        fight_rank: 'Bronze',
        fight_score: 0,
        fight_bucket_id: 'default_bucket',
        fight_unlocked_ranks: 'Bronze',
        fight_action_counts: {},
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
    if (norm.includes('SET ACCOUNT_STATUS = $1, STATUS_REASON = $2, FLAGGED_AMOUNT = $3, BAN_EXPIRES_AT = $4, LAST_APPEAL_AT = 0')) {
      const status = String(params[0]);
      const reason = params[1] !== undefined ? params[1] : null;
      const flaggedAmount = Number(params[2] || 0);
      const banExpiresAt = params[3] !== null && params[3] !== undefined ? Number(params[3]) : null;
      const userId = Number(params[4]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.account_status = status;
        u.status_reason = reason;
        u.flagged_amount = flaggedAmount;
        u.ban_expires_at = banExpiresAt;
        u.last_appeal_at = 0;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET ACCOUNT_STATUS = $1, STATUS_REASON = $2, FLAGGED_AMOUNT = $3')) {
      const status = String(params[0]);
      const reason = params[1] !== undefined ? params[1] : null;
      const flaggedAmount = Number(params[2] || 0);
      const userId = Number(params[3]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.account_status = status;
        u.status_reason = reason;
        u.flagged_amount = flaggedAmount;
        u.last_appeal_at = 0;
        if (status === 'active') u.ban_expires_at = null;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET CAN_REPLY_OWNER = $1')) {
      const canReply = Number(params[0] ? 1 : 0);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.can_reply_owner = canReply;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET ULTIMATE_EXPIRES_AT = $1')) {
      const exp = params[0] === null || params[0] === undefined ? null : Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.ultimate_expires_at = exp;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET LAST_APPEAL_AT = $1')) {
      const ts = Number(params[0] || 0);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.last_appeal_at = ts;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET OWNER_CHAT_ID = $1')) {
      const chatId = Number(params[0]);
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.owner_chat_id = chatId;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET EQUIPPED_TITLE = $1')) {
      const title = String(params[0] || 'Newbie');
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.equipped_title = title;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET CUSTOM_TITLE = $1, EQUIPPED_TITLE = $2, LAST_CUSTOM_TITLE_AT = $3')) {
      const customTitle = String(params[0]);
      const equippedTitle = String(params[1]);
      const ts = Number(params[2] || Date.now());
      const userId = Number(params[3]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.custom_title = customTitle;
        u.equipped_title = equippedTitle;
        u.last_custom_title_at = ts;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
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
    if (norm.includes('SET LEVEL = $1, XP = $2, WALLET = $3, BANK_MAX = $4')) {
      const u = memoryDb.users.get(Number(params[4]));
      if (u) {
        u.level = Number(params[0]);
        u.xp = Number(params[1]);
        u.wallet = Number(params[2]);
        u.bank_max = Number(params[3]);
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET LEVEL = $1, WALLET = $2, BANK_MAX = $3')) {
      const u = memoryDb.users.get(Number(params[3]));
      if (u) {
        u.level = Number(params[0]);
        u.wallet = Number(params[1]);
        u.bank_max = Number(params[2]);
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET WALLET = $1, CUSTOM_LUCK = $2')) {
      const u = memoryDb.users.get(Number(params[2]));
      if (u) {
        u.wallet = Number(params[0]);
        u.custom_luck = Number(params[1]);
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET WALLET = $1 WHERE USER_ID = $2')) {
      const u = memoryDb.users.get(Number(params[1]));
      if (u) {
        u.wallet = Number(params[0]);
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
    if (norm.includes('PRESTIGE = $1') || norm.includes('SET PRESTIGE = $1')) {
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
    if (norm.includes('SET FIGHT_REP = FIGHT_REP + 1')) {
      const userId = Number(params[0]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.fight_rep = Number(u.fight_rep || 0) + 1;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET FIGHT_ACTION_COUNTS = $1')) {
      const counts = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
      const userId = Number(params[1]);
      const u = memoryDb.users.get(userId);
      if (u) {
        u.fight_action_counts = counts;
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    if (norm.includes('SET FIGHT_WINS = $1, FIGHT_LOSSES = $2, FIGHT_STREAK = $3, FIGHT_SCORE = $4, FIGHT_RANK = $5, FIGHT_BUCKET_ID = $6, FIGHT_UNLOCKED_RANKS = $7, FIGHT_ACTION_COUNTS = $8')) {
      const u = memoryDb.users.get(Number(params[8]));
      if (u) {
        u.fight_wins = Number(params[0]);
        u.fight_losses = Number(params[1]);
        u.fight_streak = Number(params[2]);
        u.fight_score = Number(params[3]);
        u.fight_rank = String(params[4]);
        u.fight_bucket_id = String(params[5]);
        u.fight_unlocked_ranks = String(params[6]);
        u.fight_action_counts = typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7];
        u.updated_at = new Date();
        return { rows: [{ ...u }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // 1b. Users Leaderboard & Fight Bucket queries (in-memory)
  if (norm.includes('FROM USERS U') && norm.includes('ORDER BY')) {
    let list = Array.from(memoryDb.users.values()).map(u => ({
      ...u,
      total_coins: Number(u.wallet || 0) + Number(u.bank || 0)
    }));
    const hasChatFilter = norm.includes('INNER JOIN GROUP_MEMBERS');
    if (hasChatFilter) {
      const chatId = Number(params[0]);
      list = list.filter(u => memoryDb.group_members.has(`${chatId}:${u.user_id}`));
    }
    if (norm.includes('ORDER BY U.FIGHT_SCORE DESC')) {
      list.sort((a, b) => (Number(b.fight_score || 0) - Number(a.fight_score || 0)) || (Number(b.fight_rep || 0) - Number(a.fight_rep || 0)) || (Number(b.fight_wins || 0) - Number(a.fight_wins || 0)));
    } else if (norm.includes('ORDER BY (U.WALLET + U.BANK) DESC')) {
      list.sort((a, b) => b.total_coins - a.total_coins);
    } else if (norm.includes('ORDER BY U.LEVEL DESC')) {
      list.sort((a, b) => (Number(b.level || 1) - Number(a.level || 1)) || (Number(b.xp || 0) - Number(a.xp || 0)));
    }
    const limitParam = hasChatFilter ? params[1] : params[0];
    const limit = Number(limitParam || 10);
    return { rows: list.slice(0, limit), rowCount: Math.min(list.length, limit) };
  }

  if (norm.includes('FROM USERS') && norm.includes('WHERE FIGHT_BUCKET_ID = $1')) {
    const bucketId = String(params[0]);
    const list = Array.from(memoryDb.users.values())
      .filter(u => (u.fight_bucket_id || 'default_bucket') === bucketId || Number(u.fight_wins || 0) + Number(u.fight_losses || 0) > 0)
      .sort((a, b) => (Number(b.fight_score || 0) - Number(a.fight_score || 0)) || (Number(b.fight_wins || 0) - Number(a.fight_wins || 0)))
      .map(u => ({ ...u }));
    return { rows: list, rowCount: list.length };
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
    if (norm.includes('DO UPDATE SET QUANTITY = EXCLUDED.QUANTITY') || norm.includes('DO UPDATE SET QUANTITY = $3')) {
      current.quantity = qty;
    } else {
      current.quantity += qty;
    }
    if (current.quantity <= 0) {
      memoryDb.inventories.delete(key);
    } else {
      memoryDb.inventories.set(key, current);
    }
    return { rows: [{ ...current }], rowCount: 1 };
  }

  if (norm.startsWith('SELECT') && norm.includes('FROM INVENTORIES') && norm.includes('WHERE USER_ID = $1 AND ITEM_ID = $2')) {
    const userId = Number(params[0]);
    const itemId = String(params[1]);
    const item = memoryDb.inventories.get(`${userId}:${itemId}`);
    return { rows: item && item.quantity > 0 ? [{ ...item }] : [], rowCount: item ? 1 : 0 };
  }

  if (norm.startsWith('SELECT') && norm.includes('FROM INVENTORIES') && norm.includes('WHERE USER_ID = $1')) {
    const userId = Number(params[0]);
    const items = [];
    for (const [k, v] of memoryDb.inventories.entries()) {
      if (k.startsWith(`${userId}:`) && v.quantity > 0) items.push({ ...v });
    }
    return { rows: items, rowCount: items.length };
  }

  if (norm.startsWith('DELETE FROM INVENTORIES')) {
    const userId = Number(params[0]);
    if (norm.includes('AND ITEM_ID = $2')) {
      memoryDb.inventories.delete(`${userId}:${String(params[1])}`);
    } else if (norm.includes('ITEM_ID NOT IN')) {
      const keepSet = new Set(params.slice(1).map(String));
      for (const [k, v] of Array.from(memoryDb.inventories.entries())) {
        if (k.startsWith(`${userId}:`) && !keepSet.has(v.item_id)) {
          memoryDb.inventories.delete(k);
        }
      }
    } else {
      for (const k of Array.from(memoryDb.inventories.keys())) {
        if (k.startsWith(`${userId}:`)) memoryDb.inventories.delete(k);
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (norm.startsWith('UPDATE INVENTORIES') && norm.includes('QUANTITY = QUANTITY - $1')) {
    const qty = Number(params[0]);
    const userId = Number(params[1]);
    const itemId = String(params[2]);
    const key = `${userId}:${itemId}`;
    const current = memoryDb.inventories.get(key);
    if (current) {
      current.quantity = Math.max(0, current.quantity - qty);
      if (current.quantity <= 0) {
        memoryDb.inventories.delete(key);
      } else {
        memoryDb.inventories.set(key, current);
      }
      return { rows: [{ ...current }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
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

  if (norm.startsWith('DELETE FROM ACTIVE_BUFFS')) {
    const userId = Number(params[0]);
    const buff = params[1] ? String(params[1]) : null;
    if (buff) {
      memoryDb.active_buffs.delete(`${userId}:${buff}`);
    } else {
      for (const k of Array.from(memoryDb.active_buffs.keys())) {
        if (k.startsWith(`${userId}:`)) memoryDb.active_buffs.delete(k);
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (norm.includes('FROM ACTIVE_BUFFS') && norm.includes('WHERE USER_ID = $1')) {
    const userId = Number(params[0]);
    const now = Math.floor(Date.now() / 1000);
    const specificBuff = norm.includes('BUFF_TYPE = $2') ? String(params[1]) : null;

    if (specificBuff) {
      const exp = memoryDb.active_buffs.get(`${userId}:${specificBuff}`);
      return { rows: exp && exp > now ? [{ expires_at: exp }] : [], rowCount: exp && exp > now ? 1 : 0 };
    }

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

  // 7. Shop Stock
  if (norm.includes('FROM SHOP_STOCK') && norm.includes('WHERE ITEM_ID = $1')) {
    const row = memoryDb.shop_stock.get(String(params[0]));
    return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
  }

  if (norm.startsWith('INSERT INTO SHOP_STOCK')) {
    const itemId = String(params[0]);
    const currentStock = Number(params[1]);
    const nextResetAt = Number(params[2]);
    const existing = memoryDb.shop_stock.get(itemId);
    if (!existing || norm.includes('DO UPDATE')) {
      const row = { item_id: itemId, current_stock: currentStock, next_reset_at: nextResetAt };
      memoryDb.shop_stock.set(itemId, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    return { rows: [{ ...existing }], rowCount: 1 };
  }

  if (norm.startsWith('UPDATE SHOP_STOCK')) {
    if (norm.includes('SET CURRENT_STOCK = $1, NEXT_RESET_AT = $2')) {
      const currentStock = Number(params[0]);
      const nextResetAt = Number(params[1]);
      const itemId = String(params[2]);
      const row = { item_id: itemId, current_stock: currentStock, next_reset_at: nextResetAt };
      memoryDb.shop_stock.set(itemId, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (norm.includes('SET CURRENT_STOCK = $1 WHERE ITEM_ID = $2')) {
      const currentStock = Number(params[0]);
      const itemId = String(params[1]);
      const existing = memoryDb.shop_stock.get(itemId);
      if (existing) {
        existing.current_stock = currentStock;
        return { rows: [{ ...existing }], rowCount: 1 };
      }
    }
  }

  // 8. Fights Table (Stateless Fight 2.0)
  if (norm.startsWith('INSERT INTO FIGHTS')) {
    const row = {
      fight_id: memoryDb.fightAutoInc++,
      type: String(params[0]),
      mode: String(params[1]),
      wager_coins: Number(params[2] || 0),
      left_team: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
      right_team: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
      winner_side: params[5] ? String(params[5]) : null,
      rounds_log: typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6],
      created_at: Number(params[7] || Date.now())
    };
    memoryDb.fights.push(row);
    return { rows: [{ ...row }], rowCount: 1 };
  }

  if (norm.includes('FROM FIGHTS') && norm.includes('WHERE FIGHT_ID = $1')) {
    const fid = Number(params[0]);
    const found = memoryDb.fights.find(f => f.fight_id === fid);
    return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 };
  }

  if (norm.includes('FROM FIGHTS') && norm.includes('ORDER BY CREATED_AT DESC')) {
    const targetUserId = Number(params[0]);
    const matched = memoryDb.fights
      .filter(f => {
        const leftIds = (f.left_team || []).map(p => Number(p.userId));
        const rightIds = (f.right_team || []).map(p => Number(p.userId));
        return leftIds.includes(targetUserId) || rightIds.includes(targetUserId);
      })
      .sort((a, b) => Number(b.created_at) - Number(a.created_at));
    return { rows: matched.map(m => ({ ...m })), rowCount: matched.length };
  }

  // 9. Fight Reputations Table
  if (norm.startsWith('INSERT INTO FIGHT_REPUTATIONS')) {
    const key = `${Number(params[0])}:${Number(params[1])}`;
    if (memoryDb.fight_reputations.has(key)) {
      return { rows: [], rowCount: 0 };
    }
    memoryDb.fight_reputations.add(key);
    return { rows: [{ giver_id: Number(params[0]), receiver_id: Number(params[1]) }], rowCount: 1 };
  }

  if (norm.includes('FROM FIGHT_REPUTATIONS') && norm.includes('WHERE GIVER_ID = $1 AND RECEIVER_ID = $2')) {
    const key = `${Number(params[0])}:${Number(params[1])}`;
    return { rows: memoryDb.fight_reputations.has(key) ? [{ giver_id: Number(params[0]), receiver_id: Number(params[1]) }] : [], rowCount: memoryDb.fight_reputations.has(key) ? 1 : 0 };
  }

  // 10. Fight Daily Pairs Table
  if (norm.includes('FROM FIGHT_DAILY_PAIRS')) {
    const key = `${String(params[0])}:${String(params[1])}`;
    const count = memoryDb.fight_daily_pairs.get(key) || 0;
    return { rows: count > 0 ? [{ fight_count: count }] : [], rowCount: count > 0 ? 1 : 0 };
  }

  if (norm.startsWith('INSERT INTO FIGHT_DAILY_PAIRS')) {
    const key = `${String(params[0])}:${String(params[1])}`;
    const next = (memoryDb.fight_daily_pairs.get(key) || 0) + 1;
    memoryDb.fight_daily_pairs.set(key, next);
    return { rows: [{ fight_count: next }], rowCount: 1 };
  }

  // 11. Settings Table (Weekly rollover tracking)
  if (norm.includes('FROM SETTINGS') && norm.includes('WHERE KEY = $1')) {
    const val = memoryDb.settings.get(String(params[0]));
    return { rows: val !== undefined ? [{ key: String(params[0]), value: val }] : [], rowCount: val !== undefined ? 1 : 0 };
  }

  if (norm.startsWith('INSERT INTO SETTINGS')) {
    memoryDb.settings.set(String(params[0]), String(params[1]));
    return { rows: [{ key: String(params[0]), value: String(params[1]) }], rowCount: 1 };
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
