import { Bot } from 'grammy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import registerUser from './middlewares/registerUser.js';
import cooldownRepo from './database/cooldownRepo.js';
import { formatTime } from './utils/formatters.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.BOT_TOKEN || 'DUMMY_TOKEN_FOR_SETUP';
export const bot = new Bot(token);

// In-memory registry of commands and callback handlers
export const commands = new Map();
export const callbackHandlers = new Map();

// 1. Global Middlewares
bot.use(registerUser);

// Global Error Handler
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[TeleMemer Error] Error while handling update ${ctx?.update?.update_id}:`, err.error);
});

// Helper to check button ownership lock
export function checkButtonOwnership(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data) return true;

  const parts = data.split(':');
  // If the callback explicitly marks itself as shared (e.g. coinbomb, heist join), allow all
  if (parts.includes('shared') || parts.includes('public') || parts[0] === 'heist_join' || parts[0] === 'coinbomb_claim') {
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

// 2. Dynamic Command & Callback Loader
export async function loadCommands() {
  const commandsDir = path.resolve(__dirname, 'commands');

  if (!fs.existsSync(commandsDir)) {
    console.log('[TeleMemer] Creating commands directory...');
    fs.mkdirSync(commandsDir, { recursive: true });
    return;
  }

  const categories = fs.readdirSync(commandsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  console.log(`[TeleMemer] Scanning ${categories.length} command categories...`);

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

        command.category = category;
        commands.set(command.name, command);

        const triggers = [command.name, ...(command.aliases || [])];

        bot.command(triggers, async (ctx) => {
          const userId = ctx.from?.id;

          // Cooldown check if configured on the command
          if (userId && command.cooldown && command.cooldown > 0) {
            const { onCooldown, remainingSeconds } = cooldownRepo.checkCooldown(userId, command.name);
            if (onCooldown) {
              return ctx.reply(
                `⏳ <b>Slow down!</b> You can use <code>/${command.name}</code> again in <b>${formatTime(remainingSeconds)}</b>.`,
                { parse_mode: 'HTML' }
              );
            }
          }

          try {
            await command.execute(ctx);
            // Apply cooldown after successful execution
            if (userId && command.cooldown && command.cooldown > 0) {
              cooldownRepo.setCooldown(userId, command.name, command.cooldown);
            }
          } catch (execErr) {
            console.error(`[TeleMemer] Error executing /${command.name}:`, execErr);
            await ctx.reply(`⚠️ An error occurred while executing /${command.name}. Please try again later.`).catch(() => {});
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

  // Built-in /start & /help
  registerDefaultCommands();
}

function registerDefaultCommands() {
  bot.command(['start', 'help'], async (ctx) => {
    let helpMsg = `🐸 <b>Welcome to TeleMemer!</b>\n` +
      `The definitive RPG & Economy bot for Telegram groups, inspired by Dank Memer.\n\n` +
      `<b>⚡ Quick Start Guide:</b>\n` +
      `• /bal - Check your wallet and bank\n` +
      `• /flow - Single-message grinding action bar!\n` +
      `• /daily - Claim your daily coins & streak reward\n` +
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

    await ctx.reply(helpMsg, { parse_mode: 'HTML' });
  });

  // Global callback_query dispatcher with button ownership lock
  bot.on('callback_query:data', async (ctx) => {
    // 1. Enforce button ownership lock
    if (!checkButtonOwnership(ctx)) {
      return;
    }

    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const commandKey = parts[0];

    // Check if there is a handler registered for this prefix
    const handler = callbackHandlers.get(commandKey);
    if (handler) {
      try {
        await handler(ctx);
      } catch (err) {
        console.error(`[TeleMemer] Error handling callback ${data}:`, err);
        await ctx.answerCallbackQuery({ text: '⚠️ Something went wrong processing your choice.' }).catch(() => {});
      }
      return;
    }

    // Default fallback
    await ctx.answerCallbackQuery().catch(() => {});
  });
}

export default bot;
