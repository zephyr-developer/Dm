import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import shopStockRepo from '../../database/shopStockRepo.js';
import { findItem, getItem, items } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';

const MAX_SAFE_QTY = 100_000_000_000;
const MAX_SAFE_PAYOUT_BIG = 9_000_000_000_000_000n;

export const sell = {
  name: 'sell',
  aliases: [],
  description: 'Sell collected items or liquidate all loot for coins with confirmation',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawInput = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1).join(' ').trim();
    const args = rawInput ? rawInput.split(/\s+/) : [];
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
    if (firstArg === 'all' && args.length === 1) {
      const inventory = await inventoryRepo.getUserInventory(userId);
      const lootItems = inventory.filter(entry => {
        const itm = items[entry.item_id];
        return itm && itm.type === 'loot' && entry.quantity > 0;
      });

      if (lootItems.length === 0) {
        return ctx.reply('🎒 You do not have any sellable loot items in your backpack right now!');
      }

      let totalEstimatedBig = 0n;
      const previewLines = [];
      for (const entry of lootItems) {
        const itm = items[entry.item_id];
        const earnedBig = BigInt(itm.sellPrice) * BigInt(entry.quantity);
        totalEstimatedBig += earnedBig;
        const cappedLineEarn = earnedBig > MAX_SAFE_PAYOUT_BIG ? Number(MAX_SAFE_PAYOUT_BIG) : Number(earnedBig);
        previewLines.push(`• ${entry.quantity.toLocaleString('en-US')}x ${itm.emoji} ${itm.name} → ${formatCoins(cappedLineEarn)}`);
      }

      const totalEstimated = totalEstimatedBig > MAX_SAFE_PAYOUT_BIG
        ? Number(MAX_SAFE_PAYOUT_BIG)
        : Number(totalEstimatedBig);

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `sell:no:${userId}`)
        .text('✅ Confirm', `sell:yes:all:0:${userId}`);

      return ctx.reply(
        `💰 <b>Confirm Bulk Loot Liquidation</b>\n\n` +
        `You are about to sell all loot items in your backpack:\n` +
        previewLines.join('\n') +
        `\n\n🪙 <b>Total Payout:</b> <b>${formatCoins(totalEstimated)}</b>\n\n` +
        `<i>Proceed with selling all loot?</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );
    }

    // ==========================================
    // CASE 2: /sell <item> [quantity]
    // ==========================================
    let quantity = 1;
    let itemQuery = args.join(' ');
    const lastArg = args[args.length - 1];
    let sellAllOfThisItem = false;
    let explicitQtyStr = null;

    if (lastArg?.toLowerCase() === 'all' || lastArg?.toLowerCase() === 'max') {
      sellAllOfThisItem = true;
      itemQuery = args.slice(0, -1).join(' ');
    } else if (/^\d+$/.test(lastArg) && args.length > 1) {
      explicitQtyStr = lastArg;
      itemQuery = args.slice(0, -1).join(' ');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Could not identify an item called "<b>${sanitizeHtml(itemQuery)}</b>".`, { parse_mode: 'HTML' });
    }

    const ownedQuantity = await inventoryRepo.getItem(userId, item.id);
    if (ownedQuantity <= 0) {
      return ctx.reply(`🎒 You don't own any ${item.emoji} <b>${item.name}</b> to sell!`, { parse_mode: 'HTML' });
    }

    if (sellAllOfThisItem) {
      quantity = Math.min(ownedQuantity, MAX_SAFE_QTY);
    } else if (explicitQtyStr) {
      let bigQty;
      try {
        bigQty = BigInt(explicitQtyStr);
      } catch {
        return ctx.reply('❌ Please specify a valid positive quantity to sell.');
      }
      if (bigQty <= 0n) {
        return ctx.reply('❌ Please specify a positive quantity to sell.');
      }
      if (bigQty > BigInt(ownedQuantity)) {
        return ctx.reply(
          `❌ You only have <b>${ownedQuantity.toLocaleString('en-US')}x</b> ${item.emoji} <b>${item.name}</b> in your inventory.`,
          { parse_mode: 'HTML' }
        );
      }
      if (bigQty > BigInt(MAX_SAFE_QTY)) {
        return ctx.reply(
          `❌ Maximum quantity per sale is <b>${MAX_SAFE_QTY.toLocaleString('en-US')}x</b> items.`,
          { parse_mode: 'HTML' }
        );
      }
      quantity = Number(bigQty);
    }

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return ctx.reply('❌ Please specify a positive quantity to sell.');
    }

    if (quantity > ownedQuantity) {
      return ctx.reply(
        `❌ You only have <b>${ownedQuantity.toLocaleString('en-US')}x</b> ${item.emoji} <b>${item.name}</b> in your inventory.`,
        { parse_mode: 'HTML' }
      );
    }

    if (!item.sellPrice || item.sellPrice <= 0) {
      return ctx.reply(`🚫 ${item.emoji} <b>${item.name}</b> cannot be sold at the pawn shop!`, { parse_mode: 'HTML' });
    }

    const totalPayoutBigInt = BigInt(item.sellPrice) * BigInt(quantity);
    if (totalPayoutBigInt > MAX_SAFE_PAYOUT_BIG) {
      return ctx.reply(
        `❌ Total payout exceeds the safe wallet limit of <b>🪙 9 Quadrillion</b>! Please sell a smaller quantity.`,
        { parse_mode: 'HTML' }
      );
    }

    const totalPayout = Number(totalPayoutBigInt);
    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `sell:no:${userId}`)
      .text('✅ Confirm', `sell:yes:${item.id}:${quantity}:${userId}`);

    return ctx.reply(
      `💰 <b>Confirm Pawn Shop Sale</b>\n\n` +
      `• <b>Selling:</b> ${quantity.toLocaleString('en-US')}x ${item.emoji} <b>${item.name}</b>\n` +
      `• <b>Payout:</b> ${formatCoins(totalPayout)}\n` +
      `• <b>Owned:</b> ${ownedQuantity.toLocaleString('en-US')}x\n\n` +
      `<i>Confirm this sale?</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const decision = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your transaction!",
        show_alert: true
      });
    }

    if (decision === 'no') {
      await ctx.answerCallbackQuery({ text: 'Sale cancelled.' });
      return ctx.editMessageText('❌ Transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (decision === 'yes') {
      const targetItemKey = parts[2];
      const quantity = Number(parts[3]);

      // CASE 1: Liquidate all loot
      if (targetItemKey === 'all') {
        const inventory = await inventoryRepo.getUserInventory(targetUserId);
        const lootItems = inventory.filter(entry => {
          const itm = items[entry.item_id];
          return itm && itm.type === 'loot' && entry.quantity > 0;
        });

        if (lootItems.length === 0) {
          await ctx.answerCallbackQuery({ text: 'No loot items left to sell!', show_alert: true });
          return ctx.editMessageText('🎒 You no longer have any sellable loot items in your backpack.').catch(() => {});
        }

        let totalEarnedBig = 0n;
        const summaryLines = [];

        for (const entry of lootItems) {
          const itm = items[entry.item_id];
          const consumed = await inventoryRepo.consumeItemAtomic(targetUserId, entry.item_id, entry.quantity);
          if (!consumed.success) continue;

          const earnedBig = BigInt(itm.sellPrice) * BigInt(entry.quantity);
          totalEarnedBig += earnedBig;
          if (itm.stockLimit) {
            await shopStockRepo.returnStock(itm.id, entry.quantity);
          }
          const earnedDisp = earnedBig > MAX_SAFE_PAYOUT_BIG ? Number(MAX_SAFE_PAYOUT_BIG) : Number(earnedBig);
          summaryLines.push(`• ${entry.quantity.toLocaleString('en-US')}x ${itm.emoji} ${itm.name} → ${formatCoins(earnedDisp)}`);
        }

        if (summaryLines.length === 0) {
          await ctx.answerCallbackQuery({ text: 'No loot items left to sell!', show_alert: true });
          return ctx.editMessageText('🎒 You no longer have any sellable loot items in your backpack.').catch(() => {});
        }

        const totalEarned = totalEarnedBig > MAX_SAFE_PAYOUT_BIG
          ? Number(MAX_SAFE_PAYOUT_BIG)
          : Number(totalEarnedBig);

        const updated = await userRepo.updateCoins(targetUserId, {
          walletDelta: totalEarned,
          sourceCommand: '/sell all',
          details: `Liquidated ${summaryLines.length} loot stacks`
        });

        await ctx.answerCallbackQuery({ text: `Sold all loot for ${formatCoins(totalEarned)}!` });
        return ctx.editMessageText(
          `💰 <b>Liquidated All Loot!</b>\n` +
          `Sold all your hunted game, fish, worms, and raw scrap (Returned to Market):\n\n` +
          summaryLines.join('\n') +
          `\n\n🪙 <b>Total Payout:</b> <b>${formatCoins(totalEarned)}</b>\n` +
          `👛 <b>New Wallet:</b> ${formatCoins(updated.wallet)}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // CASE 2: Sell specific item
      const item = getItem(targetItemKey);
      if (
        !item ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > MAX_SAFE_QTY
      ) {
        await ctx.answerCallbackQuery({ text: 'Invalid sale parameters.', show_alert: true });
        return ctx.editMessageText('❌ Transaction failed: Invalid item or quantity.').catch(() => {});
      }

      const totalPayoutBigInt = BigInt(item.sellPrice) * BigInt(quantity);
      if (totalPayoutBigInt > MAX_SAFE_PAYOUT_BIG) {
        await ctx.answerCallbackQuery({ text: 'Payout exceeds safe wallet limit!', show_alert: true });
        return ctx.editMessageText('❌ Transaction failed: Total payout exceeds safe limit.').catch(() => {});
      }
      const totalPayout = Number(totalPayoutBigInt);

      // Atomically deduct from seller's inventory first so concurrent double-clicks cannot double-credit
      const consumed = await inventoryRepo.consumeItemAtomic(targetUserId, item.id, quantity);
      if (!consumed.success) {
        const ownedQuantity = await inventoryRepo.getItem(targetUserId, item.id);
        await ctx.answerCallbackQuery({ text: `You only own ${ownedQuantity}x ${item.name}!`, show_alert: true });
        return ctx.editMessageText(
          `❌ <b>Sale Failed:</b> You only have <b>${ownedQuantity.toLocaleString('en-US')}x</b> ${item.emoji} <b>${item.name}</b> left.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      const updated = await userRepo.updateCoins(targetUserId, {
        walletDelta: totalPayout,
        sourceCommand: '/sell',
        details: `Sold ${quantity}x ${item.name} (${item.emoji})`
      });

      // Return limited shop stock back to the Global /shop market
      let saleText = '';
      if (item.stockLimit) {
        await shopStockRepo.returnStock(item.id, quantity);
        saleText =
          `💵 You sold <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}</b> for <b>🪙 ${totalPayout.toLocaleString('en-US')}</b>!\n` +
          `📦 <b>Market Restocked:</b> ${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name} has been returned to the Global <code>/shop</code> shelf!\n\n`;
      } else {
        saleText =
          `💵 You sold <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}</b> for <b>🪙 ${totalPayout.toLocaleString('en-US')}</b> (Returned to Market).\n\n`;
      }

      await ctx.answerCallbackQuery({ text: `Sold ${quantity.toLocaleString('en-US')}x ${item.name}!` });
      return ctx.editMessageText(
        `${saleText}` +
        `🎒 <b>Remaining:</b> ${consumed.remaining.toLocaleString('en-US')}x ${item.name}\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(updated.wallet)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default sell;
