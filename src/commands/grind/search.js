import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';
import { getLuckBreakdown, checkDropChance } from '../../utils/luckEngine.js';

export const SEARCH_LOCATIONS = {
  dumpster: {
    id: 'dumpster',
    name: 'Dumpster',
    emoji: '🗑️',
    coinRange: [400, 1500],
    itemPool: ['garbage', 'worm', 'ant'],
    deathChance: 0.08,
    deathReason: 'getting crushed by a reckless garbage disposal truck'
  },
  area51: {
    id: 'area51',
    name: 'Area 51',
    emoji: '🛸',
    coinRange: [2000, 5000],
    itemPool: ['banknote', 'ducttape'],
    deathChance: 0.20,
    deathReason: 'vaporization by alien plasma laser turrets'
  },
  momspurse: {
    id: 'momspurse',
    name: "Mom's Purse",
    emoji: '👜',
    coinRange: [600, 2000],
    itemPool: ['apple', 'ducttape'],
    deathChance: 0.10,
    deathReason: 'getting struck by mom\'s pinpoint flying sandal (la chancla)'
  },
  air: {
    id: 'air',
    name: 'Thin Air',
    emoji: '💨',
    coinRange: [100, 600],
    itemPool: [],
    deathChance: 0.05,
    deathReason: 'spontaneously forgetting how to breathe oxygen'
  },
  discordhq: {
    id: 'discordhq',
    name: 'Discord HQ',
    emoji: '💬',
    coinRange: [800, 2500],
    itemPool: ['laptop', 'garbage'],
    deathChance: 0.12,
    deathReason: 'choking on toxic unchecked nitro notifications'
  },
  sewer: {
    id: 'sewer',
    name: 'City Sewer',
    emoji: '🕳️',
    coinRange: [500, 1800],
    itemPool: ['worm', 'garbage'],
    deathChance: 0.12,
    deathReason: 'ambushed by a mutated subterranean sewer alligator'
  },
  hospital: {
    id: 'hospital',
    name: 'Hospital',
    emoji: '🏥',
    coinRange: [700, 2200],
    itemPool: ['lifesaver', 'apple'],
    deathChance: 0.08,
    deathReason: 'accidentally getting wheeled into an experimental brain surgery'
  },
  bankvault: {
    id: 'bankvault',
    name: 'Bank Vault',
    emoji: '🏦',
    coinRange: [2500, 6000],
    itemPool: ['banknote', 'pepecoin'],
    deathChance: 0.18,
    deathReason: 'being locked inside the airtight steel vault overnight'
  },
  tree: {
    id: 'tree',
    name: 'Tall Tree',
    emoji: '🌳',
    coinRange: [300, 1200],
    itemPool: ['ant', 'worm', 'apple'],
    deathChance: 0.09,
    deathReason: 'falling 40 feet while trying to grab a shiny wrapper'
  },
  attic: {
    id: 'attic',
    name: 'Creepy Attic',
    emoji: '🕸️',
    coinRange: [500, 1900],
    itemPool: ['ducttape', 'garbage'],
    deathChance: 0.10,
    deathReason: 'falling through the weak drywall ceiling into the living room'
  },
  uber: {
    id: 'uber',
    name: 'Back of an Uber',
    emoji: '🚕',
    coinRange: [400, 1600],
    itemPool: ['apple'],
    deathChance: 0.06,
    deathReason: 'the driver crashing into a light pole while streaming on TikTok'
  },
  fridge: {
    id: 'fridge',
    name: 'Office Fridge',
    emoji: '🧊',
    coinRange: [200, 1000],
    itemPool: ['apple', 'garbage'],
    deathChance: 0.05,
    deathReason: 'eating unlabeled mystery leftovers from three months ago'
  }
};

export const search = {
  name: 'search',
  aliases: [],
  description: 'Search diverse locations for coins and secret items',
  cooldown: 30,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    // Pick 3 random distinct locations
    const allKeys = Object.keys(SEARCH_LOCATIONS);
    const shuffled = allKeys.sort(() => 0.5 - Math.random());
    const selected = [shuffled[0], shuffled[1], shuffled[2]];

    const keyboard = new InlineKeyboard();
    selected.forEach(key => {
      const loc = SEARCH_LOCATIONS[key];
      keyboard.text(`${loc.emoji} ${loc.name}`, `search:${key}:${userId}`);
    });

    const msg = `🔍 <b>Where do you want to search?</b>\n` +
      `Pick a location below. Some places hold immense riches, but beware of mortal danger!`;

    await ctx.reply(msg, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const locKey = parts[1];
    const targetUserId = Number(parts[2]);

    const location = SEARCH_LOCATIONS[locKey];
    if (!location) {
      return ctx.answerCallbackQuery({ text: 'Location not found!' });
    }

    const luckInfo = getLuckBreakdown(targetUserId);
    // Luck reduces death chance and boosts rewards
    const deathReduction = luckInfo.totalBonus / 400;
    const effectiveDeathChance = Math.max(0.01, location.deathChance - deathReduction);

    // Roll for death
    if (Math.random() < effectiveDeathChance) {
      const deathResult = await handleDeath(ctx, targetUserId, location.deathReason);
      await ctx.editMessageText(deathResult.message, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: deathResult.survived ? 'Saved by Life Saver!' : 'You died!' });
    }

    // Success! Calculate coins
    const baseCoins = randomBetween(location.coinRange[0], location.coinRange[1]);
    const earnedCoins = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 150)));
    userRepo.updateWallet(targetUserId, earnedCoins);

    // Roll for item drop with luck multiplier
    let dropMsg = '';
    if (location.itemPool.length > 0 && checkDropChance(targetUserId, 0.40)) {
      const itemId = pickRandom(location.itemPool);
      inventoryRepo.addItem(targetUserId, itemId, 1);
      const itm = items[itemId] || { emoji: '📦', name: itemId };
      dropMsg = `\n🎁 You also uncovered 1x ${itm.emoji} <b>${itm.name}</b>!`;
    }

    const xpResult = addXp(targetUserId);

    let luckTag = '';
    if (luckInfo.customLuck > 0) {
      luckTag = ` <i>(🎲 +${luckInfo.customLuck}% custom luck active!)</i>`;
    } else if (luckInfo.hasHorseshoe) {
      luckTag = ' <i>(🧲 Lucky Horseshoe bonus!)</i>';
    }

    const resultText = `🔍 You scavenged inside the <b>${location.emoji} ${location.name}</b> and discovered <b>${formatCoins(earnedCoins)}</b>!` +
      luckTag +
      dropMsg +
      `\n⭐ <b>XP Earned:</b> +${xpResult.earnedXp} XP` +
      (xpResult.message ? `\n${xpResult.message}` : '');

    await ctx.editMessageText(resultText, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery({ text: 'Search complete!' });
  }
};

export default search;
