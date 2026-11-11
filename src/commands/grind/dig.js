import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';

export const dig = {
  name: 'dig',
  aliases: [],
  description: 'Dig in the earth with a shovel for buried treasures and critters',
  cooldown: 35,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    // Verify user owns a shovel
    if (!inventoryRepo.hasItem(userId, 'shovel', 1)) {
      return ctx.reply(
        `🪣 <b>You need a Shovel to dig!</b>\n` +
        `Visit the shop to purchase one: <code>/buy shovel</code> (Cost: 🪙 25,000)`,
        { parse_mode: 'HTML' }
      );
    }

    const hasHorseshoe = inventoryRepo.hasBuff(userId, 'horseshoe');
    const roll = randomBetween(1, 100) + (hasHorseshoe ? 10 : 0);

    // 5% chance shovel breaks
    let shovelBroke = false;
    if (Math.random() < 0.05) {
      inventoryRepo.removeItem(userId, 'shovel', 1);
      shovelBroke = true;
    }

    const breakNotice = shovelBroke
      ? `\n\n💥 <b>SNAP!</b> Your 🪣 <b>Shovel broke</b> while digging! Buy a replacement with <code>/buy shovel</code>.`
      : '';

    // Outcome 1: Nothing (Roll <= 20)
    if (roll <= 20) {
      const xpRes = addXp(userId, 15);
      return ctx.reply(
        `🪣 You dug a giant hole in the mud and found absolutely nothing but wet dirt.\n` +
        `⭐ +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // Outcome 2: Rare Loot (Roll > 75)
    if (roll > 75) {
      const rareItemId = pickRandom(['banknote', 'coinbomb']);
      const rareItem = items[rareItemId];
      const coinsFound = randomBetween(1500, 3500);

      inventoryRepo.addItem(userId, rareItemId, 1);
      userRepo.updateWallet(userId, coinsFound);
      const xpRes = addXp(userId, randomBetween(30, 45));

      return ctx.reply(
        `🌟 <b>RARE UNVEILING!</b>\n` +
        `Your shovel struck something solid buried deep in the ground!\n\n` +
        `🎁 <b>Item Unearthed:</b> 1x ${rareItem.emoji} <b>${rareItem.name}</b>\n` +
        `🪙 <b>Coins Found:</b> +${formatCoins(coinsFound)}\n` +
        `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        breakNotice +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // Outcome 3: Common Loot (Roll 21–75)
    const commonItemId = pickRandom(['worm', 'ant', 'garbage']);
    const commonItem = items[commonItemId];
    const coinsFound = randomBetween(500, 1500);

    inventoryRepo.addItem(userId, commonItemId, 1);
    userRepo.updateWallet(userId, coinsFound);
    const xpRes = addXp(userId, randomBetween(20, 30));

    return ctx.reply(
      `🪣 You dug into the dirt and unearthed 1x ${commonItem.emoji} <b>${commonItem.name}</b> and <b>${formatCoins(coinsFound)}</b>!\n` +
      `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      breakNotice +
      (xpRes.message ? `\n${xpRes.message}` : ''),
      { parse_mode: 'HTML' }
    );
  }
};

export default dig;
