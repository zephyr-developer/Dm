import crypto from 'node:crypto';
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

const INSTANCE_ID = crypto.randomUUID();
const POLLING_LEASE_KEY = 'bot_polling_lease';
const LEASE_TTL_MS = 20_000;
const LEASE_RENEW_MS = 8_000;
const STANDBY_CHECK_MS = 10_000;

// Track active bot transport mode to prevent Polling + Webhook collision
let isPolling = false;
let isStandby = false;
let isWebhookActive = false;
let isShuttingDown = false;
let conflictRetries = 0;
let lastConflictWarnAt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
let stableResetTimer: ReturnType<typeof setTimeout> | null = null;
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

function isConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { error_code?: number; message?: string; description?: string };
  if (anyErr.error_code === 409) return true;
  const text = `${anyErr.message || ''} ${anyErr.description || ''}`.toLowerCase();
  return text.includes('409') || text.includes('conflict');
}

async function acquireOrRenewPollingLease(): Promise<boolean> {
  if (!isPostgresConfigured) return true;
  const now = Date.now();
  const expiresAt = now + LEASE_TTL_MS;
  const payload = JSON.stringify({ instanceId: INSTANCE_ID, expiresAt });

  try {
    const res = await db.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE NOT (settings.value LIKE '{%')
          OR (settings.value::jsonb->>'instanceId') = $3
          OR COALESCE((settings.value::jsonb->>'expiresAt')::bigint, 0) < $4
       RETURNING value;`,
      [POLLING_LEASE_KEY, payload, INSTANCE_ID, now]
    );
    return res.rows.length > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ Polling lease check failed, failing open:', message);
    return true;
  }
}

async function releasePollingLease(): Promise<void> {
  if (!isPostgresConfigured) return;
  try {
    await db.query(
      `DELETE FROM settings
       WHERE key = $1
         AND settings.value LIKE '{%'
         AND (settings.value::jsonb->>'instanceId') = $2;`,
      [POLLING_LEASE_KEY, INSTANCE_ID]
    );
  } catch {
    // Best-effort lease release on shutdown/conflict
  }
}

function clearPollingTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (leaseRenewTimer) {
    clearInterval(leaseRenewTimer);
    leaseRenewTimer = null;
  }
  if (stableResetTimer) {
    clearTimeout(stableResetTimer);
    stableResetTimer = null;
  }
}

async function stopPollingIfRunning() {
  clearPollingTimers();
  isStandby = false;
  if (isPolling || bot.isRunning()) {
    isPolling = false;
    await bot.stop().catch(() => {});
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
      await releasePollingLease();
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

  if (isPolling || isShuttingDown) return;

  const scheduleReconnect = (delayMs: number) => {
    if (reconnectTimer || isShuttingDown || isWebhookActive) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void launch();
    }, delayMs);
  };

  const launch = async () => {
    if (isWebhookActive || isPolling || isShuttingDown) return;

    const hasLease = await acquireOrRenewPollingLease();
    if (!hasLease) {
      if (!isStandby) {
        console.log('🛡️ Another TeleMemer instance holds the active polling lease. Standing by...');
      }
      isStandby = true;
      scheduleReconnect(STANDBY_CHECK_MS);
      return;
    }

    isStandby = false;
    isPolling = true;
    console.log('🤖 Connecting to Telegram Bot API (Long Polling) with drop_pending_updates: true...');

    if (leaseRenewTimer) clearInterval(leaseRenewTimer);
    leaseRenewTimer = setInterval(async () => {
      if (!isPolling || isShuttingDown || isWebhookActive) return;
      const renewed = await acquireOrRenewPollingLease();
      if (!renewed) {
        console.warn('🛡️ Lost polling lease to another instance; pausing local poller.');
        await stopPollingIfRunning();
        isStandby = true;
        scheduleReconnect(STANDBY_CHECK_MS);
      }
    }, LEASE_RENEW_MS);

    try {
      bot
        .start({
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
          onStart: (botInfo) => {
            console.log(`🎉 TeleMemer Bot is LIVE! Username: @${botInfo.username} (ID: ${botInfo.id})`);
            if (stableResetTimer) clearTimeout(stableResetTimer);
            stableResetTimer = setTimeout(() => {
              conflictRetries = 0;
            }, 15_000);
          },
        })
        .catch(async (botErr) => {
          const wasPolling = isPolling;
          clearPollingTimers();
          isPolling = false;
          if (isWebhookActive || isShuttingDown || !wasPolling) return;

          if (isConflictError(botErr)) {
            conflictRetries += 1;
            await releasePollingLease();
            const baseBackoff = Math.min(60_000, 10_000 * Math.pow(2, Math.min(conflictRetries - 1, 3)));
            const jitter = Math.floor(Math.random() * 3000);
            const delayMs = baseBackoff + jitter;
            const now = Date.now();
            if (now - lastConflictWarnAt > 30_000) {
              lastConflictWarnAt = now;
              console.warn(
                `⚠️ Another bot instance is polling Telegram (409 Conflict). Backing off for ${Math.round(delayMs / 1000)}s...`
              );
            }
            isStandby = true;
            scheduleReconnect(delayMs);
            return;
          }

          const msg = botErr instanceof Error ? botErr.message : String(botErr);
          console.warn('⚠️ Telegram polling interrupted:', msg);
          console.log('🔄 Reconnecting in 5 seconds...');
          scheduleReconnect(5000);
        });
    } catch (syncErr) {
      clearPollingTimers();
      isPolling = false;
      const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
      console.warn('⚠️ Failed to launch Telegram polling:', message);
    }
  };

  await launch();
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
        const [userRes, coinsRes, groupRes, premRes] = await Promise.all([
          db.query('SELECT COUNT(*) as count FROM users'),
          db.query('SELECT SUM(wallet + bank) as total FROM users'),
          db.query('SELECT COUNT(DISTINCT chat_id) as count FROM group_members'),
          db.query('SELECT COUNT(*) as count FROM users WHERE premium_until > $1', [Date.now()]),
        ]);
        userCount = Number(userRes.rows[0]?.count || 0);
        totalCoins = Number(coinsRes.rows[0]?.total || 0);
        groupCount = Number(groupRes.rows[0]?.count || 0);
        premiumCount = Number(premRes.rows[0]?.count || 0);
      } catch {
        // Keep health response alive even if DB is still connecting
      }

      res.json({
        status: 'online',
        app: 'TeleMemer',
        uptime: process.uptime(),
        botConnected: hasLiveBotToken(),
        mode: isWebhookActive ? 'webhook' : isPolling ? 'polling' : isStandby ? 'standby' : 'idle',
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
      try {
        if (!viteMiddleware && viteInitPromise) {
          await viteInitPromise;
        }
        if (viteMiddleware) {
          return viteMiddleware(req, res, next);
        }
        next();
      } catch (err) {
        next(err);
      }
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

  // Graceful shutdown: release port 3000 immediately, then stop polling & release lease
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('🛑 Shutting down TeleMemer gracefully...');

    const forceExitTimer = setTimeout(() => {
      process.exit(0);
    }, 3000);
    forceExitTimer.unref();

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    const serverClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await Promise.allSettled([
      serverClosed,
      stopPollingIfRunning(),
      releasePollingLease(),
    ]);

    const pgPool = db.pool as { end?: () => Promise<void> } | null;
    if (pgPool && typeof pgPool.end === 'function') {
      await pgPool.end().catch(() => {});
    }
    console.log('👋 Database and bot connections closed safely.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal crash on server startup:', err);
  process.exit(1);
});
