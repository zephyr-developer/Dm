import { getItem, findItem } from '../../config/items.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import shopStockRepo from '../../database/shopStockRepo.js';
import { formatCoins, formatTime, sanitizeHtml } from '../../utils/formatters.js';

const CATEGORY_LABELS = {
  tool: '⛏️ Tool',
  defense: '🛡️ Defense',
  consumable: '🧪 Consumable',
  loot: '📦 Loot',
  collectible: '🏆 Collectible'
};

export const items = {
  name: 'items',
  aliases: ['item', 'iteminfo', 'info'],
  description: 'Look up detailed stats, prices, aliases, and stock for any item',
  cooldown: 2,

  async execute(ctx) {
    const query = (ctx.match || '').trim() ||
      ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '';

    if (!query) {
      return ctx.reply(
        `📖 <b>TeleMemer Item Encyclopedia</b>\n` +
        `Usage: <code>/items &lt;item name, ID, or alias&gt;</code>\n\n` +
        `<b>Popular Lookups:</b>\n` +
        `• <b>Tools:</b> <code>shovel</code>, <code>rifle</code>, <code>fishingpole</code>, <code>laptop</code>\n` +
        `• <b>Defense &amp; Utility:</b> <code>lifesaver</code>, <code>padlock</code>, <code>landmine</code>, <code>vaultlock</code>, <code>banknote</code>, <code>horseshoe</code>, <code>apple</code>\n` +
        `• <b>Tickets &amp; Fun:</b> <code>adventureticket</code>, <code>coinbomb</code>, <code>ducttape</code>\n` +
        `• <b>Rare Collectibles:</b> <code>pepecoin</code>, <code>pepetrophy</code>, <code>dragon</code>, <code>kraken</code>\n` +
        `• <b>Limited Exclusives:</b> <code>zyloveletter</code>, <code>mjnecklace</code>, <code>gtkcondom</code>\n\n` +
        `💡 <i>Tip: Shortcuts like <code>/items bn</code>, <code>/items ls</code>, or <code>/items trophy</code> also work!</i>`,
        { parse_mode: 'HTML' }
      );
    }

    const item = findItem(query);
    if (!item) {
      return ctx.reply(
        `❌ No item found matching "<b>${sanitizeHtml(query)}</b>".\nRun <code>/shop</code> or <code>/items</code> to browse valid item IDs.`,
        { parse_mode: 'HTML' }
      );
    }

    const callerId = ctx.from.id;
    const ownedQty = await inventoryRepo.getItem(callerId, item.id);

    const categoryLabel = CATEGORY_LABELS[item.type] || item.type;
    const prestigeBadge = (item.prestigeKeep || item.type === 'collectible')
      ? '🛡️ <b>Kept on Prestige</b>'
      : '⚠️ Reset on Prestige';

    const aliasList = Array.isArray(item.aliases) && item.aliases.length > 0
      ? item.aliases.map(a => `<code>${sanitizeHtml(a)}</code>`).join(', ')
      : '<i>None</i>';

    const buyLine = item.buyPrice !== null && item.buyPrice > 0
      ? formatCoins(item.buyPrice)
      : '<i>Not buyable (Loot / Craft only)</i>';

    const sellLine = item.sellPrice !== null && item.sellPrice > 0
      ? formatCoins(item.sellPrice)
      : '<i>Not sellable</i>';

    let stockBlock = '';
    if (item.stockLimit && item.stockLimit > 0) {
      const stock = await shopStockRepo.getItemStock(item.id);
      const resetInSec = Math.max(1, Math.ceil((stock.nextResetAt - Date.now()) / 1000));
      const periodLabel = stock.stockPeriod === 'weekly' ? 'Weekly' : 'Daily';
      const stockStatus = stock.currentStock > 0
        ? `<b>${stock.currentStock}/${stock.stockLimit}</b> left`
        : `<b>0/${stock.stockLimit}</b> (Sold Out)`;
      stockBlock = `📦 <b>Global Stock:</b> ${stockStatus} — <i>${periodLabel} reset in ${formatTime(resetInSec)}</i>\n`;
    }

    let recipeBlock = '';
    if (item.craftRecipe && Object.keys(item.craftRecipe).length > 0) {
      const parts = Object.entries(item.craftRecipe).map(([ingId, qty]) => {
        const ing = getItem(ingId);
        return ing
          ? `${qty}x ${ing.emoji} ${sanitizeHtml(ing.name)} (<code>${ing.id}</code>)`
          : `${qty}x <code>${sanitizeHtml(ingId)}</code>`;
      });
      recipeBlock = `⚒️ <b>Crafting Recipe:</b> ${parts.join(' + ')}\n`;
    }

    let msg = `${item.emoji} <b>${sanitizeHtml(item.name)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🆔 <b>ID:</b> <code>${item.id}</code>\n`;
    msg += `🏷️ <b>Aliases:</b> ${aliasList}\n`;
    msg += `📂 <b>Category:</b> ${categoryLabel} • ${prestigeBadge}\n`;
    msg += `🛒 <b>Buy Price:</b> ${buyLine}\n`;
    msg += `💵 <b>Sell Price:</b> ${sellLine}\n`;
    if (stockBlock) msg += stockBlock;
    if (recipeBlock) msg += recipeBlock;
    msg += `\n📖 <b>Description:</b>\n${sanitizeHtml(item.description)}\n\n`;
    msg += `🎒 <b>You Own:</b> <b>${ownedQty.toLocaleString('en-US')}x</b>`;

    return ctx.reply(msg, { parse_mode: 'HTML' });
  }
};

export default items;
