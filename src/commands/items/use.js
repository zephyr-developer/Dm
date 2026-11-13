import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem, getItem } from '../../config/items.js';
import { formatCoins, formatTime, randomBetween, sanitizeHtml } from '../../utils/formatters.js';

// In-memory active coin bomb drops: bombId -> { creatorId, creatorName, totalCoins, claimed: [] }
const activeCoinBombs = new Map();

const USABLE_ITEM_IDS = new Set([
  'banknote',
  'padlock',
  'landmine',
  'vaultlock',
  'horseshoe',
  'apple',
  'coinbomb'
]);

export const use = {
  name: 'use',
  aliases: [],
  description: 'Use, consume, or deploy items from your backpack in single or bulk amounts with confirmation',
  cooldown: 2,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    let rawInput = (ctx.match || '').trim();
    if (!rawInput && ctx.message?.text) {
      rawInput = ctx.message.text.trim().split(/\s+/).slice(1).join(' ').trim();
    }

    if (!rawInput) {
      return ctx.reply(
        `🎒 <b>Item Activation</b>\n` +
        `Usage: <code>/use &lt;item&gt; [quantity]</code>\n` +
        `Examples: <code>/use banknote 100</code>, <code>/use banknote all</code>, <code>/use vaultlock 3</code>\n\n` +
        `<b>Usable Items:</b>\n` +
        `• 📜 <code>banknote</code> - Expand bank vault space (+15k to +30k per note)\n` +
        `• 🔒 <code>padlock</code> - Protect wallet against 1 robbery attempt (24h per lock)\n` +
        `• 💣 <code>landmine</code> - Trap wallet: 50% chance to kill robber (24h per mine)\n` +
        `• 🏦 <code>vaultlock</code> - Protect bank vault against 1 heist attempt (24h per lock)\n` +
        `• 🧲 <code>horseshoe</code> - +15% luck bonus on grinding (30m per horseshoe)\n` +
        `• 🍎 <code>apple</code> - Protect items from loss on death (24h per apple)\n` +
        `• 💣 <code>coinbomb</code> - Drop 10k–50k coins in chat for first 3 clickers!`,
        { parse_mode: 'HTML' }
      );
    }

    const words = rawInput.split(/\s+/);
    let quantityStr = null;
    let itemQuery = '';

    const lastWord = words[words.length - 1].toLowerCase();
    const firstWord = words[0].toLowerCase();

    if (words.length > 1 && (/^\d+$/.test(lastWord) || lastWord === 'all' || lastWord === 'max')) {
      quantityStr = lastWord;
      itemQuery = words.slice(0, -1).join(' ');
    } else if (words.length > 1 && (/^\d+$/.test(firstWord) || firstWord === 'all' || firstWord === 'max')) {
      quantityStr = firstWord;
      itemQuery = words.slice(1).join(' ');
    } else {
      itemQuery = words.join(' ');
    }

    const item = findItem(itemQuery);
    if (!item) {
      return ctx.reply(`❌ Could not find an item called "<b>${sanitizeHtml(itemQuery)}</b>".`, { parse_mode: 'HTML' });
    }

    if (!USABLE_ITEM_IDS.has(item.id)) {
      return ctx.reply(`ℹ️ ${item.emoji} <b>${item.name}</b> cannot be used directly. Check <code>/craft</code> or <code>/shop</code>!`, { parse_mode: 'HTML' });
    }

    const owned = await inventoryRepo.getItem(userId, item.id);
    if (owned <= 0) {
      return ctx.reply("❌ You don't own any of this item.", { parse_mode: 'HTML' });
    }

    let quantity = 1;
    if (quantityStr === 'all' || quantityStr === 'max') {
      quantity = owned;
    } else if (quantityStr) {
      const parsed = parseInt(quantityStr, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('❌ Please provide a valid positive quantity to use.', { parse_mode: 'HTML' });
      }
      quantity = parsed;
    }

    if (quantity > owned) {
      return ctx.reply(`❌ You only have ${owned}x ${item.name}.`, { parse_mode: 'HTML' });
    }

    if (item.id === 'coinbomb') {
      if (quantity > 1) {
        return ctx.reply(
          `❌ You can only use <b>1x Coin Bomb</b> at a time to prevent chat chaos!`,
          { parse_mode: 'HTML' }
        );
      }
      if (ctx.chat.type === 'private') {
        return ctx.reply('💣 Coin Bombs can only be detonated inside a group chat for players to race for!');
      }
    }

    // Send confirmation prompt (NO deduction yet) — Cancel left, Confirm right
    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `use:no:${userId}`)
      .text('✅ Confirm', `use:yes:${item.id}:${quantity}:${userId}`);

    return ctx.reply(
      `🎒 <b>Confirm Item Usage</b>\n\n` +
      `• <b>Item:</b> ${quantity.toLocaleString('en-US')}x ${item.emoji} <b>${item.name}</b>\n` +
      `• <b>Effect:</b> <i>${item.description}</i>\n` +
      `• <b>Owned:</b> ${owned.toLocaleString('en-US')}x\n\n` +
      `<i>Are you sure you want to consume this item?</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const prefix = parts[0];
    const subAction = parts[1];

    // 1. Handle Coin Bomb communal button
    if (prefix === 'coinbomb_claim' || (prefix === 'use' && subAction === 'bomb')) {
      const bombId = prefix === 'coinbomb_claim' ? parts[1] : parts[2];
      const clickerId = ctx.from.id;
      const clickerName = ctx.from.first_name || 'Player';

      const bomb = activeCoinBombs.get(bombId);
      if (!bomb) {
        return ctx.answerCallbackQuery({ text: 'This coin bomb has already expired or finished!', show_alert: true });
      }

      const alreadyClaimed = bomb.claimed.some(c => c.userId === clickerId);
      if (alreadyClaimed) {
        return ctx.answerCallbackQuery({ text: 'You already snatched a bag of coins!', show_alert: true });
      }

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
          .text(`💰 Grab Coins! (${claimedCount}/3)`, `use:bomb:${bombId}:shared`);

        await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
        return ctx.answerCallbackQuery({ text: `💰 Snatched +${formatCoins(claimAmount)}!`, show_alert: true });
      }

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

    // 2. Confirmation callbacks (use:yes:<item_id>:<qty>:<uid> / use:no:<uid>)
    const targetUserId = Number(parts[parts.length - 1]);
    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your transaction!",
        show_alert: true
      });
    }

    if (subAction === 'no') {
      await ctx.answerCallbackQuery({ text: 'Item usage cancelled.' });
      return ctx.editMessageText('❌ Transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (subAction === 'yes') {
      const itemId = parts[2];
      const quantity = parseInt(parts[3], 10);
      const item = getItem(itemId);

      if (!item || !USABLE_ITEM_IDS.has(item.id) || isNaN(quantity) || quantity <= 0) {
        await ctx.answerCallbackQuery({ text: 'Invalid item usage.', show_alert: true });
        return ctx.editMessageText('❌ Transaction failed: Invalid item or quantity.').catch(() => {});
      }

      const owned = await inventoryRepo.getItem(targetUserId, item.id);
      if (owned < quantity) {
        await ctx.answerCallbackQuery({ text: `You only own ${owned}x ${item.name}!`, show_alert: true });
        return ctx.editMessageText(
          `❌ <b>Action Failed:</b> You only have <b>${owned}x</b> ${item.emoji} <b>${item.name}</b> left.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 1. BANK NOTE
      if (item.id === 'banknote') {
        let totalAdded = 0;
        for (let i = 0; i < quantity; i++) {
          totalAdded += randomBetween(15000, 30000);
        }

        await inventoryRepo.removeItem(targetUserId, 'banknote', quantity);
        const updatedUser = await userRepo.increaseBankMax(targetUserId, totalAdded);

        await ctx.answerCallbackQuery({ text: `Expanded bank by 🪙 ${totalAdded.toLocaleString()}!` });
        return ctx.editMessageText(
          `📜 You used <b>${quantity.toLocaleString('en-US')}x Bank Note</b> and expanded your bank capacity by <b>🪙 ${totalAdded.toLocaleString('en-US')}</b>!\n` +
          `🏛️ <b>New Bank Limit:</b> ${formatCoins(updatedUser.bank_max)}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 2. COIN BOMB
      if (item.id === 'coinbomb') {
        if (ctx.chat?.type === 'private') {
          await ctx.answerCallbackQuery({ text: 'Group chat only!', show_alert: true });
          return ctx.editMessageText('💣 Coin Bombs can only be detonated inside a group chat!').catch(() => {});
        }

        await inventoryRepo.removeItem(targetUserId, 'coinbomb', 1);
        const bombId = `b_${Date.now()}_${targetUserId}`;
        const totalCoins = randomBetween(15000, 45000);

        activeCoinBombs.set(bombId, {
          creatorId: targetUserId,
          creatorName: ctx.from.first_name || 'Player',
          totalCoins,
          claimed: []
        });

        const keyboard = new InlineKeyboard()
          .text('💰 Grab Coins! (0/3)', `use:bomb:${bombId}:shared`);

        await ctx.answerCallbackQuery({ text: '💣 Coin Bomb Detonated!' });
        return ctx.editMessageText(
          `💣 <b>COIN BOMB DETONATED!</b> 💣\n` +
          `<b>${sanitizeHtml(ctx.from.first_name)}</b> tossed a live <b>Coin Bomb</b> into the chat!\n\n` +
          `A shower of <b>${formatCoins(totalCoins)}</b> is falling! The first <b>3 people</b> to click the button grab a slice of the cash!`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboard
          }
        ).catch(() => {});
      }

      // 3. VAULT LOCK
      if (item.id === 'vaultlock') {
        await inventoryRepo.removeItem(targetUserId, 'vaultlock', quantity);
        const addedSeconds = 86400 * quantity;
        const existingRemaining = await inventoryRepo.getBuffRemaining(targetUserId, 'vaultlock');
        const newRemaining = (existingRemaining > 0 ? existingRemaining : 0) + addedSeconds;
        await inventoryRepo.setBuff(targetUserId, 'vaultlock', newRemaining);

        await ctx.answerCallbackQuery({ text: '🏦 Vault Lock activated!' });
        return ctx.editMessageText(
          `🏦 Your <b>Vault Lock</b> is active! Your bank is protected from the next heist for <b>${formatTime(newRemaining)}</b>, or until someone attempts to rob it (whichever comes first).`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 4. PADLOCK
      if (item.id === 'padlock') {
        await inventoryRepo.removeItem(targetUserId, 'padlock', quantity);
        const addedSeconds = 86400 * quantity;
        const existingRemaining = await inventoryRepo.getBuffRemaining(targetUserId, 'padlock');
        const newRemaining = (existingRemaining > 0 ? existingRemaining : 0) + addedSeconds;
        await inventoryRepo.setBuff(targetUserId, 'padlock', newRemaining);

        await ctx.answerCallbackQuery({ text: '🔒 Padlock armed!' });
        return ctx.editMessageText(
          `🔒 <b>Padlock Armed!</b>\n` +
          `You snapped ${quantity > 1 ? `<b>${quantity}x</b> padlocks` : 'a heavy brass padlock'} onto your wallet!\n` +
          `Your coins are shielded from robbery attempts for the next <b>${formatTime(newRemaining)}</b> (or until breached).`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 5. LANDMINE
      if (item.id === 'landmine') {
        await inventoryRepo.removeItem(targetUserId, 'landmine', quantity);
        const addedSeconds = 86400 * quantity;
        const existingRemaining = await inventoryRepo.getBuffRemaining(targetUserId, 'landmine');
        const newRemaining = (existingRemaining > 0 ? existingRemaining : 0) + addedSeconds;
        await inventoryRepo.setBuff(targetUserId, 'landmine', newRemaining);

        await ctx.answerCallbackQuery({ text: '💣 Landmine primed!' });
        return ctx.editMessageText(
          `💣 <b>Landmine Primed!</b>\n` +
          `You rigged ${quantity > 1 ? `<b>${quantity}x</b> explosive pressure plates` : 'an explosive pressure plate'} inside your pocket lining!\n` +
          `If someone attempts to <code>/rob</code> you in the next <b>${formatTime(newRemaining)}</b>, there is a <b>50% chance</b> it detonates and instantly kills them!`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 6. LUCKY HORSESHOE
      if (item.id === 'horseshoe') {
        await inventoryRepo.removeItem(targetUserId, 'horseshoe', quantity);
        const addedSeconds = 1800 * quantity;
        const existingRemaining = await inventoryRepo.getBuffRemaining(targetUserId, 'horseshoe');
        const newRemaining = (existingRemaining > 0 ? existingRemaining : 0) + addedSeconds;
        await inventoryRepo.setBuff(targetUserId, 'horseshoe', newRemaining);

        await ctx.answerCallbackQuery({ text: '🧲 Lucky Horseshoe activated!' });
        return ctx.editMessageText(
          `🧲 <b>Lucky Horseshoe Activated!</b>\n` +
          `You activated <b>${quantity}x Lucky Horseshoe</b>!\n` +
          `Enjoy <b>+15% luck bonus</b> on <code>/beg</code>, <code>/search</code>, <code>/crime</code>, <code>/dig</code>, <code>/hunt</code>, and <code>/fish</code> for the next <b>${formatTime(newRemaining)}</b>!`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 7. APPLE
      if (item.id === 'apple') {
        await inventoryRepo.removeItem(targetUserId, 'apple', quantity);
        const addedSeconds = 86400 * quantity;
        const existingRemaining = await inventoryRepo.getBuffRemaining(targetUserId, 'apple');
        const newRemaining = (existingRemaining > 0 ? existingRemaining : 0) + addedSeconds;
        await inventoryRepo.setBuff(targetUserId, 'apple', newRemaining);

        await ctx.answerCallbackQuery({ text: '🍎 Crisp Apple consumed!' });
        return ctx.editMessageText(
          `🍎 <b>Crisp Apple Consumed!</b>\n` +
          `You consumed <b>${quantity}x Apple</b>!\n` +
          `For the next <b>${formatTime(newRemaining)}</b>, if you die during any grinding or crime activity, your <b>inventory items are 100% protected</b> from loss! (You will only risk coins).`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }
  }
};

export default use;
