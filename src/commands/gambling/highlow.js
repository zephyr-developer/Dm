import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, parseBet, randomBetween } from '../../utils/formatters.js';

// In-memory sessions: userId -> { hint, secret, bet }
const activeHLSessions = new Map();

export const highlow = {
  name: 'highlow',
  aliases: ['hl'],
  description: 'Guess whether mystery number is higher, lower, or jackpot (Optional bets with 1.5x win & 5x Jackpot)',
  cooldown: 20, // 10s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const betStr = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1)[0];
    let bet = 0;

    // Optional bet handling
    if (betStr) {
      const { valid, error, bet: parsedBet } = parseBet(betStr, user.wallet);
      if (!valid) {
        if (error === 'INSUFFICIENT_FUNDS' || error === 'NO_COINS') {
          return ctx.reply(`❌ You don't have enough coins in your wallet! You only have 🪙 ${Number(user.wallet || 0).toLocaleString()}.`);
        }
        return ctx.reply('❌ Please enter a valid positive number for your bet (or run <code>/highlow</code> without arguments for free play).', { parse_mode: 'HTML' });
      }

      bet = parsedBet;

      // Deduct bet immediately
      if (bet > 0) {
        await userRepo.updateCoins(userId, {
          walletDelta: -bet,
          sourceCommand: '/highlow',
          details: `High-Low Bet: 🪙 ${bet.toLocaleString()}`
        });
      }
    }

    const hint = randomBetween(1, 100);
    const secret = randomBetween(1, 100);

    activeHLSessions.set(userId, { hint, secret, bet });

    const keyboard = new InlineKeyboard()
      .text('⬆️ Higher', `highlow:higher:${userId}`)
      .text('🎯 JACKPOT! (Same)', `highlow:jackpot:${userId}`)
      .text('⬇️ Lower', `highlow:lower:${userId}`);

    const betNotice = bet > 0
      ? `💰 <b>Active Bet:</b> ${formatCoins(bet)} (Win: <b>1.5x</b> | Jackpot: <b>5x</b>)\n\n`
      : `🎮 <b>Free Play Mode</b> (Bet optional: <code>/highlow &lt;amount&gt;</code>)\n\n`;

    const prompt = `🎲 <b>High-Low Mystery Number</b>\n\n` +
      betNotice +
      `The visible hint number is: <b>[ ${hint} ]</b>\n\n` +
      `Is the secret mystery number (1–100) <b>Higher</b>, <b>Lower</b>, or an exact <b>Jackpot</b> match?`;

    await ctx.reply(prompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const choice = parts[1];
    const targetUserId = Number(parts[2]);

    const session = activeHLSessions.get(targetUserId);
    if (!session) {
      return ctx.answerCallbackQuery({ text: 'This game has expired. Run /highlow again!', show_alert: true });
    }

    activeHLSessions.delete(targetUserId);
    let { hint, secret, bet } = session;
    const luckInfo = await getLuckBreakdown(targetUserId);

    // LuckEngine: Tilt mystery number if player has active luck
    if (luckInfo.totalBonus > 0) {
      if (choice === 'jackpot' && luckInfo.customLuck >= 50 && Math.random() < 0.50) {
        secret = hint;
      } else if (choice === 'higher' && secret <= hint && Math.random() < Math.min(0.85, luckInfo.totalBonus / 120)) {
        secret = Math.min(100, hint + randomBetween(1, 15));
      } else if (choice === 'lower' && secret >= hint && Math.random() < Math.min(0.85, luckInfo.totalBonus / 120)) {
        secret = Math.max(1, hint - randomBetween(1, 15));
      }
    }

    let isWin = false;
    let isJackpot = false;

    if (choice === 'higher' && secret > hint) isWin = true;
    else if (choice === 'lower' && secret < hint) isWin = true;
    else if (choice === 'jackpot' && secret === hint) {
      isWin = true;
      isJackpot = true;
    }

    if (isWin) {
      let reward = 0;
      let winTitle = '';

      if (isJackpot) {
        if (bet > 0) {
          reward = Math.floor(bet * 5); // 5x massive payout!
          winTitle = '🎯 <b>JACKPOT EXACT MATCH! 5X PAYOUT!</b> 🌟';
        } else {
          reward = 25000;
          winTitle = '🎯 <b>JACKPOT EXACT MATCH!</b> 🌟';
        }
      } else {
        if (bet > 0) {
          reward = Math.floor(bet * 1.5); // 1.5x payout!
          winTitle = '🎉 <b>CORRECT GUESS! 1.5X PAYOUT!</b>';
        } else {
          const base = randomBetween(800, 2000);
          reward = Math.floor(base * (1 + (luckInfo.totalBonus / 200)));
          winTitle = '🎉 <b>CORRECT GUESS!</b>';
        }
      }

      await userRepo.updateCoins(targetUserId, {
        walletDelta: reward,
        sourceCommand: '/highlow',
        details: isJackpot
          ? `High-Low Exact Jackpot (${bet > 0 ? '5x' : '25k'})`
          : `High-Low Win (${choice}${bet > 0 ? ' 1.5x' : ''})`
      });
      const xpRes = await addXp(targetUserId, isJackpot ? 100 : 25);

      const updatedUser = await userRepo.getUser(targetUserId);
      const updatedWallet = updatedUser?.wallet || 0;
      let luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';

      const msg = `${winTitle}${luckTag}\n\n` +
        `• Hint Number: <b>${hint}</b>\n` +
        `• Secret Number: <b>${secret}</b>\n` +
        `• Your Guess: <i>${choice.toUpperCase()}</i>\n\n` +
        (bet > 0 ? `💰 <b>Original Bet:</b> ${formatCoins(bet)}\n` : '') +
        `💰 <b>Prize Awarded:</b> +${formatCoins(reward)}\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(updatedWallet)}\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({ text: 'You won!' });
    } else {
      const xpRes = await addXp(targetUserId, 10);
      const updatedUser = await userRepo.getUser(targetUserId);
      const updatedWallet = updatedUser?.wallet || 0;

      const msg = `💀 <b>WRONG GUESS!</b>\n\n` +
        `• Hint Number: <b>${hint}</b>\n` +
        `• Secret Number was: <b>${secret}</b>\n` +
        `• Your Guess: <i>${choice.toUpperCase()}</i>\n\n` +
        (bet > 0 ? `💸 <b>Lost Bet:</b> ${formatCoins(bet)}\n` : '') +
        `👛 <b>Wallet Balance:</b> ${formatCoins(updatedWallet)}\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({ text: 'Incorrect guess!' });
    }
  }
};

export default highlow;
