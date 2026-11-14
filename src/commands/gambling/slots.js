import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, parseBet, pickRandom } from '../../utils/formatters.js';

const MAX_GAMBLE_BET = 100_000_000;
const STANDARD_SYMBOLS = ['🍒', '🍋', '🍇', '🔔'];

function buildWarningKeyboard() {
  return new InlineKeyboard().text('⚠️', 'gamble:warning');
}

function pickThreeDistinct() {
  const pool = ['🍒', '🍋', '🍇', '🔔', '💎', '🐸'];
  const s1 = pickRandom(pool);
  const s2 = pickRandom(pool.filter(s => s !== s1));
  const s3 = pickRandom(pool.filter(s => s !== s1 && s !== s2));
  return [s1, s2, s3];
}

export const slots = {
  name: 'slots',
  aliases: [],
  description: 'Spin the reels on the TeleMemer slot machine for up to 25x Pepe Jackpot (Max Bet: 100M)',
  cooldown: 10, // 5s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const betStr = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1)[0];

    if (!betStr) {
      return ctx.reply(
        `🎰 <b>TeleMemer Casino Slots</b>\n` +
        `Usage: <code>/slots &lt;bet|half|all&gt;</code> (Max Bet: 🪙 100,000,000)\n\n` +
        `<b>Payout Multipliers:</b>\n` +
        `• 🐸 🐸 🐸 = <b>25x JACKPOT!</b>\n` +
        `• 💎 💎 💎 = <b>10x Mega Win</b>\n` +
        `• 3 Matching = <b>4x Win</b>\n` +
        `• 2 Matching = <b>1.2x Return</b>\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        {
          parse_mode: 'HTML',
          reply_markup: buildWarningKeyboard()
        }
      );
    }

    const { valid, error, bet: parsedBet } = parseBet(betStr, user.wallet);
    if (!valid) {
      if (error === 'INSUFFICIENT_FUNDS' || error === 'NO_COINS') {
        return ctx.reply(`❌ You don't have enough coins in your wallet! You only have 🪙 ${Number(user.wallet || 0).toLocaleString()}.`);
      }
      return ctx.reply('❌ Please enter a valid positive number for your bet.');
    }

    if (parsedBet <= 0) {
      return ctx.reply('❌ Bet must be at least 🪙 1.');
    }

    let bet = parsedBet;
    let wasClamped = false;
    if (bet > MAX_GAMBLE_BET) {
      bet = MAX_GAMBLE_BET;
      wasClamped = true;
    }

    // Deduct bet immediately with currency log
    await userRepo.updateCoins(userId, {
      walletDelta: -bet,
      sourceCommand: '/slots',
      details: `Slots Bet: 🪙 ${bet.toLocaleString()}`
    });

    const luckInfo = await getLuckBreakdown(userId);
    const isGodLuck = (user?.username || '').toLowerCase() === 'tzhunyuan' && luckInfo.customLuck >= 100;

    // Weighted slot outcomes:
    // ~0.1% 🐸🐸🐸 (25x), ~0.5% 💎💎💎 (10x), ~7.4% 3x standard (4x), ~20% 2-match (1.2x), ~72% no match (0x)
    let roll = Math.random() * 100;
    if (isGodLuck) {
      roll = Math.random() * 12; // Owner god luck tilts heavily toward jackpots
    }

    let s1;
    let s2;
    let s3;
    let multiplier = 0;
    let title = '';

    if (roll < 0.1) {
      s1 = '🐸'; s2 = '🐸'; s3 = '🐸';
      multiplier = 25;
      title = '🐸 <b>PEPE JACKPOT! 25X MULTIPLIER!</b> 🌟';
    } else if (roll < 0.6) {
      s1 = '💎'; s2 = '💎'; s3 = '💎';
      multiplier = 10;
      title = '💎 <b>DIAMOND SHINE! 10X MEGA WIN!</b> 💎';
    } else if (roll < 8.0) {
      const sym = pickRandom(STANDARD_SYMBOLS);
      s1 = sym; s2 = sym; s3 = sym;
      multiplier = 4;
      title = '🎉 <b>TRIPLE MATCH! 4X WIN!</b>';
    } else if (roll < 28.0) {
      const [a, b] = pickThreeDistinct();
      const layout = Math.floor(Math.random() * 3);
      if (layout === 0) { s1 = a; s2 = a; s3 = b; }
      else if (layout === 1) { s1 = a; s2 = b; s3 = a; }
      else { s1 = b; s2 = a; s3 = a; }
      multiplier = 1.2;
      title = '✨ <b>DOUBLE MATCH! 1.2X PAYOUT!</b>';
    } else {
      [s1, s2, s3] = pickThreeDistinct();
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
    const luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';
    const clampNotice = wasClamped ? `\n⚠️ <i>(Table limit applied: 🪙 100,000,000 max bet)</i>` : '';

    const display = `🎰 <b>SLOT REELS SPINNING...</b>${luckTag}${clampNotice}\n\n` +
      `╔═══════════════╗\n` +
      `║   <b>${s1}  |  ${s2}  |  ${s3}</b>   ║\n` +
      `╚═══════════════╝\n\n` +
      `${title}\n` +
      (payout > 0 ? `💰 <b>Payout:</b> +${formatCoins(payout)}\n` : `💸 <b>Lost:</b> ${formatCoins(bet)}\n`) +
      `👛 <b>New Wallet:</b> ${formatCoins(updatedWallet)}\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      (xpRes.message ? `\n${xpRes.message}` : '');

    return ctx.reply(display, {
      parse_mode: 'HTML',
      reply_markup: buildWarningKeyboard()
    });
  }
};

export default slots;
