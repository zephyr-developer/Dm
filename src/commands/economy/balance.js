import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
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

async function buildBalanceCard(targetUser) {
  const netWorth = await calculateNetWorth(targetUser);
  const wallet = Number(targetUser.wallet || 0);
  const bank = Number(targetUser.bank || 0);
  const bankMax = Number(targetUser.bank_max || 5000);

  const bankPercent = bankMax > 0 ? Math.floor((bank / bankMax) * 100) : 0;
  const bankBar = progressBar(bank, bankMax, 8);
  const isPremium = Number(targetUser.premium_until || 0) > Date.now();

  const premiumBadge = isPremium ? ' 💎 <b>[PREMIUM MEMBER]</b>' : '';

  const card = `💳 <b>Financial Portfolio for ${sanitizeHtml(targetUser.first_name)}</b>${premiumBadge}\n` +
    (targetUser.username ? `👤 <i>@${targetUser.username}</i>\n\n` : `\n`) +
    `👛 <b>Wallet:</b> ${formatCoins(wallet)}\n` +
    `🏦 <b>Bank:</b> ${formatCoins(bank)} / ${formatCoins(bankMax)} (<b>${bankPercent}%</b>)\n` +
    `📊 <b>Bank Space:</b> ${bankBar}\n` +
    `💎 <b>Net Worth:</b> ${formatCoins(netWorth)}\n\n` +
    `⭐ <b>Level:</b> ${targetUser.level} (Prestige: ${targetUser.prestige})`;

  const keyboard = new InlineKeyboard()
    .text('🔄 Refresh', `balance:refresh:${targetUser.user_id}`)
    .text('📜 Currency Logs', `currencylog:page:1:all:${targetUser.user_id}:${targetUser.user_id}`);

  return { text: card, keyboard };
}

export const balance = {
  name: 'balance',
  aliases: ['bal'],
  description: 'View your wallet, bank, and total net worth (with Premium indicator)',
  cooldown: 0,

  async execute(ctx) {
    let targetUserId = ctx.from.id;
    let targetUsername = ctx.from.username;
    let targetFirstName = ctx.from.first_name;

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      targetUserId = replied.id;
      targetUsername = replied.username;
      targetFirstName = replied.first_name;
    }

    const user = await userRepo.getOrInitUser(targetUserId, targetUsername, targetFirstName);
    const { text, keyboard } = await buildBalanceCard(user);

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

    if (action === 'refresh') {
      const user = await userRepo.getUser(targetUserId);
      if (!user) {
        return ctx.answerCallbackQuery({ text: 'User account not found.' });
      }

      const { text, keyboard } = await buildBalanceCard(user);
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        await ctx.answerCallbackQuery({ text: 'Balance refreshed!' });
      } catch (err) {
        await ctx.answerCallbackQuery({ text: 'Balance is already up to date.' });
      }
    }
  }
};

export default balance;
