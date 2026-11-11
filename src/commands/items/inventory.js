import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { items } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';

const ITEMS_PER_PAGE = 6;

function buildInventoryCard(targetUserId, page = 1) {
  const user = userRepo.getUser(targetUserId);
  const rawInventory = inventoryRepo.getUserInventory(targetUserId);

  if (!rawInventory || rawInventory.length === 0) {
    const emptyText = `🎒 <b>Backpack for ${sanitizeHtml(user?.first_name || 'Player')}</b>\n\n` +
      `<i>Your backpack is completely empty!</i>\n` +
      `Head out to grind with <code>/flow</code>, <code>/beg</code>, <code>/fish</code>, or visit the <code>/shop</code>!`;
    return { text: emptyText, keyboard: null };
  }

  const totalPages = Math.ceil(rawInventory.length / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.max(1, Math.min(totalPages, page));

  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = rawInventory.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  let totalBackpackValue = 0;
  rawInventory.forEach(entry => {
    const itm = items[entry.item_id];
    if (itm) totalBackpackValue += itm.sellPrice * entry.quantity;
  });

  let text = `🎒 <b>Backpack for ${sanitizeHtml(user?.first_name || 'Player')}</b>\n` +
    `📦 <b>Unique Items:</b> ${rawInventory.length} | 💰 <b>Total Resale Value:</b> ${formatCoins(totalBackpackValue)}\n` +
    `📄 <b>Page ${currentPage} / ${totalPages}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  pageItems.forEach(entry => {
    const itm = items[entry.item_id] || { name: entry.item_id, emoji: '📦', type: 'item', sellPrice: 0 };
    const stackValue = itm.sellPrice * entry.quantity;

    text += `${itm.emoji} <b>${itm.name}</b> × <b>${entry.quantity}</b>\n` +
      `• Type: <i>${itm.type}</i> | Sell Value: ${formatCoins(stackValue)}\n` +
      `• ID: <code>${entry.item_id}</code>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>Tip: Use items with</i> <code>/use &lt;item_id&gt;</code> <i>or craft with</i> <code>/craft</code>!`;

  const keyboard = new InlineKeyboard();
  const prevPage = currentPage > 1 ? currentPage - 1 : totalPages;
  const nextPage = currentPage < totalPages ? currentPage + 1 : 1;

  keyboard
    .text('⬅️ Prev', `inventory:page:${prevPage}:${targetUserId}`)
    .text(`📑 ${currentPage}/${totalPages}`, `inventory:page:${currentPage}:${targetUserId}`)
    .text('➡️ Next', `inventory:page:${nextPage}:${targetUserId}`);

  return { text, keyboard };
}

export const inventory = {
  name: 'inventory',
  aliases: ['inv'],
  description: 'Inspect your backpack, owned tools, loot, and collectibles',
  cooldown: 3,

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

    userRepo.getOrInitUser(targetUserId, targetUsername, targetFirstName);

    const { text, keyboard } = buildInventoryCard(targetUserId, 1);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard || undefined
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const page = Number(parts[2]);
    const targetUserId = Number(parts[3]);

    const { text, keyboard } = buildInventoryCard(targetUserId, page);

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard || undefined
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Already on this page.' });
    }
  }
};

export default inventory;
