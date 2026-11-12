import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, pickRandom } from '../../utils/formatters.js';

const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '🐸'];

export const slots = {
  name: 'slots',
  aliases: [],
  description: 'Spin the reels on the TeleMemer slot machine for up to 25x Pepe Jackpot',
  cooldown: 10, // 5s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const betInput = args[0]?.toLowerCase();

    if (!betInput) {
      return ctx.reply(
        `🎰 <b>TeleMemer Casino Slots</b>\n` +
        `Usage: <code>/slots &lt;bet&gt;</code> or <code>/slots max</code> (Max: 🪙 50,000)\n\n` +
        `<b>Payout Multipliers:</b>\n` +
        `• 🐸 🐸 🐸 = <b>25x JACKPOT!</b>\n` +
        `• 💎 💎 💎 = <b>10x Mega Win</b>\n` +
        `• 3 Matching = <b>4x Win</b>\n` +
        `• 2 Matching = <b>1.5x Return</b>\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    let bet = 0;
    if (betInput === 'all' || betInput === 'max') {
      bet = Math.min(50000, user.wallet);
    } else {
      const parsed = parseInt(betInput.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please enter a valid positive number for your bet.');
      }
      bet = parsed;
    }

    if (bet < 100) {
      return ctx.reply('❌ Minimum slot bet is 🪙 100.');
    }
    if (bet > 50000) {
      return ctx.reply('❌ Maximum slot bet is 🪙 50,000.');
    }
    if (user.wallet < bet) {
      return ctx.reply(`💸 You don't have enough coins in your wallet! (Wallet: ${formatCoins(user.wallet)})`);
    }

    // Deduct bet immediately with currency log
    await userRepo.updateCoins(userId, {
      walletDelta: -bet,
      sourceCommand: '/slots',
      details: `Slots Bet: 🪙 ${bet.toLocaleString()}`
    });

    const luckInfo = await getLuckBreakdown(userId);

    // Spin 3 symbols
    let s1 = pickRandom(SLOT_SYMBOLS);
    let s2 = pickRandom(SLOT_SYMBOLS);
    let s3 = pickRandom(SLOT_SYMBOLS);

    // LuckEngine: Tilt reels if high luck is active
    if (luckInfo.totalBonus > 0) {
      // If customLuck >= 100, high chance for Pepe Jackpot 🐸
      if (luckInfo.customLuck >= 100 && Math.random() < 0.45) {
        s1 = '🐸';
        s2 = '🐸';
        s3 = '🐸';
      } else if (luckInfo.totalBonus >= 50 && Math.random() < 0.50) {
        // Guaranteed triple match
        const luckySymbol = pickRandom(['💎', '🔔', '🍒']);
        s1 = luckySymbol;
        s2 = luckySymbol;
        s3 = luckySymbol;
      } else if (Math.random() < Math.min(0.70, luckInfo.totalBonus / 100)) {
        // Guaranteed at least double match
        s2 = s1;
      }
    }

    let multiplier = 0;
    let title = '';

    // Check 3 matching
    if (s1 === s2 && s2 === s3) {
      if (s1 === '🐸') {
        multiplier = 25;
        title = '🐸 <b>PEPE JACKPOT! 25X MULTIPLIER!</b> 🌟';
      } else if (s1 === '💎') {
        multiplier = 10;
        title = '💎 <b>DIAMOND SHINE! 10X MEGA WIN!</b> 💎';
      } else {
        multiplier = 4;
        title = '🎉 <b>TRIPLE MATCH! 4X WIN!</b>';
      }
    } else if (s1 === s2 || s2 === s3 || s1 === s3) {
      // 2 matching
      multiplier = 1.5;
      title = '✨ <b>DOUBLE MATCH! 1.5X PAYOUT!</b>';
    } else {
      multiplier = 0;
      title = '💀 <b>NO MATCH! YOU LOST!</b>';
    }

    const payout = Math.floor(bet * multiplier);
    if (payout > 0) {
      const cleanTitle = title.replace(/<[^>]*>/g, '').trim();
      await userRepo.updateCoins(userId, {
        walletDelta: payout,
        sourceCommand: '/slots',
        details: `Won Slots (${cleanTitle})`
      });
    }

    const xpRes = await addXp(userId, multiplier > 0 ? 25 : 10);
    const updatedUser = await userRepo.getUser(userId);
    const updatedWallet = updatedUser?.wallet || 0;
    let luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';

    const display = `🎰 <b>SLOT REELS SPINNING...</b>${luckTag}\n\n` +
      `╔═══════════════╗\n` +
      `║   <b>${s1}  |  ${s2}  |  ${s3}</b>   ║\n` +
      `╚═══════════════╝\n\n` +
      `${title}\n` +
      (payout > 0 ? `💰 <b>Payout:</b> +${formatCoins(payout)}\n` : `💸 <b>Lost:</b> ${formatCoins(bet)}\n`) +
      `👛 <b>New Wallet:</b> ${formatCoins(updatedWallet)}\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      (xpRes.message ? `\n${xpRes.message}` : '');

    return ctx.reply(display, { parse_mode: 'HTML' });
  }
};

export default slots;
