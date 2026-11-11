import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'telememer.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

// Enable WAL mode for high-throughput concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Initialize schema & migrate fields
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      wallet INTEGER DEFAULT 500,
      bank INTEGER DEFAULT 0,
      bank_max INTEGER DEFAULT 5000,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      prestige INTEGER DEFAULT 0,
      job_id TEXT DEFAULT NULL,
      work_shifts INTEGER DEFAULT 0,
      streak_daily INTEGER DEFAULT 0,
      last_daily INTEGER DEFAULT 0,
      passive_mode INTEGER DEFAULT 0,
      premium_until INTEGER DEFAULT 0,
      custom_luck INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventories (
      user_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS active_buffs (
      user_id INTEGER NOT NULL,
      buff_type TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, buff_type),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
      user_id INTEGER NOT NULL,
      command TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, command),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_members (
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(chat_id);
    CREATE INDEX IF NOT EXISTS idx_users_networth ON users(wallet, bank);
    CREATE INDEX IF NOT EXISTS idx_active_buffs_expiry ON active_buffs(expires_at);
  `);

  // Auto-migration for existing tables: check for premium_until & custom_luck
  const tableCols = db.pragma('table_info(users)').map(c => c.name);
  if (!tableCols.includes('premium_until')) {
    db.exec(`ALTER TABLE users ADD COLUMN premium_until INTEGER DEFAULT 0`);
  }
  if (!tableCols.includes('custom_luck')) {
    db.exec(`ALTER TABLE users ADD COLUMN custom_luck INTEGER DEFAULT 0`);
  }
}

initDatabase();

export default db;
