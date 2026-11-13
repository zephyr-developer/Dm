import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';

function parseCoinAmount(str) {
  if (!str) return NaN;
  const clean = str.trim().toLowerCase().replace(/,/g, '');
  if (!/^\d+(\.\d+)?[kmbtq]?$/.test(clean)) return NaN;
  if (clean.endsWith('q')) return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000_000_000);
  if (clean.endsWith('t')) return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000_000);
  if (clean.endsWith('b')) return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000);
  if (clean.endsWith('m')) return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000);
  if (clean.endsWith('k')) return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000);
  return parseInt(clean, 10);
}

export const give = {
  name: 'give',
  aliases: ['share', 'pay'],
  description: 'Transfer coins (5% burn tax) or backpack items to a friend',
  cooldown: 5,

  async execute(ctx) {
    const callerId = ctx.from.id;
    const caller = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    if (Number(caller.passive_mode) === 1) {
      return ctx.reply('❌ You cannot send coins or items while in <b>Passive Mode</b>!', { parse_mode: 'HTML' });
    }

    const { user: target, notFound, errorMessage, remainingArgs: rawArgs } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(
        `🎁 <b>P2P Currency &amp; Item Transfer</b>\n` +
        `Usage:\n` +
        `• Reply to a friend: <code>/give 5000</code> or <code>/give shovel 1</code>\n` +
        `• Via username: <code>/give @username 5000</code> or <code>/give @username padlock 2</code>\n\n` +
        `⚠️ <i>Note: Coin transfers incur a 5% anti-inflation burn tax.</i>`,
        { parse_mode: 'HTML' }
      );
    }

    if (target.user_id === callerId) {
      return ctx.reply('🤡 You cannot send gifts to yourself!');
    }

    if (Number(target.passive_mode) === 1) {
      return ctx.reply('❌ You cannot send coins or items to a player who is in <b>Passive Mode</b>!', { parse_mode: 'HTML' });
    }

    if (rawArgs.length === 0) {
      return ctx.reply('❌ Please specify what you wish to give (coins amount or item name).');
    }

    const targetDisplayName = target.username ? `@${target.username}` : target.first_name;

    // Determine if giving coins or an item:
    // Single numeric/shorthand arg (e.g. `5000`, `50k`, `all`? -> handled below) is coins.
    // Multiple args where the first is numeric and second is item text (e.g. `2 padlock`) is an item transfer.
    const firstArg = rawArgs[0];
    const parsedCoin = parseCoinAmount(firstArg);
    const isCoinTransfer = rawArgs.length === 1 && !isNaN(parsedCoin);

    // ==========================================
    // CASE 1: TRANSFER COINS (CONFIRMATION)
    // ==========================================
    if (isCoinTransfer) {
      const amount = parsedCoin;
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Please specify a valid amount of coins to transfer.');
      }

      const callerWallet = Number(caller.wallet || 0);
      if (callerWallet < amount) {
        return ctx.reply(
          `💸 You don't have enough coins in your wallet! (You have ${formatCoins(callerWallet)}, trying to send ${formatCoins(amount)})`
        );
      }

      const tax = Math.floor(amount * 0.05);
      const netAmount = amount - tax;

      const token = createConfirmation('gv', {
        kind: 'coins',
        callerId,
        callerLabel: caller.username || caller.first_name,
        targetId: target.user_id,
        targetFirstName: target.first_name,
        targetDisplayName,
        amount,
        tax,
        netAmount
      });

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `give:no:${token}:${callerId}`)
        .text('✅ Confirm', `give:yes:${token}:${callerId}`);

      return ctx.reply(
        `⚠️ <b>Confirm Coin Transfer</b>\n\n` +
        `👤 <b>Recipient:</b> ${sanitizeHtml(targetDisplayName)} (<b>${sanitizeHtml(target.first_name)}</b>)\n` +
        `💸 <b>Gross Sent:</b> ${formatCoins(amount)}\n` +
        `🔥 <b>5% Burn Tax:</b> ${formatCoins(tax)}\n` +
        `✅ <b>Net Received:</b> <b>${formatCoins(netAmount)}</b>\n\n` +
        `<i>Press Confirm to finalize this transfer.</i>`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    // ==========================================
    // CASE 2: TRANSFER ITEM (CONFIRMATION)
    // ==========================================
    let quantity = 1;
    let itemQuery = rawArgs.join(' ');

    const lastArg = rawArgs[rawArgs.length - 1];
    if (/^\d+$/.test(lastArg) && rawArgs.length > 1) {
      quantity = parseInt(lastArg, 10);
      itemQuery = rawArgs.slice(0, -1).join(' ');
    } else if (/^\d+$/.test(firstArg) && rawArgs.length > 1) {
      quantity = parseInt(firstArg, 10);
      itemQuery = rawArgs.slice(1).join(' ');
    }

    if (isNaN(quantity) || quantity <= 0) {
      return ctx.reply('❌ Please specify a valid positive item quantity.');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Unknown item "<b>${sanitizeHtml(itemQuery)}</b>". Run <code>/inv</code> to check your inventory.`, { parse_mode: 'HTML' });
    }

    const ownedQty = await inventoryRepo.getItem(callerId, item.id);
    if (ownedQty < quantity) {
      return ctx.reply(
        `🎒 You only own <b>${ownedQty}x</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b>!`,
        { parse_mode: 'HTML' }
      );
    }

    const token = createConfirmation('gv', {
      kind: 'item',
      callerId,
      targetId: target.user_id,
      targetFirstName: target.first_name,
      targetDisplayName,
      itemId: item.id,
      itemName: item.name,
      itemEmoji: item.emoji,
      quantity
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `give:no:${token}:${callerId}`)
      .text('✅ Confirm', `give:yes:${token}:${callerId}`);

    return ctx.reply(
      `⚠️ <b>Confirm Item Gift</b>\n\n` +
      `👤 <b>Recipient:</b> ${sanitizeHtml(targetDisplayName)} (<b>${sanitizeHtml(target.first_name)}</b>)\n` +
      `🎁 <b>Gift:</b> <b>${quantity.toLocaleString('en-US')}x ${item.emoji} ${sanitizeHtml(item.name)}</b>\n` +
      `🎒 <b>Currently Owned:</b> ${ownedQty.toLocaleString('en-US')}x\n\n` +
      `<i>Press Confirm to hand over this item.</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const token = parts[2];
    const ownerId = Number(parts[3]);

    if (ctx.from.id !== ownerId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your transfer confirmation!",
        show_alert: true
      }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.callerId !== ownerId) {
      await ctx.editMessageText('⏳ This transfer confirmation has expired. Please run <code>/give</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Transfer cancelled.');
      return ctx.answerCallbackQuery({ text: 'Transfer cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    // Consume immediately to prevent double-click exploits
    consumeConfirmation(token);

    // Re-verify passive mode for both caller & target
    const freshCaller = await userRepo.getUser(pending.callerId);
    const freshTarget = await userRepo.getUser(pending.targetId);

    if (!freshCaller || !freshTarget) {
      await ctx.editMessageText('❌ Transfer failed: account record not found.');
      return ctx.answerCallbackQuery({ text: 'Transfer failed.' }).catch(() => {});
    }

    if (Number(freshCaller.passive_mode) === 1 || Number(freshTarget.passive_mode) === 1) {
      await ctx.editMessageText('❌ Transfer cancelled: Passive Mode is active for one of the players.');
      return ctx.answerCallbackQuery({ text: 'Blocked by Passive Mode.' }).catch(() => {});
    }

    // ==========================================
    // EXECUTE COIN TRANSFER
    // ==========================================
    if (pending.kind === 'coins') {
      const freshWallet = Number(freshCaller.wallet || 0);
      if (freshWallet < pending.amount) {
        await ctx.editMessageText(
          `❌ Transfer failed: insufficient wallet balance! (You now have ${formatCoins(freshWallet)}, needed ${formatCoins(pending.amount)})`
        );
        return ctx.answerCallbackQuery({ text: 'Insufficient coins!' }).catch(() => {});
      }

      const res = await userRepo.transferWallet(
        pending.callerId,
        pending.targetId,
        pending.amount,
        0.05,
        freshCaller.username || freshCaller.first_name,
        freshTarget.username || freshTarget.first_name,
        { skipAntiCheat: true }
      );

      if (!res.success) {
        await ctx.editMessageText(`❌ Transfer failed: ${sanitizeHtml(res.reason || 'Unknown error')}`, { parse_mode: 'HTML' });
        return ctx.answerCallbackQuery({ text: 'Transfer failed.' }).catch(() => {});
      }

      const { evaluateGiveTransferAnomaly } = await import('../../services/antiCheat.js');
      const acCheck = await evaluateGiveTransferAnomaly({
        sender: freshCaller,
        receiver: freshTarget,
        amount: pending.amount,
        netAmount: res.netAmount,
        senderWalletAfter: res.senderAfter?.wallet ?? (freshWallet - pending.amount),
        senderBankAfter: res.senderAfter?.bank ?? Number(freshCaller.bank || 0),
        receiverWalletAfter: res.recipientAfter?.wallet ?? (Number(freshTarget.wallet || 0) + res.netAmount),
        receiverBankAfter: res.recipientAfter?.bank ?? Number(freshTarget.bank || 0)
      });

      let securityNotice = '';
      if (acCheck?.triggered) {
        securityNotice = `\n\n🚨 <b>ANTI-CHEAT NOTICE:</b> This large/unusual transfer triggered an automatic account freeze on both parties pending Bot Owner review.`;
      }

      await ctx.editMessageText(
        `🎁 <b>Transfer Complete!</b>\n` +
        `Transferred <b>${formatCoins(res.netAmount)}</b> to <b>${sanitizeHtml(freshTarget.first_name)}</b>!\n\n` +
        `🔥 <b>Tax Burned (5%):</b> ${formatCoins(res.tax)}\n` +
        `👛 <b>Your Remaining Wallet:</b> ${formatCoins(freshWallet - pending.amount)}` +
        securityNotice,
        { parse_mode: 'HTML' }
      );
      return ctx.answerCallbackQuery({ text: acCheck?.triggered ? 'Transfer flagged for review!' : 'Transfer complete!' }).catch(() => {});
    }

    // ==========================================
    // EXECUTE ITEM TRANSFER (ANTI-DOUBLE-SPEND)
    // ==========================================
    const freshOwned = await inventoryRepo.getItem(pending.callerId, pending.itemId);
    if (freshOwned < pending.quantity) {
      await ctx.editMessageText(
        `❌ Transfer failed: you only own <b>${freshOwned}x</b> ${pending.itemEmoji} <b>${sanitizeHtml(pending.itemName)}</b> now.`,
        { parse_mode: 'HTML' }
      );
      return ctx.answerCallbackQuery({ text: 'Insufficient items!' }).catch(() => {});
    }

    const removed = await inventoryRepo.removeItem(pending.callerId, pending.itemId, pending.quantity);
    if (!removed) {
      await ctx.editMessageText('❌ Transfer failed while deducting item from your backpack.');
      return ctx.answerCallbackQuery({ text: 'Transfer failed.' }).catch(() => {});
    }

    await inventoryRepo.addItem(pending.targetId, pending.itemId, pending.quantity);

    await ctx.editMessageText(
      `🎁 <b>Gift Delivered!</b>\n` +
      `You handed <b>${pending.quantity.toLocaleString('en-US')}x ${pending.itemEmoji} ${sanitizeHtml(pending.itemName)}</b> to <b>${sanitizeHtml(freshTarget.first_name)}</b>!\n\n` +
      `🎒 <b>Remaining in Backpack:</b> ${(freshOwned - pending.quantity).toLocaleString('en-US')}x ${sanitizeHtml(pending.itemName)}`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCallbackQuery({ text: 'Gift delivered!' }).catch(() => {});
  }
};

export default give;
