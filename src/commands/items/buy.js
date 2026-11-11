import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem } from '../../config/items.js';
import { formatCoins } from '../../utils/formatters.js';

export const buy = {
  name: 'buy',
  aliases: [],
  description: 'Purchase an item from the shop by name or ID',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    if (args.length === 0) {
      return ctx.reply(
        `🛒 <b>Shop Purchase</b>\n` +
        `Usage: <code>/buy &lt;item_name&gt; [quantity]</code>\n` +
        `Example: <code>/buy shovel</code> or <code>/buy padlock 3</code>\n\n` +
        `View available items with <code>/shop</code>!`,
        { parse_mode: 'HTML' }
      );
    }

    // Check if the last argument is a quantity number
    let quantity = 1;
    let itemQuery = args.join(' ');

    const lastArg = args[args.length - 1];
    if (/^\d+$/.test(lastArg) && args.length > 1) {
      quantity = parseInt(lastArg, 10);
      itemQuery = args.slice(0, -1).join(' ');
    }

    if (quantity <= 0) {
      return ctx.reply('❌ Quantity must be at least 1.');
    }
    if (quantity > 100) {
      return ctx.reply('❌ Maximum purchase limit is 100 items per order.');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(
        `❌ Could not find an item matching "<b>${itemQuery}</b>".\n` +
        `Run <code>/shop</code> to see valid items.`,
        { parse_mode: 'HTML' }
      );
    }

    if (item.buyPrice === null) {
      return ctx.reply(
        `🚫 ${item.emoji} <b>${item.name}</b> is not sold in the regular store!\n` +
        `You can find it by grinding, crafting (<code>/craft</code>), or hunting/fishing.`,
        { parse_mode: 'HTML' }
      );
    }

    const totalCost = item.buyPrice * quantity;
    if (user.wallet < totalCost) {
      return ctx.reply(
        `💸 <b>Insufficient Funds!</b>\n` +
        `To buy <b>${quantity}x ${item.emoji} ${item.name}</b>, you need <b>${formatCoins(totalCost)}</b>.\n` +
        `👛 Your wallet balance: <b>${formatCoins(user.wallet)}</b>`,
        { parse_mode: 'HTML' }
      );
    }

    // Deduct coins & add items
    userRepo.updateWallet(userId, -totalCost);
    inventoryRepo.addItem(userId, item.id, quantity);
    const newQuantity = inventoryRepo.getItem(userId, item.id);

    return ctx.reply(
      `✅ <b>Purchase Complete!</b>\n` +
      `Bought <b>${quantity}x ${item.emoji} ${item.name}</b> for <b>${formatCoins(totalCost)}</b>.\n\n` +
      `🎒 <b>Now in Backpack:</b> ${newQuantity}x ${item.name}\n` +
      `👛 <b>Remaining Wallet:</b> ${formatCoins(user.wallet - totalCost)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default buy;
