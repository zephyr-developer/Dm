import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLootItems, items } from '../../config/items.js';
import { formatCoins, randomBetween, sanitizeHtml } from '../../utils/formatters.js';

// Items eligible for bounty contracts (achievable via grinding)
const ELIGIBLE_BOUNTY_ITEMS = [
  'worm',
  'ant',
  'garbage',
  'boar',
  'deer',
  'commonfish',
  'tropicalfish',
  'ducttape'
];

function generateBountyRequirements() {
  const allLoot = getLootItems().filter(i => ELIGIBLE_BOUNTY_ITEMS.includes(i.id));
  const shuffled = [...allLoot].sort(() => 0.5 - Math.random());
  // Pick 1 to 3 distinct items
  const count = randomBetween(1, 3);
  const selected = shuffled.slice(0, count);

  const requirements = [];
  let totalSellValue = 0;

  for (const item of selected) {
    let qty = 1;
    if (['worm', 'ant', 'garbage'].includes(item.id)) {
      qty = randomBetween(2, 5);
    } else if (['commonfish', 'boar'].includes(item.id)) {
      qty = randomBetween(1, 3);
    } else {
      // deer, tropicalfish, ducttape
      qty = randomBetween(1, 2);
    }

    const itemSell = item.sellPrice || 500;
    totalSellValue += itemSell * qty;

    requirements.push({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji,
      quantity: qty,
      unitSellPrice: itemSell
    });
  }

  // 4x total item sellPrice in coins + large XP bonus
  const rewardCoins = totalSellValue * 4;
  const rewardXp = randomBetween(200, 350);

  return { requirements, rewardCoins, rewardXp };
}

function buildQuestMessage(quest) {
  let reqsText = '';
  quest.requirements.forEach(r => {
    reqsText += `  • ${r.quantity}x ${r.emoji} <b>${r.name}</b> (Base: 🪙 ${(r.unitSellPrice * r.quantity).toLocaleString()})\n`;
  });

  const text = `📜 <b>HUNTER GUILD BOUNTY CONTRACT</b>\n` +
    `👤 <b>Client:</b> The Royal Meme Guildmaster\n` +
    `🎯 <b>Assigned Hunter:</b> ${sanitizeHtml(quest.userName)}\n\n` +
    `The Guild has issued an urgent procurement order for local resources:\n\n` +
    `<b>Required Deliveries:</b>\n` +
    reqsText + `\n` +
    `<b>🏆 Contract Rewards:</b>\n` +
    `🪙 <b>Coin Bounty:</b> ${formatCoins(quest.rewardCoins)} <i>(4x Market Sell Value!)</i>\n` +
    `⭐ <b>XP Reward:</b> +${quest.rewardXp} XP\n\n` +
    `<i>Have the items in your inventory? Click <b>[Turn In Items]</b> below. Missing items? Go grind with /dig, /fish, /hunt, or /search and come back!</i>`;

  const keyboard = new InlineKeyboard()
    .text('✅ Turn In Items', `quest:turnin:${quest.messageId}:${quest.userId}`)
    .text('❌ Dismiss Contract', `quest:ignore:${quest.messageId}:${quest.userId}`);

  return { text, keyboard };
}

export const quest = {
  name: 'quest',
  aliases: ['bounty', 'bounties'],
  category: 'grind',
  description: 'Accept high-paying bounty contracts requesting gathered grind materials (Pays 4x Market Value)',
  cooldown: 3600, // 60 minutes (30 minutes for Premium)

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!global.activeQuests) {
      global.activeQuests = new Map();
    }

    // Purge quests older than 2 hours to prevent memory buildup
    const now = Date.now();
    for (const [k, v] of global.activeQuests.entries()) {
      if (now - (v.createdAt || 0) > 7200000) {
        global.activeQuests.delete(k);
      }
    }

    // Generate dynamic bounty requirements
    const { requirements, rewardCoins, rewardXp } = generateBountyRequirements();

    const questData = {
      messageId: 0,
      chatId: ctx.chat.id,
      userId,
      userName: ctx.from.first_name || 'Hunter',
      requirements,
      rewardCoins,
      rewardXp,
      createdAt: now
    };

    const initialView = buildQuestMessage(questData);
    const sent = await ctx.reply(initialView.text, {
      parse_mode: 'HTML',
      reply_markup: initialView.keyboard
    });

    questData.messageId = sent.message_id;
    global.activeQuests.set(String(sent.message_id), questData);

    // Update buttons with the real messageId
    const updatedView = buildQuestMessage(questData);
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, sent.message_id, {
      reply_markup: updatedView.keyboard
    }).catch(() => {});
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    // Format: quest:${action}:${messageId}:${userId}
    const action = parts[1];
    const messageId = parts[2] || String(ctx.callbackQuery.message?.message_id);
    const clickerId = ctx.from.id;

    if (!global.activeQuests) {
      global.activeQuests = new Map();
    }

    const questData = global.activeQuests.get(String(messageId));

    if (!questData) {
      return ctx.answerCallbackQuery({
        text: '⏳ This bounty contract has expired or was already completed!',
        show_alert: true
      });
    }

    // Verify ownership
    if (questData.userId !== clickerId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your bounty contract! Type /quest to receive your own contract.",
        show_alert: true
      });
    }

    // ==========================================
    // ACTION: DISMISS CONTRACT
    // ==========================================
    if (action === 'ignore') {
      global.activeQuests.delete(String(messageId));
      await ctx.answerCallbackQuery({ text: 'Bounty contract dismissed.' });

      const dismissedText = `❌ <b>Bounty Contract Dismissed</b>\n\n` +
        `You rejected this Guild contract. Run <code>/quest</code> again later to take on a fresh assignment!`;

      return ctx.editMessageText(dismissedText, { parse_mode: 'HTML' }).catch(() => {});
    }

    // ==========================================
    // ACTION: TURN IN ITEMS
    // ==========================================
    if (action === 'turnin') {
      // Check current user inventory for all required items
      const userInventory = await inventoryRepo.getUserInventory(clickerId);
      const invMap = new Map();
      userInventory.forEach(inv => {
        invMap.set(inv.item_id, inv.quantity);
      });

      const missing = [];
      for (const req of questData.requirements) {
        const owned = invMap.get(req.itemId) || 0;
        if (owned < req.quantity) {
          const needed = req.quantity - owned;
          missing.push(`${needed}x ${req.emoji} ${req.name}`);
        }
      }

      // If missing items, alert user without modifying or deleting the message!
      if (missing.length > 0) {
        return ctx.answerCallbackQuery({
          text: `❌ You do not have all items yet!\n\nStill needed:\n• ${missing.join('\n• ')}\n\nGo grind with /dig, /fish, /hunt, or /search and come back to turn them in!`,
          show_alert: true
        });
      }

      // User has all items! Deduct from inventory
      for (const req of questData.requirements) {
        await inventoryRepo.removeItem(clickerId, req.itemId, req.quantity);
      }

      // Award coins (recorded in currency_logs)
      await userRepo.updateCoins(clickerId, {
        walletDelta: questData.rewardCoins,
        sourceCommand: '/quest',
        details: 'Fulfilled Hunter Guild Bounty Contract'
      });

      // Award XP
      const xpRes = await addXp(clickerId, questData.rewardXp);

      // Clean up quest from memory
      global.activeQuests.delete(String(messageId));

      await ctx.answerCallbackQuery({ text: '🎉 Bounty fulfilled! Coins and XP added.' });

      let turnedInList = '';
      questData.requirements.forEach(r => {
        turnedInList += `  • ${r.quantity}x ${r.emoji} <b>${r.name}</b>\n`;
      });

      const completionText = `🏆 <b>BOUNTY CONTRACT FULFILLED!</b>\n` +
        `👤 <b>Hunter:</b> ${sanitizeHtml(questData.userName)}\n\n` +
        `You delivered all required resources to the Guildmaster:\n` +
        turnedInList + `\n` +
        `<b>💰 Payment Disbursed:</b>\n` +
        `🪙 <b>Bounty Coins:</b> +${formatCoins(questData.rewardCoins)} <i>(4x Market Sell Value!)</i>\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '') +
        `\n\n<i>Outstanding work, Hunter! Check back later for your next assignment.</i>`;

      return ctx.editMessageText(completionText, { parse_mode: 'HTML' }).catch(() => {});
    }
  }
};

export default quest;
