import express from 'express';
import dotenv from 'dotenv';
import db, { initDatabase } from './database/db.js';
import { bot, loadCommands } from './bot.js';
import { getAllItems } from './config/items.js';
import { getAllJobs } from './config/jobs.js';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🐸 TeleMemer - Telegram RPG & Economy Engine');
  console.log('----------------------------------------------------');

  // 1. Initialize SQLite database schemas
  try {
    initDatabase();
    console.log('✅ SQLite Database initialized successfully (WAL mode enabled).');
  } catch (dbErr) {
    console.error('❌ Failed to initialize SQLite database:', dbErr);
    process.exit(1);
  }

  // 2. Dynamically load all command modules and callback handlers
  try {
    await loadCommands();
    console.log('✅ Command & Callback modules registered.');
  } catch (loaderErr) {
    console.error('❌ Error during command loading:', loaderErr);
  }

  // 3. Launch HTTP Server (for health-checks, dashboard status & preview)
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    try {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
      const totalCoins = db.prepare('SELECT SUM(wallet + bank) as total FROM users').get()?.total || 0;
      const groupCount = db.prepare('SELECT COUNT(DISTINCT chat_id) as count FROM group_members').get()?.count || 0;

      res.json({
        status: 'online',
        app: 'TeleMemer',
        botConnected: Boolean(BOT_TOKEN && !BOT_TOKEN.includes('1234567890') && !BOT_TOKEN.includes('DUMMY')),
        database: 'connected',
        stats: {
          registeredUsers: userCount,
          activeGroups: groupCount,
          totalEconomyCoins: totalCoins,
          catalogItems: getAllItems().length,
          availableJobs: getAllJobs().length
        }
      });
    } catch (err) {
      res.status(500).json({ status: 'error', error: err.message });
    }
  });

  app.get('/api/items', (req, res) => {
    res.json(getAllItems());
  });

  app.get('/api/jobs', (req, res) => {
    res.json(getAllJobs());
  });

  // Start Express on PORT
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TeleMemer HTTP Status & API Service running on http://0.0.0.0:${PORT}`);
  });

  // 4. Start Telegram Bot Long-Polling
  if (BOT_TOKEN && !BOT_TOKEN.includes('1234567890') && !BOT_TOKEN.includes('DUMMY') && !BOT_TOKEN.includes('your_telegram_bot_token')) {
    console.log('🤖 Connecting to Telegram Bot API with configured BOT_TOKEN...');
    bot.start({
      onStart: (botInfo) => {
        console.log(`🎉 TeleMemer Bot is LIVE! Username: @${botInfo.username} (ID: ${botInfo.id})`);
      }
    }).catch((botErr) => {
      console.error('❌ Failed to start Telegram Bot long polling:', botErr.message);
    });
  } else {
    console.log('ℹ️ No live Telegram BOT_TOKEN detected in environment.');
    console.log('👉 To connect to real Telegram:');
    console.log('   1. Message @BotFather on Telegram and send /newbot');
    console.log('   2. Copy the API Token provided');
    console.log('   3. Put BOT_TOKEN="your_token_here" in .env and restart!');
    console.log('   TeleMemer database, command engine, and HTTP services are fully operational.');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('🛑 Shutting down TeleMemer gracefully...');
    server.close(() => {
      bot.stop().then(() => {
        db.close();
        console.log('👋 Database and bot connections closed.');
        process.exit(0);
      }).catch(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
  console.error('Fatal crash on bootstrap:', err);
});
