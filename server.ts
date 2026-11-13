import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import db, { initDatabase, isPostgresConfigured } from './src/database/db.js';
import { bot, loadCommands } from './src/bot.js';
import { getAllItems } from './src/config/items.js';
import { getAllJobs } from './src/config/jobs.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
// In development (AI Studio container), nginx occupies PORT=8080 and proxies to 3000.
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

function startTelegramBotWithReconnect() {
  if (
    BOT_TOKEN &&
    !BOT_TOKEN.includes('1234567890') &&
    !BOT_TOKEN.includes('DUMMY') &&
    !BOT_TOKEN.includes('your_telegram_bot_token')
  ) {
    console.log('🤖 Connecting to Telegram Bot API with drop_pending_updates: true...');

    const launch = () => {
      bot
        .start({
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
          onStart: (botInfo) => {
            console.log(`🎉 TeleMemer Bot is LIVE! Username: @${botInfo.username} (ID: ${botInfo.id})`);
          },
        })
        .catch((botErr) => {
          console.error('⚠️ Telegram connection dropped:', botErr.message);
          console.log('🔄 Reconnecting in 5 seconds...');
          setTimeout(launch, 5000);
        });
    };

    launch();
  } else {
    console.log('ℹ️ No live Telegram BOT_TOKEN detected in environment.');
    console.log('👉 Set BOT_TOKEN in your environment variables to connect to Telegram.');
  }
}

async function startServer() {
  console.log('----------------------------------------------------');
  console.log('🐸 TeleMemer - 24/7 Telegram RPG & Economy Engine');
  console.log('----------------------------------------------------');

  const app = express();
  app.use(express.json());

  // Health & API endpoints
  const handleHealth = async (_req: express.Request, res: express.Response) => {
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
      } catch {
        // Keep health response alive even if DB is still connecting
      }

      res.json({
        status: 'online',
        app: 'TeleMemer',
        uptime: process.uptime(),
        botConnected: Boolean(BOT_TOKEN && !BOT_TOKEN.includes('1234567890') && !BOT_TOKEN.includes('DUMMY')),
        database: isPostgresConfigured ? 'PostgreSQL (Persistent)' : 'In-Memory Dev Mode',
        stats: {
          registeredUsers: userCount,
          activeGroups: groupCount,
          premiumUsers: premiumCount,
          totalEconomyCoins: totalCoins,
          catalogItems: getAllItems().length,
          availableJobs: getAllJobs().length,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: 'error', error: message });
    }
  };

  app.get('/health', handleHealth);
  app.get('/api/health', handleHealth);

  app.get('/api/items', (_req, res) => {
    res.json(getAllItems());
  });

  app.get('/api/jobs', (_req, res) => {
    res.json(getAllJobs());
  });

  // Frontend middleware (Vite in dev, static dist in production)
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 TeleMemer Full-Stack Server running on http://0.0.0.0:${PORT}`);
      resolve();
    });
  });

  // Anti-Sleep 4-Minute Self-Ping (Prevents Render / Koyeb / Fly sleeping)
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
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Anti-Sleep Ping] Ping warning: ${message}`);
      }
    }, 240000);
  }

  // Initialize PostgreSQL & load bot commands in background without blocking HTTP startup
  try {
    await initDatabase();
    console.log('✅ PostgreSQL Database initialized successfully (Zero-Drop policy active).');
  } catch (dbErr) {
    console.error('❌ Failed to initialize database:', dbErr);
  }

  try {
    await loadCommands();
    console.log('✅ Command & Callback modules registered.');
  } catch (loaderErr) {
    console.error('❌ Error during command loading:', loaderErr);
  }

  startTelegramBotWithReconnect();

  // Graceful shutdown
  const shutdown = () => {
    console.log('🛑 Shutting down TeleMemer gracefully...');
    server.close(() => {
      bot
        .stop()
        .then(async () => {
          const pgPool = db.pool as { end?: () => Promise<void> } | null;
          if (pgPool && typeof pgPool.end === 'function') {
            await pgPool.end().catch(() => {});
          }
          console.log('👋 Database and bot connections closed safely.');
          process.exit(0);
        })
        .catch(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal crash on server startup:', err);
  process.exit(1);
});
