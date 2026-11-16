import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, parseBet, pickRandom } from '../../utils/formatters.js';

const MAX_GAMBLE_BET = 100_000_000;
const STANDARD_SYMBOLS = [
  { sym: '🍒', baseMult: 3 },
  { sym: '🍋', baseMult: 4 },
  { sym: '🍇', baseMult: 4 },
  { sym: '🔔', baseMult: 5 }
];

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
  description: 'Spin the reels on the TeleMemer slot machine for up to 25x (50x VIP) Pepe Jackpot (Max Bet: 100M)',
  cooldown: 10, // 5s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);
    const isUltimate = await userRepo.isUltimateGambler(user);

    const betStr = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1)[0];

    if (!betStr) {
      const limitLabel = isUltimate ? '🎰 No Limit (Ultimate Gambler)' : 'Max Bet: 🪙 100,000,000';
      const multList = isUltimate
        ? `• 🐸 🐸 🐸 = <b>50x MEGA VIP JACKPOT!</b>\n` +
          `• 💎 💎 💎 = <b>15x VIP Mega Win</b>\n` +
          `• 3 Matching = <b>4.5x–7.5x VIP Win</b>\n` +
          `• 2 Matching = <b>1.8x VIP Return</b>\n\n`
        : `• 🐸 🐸 🐸 = <b>25x JACKPOT!</b>\n` +
          `• 💎 💎 💎 = <b>10x Mega Win</b>\n` +
          `• 3 Matching = <b>3x–5x Win</b>\n` +
          `• 2 Matching = <b>1.2x Return</b>\n\n`;
      return ctx.reply(
        (isUltimate ? `🎰 <b>[ULTIMATE GAMBLER — NO LIMIT TABLE]</b>\n` : '') +
        `🎰 <b>TeleMemer Casino Slots</b>\n` +
        `Usage: <code>/slots &lt;bet|half|all&gt;</code> (${limitLabel})\n\n` +
        `<b>Payout Multipliers:</b>\n` +
        multList +
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
    if (!isUltimate && bet > MAX_GAMBLE_BET) {
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
    // Standard: ~0.1% 🐸🐸🐸 (25x), ~0.5% 💎💎💎 (10x), ~7.4% 3x standard (3x-5x), ~20% 2-match (1.2x), ~72% no match (0x)
    // Ultimate Gambler: +25% VIP luck boost to matching hits (53% match rate vs 28% standard) & 1.5x/50x Elite multipliers
    let roll = Math.random() * 100;
    if (isGodLuck) {
      roll = Math.random() * 12; // Owner god luck tilts heavily toward jackpots
    }

    const triplePepeMax = isUltimate ? 0.5 : 0.1;
    const tripleDiamondMax = isUltimate ? 3.0 : 0.6;
    const tripleStdMax = isUltimate ? 18.0 : 8.0;
    const doubleMatchMax = isUltimate ? 53.0 : 28.0;

    let s1;
    let s2;
    let s3;
    let multiplier = 0;
    let title = '';

    if (roll < triplePepeMax) {
      s1 = '🐸'; s2 = '🐸'; s3 = '🐸';
      multiplier = isUltimate ? 50 : 25;
      title = isUltimate
        ? '🐸 <b>PEPE JACKPOT! 50X MEGA VIP JACKPOT!</b> 🌟'
        : '🐸 <b>PEPE JACKPOT! 25X MULTIPLIER!</b> 🌟';
    } else if (roll < tripleDiamondMax) {
      s1 = '💎'; s2 = '💎'; s3 = '💎';
      multiplier = isUltimate ? 15 : 10;
      title = isUltimate
        ? '💎 <b>DIAMOND SHINE! 15X VIP MEGA WIN!</b> 💎'
        : '💎 <b>DIAMOND SHINE! 10X MEGA WIN!</b> 💎';
    } else if (roll < tripleStdMax) {
      const picked = pickRandom(STANDARD_SYMBOLS);
      s1 = picked.sym; s2 = picked.sym; s3 = picked.sym;
      multiplier = isUltimate ? Number((picked.baseMult * 1.5).toFixed(2)) : picked.baseMult;
      title = `🎉 <b>TRIPLE MATCH! ${multiplier}X WIN!</b>`;
    } else if (roll < doubleMatchMax) {
      const [a, b] = pickThreeDistinct();
      const layout = Math.floor(Math.random() * 3);
      if (layout === 0) { s1 = a; s2 = a; s3 = b; }
      else if (layout === 1) { s1 = a; s2 = b; s3 = a; }
      else { s1 = b; s2 = a; s3 = a; }
      multiplier = isUltimate ? 1.8 : 1.2;
      title = `✨ <b>DOUBLE MATCH! ${multiplier}X PAYOUT!</b>`;
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
    const eliteBanner = isUltimate ? `🎰 <b>[ULTIMATE GAMBLER — NO LIMIT TABLE]</b>\n` : '';
    const eliteBoostNotice = isUltimate ? `\n🔥 <b>Elite Multiplier Boost (+50% Payouts) Applied!</b>` : '';
    const clampNotice = wasClamped ? `\n⚠️ <i>(Table limit applied: 🪙 100,000,000 max bet)</i>` : '';

    const display = `${eliteBanner}🎰 <b>SLOT REELS SPINNING...</b>${luckTag}${eliteBoostNotice}${clampNotice}\n\n` +
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
