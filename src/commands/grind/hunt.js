import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown, checkDropChance, rollLuck } from '../../utils/luckEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween } from '../../utils/formatters.js';

export const hunt = {
  name: 'hunt',
  aliases: [],
  description: 'Venture into the wilderness with a rifle to hunt wild beasts',
  cooldown: 35, // 17s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!(await inventoryRepo.hasItem(userId, 'rifle', 1))) {
      return ctx.reply(
        `🔫 <b>You need a Hunting Rifle to go hunting!</b>\n` +
        `Visit the shop to purchase one: <code>/buy rifle</code> (Cost: 🪙 25,000)`,
        { parse_mode: 'HTML' }
      );
    }

    const luckInfo = await getLuckBreakdown(userId);

    // Break chance (reduced if high luck)
    const breakProb = Math.max(0.01, 0.05 - (luckInfo.totalBonus / 2000));
    let rifleBroke = false;
    if (Math.random() < breakProb) {
      await inventoryRepo.removeItem(userId, 'rifle', 1);
      rifleBroke = true;
    }

    const breakNotice = rifleBroke
      ? `\n\n💥 <b>MISFIRE!</b> Your 🔫 <b>Hunting Rifle backfired and broke!</b> Buy a new one with <code>/buy rifle</code>.`
      : '';

    // Check for rare Dragon: 1% base chance boosted by luckEngine
    if (await checkDropChance(userId, 0.01)) {
      await inventoryRepo.addItem(userId, 'dragon', 1);
      const bonusCoins = Math.floor(randomBetween(5000, 15000) * (1 + (luckInfo.totalBonus / 200)));
      await userRepo.updateCoins(userId, {
        walletDelta: bonusCoins,
        sourceCommand: '/hunt',
        details: 'Slayed Legendary Mythic Dragon'
      });
      const xpRes = await addXp(userId, 100);

      const dragonItem = items.dragon;
      let luckTag = luckInfo.customLuck > 0 ? ` <i>(🎲 +${luckInfo.customLuck}% luck active!)</i>` : '';

      return ctx.reply(
        `🐉 <b>LEGENDARY ENCOUNTER!</b>${luckTag}\n` +
        `You sighted a blazing beast soaring above the mountain ridge and took the shot of a lifetime!\n\n` +
        `🏆 <b>Brought Down:</b> 1x ${dragonItem.emoji} <b>${dragonItem.name}</b> (Value: 🪙 35,000)\n` +
        `🪙 <b>Bounty Claimed:</b> +${formatCoins(bonusCoins)}\n` +
        `⭐ <b>XP Earned:</b> +100 XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    const roll = await rollLuck(userId, 1, 100);

    // 20% nothing (Roll <= 20)
    if (roll <= 20) {
      const xpRes = await addXp(userId, 15);
      return ctx.reply(
        `🔫 You stalked the dark forest for 30 minutes, but all the animals were frightened away by your loud footsteps.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // High roll: Both Boar & Deer + coins
    if (roll > 80) {
      await inventoryRepo.addItem(userId, 'boar', 1);
      await inventoryRepo.addItem(userId, 'deer', 1);
      const baseCoins = randomBetween(1000, 3000);
      const foundCoins = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 200)));
      await userRepo.updateCoins(userId, {
        walletDelta: foundCoins,
        sourceCommand: '/hunt',
        details: 'Double Hunt (Boar & Deer)'
      });
      const xpRes = await addXp(userId, randomBetween(35, 50));

      return ctx.reply(
        `🎯 <b>DOUBLE KILL!</b>\n` +
        `You took down both a 🐗 <b>Wild Boar</b> and a 🦌 <b>Majestic Deer</b>, plus recovered <b>${formatCoins(foundCoins)}</b> from an abandoned hunter stash!\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // Standard game: Boar or Deer
    const targetPrey = Math.random() < 0.5 ? 'boar' : 'deer';
    await inventoryRepo.addItem(userId, targetPrey, 1);
    const preyObj = items[targetPrey];
    const xpRes = await addXp(userId, randomBetween(20, 35));

    return ctx.reply(
      `🔫 <b>Direct Hit!</b> You brought down 1x ${preyObj.emoji} <b>${preyObj.name}</b>!\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      breakNotice +
      (xpRes.message ? `\n${xpRes.message}` : ''),
      { parse_mode: 'HTML' }
    );
  }
};

export default hunt;
