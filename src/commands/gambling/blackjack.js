import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, parseBet } from '../../utils/formatters.js';

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const VALUES = [
  { val: '2', score: 2 },
  { val: '3', score: 3 },
  { val: '4', score: 4 },
  { val: '5', score: 5 },
  { val: '6', score: 6 },
  { val: '7', score: 7 },
  { val: '8', score: 8 },
  { val: '9', score: 9 },
  { val: '10', score: 10 },
  { val: 'J', score: 10 },
  { val: 'Q', score: 10 },
  { val: 'K', score: 10 },
  { val: 'A', score: 11 }
];

function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const v of VALUES) {
      deck.push({ suit: s, val: v.val, score: v.score });
    }
  }
  return deck.sort(() => 0.5 - Math.random());
}

function calculateHand(cards) {
  let score = 0;
  let aces = 0;

  for (const c of cards) {
    score += c.score;
    if (c.val === 'A') aces++;
  }

  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }

  return score;
}

function renderHand(cards, hideFirst = false) {
  if (hideFirst) {
    return `[🂠] ${cards.slice(1).map(c => `[${c.val}${c.suit}]`).join(' ')}`;
  }
  return cards.map(c => `[${c.val}${c.suit}]`).join(' ');
}

// In-memory active games: userId -> GameState
const activeGames = new Map();

export const blackjack = {
  name: 'blackjack',
  aliases: ['bj'],
  description: 'Play a full game of soft-17 Blackjack with Double Down (No Bet Limits)',
  cooldown: 15, // 8s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (activeGames.has(userId)) {
      return ctx.reply('🃏 You already have an active Blackjack hand! Finish it with the buttons on your game table.');
    }

    const betStr = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1)[0];

    if (!betStr) {
      return ctx.reply(
        `🃏 <b>Blackjack (21)</b>\n` +
        `Usage: <code>/bj &lt;bet|half|all&gt;</code> (Supports shorthand: 50k, 10m, 5b)\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    const { valid, error, bet } = parseBet(betStr, user.wallet);
    if (!valid) {
      if (error === 'INSUFFICIENT_FUNDS' || error === 'NO_COINS') {
        return ctx.reply(`❌ You don't have enough coins in your wallet! You only have 🪙 ${Number(user.wallet || 0).toLocaleString()}.`);
      }
      return ctx.reply('❌ Please enter a valid positive number for your bet.');
    }

    if (bet <= 0) {
      return ctx.reply('❌ Bet must be at least 🪙 1.');
    }

    // Deduct bet immediately
    const afterBetUser = await userRepo.updateCoins(userId, {
      walletDelta: -bet,
      sourceCommand: '/blackjack',
      details: `Blackjack Bet: 🪙 ${bet.toLocaleString()}`
    });

    const luckInfo = await getLuckBreakdown(userId);
    const deck = createDeck();
    const playerCards = [deck.pop(), deck.pop()];
    const dealerCards = [deck.pop(), deck.pop()];

    // If high custom luck (> 50), bias initial hand towards 21
    if (luckInfo.totalBonus >= 50 && Math.random() < 0.40) {
      playerCards[0] = { suit: '♠️', val: 'A', score: 11 };
      playerCards[1] = { suit: '👑', val: 'K', score: 10 };
    }

    const playerScore = calculateHand(playerCards);

    // Check Natural Blackjack (21 on 2 cards)
    if (playerScore === 21) {
      const payout = Math.floor(bet * 2.5);
      const afterWinUser = await userRepo.updateCoins(userId, {
        walletDelta: payout,
        sourceCommand: '/blackjack',
        details: 'Natural Blackjack 3:2 Payout'
      });

      const winMsg = `🃏 <b>BLACKJACK! NATURAL 21!</b> 🎉\n\n` +
        `👤 <b>Your Hand:</b> ${renderHand(playerCards)} (Score: <b>21</b>)\n` +
        `🤖 <b>Dealer Hand:</b> ${renderHand(dealerCards)} (Score: <b>${calculateHand(dealerCards)}</b>)\n\n` +
        `💰 <b>Payout (3:2):</b> +${formatCoins(payout)}!\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(afterWinUser.wallet)}`;

      return ctx.reply(winMsg, { parse_mode: 'HTML' });
    }

    // Store game state
    const gameState = {
      userId,
      bet,
      deck,
      playerCards,
      dealerCards
    };
    activeGames.set(userId, gameState);

    const keyboard = new InlineKeyboard()
      .text('🃏 Hit', `blackjack:hit:${userId}`)
      .text('🛑 Stand', `blackjack:stand:${userId}`);

    // Allow double down if player has enough wallet
    if (afterBetUser.wallet >= bet) {
      keyboard.text('💰 Double Down', `blackjack:double:${userId}`);
    }

    const tableMsg = `🃏 <b>Blackjack Table</b> (Bet: ${formatCoins(bet)})\n\n` +
      `👤 <b>Your Hand:</b> ${renderHand(playerCards)} (Score: <b>${playerScore}</b>)\n` +
      `🤖 <b>Dealer Hand:</b> ${renderHand(dealerCards, true)} (Score: <b>?</b>)\n\n` +
      `<i>What is your move?</i>`;

    await ctx.reply(tableMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);

    const game = activeGames.get(targetUserId);
    if (!game) {
      return ctx.answerCallbackQuery({ text: 'This Blackjack game has ended.', show_alert: true });
    }

    const user = await userRepo.getUser(targetUserId);
    const luckInfo = await getLuckBreakdown(targetUserId);

    // ==========================================
    // ACTION 1: HIT
    // ==========================================
    if (action === 'hit') {
      let drawnCard = game.deck.pop();

      // If high luck and current score <= 11, try to pull a high card
      const currentScore = calculateHand(game.playerCards);
      if (luckInfo.totalBonus >= 50 && currentScore <= 11 && Math.random() < 0.60) {
        drawnCard = { suit: '💎', val: '10', score: 10 };
      }

      game.playerCards.push(drawnCard);
      const score = calculateHand(game.playerCards);

      // BUST!
      if (score > 21) {
        activeGames.delete(targetUserId);
        const bustMsg = `💥 <b>BUSTED! (Score: ${score})</b>\n\n` +
          `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)}\n` +
          `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards)} (Score: <b>${calculateHand(game.dealerCards)}</b>)\n\n` +
          `💸 You lost your bet of <b>${formatCoins(game.bet)}</b>.\n` +
          `👛 <b>Wallet:</b> ${formatCoins(user ? user.wallet : 0)}`;

        await ctx.editMessageText(bustMsg, { parse_mode: 'HTML' });
        return ctx.answerCallbackQuery({ text: 'Busted!' });
      }

      // Re-render table
      const keyboard = new InlineKeyboard()
        .text('🃏 Hit', `blackjack:hit:${targetUserId}`)
        .text('🛑 Stand', `blackjack:stand:${targetUserId}`);

      const updatedMsg = `🃏 <b>Blackjack Table</b> (Bet: ${formatCoins(game.bet)})\n\n` +
        `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)} (Score: <b>${score}</b>)\n` +
        `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards, true)} (Score: <b>?</b>)\n\n` +
        `<i>What is your move?</i>`;

      await ctx.editMessageText(updatedMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return ctx.answerCallbackQuery();
    }

    // ==========================================
    // ACTION 2: DOUBLE DOWN
    // ==========================================
    if (action === 'double') {
      const currentWallet = Number(user?.wallet || 0);
      if (currentWallet < game.bet) {
        return ctx.answerCallbackQuery({
          text: `❌ Not enough coins in your wallet to Double Down! (Need: 🪙 ${game.bet.toLocaleString()})`,
          show_alert: true
        });
      }

      await userRepo.updateCoins(targetUserId, {
        walletDelta: -game.bet,
        sourceCommand: '/blackjack',
        details: `Blackjack Double Down (+🪙 ${game.bet.toLocaleString()})`
      });
      game.bet *= 2;

      let doubleCard = game.deck.pop();
      const currentScore = calculateHand(game.playerCards);
      if (luckInfo.totalBonus >= 50 && currentScore <= 11 && Math.random() < 0.70) {
        doubleCard = { suit: '👑', val: '10', score: 10 };
      }

      game.playerCards.push(doubleCard);

      const score = calculateHand(game.playerCards);
      if (score > 21) {
        activeGames.delete(targetUserId);
        const updatedUser = await userRepo.getUser(targetUserId);
        const bustMsg = `💥 <b>BUSTED ON DOUBLE DOWN! (Score: ${score})</b>\n\n` +
          `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)}\n` +
          `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards)} (Score: <b>${calculateHand(game.dealerCards)}</b>)\n\n` +
          `💸 You lost your doubled bet of <b>${formatCoins(game.bet)}</b>.\n` +
          `👛 <b>Wallet:</b> ${formatCoins(updatedUser?.wallet || 0)}`;

        await ctx.editMessageText(bustMsg, { parse_mode: 'HTML' });
        return ctx.answerCallbackQuery({ text: 'Busted on Double Down!' });
      }

      return resolveDealerTurn(ctx, game, targetUserId);
    }

    // ==========================================
    // ACTION 3: STAND
    // ==========================================
    if (action === 'stand') {
      return resolveDealerTurn(ctx, game, targetUserId);
    }
  }
};

async function resolveDealerTurn(ctx, game, targetUserId) {
  activeGames.delete(targetUserId);

  const luckInfo = await getLuckBreakdown(targetUserId);
  const playerScore = calculateHand(game.playerCards);
  let dealerScore = calculateHand(game.dealerCards);

  // Dealer hits on soft 17
  while (dealerScore < 17) {
    let nextCard = game.deck.pop();
    // High luck makes dealer more likely to bust if dealer is at 12-16
    if (luckInfo.totalBonus >= 50 && dealerScore >= 12 && Math.random() < 0.50) {
      nextCard = { suit: '♠️', val: '10', score: 10 };
    }
    game.dealerCards.push(nextCard);
    dealerScore = calculateHand(game.dealerCards);
  }

  let outcomeTitle = '';
  let payout = 0;
  let logDetail = '';

  if (dealerScore > 21) {
    outcomeTitle = '🎉 <b>DEALER BUSTED! YOU WIN!</b>';
    payout = game.bet * 2;
    logDetail = 'Won Blackjack (Dealer Bust)';
    await userRepo.updateCoins(targetUserId, {
      walletDelta: payout,
      sourceCommand: '/blackjack',
      details: logDetail
    });
  } else if (playerScore > dealerScore) {
    outcomeTitle = '🎉 <b>YOU WIN!</b>';
    payout = game.bet * 2;
    logDetail = `Won Blackjack (${playerScore} vs ${dealerScore})`;
    await userRepo.updateCoins(targetUserId, {
      walletDelta: payout,
      sourceCommand: '/blackjack',
      details: logDetail
    });
  } else if (playerScore === dealerScore) {
    outcomeTitle = '🤝 <b>PUSH! (TIE)</b>';
    payout = game.bet;
    logDetail = 'Blackjack Push (Tie) Refund';
    await userRepo.updateCoins(targetUserId, {
      walletDelta: payout,
      sourceCommand: '/blackjack',
      details: logDetail
    });
  } else {
    outcomeTitle = '💀 <b>DEALER WINS!</b>';
    payout = 0;
  }

  const updatedUser = await userRepo.getUser(targetUserId);
  const updatedWallet = updatedUser?.wallet || 0;

  const finalMsg = `${outcomeTitle}\n\n` +
    `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)} (Score: <b>${playerScore}</b>)\n` +
    `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards)} (Score: <b>${dealerScore}</b>)\n\n` +
    (payout > 0 ? `💰 <b>Payout:</b> +${formatCoins(payout)}\n` : `💸 Lost bet of <b>${formatCoins(game.bet)}</b>\n`) +
    `👛 <b>Wallet:</b> ${formatCoins(updatedWallet)}`;

  await ctx.editMessageText(finalMsg, { parse_mode: 'HTML' });
  await ctx.answerCallbackQuery({ text: 'Hand resolved!' });
}

export default blackjack;
