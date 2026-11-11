import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const hunt = {
  name: 'hunt',
  aliases: [],
  description: 'Venture into the wilderness with a rifle to hunt wild beasts',
  cooldown: 35,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    if (!inventoryRepo.hasItem(userId, 'rifle', 1)) {
      return ctx.reply(
        `🔫 <b>You need a Hunting Rifle to go hunting!</b>\n` +
        `Visit the shop to purchase one: <code>/buy rifle</code> (Cost: 🪙 25,000)`,
        { parse_mode: 'HTML' }
      );
    }

    const hasHorseshoe = inventoryRepo.hasBuff(userId, 'horseshoe');

    // 5% chance rifle breaks
    let rifleBroke = false;
    if (Math.random() < 0.05) {
      inventoryRepo.removeItem(userId, 'rifle', 1);
      rifleBroke = true;
    }

    const breakNotice = rifleBroke
      ? `\n\n💥 <b>MISFIRE!</b> Your 🔫 <b>Hunting Rifle backfired and broke!</b> Buy a new one with <code>/buy rifle</code>.`
      : '';

    // Check for rare Dragon: 1% base, 3% with horseshoe
    const dragonChance = hasHorseshoe ? 0.03 : 0.01;
    if (Math.random() < dragonChance) {
      inventoryRepo.addItem(userId, 'dragon', 1);
      const bonusCoins = randomBetween(5000, 15000);
      userRepo.updateWallet(userId, bonusCoins);
      const xpRes = addXp(userId, 100);

      const dragonItem = items.dragon;
      return ctx.reply(
        `🐉 <b>LEGENDARY ENCOUNTER!</b>\n` +
        `You sighted a blazing beast soaring above the mountain ridge and took the shot of a lifetime!\n\n` +
        `🏆 <b>Brought Down:</b> 1x ${dragonItem.emoji} <b>${dragonItem.name}</b> (Value: 🪙 35,000)\n` +
        `🪙 <b>Bounty Claimed:</b> +${formatCoins(bonusCoins)}\n` +
        `⭐ <b>XP Earned:</b> +100 XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    const roll = randomBetween(1, 100);

    // 20% nothing
    if (roll <= 20) {
      const xpRes = addXp(userId, 15);
      return ctx.reply(
        `🔫 You stalked the dark forest for 30 minutes, but all the animals were frightened away by your loud footsteps.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // 14% Both Boar & Deer + coins
    if (roll > 86) {
      inventoryRepo.addItem(userId, 'boar', 1);
      inventoryRepo.addItem(userId, 'deer', 1);
      const foundCoins = randomBetween(1000, 3000);
      userRepo.updateWallet(userId, foundCoins);
      const xpRes = addXp(userId, randomBetween(35, 50));

      return ctx.reply(
        `🎯 <b>DOUBLE KILL!</b>\n` +
        `You took down both a 🐗 <b>Wild Boar</b> and a 🦌 <b>Majestic Deer</b>, plus recovered <b>${formatCoins(foundCoins)}</b> from an abandoned hunter stash!\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // 50% Boar or Deer
    const targetPrey = Math.random() < 0.5 ? 'boar' : 'deer';
    inventoryRepo.addItem(userId, targetPrey, 1);
    const preyObj = items[targetPrey];
    const xpRes = addXp(userId, randomBetween(20, 35));

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
