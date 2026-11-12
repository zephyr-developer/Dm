import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown, rollLuck, checkDropChance } from '../../utils/luckEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const postmemes = {
  name: 'postmemes',
  aliases: ['pm'],
  description: 'Post memes on social media from your laptop for ad revenue and fame',
  cooldown: 35, // 17s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!(await inventoryRepo.hasItem(userId, 'laptop', 1))) {
      return ctx.reply(
        `💻 <b>You need a Laptop to post memes!</b>\n` +
        `Visit the shop to purchase one: <code>/buy laptop</code> (Cost: 🪙 20,000)`,
        { parse_mode: 'HTML' }
      );
    }

    const keyboard = new InlineKeyboard()
      .text('🔥 Fresh OC', `postmemes:fresh:${userId}`)
      .text('♻️ Repost', `postmemes:repost:${userId}`)
      .row()
      .text('🧠 Intellectual', `postmemes:intellectual:${userId}`)
      .text('🍝 Copypasta', `postmemes:copypasta:${userId}`);

    const prompt = `💻 <b>Open your Laptop and select a meme genre to broadcast:</b>`;

    await ctx.reply(prompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const genre = parts[1];
    const targetUserId = Number(parts[2]);

    const luckInfo = await getLuckBreakdown(targetUserId);
    const roll = await rollLuck(targetUserId, 1, 100);

    // 1. Downvoted (Roll <= 20)
    if (roll <= 20) {
      let laptopBroke = false;
      // 35% chance laptop breaks on rage (reduced by luck)
      const breakProb = Math.max(0.05, 0.35 - (luckInfo.totalBonus / 500));
      if (Math.random() < breakProb) {
        await inventoryRepo.removeItem(targetUserId, 'laptop', 1);
        laptopBroke = true;
      }

      const breakMsg = laptopBroke
        ? `\n\n💥 <b>RAGE SMASH!</b> You raged at the comment section and smashed your 💻 <b>Laptop</b> into pieces! Buy a new one with <code>/buy laptop</code>.`
        : '';

      const xpRes = await addXp(targetUserId, 15);
      const text = `📉 <b>DOWNVOTED TO OBLIVION!</b>\n` +
        `Your <b>${genre}</b> meme received 0 upvotes, was branded "cringe" by Reddit moderators, and was deleted.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        breakMsg +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(text, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Downvoted!' });
    }

    // 2. Viral Meme (Roll > 80)
    if (roll > 80) {
      const baseCoins = randomBetween(3500, 7000);
      const viralCoins = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 150)));
      await userRepo.updateCoins(targetUserId, {
        walletDelta: viralCoins,
        sourceCommand: '/postmemes',
        details: `Viral Meme Ad Revenue (${genre})`
      });

      let bonusText = '';
      if (await checkDropChance(targetUserId, 0.60)) {
        const bonusItemId = pickRandom(['banknote', 'ducttape']);
        await inventoryRepo.addItem(targetUserId, bonusItemId, 1);
        const bonusItem = items[bonusItemId];
        bonusText = `\n🎁 <b>Sponsorship Gift:</b> 1x ${bonusItem.emoji} <b>${bonusItem.name}</b>`;
      }

      const xpRes = await addXp(targetUserId, randomBetween(35, 55));
      let luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';

      const viralText = `🚀 <b>VIRAL EXPLOSION!</b>${luckTag}\n` +
        `Your <b>${genre}</b> meme hit the front page of r/all and gathered 50,000 retweets!\n\n` +
        `💰 <b>Ad Revenue:</b> +${formatCoins(viralCoins)}` +
        bonusText +
        `\n⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(viralText, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'VIRAL MEME!' });
    }

    // 3. Decent engagement
    const baseCoins = randomBetween(800, 2500);
    const earnedCoins = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 200)));
    await userRepo.updateCoins(targetUserId, {
      walletDelta: earnedCoins,
      sourceCommand: '/postmemes',
      details: `Creator Fund Ad Revenue (${genre})`
    });
    const xpRes = await addXp(targetUserId, randomBetween(20, 35));

    const text = `📈 <b>Decent Reception!</b>\n` +
      `Your <b>${genre}</b> meme collected several hundred likes and a hearty chuckle.\n\n` +
      `🪙 <b>Creator Fund:</b> +${formatCoins(earnedCoins)}\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      (xpRes.message ? `\n${xpRes.message}` : '');

    await ctx.editMessageText(text, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery({ text: 'Meme posted!' });
  }
};

export default postmemes;
