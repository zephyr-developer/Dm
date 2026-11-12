import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem, items } from '../../config/items.js';
import { formatCoins, randomBetween, sanitizeHtml } from '../../utils/formatters.js';

// In-memory active coin bomb drops: bombId -> { totalDrop, claimants: [{ userId, name, amount }] }
const activeCoinBombs = new Map();

export const use = {
  name: 'use',
  aliases: [],
  description: 'Use, consume, or deploy an item from your backpack',
  cooldown: 2,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const itemQuery = args.join(' ');

    if (!itemQuery) {
      return ctx.reply(
        `🎒 <b>Item Activation</b>\n` +
        `Usage: <code>/use &lt;item_id&gt;</code>\n\n` +
        `<b>Usable Items:</b>\n` +
        `• 📜 <code>banknote</code> - Expand bank vault space (+15k to +30k)\n` +
        `• 🔒 <code>padlock</code> - Protect wallet against 1 robbery attempt (24h)\n` +
        `• 💣 <code>landmine</code> - Trap wallet: 50% chance to kill robber (24h)\n` +
        `• 🏦 <code>vaultlock</code> - Protect bank vault against 1 heist attempt (24h)\n` +
        `• 🧲 <code>horseshoe</code> - +15% luck bonus on grinding (30m)\n` +
        `• 🍎 <code>apple</code> - Protect items from loss on death (24h)\n` +
        `• 💣 <code>coinbomb</code> - Drop 10k–50k coins in chat for first 3 clickers!`,
        { parse_mode: 'HTML' }
      );
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Could not find an item called "<b>${itemQuery}</b>".`, { parse_mode: 'HTML' });
    }

    if (!(await inventoryRepo.hasItem(userId, item.id, 1))) {
      return ctx.reply(`🎒 You do not have any ${item.emoji} <b>${item.name}</b> in your inventory!`, { parse_mode: 'HTML' });
    }

    // ==========================================
    // 1. BANK NOTE
    // ==========================================
    if (item.id === 'banknote') {
      await inventoryRepo.removeItem(userId, 'banknote', 1);
      const bonusSpace = randomBetween(15000, 30000);
      const updatedUser = await userRepo.increaseBankMax(userId, bonusSpace);

      return ctx.reply(
        `📜 <b>Bank Vault Expanded!</b>\n` +
        `You filed your official <b>Bank Note</b> with the meme federal reserve.\n\n` +
        `🏦 <b>Bank Capacity Added:</b> +${formatCoins(bonusSpace)}\n` +
        `🏛️ <b>New Bank Limit:</b> ${formatCoins(updatedUser.bank_max)}`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 2. PADLOCK
    // ==========================================
    if (item.id === 'padlock') {
      await inventoryRepo.removeItem(userId, 'padlock', 1);
      await inventoryRepo.setBuff(userId, 'padlock', 86400); // 24h

      return ctx.reply(
        `🔒 <b>Padlock Armed!</b>\n` +
        `You snapped a heavy brass padlock onto your wallet!\n` +
        `Your coins are shielded from the next <code>/rob</code> attempt for the next <b>24 hours</b> (or until breached).`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 3. LANDMINE
    // ==========================================
    if (item.id === 'landmine') {
      await inventoryRepo.removeItem(userId, 'landmine', 1);
      await inventoryRepo.setBuff(userId, 'landmine', 86400); // 24h

      return ctx.reply(
        `💣 <b>Landmine Primed!</b>\n` +
        `You rigged an explosive pressure plate inside your pocket lining!\n` +
        `If someone attempts to <code>/rob</code> you in the next <b>24 hours</b>, there is a <b>50% chance</b> it detonates and instantly kills them!`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 4. VAULT LOCK
    // ==========================================
    if (item.id === 'vaultlock') {
      await inventoryRepo.removeItem(userId, 'vaultlock', 1);
      const exact24hMs = Date.now() + 24 * 60 * 60 * 1000;
      await inventoryRepo.setBuff(userId, 'vaultlock', exact24hMs);

      return ctx.reply(
        `🏦 Your <b>Vault Lock</b> is active! Your bank is protected from the next heist for 24 hours, or until someone attempts to rob it (whichever comes first).`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 4. LUCKY HORSESHOE
    // ==========================================
    if (item.id === 'horseshoe') {
      await inventoryRepo.removeItem(userId, 'horseshoe', 1);
      await inventoryRepo.setBuff(userId, 'horseshoe', 1800); // 30 mins

      return ctx.reply(
        `🧲 <b>Lucky Horseshoe Activated!</b>\n` +
        `You rubbed the lucky magnetic horseshoe!\n` +
        `Enjoy <b>+15% luck bonus</b> on <code>/beg</code>, <code>/search</code>, <code>/crime</code>, <code>/dig</code>, <code>/hunt</code>, and <code>/fish</code> for the next <b>30 minutes</b>!`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 5. APPLE
    // ==========================================
    if (item.id === 'apple') {
      await inventoryRepo.removeItem(userId, 'apple', 1);
      await inventoryRepo.setBuff(userId, 'apple', 86400); // 24h

      return ctx.reply(
        `🍎 <b>Crisp Apple Consumed!</b>\n` +
        `An apple a day keeps death's greedy hands away!\n` +
        `For the next <b>24 hours</b>, if you die during any grinding or crime activity, your <b>inventory items are 100% protected</b> from loss! (You will only risk coins).`,
        { parse_mode: 'HTML' }
      );
    }

    // ==========================================
    // 6. COIN BOMB
    // ==========================================
    if (item.id === 'coinbomb') {
      if (ctx.chat.type === 'private') {
        return ctx.reply('💣 Coin Bombs can only be detonated inside a group chat for players to race for!');
      }

      await inventoryRepo.removeItem(userId, 'coinbomb', 1);
      const bombId = `bomb_${Date.now()}_${userId}`;
      const totalCoins = randomBetween(15000, 45000);

      activeCoinBombs.set(bombId, {
        creatorId: userId,
        creatorName: ctx.from.first_name,
        totalCoins,
        claimed: []
      });

      const keyboard = new InlineKeyboard()
        .text('💰 Grab Coins! (0/3)', `coinbomb_claim:${bombId}:shared`);

      const bombMsg = `💣 <b>COIN BOMB DETONATED!</b> 💣\n` +
        `<b>${sanitizeHtml(ctx.from.first_name)}</b> tossed a live <b>Coin Bomb</b> into the chat!\n\n` +
        `A shower of <b>${formatCoins(totalCoins)}</b> is falling! The first <b>3 people</b> to click the button grab a slice of the cash!`;

      return ctx.reply(bombMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    return ctx.reply(`ℹ️ ${item.emoji} <b>${item.name}</b> cannot be used directly. Check <code>/craft</code> or <code>/shop</code>!`, { parse_mode: 'HTML' });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[0];

    // Handle Coin Bomb communal button
    if (action === 'coinbomb_claim') {
      const bombId = parts[1];
      const clickerId = ctx.from.id;
      const clickerName = ctx.from.first_name || 'Player';

      const bomb = activeCoinBombs.get(bombId);
      if (!bomb) {
        return ctx.answerCallbackQuery({ text: 'This coin bomb has already expired or finished!', show_alert: true });
      }

      // Check if user already claimed
      const alreadyClaimed = bomb.claimed.some(c => c.userId === clickerId);
      if (alreadyClaimed) {
        return ctx.answerCallbackQuery({ text: 'You already snatched a bag of coins!', show_alert: true });
      }

      // Claim slice (divided among 3)
      const claimAmount = Math.floor(bomb.totalCoins / 3);
      await userRepo.getOrInitUser(clickerId, ctx.from.username, clickerName);
      await userRepo.updateCoins(clickerId, {
        walletDelta: claimAmount,
        sourceCommand: '/use coinbomb',
        details: `Snatched slice of Coin Bomb dropped by ${bomb.creatorName}`
      });

      bomb.claimed.push({
        userId: clickerId,
        name: clickerName,
        amount: claimAmount
      });

      const claimedCount = bomb.claimed.length;

      if (claimedCount < 3) {
        const keyboard = new InlineKeyboard()
          .text(`💰 Grab Coins! (${claimedCount}/3)`, `coinbomb_claim:${bombId}:shared`);

        await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
        return ctx.answerCallbackQuery({ text: `💰 Snatched +${formatCoins(claimAmount)}!`, show_alert: true });
      }

      // All 3 claimed! Finish bomb
      activeCoinBombs.delete(bombId);

      let summaryText = `💥 <b>COIN BOMB FULLY LOOTED!</b> 💥\n` +
        `Tossed by: <b>${sanitizeHtml(bomb.creatorName)}</b>\n\n` +
        `<b>Winners:</b>\n`;

      bomb.claimed.forEach((c, idx) => {
        summaryText += `${idx + 1}. <b>${sanitizeHtml(c.name)}</b> snatched <b>${formatCoins(c.amount)}</b>!\n`;
      });

      await ctx.editMessageText(summaryText, { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: `💰 Snatched the last bag (+${formatCoins(claimAmount)})!`, show_alert: true });
    }
  }
};

export default use;
