import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import shopStockRepo from '../../database/shopStockRepo.js';
import { findItem, getItem } from '../../config/items.js';
import { formatCoins, formatTime, sanitizeHtml } from '../../utils/formatters.js';

const MAX_SAFE_QTY = 100_000_000_000; // 100 Billion max stack/transaction quantity
const MAX_SAFE_INT_BIG = BigInt(Number.MAX_SAFE_INTEGER); // 9,007,199,254,740,991

export const buy = {
  name: 'buy',
  aliases: [],
  description: 'Purchase items from the shop with confirmation',
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

    if (words.length > 1 && (/^\d+$/.test(lastWord) || lastWord === 'all' || lastWord === 'max')) {
      quantityStr = lastWord;
      itemQuery = words.slice(0, -1).join(' ');
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

    // Check global limited stock if applicable
    let stockInfo = null;
    if (item.stockLimit) {
      stockInfo = await shopStockRepo.getItemStock(item.id);
      if (stockInfo.currentStock <= 0) {
        const resetInSec = Math.max(1, Math.ceil((stockInfo.nextResetAt - Date.now()) / 1000));
        return ctx.reply(
          `❌ <b>SOLD OUT!</b>\n` +
          `${item.emoji} <b>${item.name}</b> has <b>0/${stockInfo.stockLimit}</b> global stock left!\n` +
          `⏳ Restocks in: <b>${formatTime(resetInSec)}</b>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    const currentWallet = Math.max(0, Math.floor(Number(user.wallet || 0)));
    const ownedQty = await inventoryRepo.getItem(userId, item.id);
    let quantity = 1;

    if (quantityStr === 'all' || quantityStr === 'max') {
      quantity = Math.floor(currentWallet / item.buyPrice);
      if (stockInfo && quantity > stockInfo.currentStock) {
        quantity = stockInfo.currentStock;
      }
      if (item.maxOwn === 1 && quantity > 1) {
        quantity = 1;
      }
      const maxRemainingRoom = Math.max(0, MAX_SAFE_QTY - ownedQty);
      if (quantity > maxRemainingRoom) {
        quantity = maxRemainingRoom;
      }
      if (quantity <= 0) {
        return ctx.reply(
          `💸 <b>Insufficient Funds!</b>\n` +
          `You cannot afford even 1x ${item.emoji} <b>${item.name}</b>.\n` +
          `Price: <b>${formatCoins(item.buyPrice)}</b> | Your Wallet: <b>${formatCoins(currentWallet)}</b>`,
          { parse_mode: 'HTML' }
        );
      }
    } else if (quantityStr) {
      let bigQty;
      try {
        bigQty = BigInt(quantityStr);
      } catch {
        return ctx.reply('❌ Quantity must be a valid positive number.');
      }

      if (bigQty <= 0n) {
        return ctx.reply('❌ Quantity must be at least 1.');
      }

      // Overflow-proof BigInt cost check (fast, zero lag even on quadrillion inputs)
      const totalCostBig = BigInt(item.buyPrice) * bigQty;
      if (totalCostBig > BigInt(currentWallet) || totalCostBig > MAX_SAFE_INT_BIG) {
        const qtyDisplay = bigQty <= MAX_SAFE_INT_BIG ? Number(bigQty).toLocaleString('en-US') : bigQty.toString();
        return ctx.reply(
          `❌ You cannot afford <b>${qtyDisplay}x ${item.emoji} ${item.name}</b> (or the total cost exceeds the safe wallet limit of 🪙 9 Quadrillion)!`,
          { parse_mode: 'HTML' }
        );
      }

      const parsedNum = Number(bigQty);
      if (!Number.isFinite(parsedNum) || parsedNum <= 0) {
        return ctx.reply('❌ Quantity must be a valid positive number.');
      }
      quantity = parsedNum;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return ctx.reply('❌ Quantity must be at least 1.');
    }

    // Overflow & stack cap guard (100 Billion max per stack)
    const totalCostBigInt = BigInt(item.buyPrice) * BigInt(quantity);
    if (totalCostBigInt > BigInt(currentWallet) || totalCostBigInt > MAX_SAFE_INT_BIG) {
      return ctx.reply(
        `❌ You cannot afford <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}</b> (or the total cost exceeds the safe wallet limit of 🪙 9 Quadrillion)!`,
        { parse_mode: 'HTML' }
      );
    }

    if (item.maxOwn === 1) {
      if (ownedQty >= 1 || ownedQty + quantity > 1) {
        return ctx.reply(
          `❌ <b>OWNERSHIP LIMIT REACHED!</b> You already own <b>${ownedQty}x ${item.emoji} ${item.name}</b>. Each player can only hold <b>1</b> of this item at a time!`,
          { parse_mode: 'HTML' }
        );
      }
      if (quantity > 1) {
        return ctx.reply(
          `❌ You can only buy <b>1x ${item.emoji} ${item.name}</b> at a time!`,
          { parse_mode: 'HTML' }
        );
      }
    }

    if (quantity > MAX_SAFE_QTY || ownedQty + quantity > MAX_SAFE_QTY) {
      return ctx.reply(
        `❌ <b>Stack Limit Exceeded!</b> Maximum single-item stack allowed is <b>${MAX_SAFE_QTY.toLocaleString('en-US')}</b> items (100 Billion).`,
        { parse_mode: 'HTML' }
      );
    }

    if (stockInfo && quantity > stockInfo.currentStock) {
      return ctx.reply(
        `❌ Only <b>${stockInfo.currentStock}/${stockInfo.stockLimit}</b>x ${item.emoji} <b>${item.name}</b> left in global stock right now!`,
        { parse_mode: 'HTML' }
      );
    }

    const totalCost = Number(totalCostBigInt);

    // Send confirmation prompt (NO deduction yet) — Cancel LEFT, Confirm RIGHT
    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `buy:no:${userId}`)
      .text('✅ Confirm', `buy:yes:${item.id}:${quantity}:${userId}`);

    const stockNotice = stockInfo
      ? `\n• <b>Global Stock:</b> ${stockInfo.currentStock}/${stockInfo.stockLimit} remaining`
      : '';

    return ctx.reply(
      `🛒 <b>Confirm Shop Purchase</b>\n\n` +
      `• <b>Item:</b> ${quantity.toLocaleString('en-US')}x ${item.emoji} <b>${item.name}</b>\n` +
      `• <b>Total Cost:</b> ${formatCoins(totalCost)}\n` +
      `• <b>Your Wallet:</b> ${formatCoins(currentWallet)}${stockNotice}\n\n` +
      `<i>Do you want to complete this purchase?</i>`,
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
      await ctx.answerCallbackQuery({ text: 'Purchase cancelled.' });
      return ctx.editMessageText('❌ Transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (decision === 'yes') {
      const itemId = parts[2];
      const quantity = Number(parts[3]);
      const item = getItem(itemId);

      if (
        !item ||
        !item.buyPrice ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > MAX_SAFE_QTY
      ) {
        await ctx.answerCallbackQuery({ text: 'Invalid purchase details.', show_alert: true });
        return ctx.editMessageText('❌ Transaction failed: Invalid item or quantity.').catch(() => {});
      }

      const ownedQty = await inventoryRepo.getItem(targetUserId, item.id);
      if (item.maxOwn === 1) {
        if (ownedQty >= 1 || ownedQty + quantity > 1) {
          await ctx.answerCallbackQuery({ text: 'Ownership limit reached!', show_alert: true });
          return ctx.editMessageText(
            `❌ <b>OWNERSHIP LIMIT REACHED!</b> You already own <b>${ownedQty}x ${item.emoji} ${item.name}</b>. Each player can only hold <b>1</b> of this item at a time!`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }

      if (ownedQty + quantity > MAX_SAFE_QTY) {
        await ctx.answerCallbackQuery({ text: 'Stack limit exceeded!', show_alert: true });
        return ctx.editMessageText(
          `❌ <b>Stack Limit Exceeded!</b> You cannot hold more than <b>${MAX_SAFE_QTY.toLocaleString('en-US')}x</b> of an item.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      const user = await userRepo.getUser(targetUserId);
      const currentWallet = Math.max(0, Math.floor(Number(user?.wallet || 0)));
      const totalCostBigInt = BigInt(item.buyPrice) * BigInt(quantity);

      if (totalCostBigInt > BigInt(currentWallet) || totalCostBigInt > MAX_SAFE_INT_BIG) {
        await ctx.answerCallbackQuery({ text: 'Insufficient wallet funds!', show_alert: true });
        return ctx.editMessageText(
          `❌ You cannot afford <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}</b> (or the total cost exceeds the safe wallet limit of 🪙 9 Quadrillion)!`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      const totalCost = Number(totalCostBigInt);

      // Atomically lock & deduct limited global shop stock before taking coins
      if (item.stockLimit) {
        const stockRes = await shopStockRepo.purchaseLimitedStock(item.id, quantity);
        if (!stockRes.success) {
          const resetInSec = Math.max(1, Math.ceil((stockRes.nextResetAt - Date.now()) / 1000));
          await ctx.answerCallbackQuery({ text: 'Sold out!', show_alert: true });
          return ctx.editMessageText(
            `❌ <b>Purchase Failed: SOLD OUT!</b>\n` +
            `Someone else claimed the remaining stock of ${item.emoji} <b>${item.name}</b>!\n` +
            `⏳ Restocks in: <b>${formatTime(resetInSec)}</b>`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }

      // Single atomic PostgreSQL transaction: deduct wallet + insert/increment inventory + currency_logs
      const buyRes = await inventoryRepo.executeAtomicBuy(
        targetUserId,
        item.id,
        quantity,
        totalCost,
        `Bought ${quantity}x ${item.name}`
      );

      if (!buyRes.success) {
        // Return limited stock if atomic wallet deduction failed concurrently
        if (item.stockLimit) {
          await shopStockRepo.returnStock(item.id, quantity).catch(() => {});
        }
        await ctx.answerCallbackQuery({ text: 'Purchase failed: insufficient funds!', show_alert: true });
        return ctx.editMessageText(
          `💸 <b>Transaction Failed:</b> Insufficient wallet funds or invalid transaction.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      await ctx.answerCallbackQuery({ text: `Bought ${quantity.toLocaleString('en-US')}x ${item.name}!` });
      return ctx.editMessageText(
        `🛒 You bought <b>${quantity.toLocaleString('en-US')}x ${item.name}</b> for <b>🪙 ${totalCost.toLocaleString('en-US')}</b>!\n\n` +
        `🎒 <b>Now in Backpack:</b> ${buyRes.newQuantity.toLocaleString('en-US')}x ${item.emoji} ${item.name}\n` +
        `👛 <b>Remaining Wallet:</b> ${formatCoins(buyRes.newWallet)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default buy;
