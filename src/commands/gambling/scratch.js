import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, parseBet } from '../../utils/formatters.js';

const MAX_GAMBLE_BET = 100_000_000;
const MAX_STANDARD_MULTIPLIER = 5;

// Weighted casino probability table (Total = 100%, House Edge ~25.6%)
const SCRATCH_WEIGHTS = [
  { value: 0, weight: 45, label: '💨 0x' },
  { value: 0.25, weight: 25, label: '🪙 0.25x' },
  { value: 0.5, weight: 14, label: '💰 0.5x' },
  { value: 1.0, weight: 8, label: '💵 1x' },
  { value: 2.0, weight: 2, label: '💎 2x' },
  { value: 5.0, weight: 0.5, label: '👑 5x' },
  { value: 'SKULL', weight: 5.5, label: '💀 BUST' }
];

function rollWeightedTile(isGodLuck = false) {
  if (isGodLuck) {
    // @tzhunyuan with custom_luck >= 100: bomb-free high-roller board
    const godPool = [1.0, 2.0, 5.0, 10.0];
    return godPool[Math.floor(Math.random() * godPool.length)];
  }

  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const entry of SCRATCH_WEIGHTS) {
    cumulative += entry.weight;
    if (roll < cumulative) {
      return entry.value;
    }
  }
  return 0;
}

function generateWeightedBoard(isGodLuck = false) {
  const board = [];
  for (let i = 0; i < 9; i++) {
    board.push(rollWeightedTile(isGodLuck));
  }
  return board;
}

function formatTileLabel(val) {
  if (val === 'SKULL') return '💀 BUST';
  const match = SCRATCH_WEIGHTS.find(w => w.value === val);
  if (match) return match.label;
  return `${val}x`;
}

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
        label = formatTileLabel(val);
      }

      if (isFinished) {
        keyboard.text(label, `scratch:done:${userId}`);
      } else if (revealedIndices.includes(idx)) {
        keyboard.text(label, `scratch:noop:${userId}`);
      } else {
        keyboard.text(label, `scratch:click:${idx}:${userId}`);
      }
    }
    keyboard.row();
  }

  keyboard.text('⚠️', 'gamble:warning');
  return keyboard;
}

export const scratch = {
  name: 'scratch',
  aliases: [],
  description: 'Scratch 3 mystery multiplier tiles on a 3x3 scratchcard ticket (Max Bet: 100M)',
  cooldown: 15,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (activeScratchCards.has(userId)) {
      return ctx.reply('🎫 You already have an active scratchcard ticket! Finish scratching it first.');
    }

    const betStr = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1)[0];

    if (!betStr) {
      return ctx.reply(
        `🎫 <b>Scratchcard Lottery</b>\n` +
        `Usage: <code>/scratch &lt;bet|half|all&gt;</code> (Max Bet: 🪙 100,000,000)\n\n` +
        `Pick 3 mystery tiles on the 3x3 grid! Watch out for the 💀 Bomb — hitting it forfeits your card.\n` +
        `Max payout multiplier: <b>5x</b>\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    const { valid, error, bet: parsedBet } = parseBet(betStr, user.wallet);
    if (!valid) {
      if (error === 'INSUFFICIENT_FUNDS' || error === 'NO_COINS') {
        return ctx.reply(`❌ You don't have enough coins in your wallet! You only have 🪙 ${Number(user.wallet || 0).toLocaleString()}.`);
      }
      return ctx.reply('❌ Please enter a valid positive number for your scratchcard bet.');
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
      sourceCommand: '/scratch',
      details: `Scratchcard Bet: 🪙 ${bet.toLocaleString()}`
    });

    const luckInfo = await getLuckBreakdown(userId);
    const isGodLuck = (user?.username || '').toLowerCase() === 'tzhunyuan' && luckInfo.customLuck >= 100;
    const board = generateWeightedBoard(isGodLuck);

    const session = {
      userId,
      bet,
      wasClamped,
      isGodLuck,
      board,
      revealed: [],
      multipliers: []
    };
    activeScratchCards.set(userId, session);

    const keyboard = buildScratchKeyboard(userId, board, []);

    const clampNotice = wasClamped ? `\n⚠️ <i>(Table limit applied: 🪙 100,000,000 max bet)</i>` : '';
    const prompt = `🎫 <b>TeleMemer Lucky Scratchcard</b>\n` +
      `Ticket Cost: <b>${formatCoins(bet)}</b>${clampNotice}\n` +
      (luckInfo.totalBonus > 0 ? `🍀 <i>Luck Active: +${luckInfo.totalBonus}%</i>\n\n` : '\n') +
      `Scratch <b>3 tiles</b> below by clicking the ❓ boxes. Beware the 💀 Bomb!`;

    return ctx.reply(prompt, {
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

    // Hit 💀 Bomb: ends game immediately & forfeits remaining scratches/winnings
    if (value === 'SKULL') {
      activeScratchCards.delete(targetUserId);
      const finishedKeyboard = buildScratchKeyboard(targetUserId, session.board, session.revealed, true);
      const updatedUser = await userRepo.getUser(targetUserId);
      const updatedWallet = updatedUser?.wallet || 0;

      const bustMsg = `💀 <b>BOOM! YOU HIT THE BOMB!</b>\n\n` +
        `The cursed bomb detonated and forfeited your remaining scratches & winnings!\n` +
        `💸 <b>Lost:</b> ${formatCoins(session.bet)}\n` +
        `👛 <b>Wallet:</b> ${formatCoins(updatedWallet)}`;

      await ctx.editMessageText(bustMsg, {
        parse_mode: 'HTML',
        reply_markup: finishedKeyboard
      });
      return ctx.answerCallbackQuery({ text: '💀 BUST! Hit the bomb!', show_alert: true });
    }

    session.multipliers.push(value);

    // If 3 tiles scratched, finish game!
    if (session.revealed.length >= 3) {
      activeScratchCards.delete(targetUserId);
      const rawTotalMult = Number(session.multipliers.reduce((a, b) => a + b, 0).toFixed(2));
      const wasMultCapped = !session.isGodLuck && rawTotalMult > MAX_STANDARD_MULTIPLIER;
      const totalMult = wasMultCapped ? MAX_STANDARD_MULTIPLIER : rawTotalMult;
      const payout = Math.floor(session.bet * totalMult);

      if (payout > 0) {
        await userRepo.updateCoins(targetUserId, {
          walletDelta: payout,
          sourceCommand: '/scratch',
          details: `Scratchcard Payout (${totalMult}x Multiplier)`
        });
      }

      const xpRes = await addXp(targetUserId, 30);
      const updatedUser = await userRepo.getUser(targetUserId);
      const updatedWallet = updatedUser?.wallet || 0;
      const finishedKeyboard = buildScratchKeyboard(targetUserId, session.board, session.revealed, true);

      const winTitle = totalMult >= 2 ? '🎉 <b>BIG SCRATCHCARD WIN!</b>' : '🎫 <b>SCRATCHCARD FINISHED!</b>';
      const capTag = wasMultCapped ? ` <i>(Capped at ${MAX_STANDARD_MULTIPLIER}x max)</i>` : '';
      const netProfit = payout - session.bet;
      const netText = netProfit >= 0
        ? `📈 <b>Net Profit:</b> +${formatCoins(netProfit)}`
        : `📉 <b>Net Loss:</b> -${formatCoins(Math.abs(netProfit))}`;

      const summaryMsg = `${winTitle}\n\n` +
        `• Scratched Multipliers: ${session.multipliers.map(m => `<b>${m}x</b>`).join(' + ')} = <b>${totalMult}x</b>${capTag}\n` +
        (payout > 0 ? `💰 <b>Total Payout:</b> +${formatCoins(payout)}\n` : `💸 <b>Lost:</b> ${formatCoins(session.bet)}\n`) +
        `${netText}\n` +
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
