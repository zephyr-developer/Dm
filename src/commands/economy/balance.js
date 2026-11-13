import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { items } from '../../config/items.js';
import { formatCoins, progressBar, sanitizeHtml } from '../../utils/formatters.js';

async function calculateNetWorth(user) {
  if (!user) return 0;
  const userItems = await inventoryRepo.getUserInventory(user.user_id);
  const inventoryValue = userItems.reduce((acc, entry) => {
    const item = items[entry.item_id];
    return acc + (item ? item.sellPrice * entry.quantity : 0);
  }, 0);
  return Number(user.wallet || 0) + Number(user.bank || 0) + inventoryValue;
}

async function buildBalanceCard(targetUser, viewerId, viewerIsOwner = false) {
  const netWorth = await calculateNetWorth(targetUser);
  const wallet = Number(targetUser.wallet || 0);
  const bank = Number(targetUser.bank || 0);
  const bankMax = Number(targetUser.bank_max || 5000);

  const bankPercent = bankMax > 0 ? Math.floor((bank / bankMax) * 100) : 0;
  const bankBar = progressBar(bank, bankMax, 8);
  const isPremium = Number(targetUser.premium_until || 0) > Date.now();
  const premiumBadge = isPremium ? ' 💎 <b>[PREMIUM MEMBER]</b>' : '';

  const targetHandle = targetUser.username
    ? `@${sanitizeHtml(targetUser.username)}`
    : sanitizeHtml(targetUser.first_name || 'Player');

  const card = `💰 <b>${targetHandle}'s Balance</b>${premiumBadge}\n` +
    `👤 <b>Holder:</b> ${sanitizeHtml(targetUser.first_name)}\n\n` +
    `👛 <b>Wallet:</b> ${formatCoins(wallet)}\n` +
    `🏦 <b>Bank:</b> ${formatCoins(bank)} / ${formatCoins(bankMax)} (<b>${bankPercent}%</b>)\n` +
    `📊 <b>Bank Space:</b> ${bankBar}\n` +
    `💎 <b>Net Worth:</b> ${formatCoins(netWorth)}\n\n` +
    `⭐ <b>Level:</b> ${targetUser.level} (Prestige: ${targetUser.prestige})`;

  const keyboard = new InlineKeyboard()
    .text('🔄 Refresh', `balance:refresh:${targetUser.user_id}:${viewerId}`);

  if (targetUser.user_id === viewerId || viewerIsOwner) {
    keyboard.text('📜 Currency Logs', `currencylog:page:1:all:${targetUser.user_id}:${viewerId}`);
  }

  return { text: card, keyboard };
}

export const balance = {
  name: 'balance',
  aliases: ['bal'],
  description: 'View your or another player\'s wallet, bank, and total net worth',
  cooldown: 0,

  async execute(ctx) {
    const callerId = ctx.from.id;
    await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    let targetUser = null;

    // 1. Check replied message
    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      targetUser = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
    } else {
      // 2. Check text_mention entity (users without username)
      const entities = ctx.message?.entities || [];
      const textMention = entities.find(e => e.type === 'text_mention' && e.user);
      if (textMention?.user) {
        const u = textMention.user;
        targetUser = await userRepo.getOrInitUser(u.id, u.username, u.first_name);
      } else {
        // 3. Check @username or username argument
        const args = (ctx.match || '').trim()
          ? ctx.match.trim().split(/\s+/)
          : ctx.message.text.trim().split(/\s+/).slice(1);

        const usernameArg = args[0];
        if (usernameArg) {
          const cleanUsername = usernameArg.replace(/^@/, '').trim();
          targetUser = await userRepo.getUserByUsername(cleanUsername);
          if (!targetUser) {
            return ctx.reply(
              `❌ Could not find a TeleMemer account for <b>@${sanitizeHtml(cleanUsername)}</b>. They need to interact with the bot first!`,
              { parse_mode: 'HTML' }
            );
          }
        }
      }
    }

    // Default to caller
    if (!targetUser) {
      targetUser = await userRepo.getUser(callerId);
    }

    const { text, keyboard } = await buildBalanceCard(targetUser, callerId, isOwner(ctx));

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);
    const viewerId = Number(parts[3]) || ctx.from.id;

    if (action === 'refresh') {
      const user = await userRepo.getUser(targetUserId);
      if (!user) {
        return ctx.answerCallbackQuery({ text: 'User account not found.' });
      }

      const { text, keyboard } = await buildBalanceCard(user, viewerId, isOwner(ctx));
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        await ctx.answerCallbackQuery({ text: 'Balance refreshed!' });
      } catch {
        await ctx.answerCallbackQuery({ text: 'Balance is already up to date.' });
      }
    }
  }
};

export default balance;
