import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { items } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

const ITEMS_PER_PAGE = 6;

async function buildInventoryCard(targetUser, page = 1, viewerId = targetUser.user_id) {
  const targetUserId = targetUser.user_id;
  const rawInventory = await inventoryRepo.getUserInventory(targetUserId);

  const targetHandle = targetUser.username
    ? `@${sanitizeHtml(targetUser.username)}`
    : sanitizeHtml(targetUser.first_name || 'Player');

  if (!rawInventory || rawInventory.length === 0) {
    const emptyText = `🎒 <b>${targetHandle}'s Inventory</b>\n\n` +
      `<i>This backpack is completely empty!</i>\n` +
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

  let text = `🎒 <b>${targetHandle}'s Inventory</b>\n` +
    `👤 <b>Holder:</b> ${sanitizeHtml(targetUser.first_name || 'Player')}\n` +
    `📦 <b>Unique Items:</b> ${rawInventory.length} | 💰 <b>Total Resale Value:</b> ${formatCoins(totalBackpackValue)}\n` +
    `📄 <b>Page ${currentPage} / ${totalPages}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  pageItems.forEach(entry => {
    const itm = items[entry.item_id] || { name: entry.item_id, emoji: '📦', type: 'item', sellPrice: 0 };
    const stackValue = itm.sellPrice * entry.quantity;

    text += `${itm.emoji} <b>${itm.name}</b> × <b>${entry.quantity.toLocaleString('en-US')}</b>\n` +
      `• Type: <i>${itm.type}</i> | Sell Value: ${formatCoins(stackValue)}\n` +
      `• ID: <code>${entry.item_id}</code>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>Tip: Use items with</i> <code>/use &lt;item_id&gt;</code> <i>or craft with</i> <code>/craft</code>!`;

  const keyboard = new InlineKeyboard();
  const prevPage = currentPage > 1 ? currentPage - 1 : totalPages;
  const nextPage = currentPage < totalPages ? currentPage + 1 : 1;

  keyboard
    .text('⬅️ Prev', `inventory:prev:${targetUserId}:${prevPage}:${viewerId}`)
    .text(`📑 ${currentPage}/${totalPages}`, `inventory:page:${targetUserId}:${currentPage}:${viewerId}`)
    .text('➡️ Next', `inventory:next:${targetUserId}:${nextPage}:${viewerId}`);

  return { text, keyboard };
}

export const inventory = {
  name: 'inventory',
  aliases: ['inv'],
  description: 'Inspect your or another player\'s backpack, tools, loot, and collectibles',
  cooldown: 3,

  async execute(ctx) {
    const callerId = ctx.from.id;
    await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    const { user: targetUser, notFound, errorMessage } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: true,
      allowBareUsername: true,
      allowNumericId: true
    });

    if (notFound || !targetUser) {
      return ctx.reply(errorMessage || '❌ Could not find that TeleMemer account.', { parse_mode: 'HTML' });
    }

    const { text, keyboard } = await buildInventoryCard(targetUser, 1, callerId);

    return ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard || undefined
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const targetUserId = Number(parts[2]);
    const page = Number(parts[3]) || 1;
    const viewerId = Number(parts[4]) || ctx.from.id;

    const targetUser = await userRepo.getUser(targetUserId);
    if (!targetUser) {
      return ctx.answerCallbackQuery({ text: 'User account not found.', show_alert: true });
    }

    const { text, keyboard } = await buildInventoryCard(targetUser, page, viewerId);

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard || undefined
      });
      await ctx.answerCallbackQuery();
    } catch {
      await ctx.answerCallbackQuery({ text: 'Already on this page.' });
    }
  }
};

export default inventory;
