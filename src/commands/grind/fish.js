import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown, checkDropChance } from '../../utils/luckEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const fish = {
  name: 'fish',
  aliases: [],
  description: 'Cast your fishing line into the water and reel in exotic fish',
  cooldown: 35, // 17s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!(await inventoryRepo.hasItem(userId, 'fishingpole', 1))) {
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

    const luckInfo = await getLuckBreakdown(targetUserId);

    // Guaranteed if matched, otherwise 50% chance (+ luck boost)
    const isGuaranteed = chosenDir === guaranteedDir;
    const passChance = Math.min(0.95, 0.50 + (luckInfo.totalBonus / 200));
    const randomPass = Math.random() < passChance;
    const isCatch = isGuaranteed || randomPass;

    if (!isCatch) {
      // Failed: 5% chance pole breaks (reduced by luck)
      let brokeText = '';
      const breakProb = Math.max(0.01, 0.05 - (luckInfo.totalBonus / 2000));
      if (Math.random() < breakProb) {
        await inventoryRepo.removeItem(targetUserId, 'fishingpole', 1);
        brokeText = `\n\n💥 <b>CRACK!</b> The fierce resistance snapped your 🎣 <b>Fishing Pole in half!</b>`;
      }

      const xpRes = await addXp(targetUserId, 15);
      const failText = `🐟 <b>The fish slipped off the hook!</b>\n` +
        `You pulled <i>${chosenDir}</i>, but the slippery beast swam away into the depths.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        brokeText +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(failText, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Fish escaped!' });
    }

    // Success! Check for 1% Kraken (amplified by luckEngine)
    if (await checkDropChance(targetUserId, 0.01)) {
      await inventoryRepo.addItem(targetUserId, 'kraken', 1);
      const bonusCoins = Math.floor(randomBetween(8000, 20000) * (1 + (luckInfo.totalBonus / 200)));
      await userRepo.updateCoins(targetUserId, {
        walletDelta: bonusCoins,
        sourceCommand: '/fish',
        details: 'Caught Legendary Abyssal Kraken'
      });
      const xpRes = await addXp(targetUserId, 100);

      const krakenItem = items.kraken;
      let luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';

      const krakenMsg = `🦑 <b>ABYSSAL KRAKEN REELED IN!</b>${luckTag}\n` +
        `The ocean roiled as giant tentacles breached the surface! You hauled the mythical sea terror into your vessel!\n\n` +
        `🏆 <b>Catch:</b> 1x ${krakenItem.emoji} <b>${krakenItem.name}</b> (Sell: 🪙 40,000)\n` +
        `🪙 <b>Ocean Bonus:</b> +${formatCoins(bonusCoins)}\n` +
        `⭐ <b>XP Earned:</b> +100 XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(krakenMsg, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'LEGENDARY KRAKEN!' });
    }

    // Common vs Tropical Fish
    const isTropical = Math.random() < (0.35 + (luckInfo.totalBonus / 300));
    const fishId = isTropical ? 'tropicalfish' : 'commonfish';
    await inventoryRepo.addItem(targetUserId, fishId, 1);
    const fishObj = items[fishId];
    const baseCoins = randomBetween(200, 800);
    const coinsFound = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 200)));
    await userRepo.updateCoins(targetUserId, {
      walletDelta: coinsFound,
      sourceCommand: '/fish',
      details: `Reeled in 1x ${fishObj.name}`
    });
    const xpRes = await addXp(targetUserId, randomBetween(20, 35));

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
