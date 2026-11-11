import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem, items } from '../../config/items.js';
import { formatCoins } from '../../utils/formatters.js';

export const sell = {
  name: 'sell',
  aliases: [],
  description: 'Sell collected items or liquidate all loot for coins',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const firstArg = args[0]?.toLowerCase();

    if (!firstArg) {
      return ctx.reply(
        `💰 <b>Pawn Shop & Sell</b>\n` +
        `Usage:\n` +
        `• <code>/sell all</code> - Sell ALL loot items in your backpack\n` +
        `• <code>/sell &lt;item&gt; [quantity]</code> - Sell specific items\n` +
        `Example: <code>/sell worm 5</code> or <code>/sell boar all</code>`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // CASE 1: /sell all (liquidate all 'loot' items)
    // ==========================================
    if (firstArg === 'all') {
      const inventory = inventoryRepo.getUserInventory(userId);
      const lootItems = inventory.filter(entry => {
        const itm = items[entry.item_id];
        return itm && itm.type === 'loot' && entry.quantity > 0;
      });

      if (lootItems.length === 0) {
        return ctx.reply('🎒 You do not have any sellable loot items in your backpack right now!');
      }

      let totalEarned = 0;
      let summaryLines = [];

      for (const entry of lootItems) {
        const itm = items[entry.item_id];
        const earned = itm.sellPrice * entry.quantity;
        totalEarned += earned;
        inventoryRepo.removeItem(userId, entry.item_id, entry.quantity);
        summaryLines.push(`• ${entry.quantity}x ${itm.emoji} ${itm.name} → ${formatCoins(earned)}`);
      }

      userRepo.updateWallet(userId, totalEarned);

      return ctx.reply(
        `💰 <b>Liquidated All Loot!</b>\n` +
        `Sold all your hunted game, fish, worms, and raw scrap:\n\n` +
        summaryLines.join('\n') +
        `\n\n🪙 <b>Total Payout:</b> <b>${formatCoins(totalEarned)}</b>\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(user.wallet + totalEarned)}`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // CASE 2: /sell <item> [quantity]
    // ==========================================
    let quantity = 1;
    let itemQuery = args.join(' ');

    const lastArg = args[args.length - 1];
    let sellAllOfThisItem = false;

    if (lastArg?.toLowerCase() === 'all' || lastArg?.toLowerCase() === 'max') {
      sellAllOfThisItem = true;
      itemQuery = args.slice(0, -1).join(' ');
    } else if (/^\d+$/.test(lastArg) && args.length > 1) {
      quantity = parseInt(lastArg, 10);
      itemQuery = args.slice(0, -1).join(' ');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Could not identify an item called "<b>${itemQuery}</b>".`, { parse_mode: 'HTML' });
    }

    const ownedQuantity = inventoryRepo.getItem(userId, item.id);
    if (ownedQuantity <= 0) {
      return ctx.reply(`🎒 You don't own any ${item.emoji} <b>${item.name}</b> to sell!`, { parse_mode: 'HTML' });
    }

    if (sellAllOfThisItem) {
      quantity = ownedQuantity;
    }

    if (quantity <= 0) {
      return ctx.reply('❌ Please specify a positive quantity to sell.');
    }

    if (quantity > ownedQuantity) {
      return ctx.reply(
        `❌ You only have <b>${ownedQuantity}x</b> ${item.emoji} <b>${item.name}</b> in your inventory.`,
        { parse_mode: 'HTML' }
      );
    }

    const totalPayout = item.sellPrice * quantity;
    inventoryRepo.removeItem(userId, item.id, quantity);
    userRepo.updateWallet(userId, totalPayout);

    return ctx.reply(
      `🤝 <b>Deal Complete!</b>\n` +
      `Sold <b>${quantity}x ${item.emoji} ${item.name}</b> to the merchant for <b>${formatCoins(totalPayout)}</b>.\n\n` +
      `🎒 <b>Remaining:</b> ${ownedQuantity - quantity}x ${item.name}\n` +
      `👛 <b>New Wallet:</b> ${formatCoins(user.wallet + totalPayout)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default sell;
