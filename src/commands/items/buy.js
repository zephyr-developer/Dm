import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';

export const buy = {
  name: 'buy',
  aliases: [],
  description: 'Purchase items from the shop without limits or using all/max',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawInput = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1).join(' ').trim();
    if (!rawInput) {
      return ctx.reply(
        `🛒 <b>Shop Purchase</b>\n` +
        `Usage: <code>/buy &lt;item&gt; [quantity|all|max]</code>\n` +
        `Examples: <code>/buy shovel</code>, <code>/buy banknote 500</code>, <code>/buy padlock max</code>\n\n` +
        `View available items in the catalog with <code>/shop</code>!`,
        { parse_mode: 'HTML' }
      );
    }

    const words = rawInput.split(/\s+/);
    let quantityStr = null;
    let itemQuery = '';

    const lastWord = words[words.length - 1].toLowerCase();
    const firstWord = words[0].toLowerCase();

    // Check if the last word is a quantity ('all', 'max', or a number)
    if (words.length > 1 && (/^\d+$/.test(lastWord) || lastWord === 'all' || lastWord === 'max')) {
      quantityStr = lastWord;
      itemQuery = words.slice(0, -1).join(' ');
    // Or if the first word is a quantity (e.g. /buy 100 banknote)
    } else if (words.length > 1 && (/^\d+$/.test(firstWord) || firstWord === 'all' || firstWord === 'max')) {
      quantityStr = firstWord;
      itemQuery = words.slice(1).join(' ');
    } else {
      itemQuery = words.join(' ');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(
        `❌ Could not find an item matching "<b>${sanitizeHtml(itemQuery)}</b>".\n` +
        `Run <code>/shop</code> to see valid items.`,
        { parse_mode: 'HTML' }
      );
    }

    if (item.buyPrice === null || item.buyPrice <= 0) {
      return ctx.reply(
        `🚫 ${item.emoji} <b>${item.name}</b> is not sold in the regular store!\n` +
        `You can find it by grinding, crafting (<code>/craft</code>), or hunting/fishing.`,
        { parse_mode: 'HTML' }
      );
    }

    const currentWallet = Number(user.wallet || 0);
    let quantity = 1;

    // Handle "all" or "max": calculate maximum affordable quantity
    if (quantityStr === 'all' || quantityStr === 'max') {
      quantity = Math.floor(currentWallet / item.buyPrice);
      if (quantity <= 0) {
        return ctx.reply(
          `💸 <b>Insufficient Funds!</b>\n` +
          `You cannot afford even 1x ${item.emoji} <b>${item.name}</b>.\n` +
          `Price: <b>${formatCoins(item.buyPrice)}</b> | Your Wallet: <b>${formatCoins(currentWallet)}</b>`,
          { parse_mode: 'HTML' }
        );
      }
    } else if (quantityStr) {
      const parsed = parseInt(quantityStr, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Quantity must be at least 1.');
      }
      quantity = parsed;
    }

    const totalCost = item.buyPrice * quantity;
    if (currentWallet < totalCost) {
      return ctx.reply(
        `💸 <b>Insufficient Funds!</b>\n` +
        `To buy <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}</b>, you need <b>${formatCoins(totalCost)}</b>.\n` +
        `👛 Your wallet balance: <b>${formatCoins(currentWallet)}</b>`,
        { parse_mode: 'HTML' }
      );
    }

    // Deduct coins & add items to inventory without any artificial caps
    const updated = await userRepo.updateCoins(userId, {
      walletDelta: -totalCost,
      sourceCommand: '/buy',
      details: `Bought ${quantity}x ${item.name}`
    });
    await inventoryRepo.addItem(userId, item.id, quantity);
    const newQuantity = await inventoryRepo.getItem(userId, item.id);

    return ctx.reply(
      `🛒 You bought <b>${quantity.toLocaleString('en-US')}x ${item.name}</b> for <b>🪙 ${totalCost.toLocaleString('en-US')}</b>!\n\n` +
      `🎒 <b>Now in Backpack:</b> ${newQuantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}\n` +
      `👛 <b>Remaining Wallet:</b> ${formatCoins(updated.wallet)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default buy;
