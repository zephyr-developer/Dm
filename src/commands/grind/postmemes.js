import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const postmemes = {
  name: 'postmemes',
  aliases: ['pm'],
  description: 'Post memes on social media from your laptop for ad revenue and fame',
  cooldown: 35,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!inventoryRepo.hasItem(userId, 'laptop', 1)) {
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

    const hasHorseshoe = inventoryRepo.hasBuff(targetUserId, 'horseshoe');
    const roll = randomBetween(1, 100) + (hasHorseshoe ? 10 : 0);

    // 1. 20% Downvoted (Roll <= 20)
    if (roll <= 20) {
      let laptopBroke = false;
      // 35% chance laptop breaks on rage
      if (Math.random() < 0.35) {
        inventoryRepo.removeItem(targetUserId, 'laptop', 1);
        laptopBroke = true;
      }

      const breakMsg = laptopBroke
        ? `\n\n💥 <b>RAGE SMASH!</b> You raged at the comment section and smashed your 💻 <b>Laptop</b> into pieces! Buy a new one with <code>/buy laptop</code>.`
        : '';

      const xpRes = addXp(targetUserId, 15);
      const text = `📉 <b>DOWNVOTED TO OBLIVION!</b>\n` +
        `Your <b>${genre}</b> meme received 0 upvotes, was branded "cringe" by Reddit moderators, and was deleted.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        breakMsg +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(text, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Downvoted!' });
    }

    // 2. 15% Viral (Roll > 85)
    if (roll > 85) {
      const viralCoins = randomBetween(3500, 7000);
      userRepo.updateWallet(targetUserId, viralCoins);

      const bonusItemId = pickRandom(['banknote', 'ducttape']);
      inventoryRepo.addItem(targetUserId, bonusItemId, 1);
      const bonusItem = items[bonusItemId];

      const xpRes = addXp(targetUserId, randomBetween(35, 55));
      const viralText = `🚀 <b>VIRAL EXPLOSION!</b>\n` +
        `Your <b>${genre}</b> meme hit the front page of r/all and gathered 50,000 retweets!\n\n` +
        `💰 <b>Ad Revenue:</b> +${formatCoins(viralCoins)}\n` +
        `🎁 <b>Sponsorship Gift:</b> 1x ${bonusItem.emoji} <b>${bonusItem.name}</b>\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(viralText, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'VIRAL MEME!' });
    }

    // 3. 65% Decent engagement (Roll 21–85)
    const earnedCoins = randomBetween(800, 2500);
    userRepo.updateWallet(targetUserId, earnedCoins);
    const xpRes = addXp(targetUserId, randomBetween(20, 35));

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
