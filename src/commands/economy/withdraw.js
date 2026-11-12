import userRepo from '../../database/userRepo.js';
import { formatCoins } from '../../utils/formatters.js';

export const withdraw = {
  name: 'withdraw',
  aliases: ['with'],
  description: 'Withdraw coins from your bank vault into your wallet',
  cooldown: 5,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.split(/\s+/).slice(1);
    const input = args[0]?.toLowerCase();

    if (!input) {
      return ctx.reply(
        `🏦 <b>Bank Withdrawal</b>\n` +
        `Usage: <code>/with &lt;amount&gt;</code> or <code>/with all</code>\n\n` +
        `🏦 <b>Bank:</b> ${formatCoins(user.bank)}\n` +
        `👛 <b>Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    if (user.bank <= 0) {
      return ctx.reply('🏦 You do not have any coins stored in your bank account to withdraw!');
    }

    let withdrawAmount = 0;
    if (input === 'all' || input === 'max') {
      withdrawAmount = user.bank;
    } else {
      const parsed = parseInt(input.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please specify a valid positive number, or use <code>/with all</code>.', { parse_mode: 'HTML' });
      }
      withdrawAmount = Math.min(parsed, user.bank);
    }

    if (withdrawAmount <= 0) {
      return ctx.reply('❌ Cannot withdraw 0 coins.');
    }

    const result = await userRepo.withdraw(userId, withdrawAmount);
    if (!result.success) {
      return ctx.reply(`❌ Withdrawal failed: ${result.reason}`);
    }

    return ctx.reply(
      `📤 <b>Withdrawal Successful!</b>\n` +
      `Transferred <b>${formatCoins(result.withdrawn)}</b> from your bank into your wallet.\n\n` +
      `👛 <b>New Wallet:</b> ${formatCoins(result.newWallet)}\n` +
      `🏦 <b>New Bank:</b> ${formatCoins(result.newBank)} / ${formatCoins(user.bank_max)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default withdraw;
