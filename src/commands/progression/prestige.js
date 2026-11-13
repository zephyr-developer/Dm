import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { getCollectibleItemIds } from '../../config/items.js';
import { formatCoins } from '../../utils/formatters.js';

// Prevent concurrent double-execution of the prestige ritual for the same user
const activeRituals = new Set();

function getPrestigeRewardPlan(targetPrestige) {
  if (targetPrestige === 1) {
    return {
      bankBonus: 100000,
      items: [
        { itemId: 'banknote', qty: 1, label: '1x 📜 Bank Note' },
        { itemId: 'lifesaver', qty: 1, label: '1x 🛟 Life Saver' }
      ]
    };
  }

  return {
    bankBonus: targetPrestige * 250000,
    items: [
      { itemId: 'banknote', qty: targetPrestige * 2, label: `${targetPrestige * 2}x 📜 Bank Note` },
      { itemId: 'pepetrophy', qty: targetPrestige * 1, label: `${targetPrestige * 1}x 🏆 Pepe Trophy` },
      { itemId: 'coinbomb', qty: targetPrestige * 3, label: `${targetPrestige * 3}x 💣 Coin Bomb` }
    ]
  };
}

async function buildPrestigeCard(userId) {
  const user = await userRepo.getUser(userId);
  if (!user) return { text: 'User account not found.', keyboard: null };

  const currentPrestige = Number(user.prestige || 0);
  const targetPrestige = currentPrestige + 1;

  const requiredLevel = 10 * targetPrestige;
  const requiredCoins = 250000 * targetPrestige;

  const hasLevel = Number(user.level) >= requiredLevel;
  const hasCoins = Number(user.wallet) >= requiredCoins;
  const qualifies = hasLevel && hasCoins;

  const rewardPlan = getPrestigeRewardPlan(targetPrestige);
  const rewardList = rewardPlan.items.map(r => r.label).join(', ');

  const text = `👑 <b>TeleMemer Prestige Ascension</b> (Tier ${currentPrestige} ➜ <b>Tier ${targetPrestige}</b>)\n` +
    `Ascend to a higher tier of glory and unlock permanent scaling prestige perks!\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Ascension Requirements:</b>\n` +
    `• Level Required: <b>${requiredLevel}</b> (Your Level: <b>${user.level}</b>) ${hasLevel ? '✅' : '❌'}\n` +
    `• Wallet Required: <b>${formatCoins(requiredCoins)}</b> (Your Wallet: <b>${formatCoins(user.wallet)}</b>) ${hasCoins ? '✅' : '❌'}\n\n` +
    `⚠️ <b>WHAT WILL HAPPEN UPON PRESTIGE:</b>\n` +
    `• 🔄 Level reset to 1 (XP reset to 0)\n` +
    `• 💸 Wallet & Bank balances reset to 0\n` +
    `• 🎒 Non-collectible items wiped from backpack\n` +
    `• 🏆 <b>All Rare Collectibles (Pepe Coin, Pepe Trophy) ARE SAVED!</b>\n\n` +
    `🎁 <b>TIER ${targetPrestige} ASCENSION REWARDS:</b>\n` +
    `• 🌟 +1 Prestige Rank badge (+1% permanent XP multiplier per tier)\n` +
    `• 🏛️ <b>+${formatCoins(rewardPlan.bankBonus)} permanent Bank Capacity</b>\n` +
    `• 🎁 Care Package: <b>${rewardList}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard();
  if (qualifies) {
    keyboard
      .text('🔥 CONFIRM PRESTIGE', `prestige:confirm:${userId}`)
      .text('❌ CANCEL', `prestige:cancel:${userId}`);
  } else {
    keyboard
      .text('🔒 Requirements Not Met', `prestige:locked:${userId}`)
      .text('❌ CANCEL', `prestige:cancel:${userId}`);
  }

  return { text, keyboard };
}

export const prestige = {
  name: 'prestige',
  aliases: [],
  description: 'Reset your wealth and level for permanent bank capacity and scaling prestige rewards',
  cooldown: 10,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const { text, keyboard } = await buildPrestigeCard(userId);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your prestige ritual!",
        show_alert: true
      });
    }

    if (action === 'cancel') {
      await ctx.answerCallbackQuery({ text: 'Prestige cancelled.' });
      return ctx.editMessageText('❌ Prestige ritual cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (action === 'locked') {
      return ctx.answerCallbackQuery({
        text: '❌ You do not meet the level and wallet requirements to prestige yet!',
        show_alert: true
      });
    }

    if (action === 'confirm') {
      if (activeRituals.has(targetUserId)) {
        return ctx.answerCallbackQuery({ text: '🔥 Prestige ritual already in progress!' });
      }

      const user = await userRepo.getUser(targetUserId);
      if (!user) return ctx.answerCallbackQuery({ text: 'User not found.' });

      const targetPrestige = Number(user.prestige || 0) + 1;
      const requiredLevel = 10 * targetPrestige;
      const requiredCoins = 250000 * targetPrestige;

      if (Number(user.level) < requiredLevel || Number(user.wallet) < requiredCoins) {
        return ctx.answerCallbackQuery({
          text: '❌ Requirements no longer met!',
          show_alert: true
        });
      }

      activeRituals.add(targetUserId);
      try {
        await ctx.answerCallbackQuery({ text: '🔥 Initiating Prestige Sequence...' }).catch(() => {});

        // Step 1: 0%
        await ctx.editMessageText(
          '🔥 <b>INITIATING PRESTIGE SEQUENCE...</b>\n[□□□□□□□□□□] 0%',
          { parse_mode: 'HTML' }
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        // Step 2: 30%
        await ctx.editMessageText(
          '⚠️ <b>WIPING WALLET AND BANK...</b>\n[■■■□□□□□□□] 30%',
          { parse_mode: 'HTML' }
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        // Step 3: 70%
        await ctx.editMessageText(
          '♻️ <b>CONVERTING XP TO PERMANENT MULTIPLIERS...</b>\n[■■■■■■■□□□] 70%',
          { parse_mode: 'HTML' }
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        // Calculate scaling rewards right before DB update
        const rewardPlan = getPrestigeRewardPlan(targetPrestige);
        const newBankMax = Number(user.bank_max || 5000) + rewardPlan.bankBonus;

        // Finalize DB wipe and reward grant
        await userRepo.prestigeReset(targetUserId, targetPrestige, newBankMax);

        const collectibleIds = getCollectibleItemIds();
        await inventoryRepo.wipeNonCollectibleInventory(targetUserId, collectibleIds);

        for (const reward of rewardPlan.items) {
          await inventoryRepo.addItem(targetUserId, reward.itemId, reward.qty);
        }

        const rewardSummary = rewardPlan.items.map(r => `  • ${r.label}`).join('\n');

        // Step 4: 100% Complete + Rewards Breakdown
        const celebration = `✨ <b>PRESTIGE COMPLETE!</b>\n[■■■■■■■■■■] 100%\n\n` +
          `👑 You have ascended to <b>Prestige Tier ${targetPrestige}</b>!\n\n` +
          `🏛️ <b>Bank Capacity Added:</b> +${formatCoins(rewardPlan.bankBonus)}\n` +
          `🏛️ <b>New Bank Max:</b> ${formatCoins(newBankMax)}\n` +
          `🎁 <b>Scaling Ascension Package:</b>\n${rewardSummary}\n\n` +
          `🏆 <i>Your rare Pepe Collectibles have been preserved in your vault.</i>\n` +
          `Run <code>/flow</code> to dominate your new prestige run!`;

        await ctx.editMessageText(celebration, { parse_mode: 'HTML' }).catch(() => {});
      } finally {
        activeRituals.delete(targetUserId);
      }
    }
  }
};

export default prestige;
