import userRepo from '../../database/userRepo.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

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

export const generatecoin = {
  name: 'generatecoin',
  aliases: ['gencoins', 'mint'],
  description: 'Underground: Mint coins directly into wallet',
  cooldown: 0,

  async execute(ctx) {
    const { user: target, notFound, errorMessage, remainingArgs } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: true,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    const amountStr = remainingArgs[0] || '';
    const amount = parseAmount(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('⚠️ Usage: <code>/generatecoin &lt;amount&gt; [@user_optional]</code>\nExamples: <code>/generatecoin 500k</code> or <code>/generatecoin 10m @friend</code>', { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply('❌ Target user not found.');
    }

    const updatedUser = await userRepo.updateCoins(target.user_id, {
      walletDelta: amount,
      sourceCommand: '/generatecoin',
      details: 'Admin Mint from Void (@tzhunyuan)'
    });

    return ctx.reply(
      `💸 <b>Coins Minted from Void!</b>\n\n` +
      `👤 <b>Beneficiary:</b> ${sanitizeHtml(target.first_name)} (<code>${target.user_id}</code>)\n` +
      `🪙 <b>Amount Added:</b> +${formatCoins(amount)}\n` +
      `👛 <b>New Wallet:</b> ${formatCoins(updatedUser.wallet)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default generatecoin;
