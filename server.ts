import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { webhookCallback } from 'grammy';
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
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Track active bot transport mode to prevent Polling + Webhook collision
let isPolling = false;
let isWebhookActive = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let cachedWebhookMiddleware: express.RequestHandler | null = null;

function hasLiveBotToken(): boolean {
  return Boolean(
    BOT_TOKEN &&
      !BOT_TOKEN.includes('1234567890') &&
      !BOT_TOKEN.includes('DUMMY') &&
      !BOT_TOKEN.includes('your_telegram_bot_token')
  );
}

// ====================================================================
// 1. GLOBAL PROCESS CRASH GUARDS (24/7 Crash-Proofing)
// ====================================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[TeleMemer Crash Guard] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[TeleMemer Crash Guard] Uncaught Exception:', err);
});

async function stopPollingIfRunning() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (isPolling) {
    isPolling = false;
    if (bot.isInited()) {
      await bot.stop().catch(() => {});
    }
  }
}

function getWebhookMiddleware(): express.RequestHandler {
  if (!cachedWebhookMiddleware) {
    // Only instantiate webhookCallback when webhook mode is actually used,
    // because grammY's webhookCallback patches bot.start() to throw in polling mode.
    cachedWebhookMiddleware = webhookCallback(bot, 'express');
  }
  return cachedWebhookMiddleware;
}

async function startTelegramBotWithReconnect() {
  if (!hasLiveBotToken()) {
    console.log('ℹ️ No live Telegram BOT_TOKEN detected in environment.');
    console.log('👉 Set BOT_TOKEN in your environment variables to connect to Telegram.');
    return;
  }

  // Never start Long Polling if Webhook mode is active or explicitly configured
  if (isWebhookActive || WEBHOOK_URL) {
    if (WEBHOOK_URL) {
      await stopPollingIfRunning();
      const targetUrl = WEBHOOK_URL.endsWith('/api/webhook')
        ? WEBHOOK_URL
        : `${WEBHOOK_URL.replace(/\/+$/, '')}/api/webhook`;
      try {
        await bot.api.setWebhook(targetUrl, {
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
        });
        isWebhookActive = true;
        console.log(`🔗 Telegram Webhook mode active: ${targetUrl}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('⚠️ Failed to configure WEBHOOK_URL:', message);
      }
    }
    return;
  }

  if (isPolling) return;

  console.log('🤖 Connecting to Telegram Bot API (Long Polling) with drop_pending_updates: true...');

  // Ensure no stale Telegram webhook is active alongside polling
  await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

  const launch = () => {
    if (isWebhookActive || isPolling) return;
    isPolling = true;

    try {
      bot
        .start({
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
          onStart: (botInfo) => {
            console.log(`🎉 TeleMemer Bot is LIVE! Username: @${botInfo.username} (ID: ${botInfo.id})`);
          },
        })
        .catch((botErr) => {
          isPolling = false;
          if (isWebhookActive) return;
          console.error('⚠️ Telegram connection dropped:', botErr.message);
          console.log('🔄 Reconnecting in 5 seconds...');
          reconnectTimer = setTimeout(launch, 5000);
        });
    } catch (syncErr) {
      isPolling = false;
      const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
      console.error('⚠️ Failed to launch Telegram polling:', message);
    }
  };

  launch();
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
        botConnected: hasLiveBotToken(),
        mode: isWebhookActive ? 'webhook' : isPolling ? 'polling' : 'idle',
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

  // Setup Webhook endpoint: stops polling first to guarantee no double responses
  const handleSetupWebhook = async (req: express.Request, res: express.Response) => {
    try {
      if (!hasLiveBotToken()) {
        return res.status(400).json({ ok: false, error: 'Live BOT_TOKEN not configured.' });
      }

      await loadCommands();
      await stopPollingIfRunning();

      const rawUrl =
        (typeof req.body?.url === 'string' && req.body.url) ||
        (typeof req.query?.url === 'string' && req.query.url) ||
        WEBHOOK_URL ||
        (req.headers.host ? `https://${req.headers.host}` : '');

      if (!rawUrl) {
        return res.status(400).json({ ok: false, error: 'Missing webhook url parameter or WEBHOOK_URL env var.' });
      }

      const webhookUrl = rawUrl.endsWith('/api/webhook')
        ? rawUrl
        : `${rawUrl.replace(/\/+$/, '')}/api/webhook`;

      await bot.api.setWebhook(webhookUrl, {
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
      });
      isWebhookActive = true;

      return res.json({ ok: true, mode: 'webhook', webhookUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: message });
    }
  };

  app.post('/api/setup-webhook', handleSetupWebhook);
  app.get('/api/setup-webhook', handleSetupWebhook);

  // Telegram Webhook receiver: always acknowledge cleanly so Telegram never retries duplicates
  app.post('/api/webhook', async (req, res, next) => {
    try {
      await stopPollingIfRunning();
      isWebhookActive = true;
      if (!bot.isInited()) {
        await bot.init();
      }
      await loadCommands();
      const handleTelegramWebhook = getWebhookMiddleware();
      return handleTelegramWebhook(req, res, next);
    } catch (err) {
      console.error('[TeleMemer Webhook Error]:', err);
      if (!res.headersSent) {
        res.status(200).json({ ok: true });
      }
    }
  });

  // Frontend middleware (Vite in dev, static dist in production)
  let viteMiddleware: express.RequestHandler | null = null;
  let viteInitPromise: Promise<void> | null = null;

  if (!isProduction) {
    viteInitPromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true',
        },
        appType: 'spa',
      });
      viteMiddleware = vite.middlewares as unknown as express.RequestHandler;
    })();

    app.use(async (req, res, next) => {
      if (!viteMiddleware && viteInitPromise) {
        await viteInitPromise;
      }
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      next();
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // Bind port 3000 immediately so health probes & dev proxy succeed right away
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 TeleMemer Full-Stack Server running on http://0.0.0.0:${PORT}`);
      resolve();
    });
  });

  if (viteInitPromise) {
    viteInitPromise.catch((viteErr) => {
      console.error('❌ Failed to initialize Vite dev middleware:', viteErr);
    });
  }

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

  await startTelegramBotWithReconnect();

  // Graceful shutdown (close keep-alive sockets immediately so restarts never stall on EADDRINUSE)
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('🛑 Shutting down TeleMemer gracefully...');

    const forceExitTimer = setTimeout(() => {
      process.exit(0);
    }, 1500);
    forceExitTimer.unref();

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    server.close(async () => {
      await stopPollingIfRunning();
      const pgPool = db.pool as { end?: () => Promise<void> } | null;
      if (pgPool && typeof pgPool.end === 'function') {
        await pgPool.end().catch(() => {});
      }
      console.log('👋 Database and bot connections closed safely.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal crash on server startup:', err);
  process.exit(1);
});
