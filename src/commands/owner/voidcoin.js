import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

function parseAmount(str) {
  if (!str) return NaN;
  const clean = str.trim().toLowerCase().replace(/,/g, '');
  if (clean.endsWith('q')) {
    return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000_000_000);
  }
  if (clean.endsWith('t')) {
    return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000_000);
  }
  if (clean.endsWith('b')) {
    return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000_000);
  }
  if (clean.endsWith('m')) {
    return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000_000);
  }
  if (clean.endsWith('k')) {
    return Math.floor(parseFloat(clean.slice(0, -1)) * 1_000);
  }
  return parseInt(clean, 10);
}

export const voidcoin = {
  name: 'voidcoin',
  aliases: ['voidcoins', 'wipecoins'],
  category: 'owner',
  description: 'Underground: Forcefully void or set coins in a user wallet or bank',
  cooldown: 0,

  async execute(ctx) {
    // 1. Strict Owner Security Check
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    // 2. Resolve Target User (topic-safe: explicit @username > genuine human reply)
    const {
      user: target,
      notFound,
      errorMessage,
      explicitUsername,
      remainingArgs
    } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\n' +
        'Usage:\n' +
        '• <code>/voidcoin &lt;amount|all&gt; &lt;@username|reply&gt; [wallet|bank|both]</code>\n' +
        '• <code>/voidcoin set &lt;exact_amount&gt; &lt;@username|reply&gt; [wallet|bank|both]</code>\n\n' +
        'Examples:\n' +
        '• <code>/voidcoin 50k @user wallet</code>\n' +
        '• <code>/voidcoin all @user both</code>\n' +
        '• <code>/voidcoin set 500m @user</code>\n' +
        '• Or reply to any user message with <code>/voidcoin 10000</code>',
        { parse_mode: 'HTML' }
      );
    }

    const callerId = ctx.from.id;
    const targetUsername = explicitUsername || target.username || target.first_name || String(target.user_id);

    // 3. Determine Location (wallet | bank | both, defaults to wallet)
    let location = 'wallet';
    const cleanRemaining = [];

    for (const arg of remainingArgs) {
      const lower = arg.toLowerCase();
      if (['wallet', 'bank', 'both'].includes(lower)) {
        location = lower;
      } else {
        cleanRemaining.push(arg);
      }
    }

    const currentWallet = Number(target.wallet || 0);
    const currentBank = Number(target.bank || 0);

    // 4a. SET MODE: /voidcoin set <exact_amount> <@username|reply> [wallet|bank|both]
    if (cleanRemaining[0]?.toLowerCase() === 'set') {
      const setAmountStr = cleanRemaining[1];
      if (!setAmountStr) {
        return ctx.reply('⚠️ Usage: <code>/voidcoin set &lt;exact_amount&gt; &lt;@username|reply&gt; [wallet|bank|both]</code>', { parse_mode: 'HTML' });
      }

      const parsedSet = parseAmount(setAmountStr);
      if (isNaN(parsedSet) || parsedSet < 0) {
        return ctx.reply('⚠️ Invalid amount. Specify a non-negative number (e.g. <code>0</code>, <code>500m</code>, <code>10k</code>).', { parse_mode: 'HTML' });
      }

      const clampedTarget = Math.min(1_000_000_000_000_000, Math.max(0, parsedSet));
      const newWalletPreview = (location === 'wallet' || location === 'both') ? clampedTarget : currentWallet;
      const newBankPreview = (location === 'bank' || location === 'both') ? clampedTarget : currentBank;

      const token = createConfirmation('vc', {
        callerId,
        targetId: target.user_id,
        targetUsername,
        mode: 'set',
        location,
        clampedTarget
      });

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `voidcoin:no:${token}:${callerId}`)
        .text('✅ Confirm', `voidcoin:yes:${token}:${callerId}`);

      return ctx.reply(
        `⚖️ <b>CONFIRM ECONOMY RESET</b>\n\n` +
        `👤 <b>Target:</b> @${sanitizeHtml(targetUsername)} (<code>${target.user_id}</code>)\n` +
        `📍 <b>Location:</b> <b>${location.toUpperCase()}</b>\n` +
        `💳 <b>Current Balances:</b> Wallet ${formatCoins(currentWallet)} | Bank ${formatCoins(currentBank)}\n` +
        `🎯 <b>New Target Balance:</b> <b>${formatCoins(clampedTarget)}</b>\n` +
        `📊 <b>Projected Result:</b> Wallet ${formatCoins(newWalletPreview)} | Bank ${formatCoins(newBankPreview)}`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    // 4b. DEDUCT MODE: /voidcoin <amount|all> <@username|reply> [wallet|bank|both]
    const amountArg = cleanRemaining[0] ? cleanRemaining[0].toLowerCase() : '';
    if (!amountArg) {
      return ctx.reply('⚠️ Please provide an amount, <code>all</code>, or <code>set &lt;amount&gt;</code>.', { parse_mode: 'HTML' });
    }

    let isAll = false;
    let parsedRequested = 0;
    let previewWalletDeduct = 0;
    let previewBankDeduct = 0;

    if (amountArg === 'all' || amountArg === 'max') {
      isAll = true;
      if (location === 'wallet' || location === 'both') previewWalletDeduct = Math.max(0, currentWallet);
      if (location === 'bank' || location === 'both') previewBankDeduct = Math.max(0, currentBank);
    } else {
      parsedRequested = parseAmount(amountArg);
      if (isNaN(parsedRequested) || parsedRequested <= 0) {
        return ctx.reply('⚠️ Invalid amount. Specify a positive number (e.g. <code>50k</code>, <code>10000</code>) or <code>all</code>.', { parse_mode: 'HTML' });
      }
      if (location === 'wallet' || location === 'both') previewWalletDeduct = Math.min(currentWallet, parsedRequested);
      if (location === 'bank' || location === 'both') previewBankDeduct = Math.min(currentBank, parsedRequested);
    }

    const totalPreviewVoid = previewWalletDeduct + previewBankDeduct;

    const token = createConfirmation('vc', {
      callerId,
      targetId: target.user_id,
      targetUsername,
      mode: isAll ? 'void_all' : 'void',
      location,
      requestedAmount: parsedRequested
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `voidcoin:no:${token}:${callerId}`)
      .text('✅ Confirm', `voidcoin:yes:${token}:${callerId}`);

    return ctx.reply(
      `⚠️ <b>CONFIRM COIN VOID</b>\n\n` +
      `👤 <b>Target:</b> @${sanitizeHtml(targetUsername)} (<code>${target.user_id}</code>)\n` +
      `📍 <b>Location:</b> <b>${location.toUpperCase()}</b>\n` +
      `💳 <b>Current Balances:</b> Wallet ${formatCoins(currentWallet)} | Bank ${formatCoins(currentBank)}\n` +
      `💥 <b>Will Void:</b> <b>${formatCoins(totalPreviewVoid)}</b>\n` +
      `📊 <b>Projected Result:</b> Wallet ${formatCoins(currentWallet - previewWalletDeduct)} | Bank ${formatCoins(currentBank - previewBankDeduct)}`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.answerCallbackQuery({ text: '❌ Unauthorized.', show_alert: true }).catch(() => {});
    }

    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const token = parts[2];
    const ownerId = Number(parts[3]);

    if (ctx.from.id !== ownerId) {
      return ctx.answerCallbackQuery({ text: "🚫 This isn't your confirmation!", show_alert: true }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.callerId !== ownerId) {
      await ctx.editMessageText('⏳ This confirmation has expired. Please run <code>/voidcoin</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Void coin action cancelled.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    consumeConfirmation(token);

    const freshTarget = await userRepo.getUser(pending.targetId);
    if (!freshTarget) {
      await ctx.editMessageText('❌ Target user no longer exists.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Target missing.' }).catch(() => {});
    }

    const freshWallet = Number(freshTarget.wallet || 0);
    const freshBank = Number(freshTarget.bank || 0);

    if (pending.mode === 'set') {
      const walletDelta = (pending.location === 'wallet' || pending.location === 'both') ? (pending.clampedTarget - freshWallet) : 0;
      const bankDelta = (pending.location === 'bank' || pending.location === 'both') ? (pending.clampedTarget - freshBank) : 0;

      const updatedTarget = await userRepo.updateCoins(pending.targetId, {
        walletDelta,
        bankDelta,
        sourceCommand: '/voidcoin set',
        details: `Admin Economy Reset (${pending.location} -> 🪙 ${pending.clampedTarget.toLocaleString('en-US')}) by @tzhunyuan`
      });

      await ctx.editMessageText(
        `⚖️ <b>ECONOMY RESET SUCCESSFUL:</b> Set @${sanitizeHtml(pending.targetUsername)}'s <b>${pending.location}</b> to <b>🪙 ${pending.clampedTarget.toLocaleString('en-US')}</b>.\n` +
        `(Balances - Wallet: ${formatCoins(updatedTarget.wallet)}, Bank: ${formatCoins(updatedTarget.bank)})`,
        { parse_mode: 'HTML' }
      );
      return ctx.answerCallbackQuery({ text: 'Economy reset complete.' }).catch(() => {});
    }

    let actualWalletDeduction = 0;
    let actualBankDeduction = 0;

    if (pending.mode === 'void_all') {
      if (pending.location === 'wallet' || pending.location === 'both') actualWalletDeduction = Math.max(0, freshWallet);
      if (pending.location === 'bank' || pending.location === 'both') actualBankDeduction = Math.max(0, freshBank);
    } else {
      if (pending.location === 'wallet' || pending.location === 'both') actualWalletDeduction = Math.min(freshWallet, pending.requestedAmount);
      if (pending.location === 'bank' || pending.location === 'both') actualBankDeduction = Math.min(freshBank, pending.requestedAmount);
    }

    actualWalletDeduction = Math.max(0, actualWalletDeduction);
    actualBankDeduction = Math.max(0, actualBankDeduction);
    const totalVoided = actualWalletDeduction + actualBankDeduction;

    const updatedTarget = await userRepo.updateCoins(pending.targetId, {
      walletDelta: -actualWalletDeduction,
      bankDelta: -actualBankDeduction,
      sourceCommand: '/voidcoin',
      details: 'Voided by Admin (@tzhunyuan)'
    });

    await ctx.editMessageText(
      `💥 <b>VOID SUCCESSFUL:</b> Removed <b>🪙 ${totalVoided.toLocaleString('en-US')}</b> from @${sanitizeHtml(pending.targetUsername)}'s ${pending.location}.\n` +
      `(Balances - Wallet: ${formatCoins(updatedTarget.wallet)}, Bank: ${formatCoins(updatedTarget.bank)})`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCallbackQuery({ text: 'Coins voided.' }).catch(() => {});
  }
};

export default voidcoin;
