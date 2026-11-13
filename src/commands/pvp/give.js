import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

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
        `🎁 <b>P2P Currency & Item Transfer</b>\n` +
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

    // Determine if giving coins or an item
    const firstArg = rawArgs[0];
    const isNumber = /^\d+$/.test(firstArg.replace(/[,kKmM]/g, ''));

    // ==========================================
    // CASE 1: TRANSFER COINS
    // ==========================================
    if (isNumber) {
      const amount = parseInt(firstArg.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Please specify a valid amount of coins to transfer.');
      }

      const callerWallet = Number(caller.wallet || 0);
      if (callerWallet < amount) {
        return ctx.reply(
          `💸 You don't have enough coins in your wallet! (You have ${formatCoins(callerWallet)}, trying to send ${formatCoins(amount)})`
        );
      }

      const res = await userRepo.transferWallet(
        callerId,
        target.user_id,
        amount,
        0.05,
        caller.username || caller.first_name,
        target.username || target.first_name
      );

      if (!res.success) {
        return ctx.reply(`❌ Transfer failed: ${res.reason}`);
      }

      return ctx.reply(
        `🎁 <b>Transfer Complete!</b>\n` +
        `Transferred <b>${formatCoins(res.netAmount)}</b> to <b>${sanitizeHtml(target.first_name)}</b>!\n\n` +
        `🔥 <b>Tax Burned (5%):</b> ${formatCoins(res.tax)}\n` +
        `👛 <b>Your Remaining Wallet:</b> ${formatCoins(callerWallet - amount)}`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // CASE 2: TRANSFER ITEM
    // ==========================================
    let quantity = 1;
    let itemQuery = rawArgs.join(' ');

    const lastArg = rawArgs[rawArgs.length - 1];
    if (/^\d+$/.test(lastArg) && rawArgs.length > 1) {
      quantity = parseInt(lastArg, 10);
      itemQuery = rawArgs.slice(0, -1).join(' ');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Unknown item "<b>${itemQuery}</b>". Run <code>/inv</code> to check your inventory.`, { parse_mode: 'HTML' });
    }

    const ownedQty = await inventoryRepo.getItem(callerId, item.id);
    if (ownedQty < quantity) {
      return ctx.reply(
        `🎒 You only own <b>${ownedQty}x</b> ${item.emoji} <b>${item.name}</b>!`,
        { parse_mode: 'HTML' }
      );
    }

    await inventoryRepo.removeItem(callerId, item.id, quantity);
    await inventoryRepo.addItem(target.user_id, item.id, quantity);

    return ctx.reply(
      `🎁 <b>Gift Delivered!</b>\n` +
      `You handed <b>${quantity}x ${item.emoji} ${item.name}</b> to <b>${sanitizeHtml(target.first_name)}</b>!\n\n` +
      `🎒 <b>Remaining in Backpack:</b> ${ownedQty - quantity}x ${item.name}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default give;
