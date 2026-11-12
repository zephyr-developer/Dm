import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';

function parseAmount(str) {
  if (!str) return NaN;
  const clean = str.trim().toLowerCase();
  if (clean.endsWith('k')) {
    return parseFloat(clean.slice(0, -1)) * 1000;
  }
  if (clean.endsWith('m')) {
    return parseFloat(clean.slice(0, -1)) * 1000000;
  }
  if (clean.endsWith('b')) {
    return parseFloat(clean.slice(0, -1)) * 1000000000;
  }
  return parseInt(clean.replace(/,/g, ''), 10);
}

export const voidcoin = {
  name: 'voidcoin',
  aliases: ['voidcoins', 'wipecoins'],
  category: 'owner',
  description: 'Underground: Forcefully void coins from a user wallet or bank',
  cooldown: 0,

  async execute(ctx) {
    // 1. Strict Owner Security Check
    const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
    if (callerUsername !== 'tzhunyuan' && !isOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const rawArgs = ctx.message.text.trim().split(/\s+/).slice(1);
    let target = null;
    let targetUsername = null;
    const remainingArgs = [];

    // 2. Resolve Target User (via replied message or @username)
    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
      targetUsername = replied.username || replied.first_name || String(replied.id);

      // Collect all raw args, filtering out any accidental self @ mentions
      for (const arg of rawArgs) {
        if (!arg.startsWith('@')) {
          remainingArgs.push(arg);
        }
      }
    } else {
      for (const arg of rawArgs) {
        if (arg.startsWith('@') && !target) {
          const uname = arg.replace(/^@/, '');
          target = await userRepo.getUserByUsername(uname);
          targetUsername = uname;
        } else {
          remainingArgs.push(arg);
        }
      }
    }

    if (!target) {
      return ctx.reply(
        '⚠️ <b>Target user not found!</b>\n' +
        'Usage: <code>/voidcoin &lt;amount|all&gt; &lt;@username|reply&gt; [wallet|bank|both]</code>\n' +
        'Examples:\n' +
        '• <code>/voidcoin 50k @user wallet</code>\n' +
        '• <code>/voidcoin all @user both</code>\n' +
        '• Or reply to any user message with <code>/voidcoin 10000</code>',
        { parse_mode: 'HTML' }
      );
    }

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

    // 4. Determine Amount
    const amountArg = cleanRemaining[0] ? cleanRemaining[0].toLowerCase() : '';
    if (!amountArg) {
      return ctx.reply('⚠️ Please provide an amount or <code>all</code> to void.', { parse_mode: 'HTML' });
    }

    const currentWallet = Number(target.wallet || 0);
    const currentBank = Number(target.bank || 0);

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

      // Clamp deductions so balances cannot go into negative debt
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
    const displayUsername = targetUsername || target.username || target.first_name || target.user_id;

    // 6. Return discreet admin confirmation
    return ctx.reply(
      `💥 <b>VOID SUCCESSFUL:</b> Removed <b>🪙 ${totalVoided.toLocaleString('en-US')}</b> from @${sanitizeHtml(displayUsername)}'s ${location}. ` +
      `(Balances - Wallet: ${newWallet}, Bank: ${newBank})`,
      { parse_mode: 'HTML' }
    );
  }
};

export default voidcoin;
