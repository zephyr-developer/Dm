import http from 'node:http';
import dotenv from 'dotenv';
import db, { initDatabase } from './database/db.js';
import { bot, loadCommands } from './bot.js';
import { getAllItems } from './config/items.js';
import { getAllJobs } from './config/jobs.js';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? (Number(process.env.PORT) || 3000) : 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;

// ====================================================================
// 1. GLOBAL PROCESS CRASH GUARDS (24/7 Crash-Proofing)
// ====================================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[TeleMemer Crash Guard] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[TeleMemer Crash Guard] Uncaught Exception:', err);
});

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🐸 TeleMemer - 24/7 Telegram RPG & Economy Engine');
  console.log('----------------------------------------------------');

  // 1. Initialize PostgreSQL database schemas
  try {
    await initDatabase();
    console.log('✅ PostgreSQL Database initialized successfully (Zero-Drop policy active).');
  } catch (dbErr) {
    console.error('❌ Failed to initialize database:', dbErr);
  }

  // 2. Dynamically load all command modules and callback handlers
  try {
    await loadCommands();
    console.log('✅ Command & Callback modules registered.');
  } catch (loaderErr) {
    console.error('❌ Error during command loading:', loaderErr);
  }

  // 3. Lightweight Native HTTP Server (for /health and cloud host keep-alive)
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      try {
        let userCount = 0;
        let totalCoins = 0;
        let groupCount = 0;
        let premiumCount = 0;

        try {
          const userRes = await db.query('SELECT COUNT(*) as count FROM users');
          userCount = Number(userRes.rows[0]?.count || 0);

          const coinsRes = await db.query('SELECT SUM(wallet + bank) as total FROM users');
          totalCoins = Number(coinsRes.rows[0]?.total || 0);

          const groupRes = await db.query('SELECT COUNT(DISTINCT chat_id) as count FROM group_members');
          groupCount = Number(groupRes.rows[0]?.count || 0);

          const premRes = await db.query('SELECT COUNT(*) as count FROM users WHERE premium_until > $1', [Date.now()]);
          premiumCount = Number(premRes.rows[0]?.count || 0);
        } catch (dbErr) {
          // Keep health response alive even if db is connecting
        }

        const responsePayload = JSON.stringify({
          status: 'online',
          app: 'TeleMemer',
          uptime: process.uptime(),
          botConnected: Boolean(BOT_TOKEN && !BOT_TOKEN.includes('1234567890') && !BOT_TOKEN.includes('DUMMY')),
          database: db.isPostgresConfigured ? 'PostgreSQL (Persistent)' : 'In-Memory Dev Mode',
          stats: {
            registeredUsers: userCount,
            activeGroups: groupCount,
            premiumUsers: premiumCount,
            totalEconomyCoins: totalCoins,
            catalogItems: getAllItems().length,
            availableJobs: getAllJobs().length
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responsePayload);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', error: err.message }));
      }
      return;
    }

    if (url.pathname === '/api/items') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAllItems()));
      return;
    }

    if (url.pathname === '/api/jobs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAllJobs()));
      return;
    }

    // Default status fallback
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TeleMemer 24/7 Engine is LIVE.\n');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TeleMemer Native HTTP Keep-Alive Server running on http://0.0.0.0:${PORT}/health`);
  });

  // 4. Anti-Sleep 4-Minute Self-Ping (Prevents Render / Koyeb / Fly sleeping)
  if (KEEP_ALIVE_URL) {
    console.log(`⏱️ Anti-Sleep Heartbeat active for: ${KEEP_ALIVE_URL}`);
    const pingTarget = KEEP_ALIVE_URL.endsWith('/health')
      ? KEEP_ALIVE_URL
      : `${KEEP_ALIVE_URL.replace(/\/+$/, '')}/health`;

    setInterval(async () => {
      try {
        const res = await fetch(pingTarget);
        console.log(`[Anti-Sleep Ping] Heartbeat pinged ${pingTarget} -> Status ${res.status}`);
      } catch (err) {
        console.warn(`[Anti-Sleep Ping] Ping warning: ${err.message}`);
      }
    }, 240000); // 4 minutes
  }

  // 5. Connect Telegram Bot with Auto-Reconnect & Drop Pending Updates
  startTelegramBotWithReconnect();

  // Graceful shutdown
  const shutdown = () => {
    console.log('🛑 Shutting down TeleMemer gracefully...');
    server.close(() => {
      bot.stop().then(async () => {
        if (db.pool) await db.pool.end().catch(() => {});
        console.log('👋 Database and bot connections closed safely.');
        process.exit(0);
      }).catch(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function startTelegramBotWithReconnect() {
  if (BOT_TOKEN && !BOT_TOKEN.includes('1234567890') && !BOT_TOKEN.includes('DUMMY') && !BOT_TOKEN.includes('your_telegram_bot_token')) {
    console.log('🤖 Connecting to Telegram Bot API with drop_pending_updates: true...');

    const launch = () => {
      bot.start({
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
        onStart: (botInfo) => {
          console.log(`🎉 TeleMemer Bot is LIVE! Username: @${botInfo.username} (ID: ${botInfo.id})`);
        }
      }).catch((botErr) => {
        console.error('⚠️ Telegram connection dropped:', botErr.message);
        console.log('🔄 Reconnecting in 5 seconds...');
        setTimeout(launch, 5000);
      });
    };

    launch();
  } else {
    console.log('ℹ️ No live Telegram BOT_TOKEN detected in environment.');
    console.log('👉 To connect to real Telegram:');
    console.log('   1. Message @BotFather on Telegram and send /newbot');
    console.log('   2. Set BOT_TOKEN="your_token" in .env');
    console.log('   TeleMemer database, HTTP keep-alive, and command engine are fully operational.');
  }
}

bootstrap().catch(err => {
  console.error('Fatal crash on bootstrap:', err);
});
