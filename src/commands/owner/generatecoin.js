import userRepo from '../../database/userRepo.js';
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

export const generatecoin = {
  name: 'generatecoin',
  aliases: ['gencoins', 'mint'],
  description: 'Underground: Mint coins directly into wallet',
  cooldown: 0,

  async execute(ctx) {
    const callerId = ctx.from.id;
    let target = null;
    let amountStr = '';

    const rawArgs = ctx.message.text.trim().split(/\s+/).slice(1);

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
      amountStr = rawArgs[0];
    } else if (rawArgs[1]?.startsWith('@')) {
      target = await userRepo.getUserByUsername(rawArgs[1]);
      amountStr = rawArgs[0];
    } else if (rawArgs[0]?.startsWith('@')) {
      target = await userRepo.getUserByUsername(rawArgs[0]);
      amountStr = rawArgs[1];
    } else {
      target = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);
      amountStr = rawArgs[0];
    }

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
