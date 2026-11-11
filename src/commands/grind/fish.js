import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const fish = {
  name: 'fish',
  aliases: [],
  description: 'Cast your fishing line into the water and reel in exotic fish',
  cooldown: 35,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!inventoryRepo.hasItem(userId, 'fishingpole', 1)) {
      return ctx.reply(
        `🎣 <b>You need a Fishing Pole to fish!</b>\n` +
        `Visit the shop to purchase one: <code>/buy fishingpole</code> (Cost: 🪙 25,000)`,
        { parse_mode: 'HTML' }
      );
    }

    const directions = ['left', 'center', 'right'];
    const guaranteed = pickRandom(directions);

    const keyboard = new InlineKeyboard()
      .text('🌊 Pull Left', `fish:left:${guaranteed}:${userId}`)
      .text('🌊 Pull Center', `fish:center:${guaranteed}:${userId}`)
      .text('🌊 Pull Right', `fish:right:${guaranteed}:${userId}`);

    const prompt = `🎣 <b>You cast your line into deep waters...</b>\n` +
      `BITE DETECTED! The bobber is violently dipping! Which way do you reel your rod?`;

    await ctx.reply(prompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const chosenDir = parts[1];
    const guaranteedDir = parts[2];
    const targetUserId = Number(parts[3]);

    const hasHorseshoe = inventoryRepo.hasBuff(targetUserId, 'horseshoe');

    // Guaranteed if matched, otherwise 50% chance (or 65% with horseshoe)
    const isGuaranteed = chosenDir === guaranteedDir;
    const randomPass = Math.random() < (hasHorseshoe ? 0.65 : 0.50);
    const isCatch = isGuaranteed || randomPass;

    if (!isCatch) {
      // Failed: 5% chance pole breaks
      let brokeText = '';
      if (Math.random() < 0.05) {
        inventoryRepo.removeItem(targetUserId, 'fishingpole', 1);
        brokeText = `\n\n💥 <b>CRACK!</b> The fierce resistance snapped your 🎣 <b>Fishing Pole in half!</b>`;
      }

      const xpRes = addXp(targetUserId, 15);
      const failText = `🐟 <b>The fish slipped off the hook!</b>\n` +
        `You pulled <i>${chosenDir}</i>, but the slippery beast swam away into the depths.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        brokeText +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(failText, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Fish escaped!' });
    }

    // Success! Check for 1% Kraken (or 3% with horseshoe)
    const krakenChance = hasHorseshoe ? 0.03 : 0.01;
    if (Math.random() < krakenChance) {
      inventoryRepo.addItem(targetUserId, 'kraken', 1);
      const bonusCoins = randomBetween(8000, 20000);
      userRepo.updateWallet(targetUserId, bonusCoins);
      const xpRes = addXp(targetUserId, 100);

      const krakenItem = items.kraken;
      const krakenMsg = `🦑 <b>ABYSSAL KRAKEN REELED IN!</b>\n` +
        `The ocean roiled as giant tentacles breached the surface! You hauled the mythical sea terror into your vessel!\n\n` +
        `🏆 <b>Catch:</b> 1x ${krakenItem.emoji} <b>${krakenItem.name}</b> (Sell: 🪙 40,000)\n` +
        `🪙 <b>Ocean Bonus:</b> +${formatCoins(bonusCoins)}\n` +
        `⭐ <b>XP Earned:</b> +100 XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(krakenMsg, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'LEGENDARY KRAKEN!' });
    }

    // Common vs Tropical Fish
    const isTropical = Math.random() < 0.35;
    const fishId = isTropical ? 'tropicalfish' : 'commonfish';
    inventoryRepo.addItem(targetUserId, fishId, 1);
    const fishObj = items[fishId];
    const coinsFound = randomBetween(200, 800);
    userRepo.updateWallet(targetUserId, coinsFound);
    const xpRes = addXp(targetUserId, randomBetween(20, 35));

    const catchMsg = `🎣 <b>NICE CATCH!</b>\n` +
      `You reeled with perfect timing and landed 1x ${fishObj.emoji} <b>${fishObj.name}</b>!\n` +
      `🪙 Plus retrieved <b>${formatCoins(coinsFound)}</b> tangled in the seaweed.\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      (xpRes.message ? `\n${xpRes.message}` : '');

    await ctx.editMessageText(catchMsg, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery({ text: 'Fish caught!' });
  }
};

export default fish;
