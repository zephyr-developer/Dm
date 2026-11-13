import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import shopStockRepo from '../../database/shopStockRepo.js';
import { getBuyableItems, getItem } from '../../config/items.js';
import { formatCoins, formatTime } from '../../utils/formatters.js';

const ITEMS_PER_PAGE = 4;

async function buildShopPage(userId, page = 1) {
  const buyable = getBuyableItems();
  const totalPages = Math.ceil(buyable.length / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.max(1, Math.min(totalPages, page));

  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = buyable.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  const user = await userRepo.getUser(userId);
  const walletCoins = user ? Number(user.wallet || 0) : 0;
  const stockMap = await shopStockRepo.getAllLimitedStocks();

  let text = `🛍️ <b>TeleMemer Black Market & Equipment Shop</b>\n` +
    `👛 <b>Your Wallet:</b> ${formatCoins(walletCoins)} | 📄 <b>Page ${currentPage} / ${totalPages}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const stockInfoById = new Map();

  for (const item of pageItems) {
    const userQuantity = await inventoryRepo.getItem(userId, item.id);
    let stockLine = '';
    if (item.stockLimit) {
      const stockInfo = stockMap.get(item.id) || await shopStockRepo.getItemStock(item.id);
      stockInfoById.set(item.id, stockInfo);
      const resetInSec = Math.max(1, Math.ceil((stockInfo.nextResetAt - Date.now()) / 1000));
      const periodTag = stockInfo.stockPeriod === 'weekly' ? 'Weekly' : 'Daily';
      if (stockInfo.currentStock > 0) {
        stockLine = `• 🔥 <b>Global Stock:</b> <b>${stockInfo.currentStock}/${stockInfo.stockLimit}</b> (${periodTag} | Resets in ${formatTime(resetInSec)})\n`;
      } else {
        stockLine = `• ❌ <b>SOLD OUT</b> (Restocks in <b>${formatTime(resetInSec)}</b>)\n`;
      }
    }

    const prestigeTag = item.prestigeKeep ? ' 🛡️ <i>[Prestige-Proof]</i>' : '';
    text += `${item.emoji} <b>${item.name}</b> (<code>${item.id}</code>)${prestigeTag}\n` +
      `• <b>Price:</b> ${formatCoins(item.buyPrice)} | Owned: <b>${userQuantity}</b>\n` +
      stockLine +
      `• <i>${item.description}</i>\n\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>To buy in bulk, run:</i> <code>/buy &lt;item&gt; [amount]</code>`;

  const keyboard = new InlineKeyboard();

  // Quick-buy buttons for this page
  pageItems.forEach((item, index) => {
    const stockInfo = stockInfoById.get(item.id);
    const isSoldOut = stockInfo && stockInfo.currentStock <= 0;
    const btnLabel = isSoldOut ? `❌ ${item.name} (Sold Out)` : `🛒 Buy 1x ${item.name}`;
    keyboard.text(btnLabel, `shop:buy:${item.id}:${currentPage}:${userId}`);
    if (index % 2 === 1) keyboard.row();
  });

  if (pageItems.length % 2 !== 0) keyboard.row();

  // Pagination controls
  const prevPage = currentPage > 1 ? currentPage - 1 : totalPages;
  const nextPage = currentPage < totalPages ? currentPage + 1 : 1;

  keyboard
    .text('⬅️ Prev', `shop:page:${prevPage}:${userId}`)
    .text(`📑 ${currentPage}/${totalPages}`, `shop:page:${currentPage}:${userId}`)
    .text('➡️ Next', `shop:page:${nextPage}:${userId}`);

  return { text, keyboard };
}

export const shop = {
  name: 'shop',
  aliases: [],
  description: 'Browse weapons, tools, defenses, and limited prestige-proof items in the shop',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const { text, keyboard } = await buildShopPage(userId, 1);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    // Handle Page Flip
    if (action === 'page') {
      const page = Number(parts[2]);
      const { text, keyboard } = await buildShopPage(targetUserId, page);

      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        await ctx.answerCallbackQuery();
      } catch {
        await ctx.answerCallbackQuery({ text: 'Already on this page.' });
      }
      return;
    }

    // Handle Quick Buy: shop:buy:<itemId>:<page>:<userId>
    if (action === 'buy') {
      const itemId = parts[2];
      const page = Number(parts[3]);
      const item = getItem(itemId);

      if (!item || !item.buyPrice) {
        return ctx.answerCallbackQuery({ text: 'Item not available for purchase.', show_alert: true });
      }

      const user = await userRepo.getUser(targetUserId);
      if (!user || Number(user.wallet || 0) < item.buyPrice) {
        return ctx.answerCallbackQuery({
          text: `❌ Insufficient funds! You need ${formatCoins(item.buyPrice)}.`,
          show_alert: true
        });
      }

      // Atomically claim global limited stock if applicable
      if (item.stockLimit) {
        const stockRes = await shopStockRepo.purchaseLimitedStock(item.id, 1);
        if (!stockRes.success) {
          const resetInSec = Math.max(1, Math.ceil((stockRes.nextResetAt - Date.now()) / 1000));
          const { text, keyboard } = await buildShopPage(targetUserId, page);
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
          return ctx.answerCallbackQuery({
            text: `❌ ${item.name} is SOLD OUT globally! Restocks in ${formatTime(resetInSec)}.`,
            show_alert: true
          });
        }
      }

      // Deduct wallet and add item
      await userRepo.updateCoins(targetUserId, {
        walletDelta: -item.buyPrice,
        sourceCommand: '/shop buy',
        details: `Quick-bought 1x ${item.name} (${item.emoji})`
      });
      await inventoryRepo.addItem(targetUserId, item.id, 1);

      // Re-render shop page
      const { text, keyboard } = await buildShopPage(targetUserId, page);
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(() => {});

      await ctx.answerCallbackQuery({
        text: `✅ Purchased 1x ${item.name} for ${formatCoins(item.buyPrice)}!`
      });
    }
  }
};

export default shop;
