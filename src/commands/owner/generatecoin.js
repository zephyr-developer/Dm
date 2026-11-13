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

export const generatecoin = {
  name: 'generatecoin',
  aliases: ['gencoins', 'mint'],
  category: 'owner',
  description: 'Underground: Mint coins directly into wallet',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const { user: target, notFound, errorMessage, remainingArgs } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: true,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    const amountStr = remainingArgs[0] || '';
    const parsedAmount = parseAmount(amountStr);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return ctx.reply(
        '⚠️ Usage: <code>/generatecoin &lt;amount&gt; [@user_optional]</code>\nExamples: <code>/generatecoin 500k</code> or <code>/generatecoin 10m @friend</code>',
        { parse_mode: 'HTML' }
      );
    }

    if (!target) {
      return ctx.reply('❌ Target user not found.');
    }

    const amount = Math.min(1_000_000_000_000_000, Math.floor(parsedAmount));
    const callerId = ctx.from.id;
    const currentWallet = Number(target.wallet || 0);
    const beneficiaryLabel = target.username ? `@${target.username}` : target.first_name;

    const token = createConfirmation('gc', {
      callerId,
      targetId: target.user_id,
      targetFirstName: target.first_name,
      beneficiaryLabel,
      amount
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `generatecoin:no:${token}:${callerId}`)
      .text('✅ Confirm', `generatecoin:yes:${token}:${callerId}`);

    return ctx.reply(
      `⚠️ <b>CONFIRM COIN GENERATION</b>\n\n` +
      `👤 <b>Beneficiary:</b> ${sanitizeHtml(beneficiaryLabel)} (<code>${target.user_id}</code>)\n` +
      `🪙 <b>Amount to Mint:</b> +${formatCoins(amount)}\n` +
      `👛 <b>Current Wallet:</b> ${formatCoins(currentWallet)}\n` +
      `📈 <b>Projected Wallet:</b> ${formatCoins(Math.min(1_000_000_000_000_000, currentWallet + amount))}`,
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
      await ctx.editMessageText('⏳ This confirmation has expired. Please run <code>/generatecoin</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Coin generation cancelled.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    consumeConfirmation(token);

    const updatedUser = await userRepo.updateCoins(pending.targetId, {
      walletDelta: pending.amount,
      sourceCommand: '/generatecoin',
      details: 'Admin Mint from Void (@tzhunyuan)'
    });

    await ctx.editMessageText(
      `💸 <b>Coins Minted from Void!</b>\n\n` +
      `👤 <b>Beneficiary:</b> ${sanitizeHtml(pending.targetFirstName)} (<code>${pending.targetId}</code>)\n` +
      `🪙 <b>Amount Added:</b> +${formatCoins(pending.amount)}\n` +
      `👛 <b>New Wallet:</b> ${formatCoins(updatedUser.wallet)}`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCallbackQuery({ text: 'Coins minted.' }).catch(() => {});
  }
};

export default generatecoin;
