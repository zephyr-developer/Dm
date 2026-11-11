import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown, rollLuck, checkDropChance } from '../../utils/luckEngine.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';
import { items } from '../../config/items.js';

const REJECTION_NPCS = [
  { name: 'Elon Musk', text: 'told you to buy a Twitter Blue checkmark before asking for handouts. $0' },
  { name: 'Gordon Ramsay', text: 'shouted "YOUR POCKETS ARE RAW, YOU DONKEY!" and walked away. $0' },
  { name: 'Mark Zuckerberg', text: 'stared silently into your soul with unblinking reptile eyes. $0' },
  { name: 'MrBeast', text: 'said "I gave $1,000,000 to the last guy, you missed out!" $0' },
  { name: 'A random pigeon', text: 'pooped on your forehead and fluttered off. $0' },
  { name: 'Snoop Dogg', text: 'handed you a puff of smoke instead of cold cash. $0' },
  { name: 'Your Landlord', text: 'demanded tip money on top of your rent. $0' }
];

const GENEROUS_NPCS = [
  'A sympathetic grandma',
  'Shrek',
  'A mysterious billionaire in a hoodie',
  'A dog with a coin in its mouth',
  'Keanu Reeves',
  'A generous Twitch streamer',
  'Doge himself',
  'A drunk software engineer'
];

export const beg = {
  name: 'beg',
  aliases: [],
  description: 'Beg passersby and celebrities for spare change (boosted by luck)',
  cooldown: 25, // 12s for Premium

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const luckInfo = getLuckBreakdown(userId);
    const roll = rollLuck(userId, 0, 100);

    // 0–25: Rejection (If roll < 25)
    if (roll <= 25) {
      const npc = pickRandom(REJECTION_NPCS);
      const xpRes = addXp(userId, randomBetween(10, 15));
      return ctx.reply(
        `🥺 <b>${npc.name}</b> ${npc.text}\n` +
        `⭐ +${xpRes.earnedXp} XP for trying.` +
        (xpRes.message ? `\n${xpRes.message}` : ''),
        { parse_mode: 'HTML' }
      );
    }

    // 26–90: Moderate success
    let earnedCoins = 0;
    let extraItemMsg = '';
    const donor = pickRandom(GENEROUS_NPCS);

    if (roll <= 90) {
      earnedCoins = randomBetween(250, 1200);
    } else {
      // 91+: Big generous donor + item chance
      earnedCoins = randomBetween(1500, 3500);
      if (checkDropChance(userId, 0.25)) {
        const bonusItem = pickRandom(['garbage', 'worm']);
        inventoryRepo.addItem(userId, bonusItem, 1);
        const itemObj = items[bonusItem];
        extraItemMsg = `\n🎁 They also tossed you 1x ${itemObj.emoji} <b>${itemObj.name}</b>!`;
      }
    }

    // Multiply coins slightly if luck is high
    if (luckInfo.totalBonus > 0) {
      earnedCoins = Math.floor(earnedCoins * (1 + (luckInfo.totalBonus / 200)));
    }

    userRepo.updateWallet(userId, earnedCoins);
    const xpResult = addXp(userId);

    let luckNotice = '';
    if (luckInfo.customLuck > 0) {
      luckNotice = ` <i>(🎲 +${luckInfo.customLuck}% custom luck active!)</i>`;
    } else if (luckInfo.hasHorseshoe) {
      luckNotice = ' <i>(🧲 Horseshoe bonus applied!)</i>';
    }

    const replyText = `🥺 <b>${donor}</b> took pity on you and gave you <b>${formatCoins(earnedCoins)}</b>!${luckNotice}\n` +
      `⭐ <b>XP Earned:</b> +${xpResult.earnedXp} XP` +
      extraItemMsg +
      (xpResult.message ? `\n${xpResult.message}` : '');

    return ctx.reply(replyText, { parse_mode: 'HTML' });
  }
};

export default beg;
