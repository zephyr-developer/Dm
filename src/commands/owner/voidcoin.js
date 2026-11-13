import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

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
    const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
    if (callerUsername !== 'tzhunyuan' && !isOwner(ctx)) {
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
        '• <code>/voidcoin set 500m @quancibai</code>\n' +
        '• Or reply to any user message with <code>/voidcoin 10000</code>',
        { parse_mode: 'HTML' }
      );
    }

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
      const walletDelta = (location === 'wallet' || location === 'both') ? (clampedTarget - currentWallet) : 0;
      const bankDelta = (location === 'bank' || location === 'both') ? (clampedTarget - currentBank) : 0;

      const updatedTarget = await userRepo.updateCoins(target.user_id, {
        walletDelta,
        bankDelta,
        sourceCommand: '/voidcoin set',
        details: `Admin Economy Reset (${location} -> 🪙 ${clampedTarget.toLocaleString('en-US')}) by @tzhunyuan`
      });

      return ctx.reply(
        `⚖️ <b>ECONOMY RESET SUCCESSFUL:</b> Set @${sanitizeHtml(targetUsername)}'s <b>${location}</b> to <b>🪙 ${clampedTarget.toLocaleString('en-US')}</b>.\n` +
        `(Balances - Wallet: ${formatCoins(updatedTarget.wallet)}, Bank: ${formatCoins(updatedTarget.bank)})`,
        { parse_mode: 'HTML' }
      );
    }

    // 4b. DEDUCT MODE: /voidcoin <amount|all> <@username|reply> [wallet|bank|both]
    const amountArg = cleanRemaining[0] ? cleanRemaining[0].toLowerCase() : '';
    if (!amountArg) {
      return ctx.reply('⚠️ Please provide an amount, <code>all</code>, or <code>set &lt;amount&gt;</code>.', { parse_mode: 'HTML' });
    }

    let actualWalletDeduction = 0;
    let actualBankDeduction = 0;

    if (amountArg === 'all' || amountArg === 'max') {
      if (location === 'wallet' || location === 'both') {
        actualWalletDeduction = Math.max(0, currentWallet);
      }
      if (location === 'bank' || location === 'both') {
        actualBankDeduction = Math.max(0, currentBank);
      }
    } else {
      const parsed = parseAmount(amountArg);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('⚠️ Invalid amount. Specify a positive number (e.g. <code>50k</code>, <code>10000</code>) or <code>all</code>.', { parse_mode: 'HTML' });
      }

      if (location === 'wallet') {
        actualWalletDeduction = Math.min(currentWallet, parsed);
      } else if (location === 'bank') {
        actualBankDeduction = Math.min(currentBank, parsed);
      } else if (location === 'both') {
        actualWalletDeduction = Math.min(currentWallet, parsed);
        actualBankDeduction = Math.min(currentBank, parsed);
      }
    }

    actualWalletDeduction = Math.max(0, actualWalletDeduction);
    actualBankDeduction = Math.max(0, actualBankDeduction);
    const totalVoided = actualWalletDeduction + actualBankDeduction;

    // 5. Apply Deduction atomically to PostgreSQL
    const updatedTarget = await userRepo.updateCoins(target.user_id, {
      walletDelta: -actualWalletDeduction,
      bankDelta: -actualBankDeduction,
      sourceCommand: '/voidcoin',
      details: 'Voided by Admin (@tzhunyuan)'
    });

    const newWallet = formatCoins(updatedTarget.wallet);
    const newBank = formatCoins(updatedTarget.bank);

    // 6. Return discreet admin confirmation
    return ctx.reply(
      `💥 <b>VOID SUCCESSFUL:</b> Removed <b>🪙 ${totalVoided.toLocaleString('en-US')}</b> from @${sanitizeHtml(targetUsername)}'s ${location}. ` +
      `(Balances - Wallet: ${newWallet}, Bank: ${newBank})`,
      { parse_mode: 'HTML' }
    );
  }
};

export default voidcoin;
