import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, randomBetween } from '../../utils/formatters.js';

// In-memory sessions: userId -> { hint, secret }
const activeHLSessions = new Map();

export const highlow = {
  name: 'highlow',
  aliases: ['hl'],
  description: 'Guess whether the secret mystery number is higher, lower, or jackpot',
  cooldown: 20,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const hint = randomBetween(1, 100);
    const secret = randomBetween(1, 100);

    activeHLSessions.set(userId, { hint, secret });

    const keyboard = new InlineKeyboard()
      .text('⬆️ Higher', `highlow:higher:${userId}`)
      .text('🎯 JACKPOT! (Same)', `highlow:jackpot:${userId}`)
      .text('⬇️ Lower', `highlow:lower:${userId}`);

    const prompt = `🎲 <b>High-Low Mystery Number</b>\n\n` +
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
    const { hint, secret } = session;

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
        reward = 25000;
        winTitle = '🎯 <b>JACKPOT EXACT MATCH!</b> 🌟';
      } else {
        reward = randomBetween(800, 2000);
        winTitle = '🎉 <b>CORRECT GUESS!</b>';
      }

      userRepo.updateWallet(targetUserId, reward);
      const xpRes = addXp(targetUserId, isJackpot ? 100 : 25);

      const msg = `${winTitle}\n\n` +
        `• Hint Number: <b>${hint}</b>\n` +
        `• Secret Number: <b>${secret}</b>\n` +
        `• Your Guess: <i>${choice.toUpperCase()}</i>\n\n` +
        `💰 <b>Prize Awarded:</b> +${formatCoins(reward)}\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({ text: 'You won!' });
    } else {
      const xpRes = addXp(targetUserId, 10);
      const msg = `💀 <b>WRONG GUESS!</b>\n\n` +
        `• Hint Number: <b>${hint}</b>\n` +
        `• Secret Number was: <b>${secret}</b>\n` +
        `• Your Guess: <i>${choice.toUpperCase()}</i>\n\n` +
        `Better luck on your next roll! ⭐ +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({ text: 'Incorrect guess!' });
    }
  }
};

export default highlow;
