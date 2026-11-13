import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addLevels } from '../../utils/levelEngine.js';
import { findItem, getItem } from '../../config/items.js';
import { formatCoins, formatTime, randomBetween, sanitizeHtml } from '../../utils/formatters.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';

global.activeCoinBombs = global.activeCoinBombs || new Map();

const CUSTOM_TITLE_COOLDOWN_MS = 86_400_000; // 24 hours

const USABLE_ITEM_IDS = new Set([
  'banknote',
  'padlock',
  'landmine',
  'vaultlock',
  'horseshoe',
  'apple',
  'coinbomb',
  'gtkcondom',
  'owntitle'
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
        `• 💣 <code>coinbomb</code> - Drop 15k–50k coins per grab for first 3 clickers!\n` +
        `• 🎈 <code>gtkcondom</code> - Immediately gain +10 Levels!\n` +
        `• 🏷️ <code>owntitle &lt;text&gt;</code> - Unlock &amp; equip your own custom profile title!`,
        { parse_mode: 'HTML' }
      );
    }

    const words = rawInput.split(/\s+/);
    const firstWordMatch = findItem(words[0]);
    const twoWordMatch = words.length >= 2 ? findItem(`${words[0]} ${words[1]}`) : null;

    // Special handling: /use owntitle <custom title>
    if (firstWordMatch?.id === 'owntitle' || twoWordMatch?.id === 'owntitle') {
      const prefixLen = firstWordMatch?.id === 'owntitle'
        ? words[0].length
        : rawInput.toLowerCase().indexOf(words[1].toLowerCase()) + words[1].length;
      const customTitleText = rawInput.slice(prefixLen).trim();

      const ownedTitleItem = await inventoryRepo.getItem(userId, 'owntitle');
      if (ownedTitleItem <= 0) {
        return ctx.reply("❌ You don't own any 🏷️ <b>Own Title</b> item.", { parse_mode: 'HTML' });
      }

      if (!customTitleText) {
        return ctx.reply(
          '❌ Please specify the custom title you want! Usage: <code>/use owntitle &lt;your custom title&gt;</code> (Max 30 characters)',
          { parse_mode: 'HTML' }
        );
      }

      if (/[\r\n]/.test(customTitleText)) {
        return ctx.reply('❌ Custom titles cannot contain line breaks!', { parse_mode: 'HTML' });
      }

      if (customTitleText.length < 2 || customTitleText.length > 30) {
        return ctx.reply(
          `❌ Custom title must be between <b>2 and 30 characters</b> long (yours is ${customTitleText.length} characters).`,
          { parse_mode: 'HTML' }
        );
      }

      const freshUser = await userRepo.getUser(userId);
      const lastChange = Number(freshUser?.last_custom_title_at || 0);
      const elapsed = Date.now() - lastChange;
      if (lastChange > 0 && elapsed < CUSTOM_TITLE_COOLDOWN_MS) {
        const remainingSec = Math.max(1, Math.ceil((CUSTOM_TITLE_COOLDOWN_MS - elapsed) / 1000));
        return ctx.reply(
          `⏳ <b>Custom Title Cooldown!</b> You can only change your custom title once every <b>24 hours</b>. Please wait <b>${formatTime(remainingSec)}</b> before changing it again!`,
          { parse_mode: 'HTML' }
        );
      }

      const token = createConfirmation('ot', {
        callerId: userId,
        customTitleText
      });

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `use:ot_no:${token}:${userId}`)
        .text('✅ Confirm', `use:ot_yes:${token}:${userId}`);

      return ctx.reply(
        `🏷️ <b>Confirm Custom Title</b>\n` +
        `Are you sure you want to consume <b>1x 🏷️ Own Title</b> to set your custom title to:\n` +
        `👉 <b>「 ${sanitizeHtml(customTitleText)} 」</b>\n\n` +
        `<i>(Note: Once changed, you must wait 24 hours before you can change your custom title again!)</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );
    }

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

    // 1. Handle Coin Bomb communal grab button (coinbomb:grab)
    if (prefix === 'coinbomb' && subAction === 'grab') {
      const msgId = ctx.callbackQuery.message?.message_id;
      const state = global.activeCoinBombs.get(msgId);

      if (!state) {
        return ctx.answerCallbackQuery({ text: 'Too late! All coins were grabbed or this bomb expired.', show_alert: true });
      }

      const clickerId = ctx.from.id;
      const clickerName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Player');

      if (state.claimedBy.has(clickerId)) {
        return ctx.answerCallbackQuery({ text: 'You already grabbed coins from this bomb!', show_alert: true });
      }

      if (state.claimedBy.size >= 3) {
        return ctx.answerCallbackQuery({ text: 'Too late! All coins were grabbed.', show_alert: true });
      }

      // Register claimer synchronously before awaiting DB to eliminate concurrent race conditions
      state.claimedBy.add(clickerId);
      const reward = randomBetween(15000, 50000);
      state.rewards.push({
        userId: clickerId,
        name: clickerName,
        amount: reward
      });

      await userRepo.getOrInitUser(clickerId, ctx.from.username, ctx.from.first_name);
      await userRepo.updateCoins(clickerId, {
        walletDelta: reward,
        sourceCommand: '/use coinbomb',
        details: `Grabbed coins from Coin Bomb dropped by ${state.ownerName}`
      });

      const claimedCount = state.claimedBy.size;

      if (claimedCount < 3) {
        const progressLines = state.rewards
          .map((r, idx) => `${idx + 1}. <b>${sanitizeHtml(r.name)}</b> grabbed <b>${formatCoins(r.amount)}</b>!`)
          .join('\n');

        const updatedText = `💣 <b>COIN BOMB DETONATED!</b> 💣\n` +
          `<b>${sanitizeHtml(state.ownerName)}</b> tossed a live <b>Coin Bomb</b> into the chat!\n\n` +
          `First <b>3 players</b> to grab win 🪙 15,000–50,000 each!\n\n` +
          `<b>Grabbed so far (${claimedCount}/3):</b>\n${progressLines}`;

        const keyboard = new InlineKeyboard()
          .text(`💰 Grab Coins! (${claimedCount}/3)`, 'coinbomb:grab');

        await ctx.editMessageText(updatedText, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }).catch(() => {});

        return ctx.answerCallbackQuery({ text: `💰 You grabbed +${formatCoins(reward)}!`, show_alert: true });
      }

      // Reached 3/3 claimers: remove button, show all 3 winners, and clean up global map
      global.activeCoinBombs.delete(msgId);

      const winnerLines = state.rewards
        .map((r, idx) => `${idx + 1}. <b>${sanitizeHtml(r.name)}</b> grabbed <b>${formatCoins(r.amount)}</b>!`)
        .join('\n');

      const summaryText = `💥 <b>COIN BOMB FULLY LOOTED! (3/3)</b> 💥\n` +
        `Tossed by: <b>${sanitizeHtml(state.ownerName)}</b>\n\n` +
        `<b>Winners:</b>\n${winnerLines}`;

      await ctx.editMessageText(summaryText, { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: `💰 Final grab! +${formatCoins(reward)}!`, show_alert: true });
    }

    // 2. Confirmation callbacks (use:yes:<item_id>:<qty>:<uid> / use:no:<uid> / use:ot_yes:<token>:<uid> / use:ot_no:<token>:<uid>)
    const targetUserId = Number(parts[parts.length - 1]);
    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your transaction!",
        show_alert: true
      });
    }

    if (subAction === 'ot_no') {
      const token = parts[2];
      deleteConfirmation(token);
      await ctx.answerCallbackQuery({ text: 'Custom title cancelled.' });
      return ctx.editMessageText('❌ Custom title change cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (subAction === 'ot_yes') {
      const token = parts[2];
      const pending = getConfirmation(token);
      if (!pending || pending.callerId !== targetUserId) {
        await ctx.answerCallbackQuery({ text: 'Confirmation expired!', show_alert: true });
        return ctx.editMessageText('⏳ This custom title confirmation has expired. Please run <code>/use owntitle &lt;title&gt;</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      }

      consumeConfirmation(token);

      const owned = await inventoryRepo.getItem(targetUserId, 'owntitle');
      if (owned < 1) {
        await ctx.answerCallbackQuery({ text: 'You no longer own an Own Title item!', show_alert: true });
        return ctx.editMessageText('❌ <b>Action Failed:</b> You no longer own <b>1x 🏷️ Own Title</b>.', { parse_mode: 'HTML' }).catch(() => {});
      }

      const freshUser = await userRepo.getUser(targetUserId);
      const lastChange = Number(freshUser?.last_custom_title_at || 0);
      const elapsed = Date.now() - lastChange;
      if (lastChange > 0 && elapsed < CUSTOM_TITLE_COOLDOWN_MS) {
        const remainingSec = Math.max(1, Math.ceil((CUSTOM_TITLE_COOLDOWN_MS - elapsed) / 1000));
        await ctx.answerCallbackQuery({ text: 'Custom title cooldown active!', show_alert: true });
        return ctx.editMessageText(
          `⏳ <b>Custom Title Cooldown!</b> You must wait <b>${formatTime(remainingSec)}</b> before changing your custom title again.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      await inventoryRepo.removeItem(targetUserId, 'owntitle', 1);
      await userRepo.setCustomTitle(targetUserId, pending.customTitleText, Date.now());

      await ctx.answerCallbackQuery({ text: '🏷️ Custom title unlocked!' });
      return ctx.editMessageText(
        `✨ <b>NEW CUSTOM TITLE UNLOCKED!</b> Your profile title is now set to <b>「 ${sanitizeHtml(pending.customTitleText)} 」</b>!`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
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

        const ownerName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Player');
        const keyboard = new InlineKeyboard()
          .text('💰 Grab Coins! (0/3)', 'coinbomb:grab');

        const bombPrompt = `💣 <b>COIN BOMB DETONATED!</b> 💣\n` +
          `<b>${sanitizeHtml(ownerName)}</b> tossed a live <b>Coin Bomb</b> into the chat!\n\n` +
          `First <b>3 players</b> to click below grab 🪙 15,000–50,000 each!`;

        // Send a fresh group message (removing confirmation prompt) and key activeCoinBombs by sentMsg.message_id
        await ctx.deleteMessage().catch(() => {});
        const sentMsg = await ctx.reply(bombPrompt, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });

        global.activeCoinBombs.set(sentMsg.message_id, {
          ownerId: targetUserId,
          ownerName,
          claimedBy: new Set(),
          rewards: []
        });

        return ctx.answerCallbackQuery({ text: '💣 Coin Bomb Detonated!' });
      }

      // 3. GTK BRAND CONDOM (+10 Levels per item)
      if (item.id === 'gtkcondom') {
        await inventoryRepo.removeItem(targetUserId, 'gtkcondom', quantity);
        const levelsToGain = 10 * quantity;
        const lvlRes = await addLevels(targetUserId, levelsToGain, '/use gtkcondom');

        await ctx.answerCallbackQuery({ text: `🎈 Gained +${levelsToGain} Levels!` });
        return ctx.editMessageText(
          `🎈 <b>ULTIMATE PROTECTION ACTIVATED!</b>\n` +
          `You used <b>${quantity.toLocaleString('en-US')}x GTK Brand Condom</b> and instantly surged <b>+${levelsToGain} Levels</b>!\n\n` +
          `⭐ <b>Level:</b> ${lvlRes.oldLevel} ➜ <b>${lvlRes.newLevel}</b>\n` +
          `🪙 <b>Level-Up Bonus:</b> +${formatCoins(lvlRes.totalCoinsRewarded)}\n` +
          `🏛️ <b>Bank Capacity Added:</b> +${lvlRes.totalBankCapacityAdded.toLocaleString('en-US')}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      // 4. VAULT LOCK
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

      // 5. PADLOCK
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

      // 6. LANDMINE
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

      // 7. LUCKY HORSESHOE
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

      // 8. APPLE
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
