import userRepo from '../../database/userRepo.js';
import { formatCoins } from '../../utils/formatters.js';

export const deposit = {
  name: 'deposit',
  aliases: ['dep'],
  description: 'Deposit coins from your wallet into your safe bank vault',
  cooldown: 5,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.split(/\s+/).slice(1);
    const input = args[0]?.toLowerCase();

    if (!input) {
      return ctx.reply(
        `🏦 <b>Bank Deposit</b>\n` +
        `Usage: <code>/dep &lt;amount&gt;</code>, <code>/dep max</code>, or <code>/dep all</code>\n\n` +
        `👛 <b>Wallet:</b> ${formatCoins(user.wallet)}\n` +
        `🏦 <b>Bank:</b> ${formatCoins(user.bank)} / ${formatCoins(user.bank_max)}`,
        { parse_mode: 'HTML' }
      );
    }

    if (user.wallet <= 0) {
      return ctx.reply('👛 You do not have any coins in your wallet to deposit!');
    }

    const availableSpace = Math.max(0, user.bank_max - user.bank);
    if (availableSpace <= 0) {
      return ctx.reply('🏦 Your bank vault is already completely full! Use 📜 <b>Bank Notes</b> or level up to expand capacity.', { parse_mode: 'HTML' });
    }

    let depositAmount = 0;
    if (input === 'all' || input === 'max') {
      depositAmount = Math.min(user.wallet, availableSpace);
    } else {
      const parsed = parseInt(input.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please specify a valid positive number, or use <code>/dep all</code>.', { parse_mode: 'HTML' });
      }
      depositAmount = Math.min(parsed, user.wallet, availableSpace);
    }

    if (depositAmount <= 0) {
      return ctx.reply('❌ Cannot deposit 0 coins.');
    }

    const result = userRepo.deposit(userId, depositAmount);
    if (!result.success) {
      return ctx.reply(`❌ Deposit failed: ${result.reason}`);
    }

    return ctx.reply(
      `📥 <b>Deposit Successful!</b>\n` +
      `Transferred <b>${formatCoins(result.deposited)}</b> into your bank vault.\n\n` +
      `👛 <b>New Wallet:</b> ${formatCoins(result.newWallet)}\n` +
      `🏦 <b>New Bank:</b> ${formatCoins(result.newBank)} / ${formatCoins(user.bank_max)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default deposit;
