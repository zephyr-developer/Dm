import shopStockRepo from '../../database/shopStockRepo.js';
import { findItem, getItem } from '../../config/items.js';
import { formatTime, sanitizeHtml } from '../../utils/formatters.js';

const LIMITED_ITEM_IDS = ['zyloveletter', 'mjnecklace', 'gtkcondom', 'owntitle'];

async function buildStockSummary(headline) {
  let msg = `${headline}\n\n<b>📦 Current Limited Shop Stock:</b>\n`;

  for (const id of LIMITED_ITEM_IDS) {
    const item = getItem(id);
    if (!item) continue;
    const stock = await shopStockRepo.getItemStock(id);
    const resetInSec = Math.max(1, Math.ceil((stock.nextResetAt - Date.now()) / 1000));
    const statusIcon = stock.currentStock > 0 ? '✅' : '❌';
    msg += `${statusIcon} ${item.emoji} <b>${item.name}</b> (<code>${item.id}</code>): <b>${stock.currentStock}/${stock.stockLimit}</b> <i>(Resets in ${formatTime(resetInSec)})</i>\n`;
  }

  return msg;
}

export const restock = {
  name: 'restock',
  aliases: [],
  category: 'owner',
  description: 'Owner DM-only: Restock limited global shop items',
  cooldown: 0,

  async execute(ctx) {
    const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
    if (callerUsername !== 'tzhunyuan') {
      return ctx.reply('❌ Unknown command.');
    }

    if (ctx.chat?.type !== 'private') {
      return ctx.reply('🔒 Please use /restock inside our Private DM!');
    }

    const rawInput = (ctx.match || '').trim() || ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '';
    const args = rawInput ? rawInput.split(/\s+/).filter(Boolean) : [];

    // /restock or /restock all -> refill all limited items back to full stock
    if (args.length === 0 || (args.length === 1 && args[0].toLowerCase() === 'all')) {
      await shopStockRepo.restockAllLimited();
      const summary = await buildStockSummary('🔄 <b>GLOBAL SHOP RESTOCKED!</b> All limited items refilled to full stock.');
      return ctx.reply(summary, { parse_mode: 'HTML' });
    }

    // /restock <item_id> [custom_amount]
    let customAmount = null;
    let itemQuery = args.join(' ');
    const lastArg = args[args.length - 1];

    if (args.length > 1 && /^-?\d+$/.test(lastArg)) {
      const parsed = parseInt(lastArg, 10);
      if (isNaN(parsed) || parsed < 0 || parsed > 1_000_000) {
        return ctx.reply('⚠️ Invalid stock amount. Provide a non-negative integer (e.g., <code>/restock gtkcondom 5</code>).', { parse_mode: 'HTML' });
      }
      customAmount = parsed;
      itemQuery = args.slice(0, -1).join(' ');
    }

    const item = findItem(itemQuery);
    if (!item || !item.stockLimit) {
      return ctx.reply(
        `❌ "<b>${sanitizeHtml(itemQuery)}</b>" is not a limited-stock shop item.\n\n` +
        `Valid limited items:\n` +
        `• <code>zyloveletter</code> (💌 ZYuan's Love Letter)\n` +
        `• <code>mjnecklace</code> (📿 MJune's Necklace)\n` +
        `• <code>gtkcondom</code> (🎈 GTK Brand Condom)\n` +
        `• <code>owntitle</code> (🏷️ Own Title)\n\n` +
        `Or run <code>/restock all</code> to refill everything.`,
        { parse_mode: 'HTML' }
      );
    }

    const updated = await shopStockRepo.restockItem(item.id, customAmount);
    const summary = await buildStockSummary(
      `🔄 <b>RESTOCK COMPLETE:</b> Set ${item.emoji} <b>${item.name}</b> stock to <b>${updated.currentStock}</b>!`
    );
    return ctx.reply(summary, { parse_mode: 'HTML' });
  }
};

export default restock;
