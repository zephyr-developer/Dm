import { Bot } from 'grammy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import dedupUpdates from './middlewares/dedupUpdates.js';
import registerUser from './middlewares/registerUser.js';
import accountGuard from './middlewares/accountGuard.js';
import heistGuard from './middlewares/heistGuard.js';
import cooldownRepo from './database/cooldownRepo.js';
import userRepo from './database/userRepo.js';
import { isOwner } from './middlewares/ownerGuard.js';
import { formatTime } from './utils/formatters.js';
import { setSecurityBot, handleAntiCheatCallback, handleReportModerationCallback } from './services/antiCheat.js';

const GAMBLE_WARNING_ALERT =
  '⚠️ Our Stance on Gambling:\nGambling is entertainment, NOT a way to make money. The house always wins! Never spend real money. Report RMT sellers via /report!';

const GAMBLE_WARNING_FULL_TEXT =
  `⚠️ <b>Our Stance on Gambling</b>\n` +
  `━━━━━━━━━━━━━━━━━━━━━\n` +
  `It is important to remember that gambling is not a way to make money, real or fake. It is a form of entertainment and should be treated as such. If you or someone you know is struggling with gambling addiction, please seek help.\n\n` +
  `Additionally, please remember that the odds are always in favor of the house. The house always wins.\n` +
  `You should NEVER spend real money to gamble in games. If someone is offering to sell you in-game currency for real money, they are breaking our listed rules and should be reported: <code>/report &lt;@user&gt; &lt;reason&gt;</code>`;

const GAMBLE_WARNING_COOLDOWN_MS = 60_000;
const gambleWarningCooldowns = new Map();

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.BOT_TOKEN || 'DUMMY_TOKEN_FOR_SETUP';
export const bot = new Bot(token);
setSecurityBot(bot);

// In-memory registry of commands and callback handlers
export const commands = new Map();
export const callbackHandlers = new Map();

// Singleton locks to guarantee handlers are never attached more than once
let isLoaded = false;
let loadingPromise = null;
let defaultCommandsRegistered = false;

// 1. Global Middlewares (Dedup MUST be first)
bot.use(dedupUpdates);

// 2. Global Auto-Reply Quote & Forum Topic Threading wrapper
bot.use(async (ctx, next) => {
  if (ctx.message) {
    const origReply = ctx.reply.bind(ctx);
    ctx.reply = (text, other = {}, signal) => {
      const mergedOptions = {
        ...other,
        reply_parameters: other.reply_parameters || {
          message_id: ctx.message.message_id,
          allow_sending_without_reply: true
        }
      };
      if (ctx.message.message_thread_id && !mergedOptions.message_thread_id) {
        mergedOptions.message_thread_id = ctx.message.message_thread_id;
      }
      return origReply(text, mergedOptions, signal);
    };
  }
  await next();
});

bot.use(registerUser);
bot.use(accountGuard);
bot.use(heistGuard);

// 24/7 Crash-Proof Error Handler: Catch all grammY / Telegram API errors
bot.catch((err) => {
  const ctx = err.ctx;
  const error = err.error;
  const description = error?.description || error?.message || String(error);

  // Suppress harmless common Telegram errors that shouldn't pollute logs or interrupt execution
  if (
    description.includes('message is not modified') ||
    description.includes('query is too old') ||
    description.includes('message to edit not found') ||
    description.includes('bot was blocked by the user') ||
    description.includes('chat not found')
  ) {
    return;
  }

  console.error(`[TeleMemer Safe Catch] Error handling update ${ctx?.update?.update_id}:`, description);
});

// Helper to check button ownership lock
export function checkButtonOwnership(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data) return true;

  const parts = data.split(':');
  // Anti-cheat & Report Owner review buttons (`ac:...` and `rep:...`) are restricted exclusively to @tzhunyuan
  if (parts[0] === 'ac' || parts[0] === 'rep') {
    if (!isOwner(ctx)) {
      ctx.answerCallbackQuery({
        text: '❌ Unauthorized: Owner security controls only.',
        show_alert: true
      }).catch(() => {});
      return false;
    }
    return true;
  }

  // If the callback explicitly marks itself as shared (e.g. gamble:warning, coinbomb, heist join), allow all
  if (
    data === 'gamble:warning' ||
    parts.includes('shared') ||
    parts.includes('public') ||
    parts[0] === 'heist_join' ||
    parts[0] === 'coinbomb_claim' ||
    parts[0] === 'coinbomb' ||
    (parts[0] === 'bankrob' && parts[1] === 'join')
  ) {
    return true;
  }

  // Look for target user_id in the last segment
  const potentialUserId = Number(parts[parts.length - 1]);
  if (!isNaN(potentialUserId) && potentialUserId > 1000) {
    if (ctx.from.id !== potentialUserId) {
      ctx.answerCallbackQuery({
        text: "🚫 This isn't your game or session! Run your own command.",
        show_alert: true
      }).catch(() => {});
      return false;
    }
  }

  return true;
}

// 3. Dynamic Command & Callback Loader (Idempotent / Single-Execution)
export async function loadCommands() {
  if (isLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const commandsDir = path.resolve(__dirname, 'commands');

    if (!fs.existsSync(commandsDir)) {
      console.log('[TeleMemer] Creating commands directory...');
      fs.mkdirSync(commandsDir, { recursive: true });
      isLoaded = true;
      return;
    }

    const categories = fs.readdirSync(commandsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`[TeleMemer] Scanning ${categories.length} command categories...`);

    const registeredTriggers = new Set();

    for (const category of categories) {
      const categoryPath = path.join(commandsDir, category);
      const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

      for (const file of files) {
        try {
          const filePath = path.join(categoryPath, file);
          const fileUrl = pathToFileURL(filePath).href;
          const commandModule = await import(fileUrl);
          const command = commandModule.default || commandModule;

          if (!command || !command.name || typeof command.execute !== 'function') {
            console.warn(`[TeleMemer] Skipping invalid command module: ${category}/${file}`);
            continue;
          }

          if (commands.has(command.name)) {
            console.warn(`[TeleMemer] Skipping duplicate command name: /${command.name} (${category}/${file})`);
            continue;
          }

          command.category = category;
          commands.set(command.name, command);

          // Deduplicated trigger list across command + global registry
          const uniqueTriggers = [...new Set([command.name, ...(command.aliases || [])].filter(Boolean))]
            .filter(trigger => !registeredTriggers.has(trigger));

          if (uniqueTriggers.length === 0) {
            continue;
          }
          uniqueTriggers.forEach(t => registeredTriggers.add(t));

          bot.command(uniqueTriggers, async (ctx) => {
            const userId = ctx.from?.id;

            // 1. If this is an Underground Owner command, verify authorization first
            if (category === 'owner') {
              if (!isOwner(ctx)) {
                return ctx.reply('❌ Unknown command. Type /help to see all available commands.');
              }
            }

            // 2. Cooldown check (Owner @tzhunyuan MUST STILL OBEY COOLDOWNS!)
            if (userId && command.cooldown && command.cooldown > 0) {
              const { onCooldown, remainingSeconds } = await cooldownRepo.checkCooldown(userId, command.name);
              if (onCooldown) {
                const isPrem = await userRepo.isPremium(userId);
                let cdMsg = `⏳ <b>Slow down!</b> Wait <b>${formatTime(remainingSeconds)}</b> before using <code>/${command.name}</code> again.`;
                if (!isPrem) {
                  const premWait = Math.max(3, Math.floor(command.cooldown * 0.5));
                  cdMsg += `\n💎 <i>Tip: Premium users only wait ${formatTime(premWait)}!</i>`;
                }
                return ctx.reply(cdMsg, { parse_mode: 'HTML' });
              }
            }

            // 3. Guard against double replies (command calling ctx.reply AND returning a string)
            let hasReplied = false;
            const origReply = ctx.reply.bind(ctx);
            ctx.reply = async (...args) => {
              hasReplied = true;
              return origReply(...args);
            };

            try {
              const result = await command.execute(ctx);
              if (typeof result === 'string' && !hasReplied) {
                await ctx.reply(result, { parse_mode: 'HTML' });
              }
              // Apply effective cooldown (50% reduction for Premium)
              if (userId && command.cooldown && command.cooldown > 0) {
                await cooldownRepo.applyEffectiveCooldown(userId, command.name, command.cooldown);
              }
            } catch (execErr) {
              console.error(`[TeleMemer] Error executing /${command.name}:`, execErr.message);
              if (!hasReplied) {
                await origReply(`⚠️ An error occurred while executing /${command.name}. Please try again later.`).catch(() => {});
              }
            } finally {
              ctx.reply = origReply;
            }
          });

          // Register callback query handler if exported
          if (typeof command.handleCallback === 'function') {
            callbackHandlers.set(command.name, command.handleCallback);
          }

          console.log(`[TeleMemer] Loaded /${command.name} [${category}] (aliases: ${command.aliases?.join(', ') || 'none'})`);
        } catch (loadErr) {
          console.error(`[TeleMemer] Failed to load command ${category}/${file}:`, loadErr);
        }
      }
    }

    // Built-in /start & /help & global callback dispatcher
    registerDefaultCommands();
    isLoaded = true;
  })();

  try {
    await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    throw err;
  }
}

function registerDefaultCommands() {
  if (defaultCommandsRegistered) return;
  defaultCommandsRegistered = true;

  bot.command(['start', 'help'], async (ctx) => {
    let helpMsg = `🐸 <b>Welcome to TeleMemer!</b>\n` +
      `The definitive RPG & Economy bot for Telegram groups, inspired by Dank Memer.\n\n` +
      `<b>⚡ Quick Start Guide:</b>\n` +
      `• /bal - Check your wallet and bank\n` +
      `• /flow - Single-message grinding action bar!\n` +
      `• /daily, /weekly, /monthly - Claim periodic paychecks\n` +
      `• /shop - Browse weapons, tools, and defenses\n` +
      `• /work - Get a job and earn regular paychecks\n` +
      `• /bj, /slots, /scratch - Gamble your riches!\n` +
      `• /rob, /bankrob - High-stakes PvP theft\n\n`;

    const categoryNames = {
      economy: '🪙 Economy',
      grind: '⛏️ Grinding',
      items: '🎒 Items & Shop',
      pvp: '⚔️ PvP & Social',
      gambling: '🎰 Gambling',
      progression: '⭐ Progression'
    };

    const grouped = {};
    for (const cmd of commands.values()) {
      // Hide underground owner commands from public help menu
      if (cmd.category === 'owner') continue;
      if (!grouped[cmd.category]) grouped[cmd.category] = [];
      grouped[cmd.category].push(cmd);
    }

    for (const [cat, catName] of Object.entries(categoryNames)) {
      if (grouped[cat] && grouped[cat].length > 0) {
        helpMsg += `<b>${catName}:</b>\n`;
        const list = grouped[cat].map(c => `/${c.name} - <i>${c.description || 'Action'}</i>`).join('\n');
        helpMsg += `${list}\n\n`;
      }
    }

    return ctx.reply(helpMsg, { parse_mode: 'HTML' });
  });

  // Global callback_query dispatcher with button ownership lock
  bot.on('callback_query:data', async (ctx) => {
    // 1. Enforce button ownership lock
    if (!checkButtonOwnership(ctx)) {
      return;
    }

    const data = ctx.callbackQuery.data;
    const parts = data.split(':');

    if (data === 'gamble:warning') {
      await ctx.answerCallbackQuery({
        text: GAMBLE_WARNING_ALERT,
        show_alert: true
      }).catch(() => {});

      const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? 'unknown';
      const userId = ctx.from?.id ?? 'unknown';
      const cdKey = `${chatId}:${userId}`;
      const now = Date.now();
      const lastSentAt = gambleWarningCooldowns.get(cdKey) || 0;

      if (now - lastSentAt >= GAMBLE_WARNING_COOLDOWN_MS) {
        if (gambleWarningCooldowns.size > 500) {
          for (const [k, ts] of gambleWarningCooldowns.entries()) {
            if (now - ts >= GAMBLE_WARNING_COOLDOWN_MS) {
              gambleWarningCooldowns.delete(k);
            }
          }
        }
        gambleWarningCooldowns.set(cdKey, now);

        const triggerMsg = ctx.callbackQuery?.message;
        const replyOpts = { parse_mode: 'HTML' };
        if (triggerMsg?.message_id) {
          replyOpts.reply_parameters = {
            message_id: triggerMsg.message_id,
            allow_sending_without_reply: true
          };
        }
        if (triggerMsg?.message_thread_id) {
          replyOpts.message_thread_id = triggerMsg.message_thread_id;
        }
        await ctx.reply(GAMBLE_WARNING_FULL_TEXT, replyOpts).catch(() => {});
      }
      return;
    }

    if (parts[0] === 'ac') {
      try {
        await handleAntiCheatCallback(ctx);
      } catch (err) {
        console.error(`[TeleMemer] Error handling anti-cheat callback ${data}:`, err.message);
        await ctx.answerCallbackQuery({ text: '⚠️ Failed to execute security action.' }).catch(() => {});
      }
      return;
    }

    if (parts[0] === 'rep') {
      try {
        await handleReportModerationCallback(ctx);
      } catch (err) {
        console.error(`[TeleMemer] Error handling report moderation callback ${data}:`, err.message);
        await ctx.answerCallbackQuery({ text: '⚠️ Failed to execute report moderation action.' }).catch(() => {});
      }
      return;
    }

    const commandKey = parts[0] === 'coinbomb' || parts[0] === 'coinbomb_claim' ? 'use' : parts[0];

    // Check if there is a handler registered for this prefix
    const handler = callbackHandlers.get(commandKey);
    if (handler) {
      try {
        await handler(ctx);
      } catch (err) {
        console.error(`[TeleMemer] Error handling callback ${data}:`, err.message);
        await ctx.answerCallbackQuery({ text: '⚠️ Something went wrong processing your choice.' }).catch(() => {});
      }
      return;
    }

    // Default fallback
    await ctx.answerCallbackQuery().catch(() => {});
  });
}

export default bot;
