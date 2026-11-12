import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { getCollectibleItemIds } from '../../config/items.js';
import { formatCoins } from '../../utils/formatters.js';

async function buildPrestigeCard(userId) {
  const user = await userRepo.getUser(userId);
  if (!user) return { text: 'User account not found.', keyboard: null };

  const currentPrestige = user.prestige || 0;
  const targetPrestige = currentPrestige + 1;

  const requiredLevel = 10 * targetPrestige;
  const requiredCoins = 250000 * targetPrestige;

  const hasLevel = user.level >= requiredLevel;
  const hasCoins = user.wallet >= requiredCoins;
  const qualifies = hasLevel && hasCoins;

  const text = `👑 <b>TeleMemer Prestige Ascension</b> (Tier ${currentPrestige} ➜ <b>Tier ${targetPrestige}</b>)\n` +
    `Ascend to a higher tier of glory and unlock permanent prestige perks!\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Ascension Requirements:</b>\n` +
    `• Level Required: <b>${requiredLevel}</b> (Your Level: <b>${user.level}</b>) ${hasLevel ? '✅' : '❌'}\n` +
    `• Wallet Required: <b>${formatCoins(requiredCoins)}</b> (Your Wallet: <b>${formatCoins(user.wallet)}</b>) ${hasCoins ? '✅' : '❌'}\n\n` +
    `⚠️ <b>WHAT WILL HAPPEN UPON PRESTIGE:</b>\n` +
    `• 🔄 Level reset to 1 (XP reset to 0)\n` +
    `• 💸 Wallet & Bank balances reset to 0\n` +
    `• 🎒 Non-collectible items wiped from backpack\n` +
    `• 🏆 <b>All Rare Collectibles (Pepe Coin, Pepe Trophy) ARE SAVED!</b>\n\n` +
    `🎁 <b>PERMANENT ASCENSION REWARDS:</b>\n` +
    `• 🌟 +1 Prestige Rank badge\n` +
    `• 🏛️ <b>+100,000 permanent Bank Capacity</b>\n` +
    `• 🎁 Immediate Care Package: 1x 📜 Bank Note & 1x 🛟 Life Saver!\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard();
  if (qualifies) {
    keyboard.text('🔥 CONFIRM PRESTIGE ASCENSION', `prestige:confirm:${userId}`);
  } else {
    keyboard.text('🔒 Requirements Not Met', `prestige:locked:${userId}`);
  }

  return { text, keyboard };
}

export const prestige = {
  name: 'prestige',
  aliases: [],
  description: 'Reset your wealth and level for permanent bank capacity and prestige glory',
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

    if (action === 'locked') {
      return ctx.answerCallbackQuery({
        text: '❌ You do not meet the level and wallet requirements to prestige yet!',
        show_alert: true
      });
    }

    if (action === 'confirm') {
      const user = await userRepo.getUser(targetUserId);
      if (!user) return ctx.answerCallbackQuery({ text: 'User not found.' });

      const targetPrestige = (user.prestige || 0) + 1;
      const requiredLevel = 10 * targetPrestige;
      const requiredCoins = 250000 * targetPrestige;

      if (user.level < requiredLevel || user.wallet < requiredCoins) {
        return ctx.answerCallbackQuery({
          text: '❌ Requirements no longer met!',
          show_alert: true
        });
      }

      // Execute Prestige Reset
      const newBankMax = (user.bank_max || 5000) + 100000;
      await userRepo.prestigeReset(targetUserId, targetPrestige, newBankMax);

      // Wipe non-collectibles (Pepe Coin and Pepe Trophy are kept)
      const collectibleIds = getCollectibleItemIds();
      await inventoryRepo.wipeNonCollectibleInventory(targetUserId, collectibleIds);

      // Award Care Package
      await inventoryRepo.addItem(targetUserId, 'banknote', 1);
      await inventoryRepo.addItem(targetUserId, 'lifesaver', 1);

      const celebration = `🎉 <b>PRESTIGE ASCENSION COMPLETE!</b> 🎉\n\n` +
        `You have ascended to <b>Prestige Tier ${targetPrestige}</b>!\n\n` +
        `🏛️ <b>New Bank Max:</b> ${formatCoins(newBankMax)}\n` +
        `🎁 <b>Ascension Package:</b> 1x 📜 Bank Note & 1x 🛟 Life Saver added to your backpack!\n` +
        `🏆 Your rare Pepe Collectibles have been preserved in your trophy room.\n\n` +
        `Run <code>/flow</code> to start dominating your new prestige run!`;

      await ctx.editMessageText(celebration, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({
        text: `👑 Welcome to Prestige Tier ${targetPrestige}!`,
        show_alert: true
      });
    }
  }
};

export default prestige;
