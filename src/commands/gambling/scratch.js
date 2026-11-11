import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins } from '../../utils/formatters.js';

const MULTIPLIER_POOL = [0, 0.5, 1, 1, 1.5, 2, 3, 5, 'SKULL'];

// In-memory active scratch cards: userId -> state
const activeScratchCards = new Map();

function buildScratchKeyboard(userId, board, revealedIndices, isFinished = false) {
  const keyboard = new InlineKeyboard();

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const isRevealed = revealedIndices.includes(idx) || isFinished;
      const val = board[idx];

      let label = '❓';
      if (isRevealed) {
        label = val === 'SKULL' ? '💀 BUST' : `${val}x`;
      }

      if (isFinished) {
        // Disabled button
        keyboard.text(label, `scratch:done:${userId}`);
      } else if (revealedIndices.includes(idx)) {
        keyboard.text(label, `scratch:noop:${userId}`);
      } else {
        keyboard.text(label, `scratch:click:${idx}:${userId}`);
      }
    }
    keyboard.row();
  }

  return keyboard;
}

export const scratch = {
  name: 'scratch',
  aliases: [],
  description: 'Scratch 3 mystery multiplier tiles on a 3x3 scratchcard ticket',
  cooldown: 5,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (activeScratchCards.has(userId)) {
      return ctx.reply('🎫 You already have an active scratchcard ticket! Finish scratching it first.');
    }

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const betInput = args[0]?.toLowerCase();

    if (!betInput) {
      return ctx.reply(
        `🎫 <b>Scratchcard Lottery</b>\n` +
        `Usage: <code>/scratch &lt;bet&gt;</code> (Min: 🪙 1,000 | Max: 🪙 25,000)\n\n` +
        `Pick 3 mystery tiles on the 3x3 grid to accumulate multipliers! Watch out for the 💀 Skull.\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    let bet = 0;
    if (betInput === 'all' || betInput === 'max') {
      bet = Math.min(25000, user.wallet);
    } else {
      const parsed = parseInt(betInput.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please enter a valid positive number for your scratchcard bet.');
      }
      bet = parsed;
    }

    if (bet < 1000) {
      return ctx.reply('❌ Minimum bet for a scratchcard is 🪙 1,000.');
    }
    if (bet > 25000) {
      return ctx.reply('❌ Maximum bet for a scratchcard is 🪙 25,000.');
    }
    if (user.wallet < bet) {
      return ctx.reply(`💸 You do not have enough coins in your wallet! (Wallet: ${formatCoins(user.wallet)})`);
    }

    // Deduct bet immediately
    userRepo.updateWallet(userId, -bet);

    // Shuffle the 9 multipliers
    const board = [...MULTIPLIER_POOL].sort(() => 0.5 - Math.random());

    const session = {
      userId,
      bet,
      board,
      revealed: [],
      multipliers: []
    };
    activeScratchCards.set(userId, session);

    const keyboard = buildScratchKeyboard(userId, board, []);

    const prompt = `🎫 <b>TeleMemer Lucky Scratchcard</b>\n` +
      `Ticket Cost: <b>${formatCoins(bet)}</b>\n\n` +
      `Scratch <b>3 tiles</b> below by clicking the ❓ boxes. Beware the 💀!`;

    await ctx.reply(prompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];

    if (action === 'noop' || action === 'done') {
      return ctx.answerCallbackQuery();
    }

    const clickedIdx = Number(parts[2]);
    const targetUserId = Number(parts[3]);

    const session = activeScratchCards.get(targetUserId);
    if (!session) {
      return ctx.answerCallbackQuery({ text: 'This scratchcard has already ended.', show_alert: true });
    }

    if (session.revealed.includes(clickedIdx)) {
      return ctx.answerCallbackQuery({ text: 'Tile already scratched!' });
    }

    session.revealed.push(clickedIdx);
    const value = session.board[clickedIdx];

    // Check Skull
    if (value === 'SKULL') {
      activeScratchCards.delete(targetUserId);
      const finishedKeyboard = buildScratchKeyboard(targetUserId, session.board, session.revealed, true);
      const updatedWallet = userRepo.getUser(targetUserId)?.wallet || 0;

      const bustMsg = `💀 <b>BOOM! YOU HIT THE SKULL!</b>\n\n` +
        `The cursed skull destroyed your scratchcard instantly!\n` +
        `💸 <b>Lost:</b> ${formatCoins(session.bet)}\n` +
        `👛 <b>Wallet:</b> ${formatCoins(updatedWallet)}`;

      await ctx.editMessageText(bustMsg, {
        parse_mode: 'HTML',
        reply_markup: finishedKeyboard
      });
      return ctx.answerCallbackQuery({ text: '💀 BUST! Hit the skull!', show_alert: true });
    }

    session.multipliers.push(value);

    // If 3 tiles scratched, finish game!
    if (session.revealed.length >= 3) {
      activeScratchCards.delete(targetUserId);
      const totalMult = session.multipliers.reduce((a, b) => a + b, 0);
      const payout = Math.floor(session.bet * totalMult);

      if (payout > 0) {
        userRepo.updateWallet(targetUserId, payout);
      }

      const xpRes = addXp(targetUserId, 30);
      const updatedWallet = userRepo.getUser(targetUserId)?.wallet || 0;
      const finishedKeyboard = buildScratchKeyboard(targetUserId, session.board, session.revealed, true);

      const winTitle = totalMult >= 3 ? '🎉 <b>MASSIVE SCRATCHCARD WIN!</b>' : '🎫 <b>SCRATCHCARD FINISHED!</b>';
      const summaryMsg = `${winTitle}\n\n` +
        `• Scratched Multipliers: ${session.multipliers.map(m => `<b>${m}x</b>`).join(' + ')} = <b>${totalMult}x</b>\n` +
        (payout > 0 ? `💰 <b>Total Payout:</b> +${formatCoins(payout)}\n` : `💸 <b>Lost:</b> ${formatCoins(session.bet)}\n`) +
        `👛 <b>New Wallet:</b> ${formatCoins(updatedWallet)}\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(summaryMsg, {
        parse_mode: 'HTML',
        reply_markup: finishedKeyboard
      });
      return ctx.answerCallbackQuery({ text: `Finished! ${totalMult}x multiplier!` });
    }

    // Continue scratching (scratched 1 or 2 tiles)
    const keyboard = buildScratchKeyboard(targetUserId, session.board, session.revealed);
    const scratchesLeft = 3 - session.revealed.length;

    const continueMsg = `🎫 <b>TeleMemer Lucky Scratchcard</b>\n` +
      `Ticket Cost: <b>${formatCoins(session.bet)}</b>\n\n` +
      `Revealed: ${session.multipliers.map(m => `<b>${m}x</b>`).join(', ')}\n` +
      `👉 <b>${scratchesLeft} scratch${scratchesLeft > 1 ? 'es' : ''} remaining!</b> Pick another box:`;

    await ctx.editMessageText(continueMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    return ctx.answerCallbackQuery({ text: `Scratched ${value}x!` });
  }
};

export default scratch;
