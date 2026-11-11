import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { formatCoins } from '../../utils/formatters.js';

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
  for (const suit of SUITS) {
    for (const v of VALUES) {
      deck.push({ suit, val: v.val, score: v.score });
    }
  }
  return deck.sort(() => 0.5 - Math.random());
}

function calculateHand(cards) {
  let total = 0;
  let aceCount = 0;

  for (const c of cards) {
    total += c.score;
    if (c.val === 'A') aceCount++;
  }

  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount--;
  }

  return total;
}

function renderHand(cards, hideFirst = false) {
  if (hideFirst) {
    return `🂠  ${cards.slice(1).map(c => `[${c.suit} ${c.val}]`).join(' ')}`;
  }
  return cards.map(c => `[${c.suit} ${c.val}]`).join(' ');
}

// In-memory active games: userId -> game state
const activeGames = new Map();

export const blackjack = {
  name: 'blackjack',
  aliases: ['bj'],
  description: 'Play a game of soft-17 Blackjack against the dealer',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (activeGames.has(userId)) {
      return ctx.reply('🃏 You already have an ongoing Blackjack hand! Finish that hand first.');
    }

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const betInput = args[0]?.toLowerCase();

    if (!betInput) {
      return ctx.reply(
        `🃏 <b>Blackjack (21)</b>\n` +
        `Usage: <code>/bj &lt;bet&gt;</code> or <code>/bj all</code> (Max bet: 🪙 100,000)\n\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(user.wallet)}`,
        { parse_mode: 'HTML' }
      );
    }

    let bet = 0;
    if (betInput === 'all' || betInput === 'max') {
      bet = Math.min(100000, user.wallet);
    } else {
      const parsed = parseInt(betInput.replace(/[,kKmM]/g, ''), 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please enter a valid positive number for your bet.');
      }
      bet = parsed;
    }

    if (bet < 100) {
      return ctx.reply('❌ Minimum bet for Blackjack is 🪙 100.');
    }
    if (bet > 100000) {
      return ctx.reply('❌ Maximum bet for Blackjack is 🪙 100,000.');
    }
    if (user.wallet < bet) {
      return ctx.reply(`💸 You do not have enough coins in your wallet! (Wallet: ${formatCoins(user.wallet)})`);
    }

    // Deduct bet immediately
    userRepo.updateWallet(userId, -bet);

    const deck = createDeck();
    const playerCards = [deck.pop(), deck.pop()];
    const dealerCards = [deck.pop(), deck.pop()];

    const playerScore = calculateHand(playerCards);

    // Check Natural Blackjack (21 on 2 cards)
    if (playerScore === 21) {
      const payout = Math.floor(bet * 2.5);
      userRepo.updateWallet(userId, payout);

      const winMsg = `🃏 <b>BLACKJACK! NATURAL 21!</b> 🎉\n\n` +
        `👤 <b>Your Hand:</b> ${renderHand(playerCards)} (Score: <b>21</b>)\n` +
        `🤖 <b>Dealer Hand:</b> ${renderHand(dealerCards)} (Score: <b>${calculateHand(dealerCards)}</b>)\n\n` +
        `💰 <b>Payout (3:2):</b> +${formatCoins(payout)}!\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(user.wallet - bet + payout)}`;

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
    if (user.wallet - bet >= bet) {
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

    const user = userRepo.getUser(targetUserId);

    // ==========================================
    // ACTION 1: HIT
    // ==========================================
    if (action === 'hit') {
      game.playerCards.push(game.deck.pop());
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
      if (user.wallet < game.bet) {
        return ctx.answerCallbackQuery({ text: 'Not enough coins to Double Down!', show_alert: true });
      }

      userRepo.updateWallet(targetUserId, -game.bet);
      game.bet *= 2;
      game.playerCards.push(game.deck.pop());

      const score = calculateHand(game.playerCards);
      if (score > 21) {
        activeGames.delete(targetUserId);
        const bustMsg = `💥 <b>BUSTED ON DOUBLE DOWN! (Score: ${score})</b>\n\n` +
          `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)}\n` +
          `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards)} (Score: <b>${calculateHand(game.dealerCards)}</b>)\n\n` +
          `💸 You lost your doubled bet of <b>${formatCoins(game.bet)}</b>.\n` +
          `👛 <b>Wallet:</b> ${formatCoins(user.wallet - (game.bet / 2))}`;

        await ctx.editMessageText(bustMsg, { parse_mode: 'HTML' });
        return ctx.answerCallbackQuery({ text: 'Busted on Double Down!' });
      }

      // Automatically stand after receiving exactly 1 card
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

  const playerScore = calculateHand(game.playerCards);
  let dealerScore = calculateHand(game.dealerCards);

  // Dealer hits on soft 17: hits while dealerScore < 17
  while (dealerScore < 17) {
    game.dealerCards.push(game.deck.pop());
    dealerScore = calculateHand(game.dealerCards);
  }

  let outcomeTitle = '';
  let payout = 0;
  const user = userRepo.getUser(targetUserId);

  if (dealerScore > 21) {
    outcomeTitle = '🎉 <b>DEALER BUSTED! YOU WIN!</b>';
    payout = game.bet * 2;
    userRepo.updateWallet(targetUserId, payout);
  } else if (playerScore > dealerScore) {
    outcomeTitle = '🎉 <b>YOU WIN!</b>';
    payout = game.bet * 2;
    userRepo.updateWallet(targetUserId, payout);
  } else if (playerScore === dealerScore) {
    outcomeTitle = '🤝 <b>PUSH! (TIE)</b>';
    payout = game.bet;
    userRepo.updateWallet(targetUserId, payout);
  } else {
    outcomeTitle = '💀 <b>DEALER WINS!</b>';
    payout = 0;
  }

  const updatedWallet = userRepo.getUser(targetUserId)?.wallet || 0;

  const finalMsg = `${outcomeTitle}\n\n` +
    `👤 <b>Your Hand:</b> ${renderHand(game.playerCards)} (Score: <b>${playerScore}</b>)\n` +
    `🤖 <b>Dealer Hand:</b> ${renderHand(game.dealerCards)} (Score: <b>${dealerScore}</b>)\n\n` +
    (payout > 0 ? `💰 <b>Payout:</b> +${formatCoins(payout)}\n` : `💸 Lost bet of <b>${formatCoins(game.bet)}</b>\n`) +
    `👛 <b>Wallet:</b> ${formatCoins(updatedWallet)}`;

  await ctx.editMessageText(finalMsg, { parse_mode: 'HTML' });
  await ctx.answerCallbackQuery({ text: 'Hand resolved!' });
}

export default blackjack;
