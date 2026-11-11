import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { items } from '../../config/items.js';
import { formatCoins, progressBar, sanitizeHtml } from '../../utils/formatters.js';

function calculateNetWorth(user) {
  if (!user) return 0;
  const userItems = inventoryRepo.getUserInventory(user.user_id);
  const inventoryValue = userItems.reduce((acc, entry) => {
    const item = items[entry.item_id];
    return acc + (item ? item.sellPrice * entry.quantity : 0);
  }, 0);
  return user.wallet + user.bank + inventoryValue;
}

function buildBalanceCard(targetUser) {
  const netWorth = calculateNetWorth(targetUser);
  const bankPercent = targetUser.bank_max > 0 ? Math.floor((targetUser.bank / targetUser.bank_max) * 100) : 0;
  const bankBar = progressBar(targetUser.bank, targetUser.bank_max, 8);
  const isPremium = (targetUser.premium_until || 0) > Date.now();

  const premiumBadge = isPremium ? ' 💎 <b>[PREMIUM MEMBER]</b>' : '';

  const card = `💳 <b>Financial Portfolio for ${sanitizeHtml(targetUser.first_name)}</b>${premiumBadge}\n` +
    (targetUser.username ? `👤 <i>@${targetUser.username}</i>\n\n` : `\n`) +
    `👛 <b>Wallet:</b> ${formatCoins(targetUser.wallet)}\n` +
    `🏦 <b>Bank:</b> ${formatCoins(targetUser.bank)} / ${formatCoins(targetUser.bank_max)} (<b>${bankPercent}%</b>)\n` +
    `📊 <b>Bank Space:</b> ${bankBar}\n` +
    `💎 <b>Net Worth:</b> ${formatCoins(netWorth)}\n\n` +
    `⭐ <b>Level:</b> ${targetUser.level} (Prestige: ${targetUser.prestige})`;

  const keyboard = new InlineKeyboard()
    .text('🔄 Refresh', `balance:refresh:${targetUser.user_id}`);

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

    const user = userRepo.getOrInitUser(targetUserId, targetUsername, targetFirstName);
    const { text, keyboard } = buildBalanceCard(user);

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
      const user = userRepo.getUser(targetUserId);
      if (!user) {
        return ctx.answerCallbackQuery({ text: 'User account not found.' });
      }

      const { text, keyboard } = buildBalanceCard(user);
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
