import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { addXp } from '../../utils/levelEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom } from '../../utils/formatters.js';
import { getLuckBreakdown, checkDropChance } from '../../utils/luckEngine.js';

export const CRIMES = {
  taxevasion: {
    id: 'taxevasion',
    name: 'Tax Evasion',
    emoji: '📂',
    coinRange: [3000, 7500],
    itemPool: ['banknote'],
    failChance: 0.25,
    failReason: 'getting raided by IRS tactical agents in ballistic vests'
  },
  hackpentagon: {
    id: 'hackpentagon',
    name: 'Hack Pentagon',
    emoji: '💻',
    coinRange: [4000, 9000],
    itemPool: ['laptop', 'banknote'],
    failChance: 0.35,
    failReason: 'getting counter-traced and struck by a Predator drone strike'
  },
  robmom: {
    id: 'robmom',
    name: 'Rob a Grandma',
    emoji: '👵',
    coinRange: [2000, 5000],
    itemPool: ['apple'],
    failChance: 0.20,
    failReason: 'grandma pulling out a 12-gauge shotgun from her knitting bag'
  },
  piratemovies: {
    id: 'piratemovies',
    name: 'Pirate Movies',
    emoji: '🏴‍☠️',
    coinRange: [2500, 6000],
    itemPool: ['ducttape'],
    failChance: 0.15,
    failReason: 'FBI anti-piracy warning turning into real SWAT breaching charges'
  },
  counterfeit: {
    id: 'counterfeit',
    name: 'Counterfeit Pepe Coins',
    emoji: '🪙',
    coinRange: [3500, 8500],
    itemPool: ['pepecoin'],
    failChance: 0.30,
    failReason: 'the toxic printing fumes dissolving your respiratory organs'
  },
  stealtrafficcone: {
    id: 'stealtrafficcone',
    name: 'Steal Traffic Cone',
    emoji: '🚧',
    coinRange: [1500, 3500],
    itemPool: ['garbage'],
    failChance: 0.12,
    failReason: 'getting hit by a cement mixer truck while sprinting away'
  }
};

export const crime = {
  name: 'crime',
  aliases: [],
  description: 'Commit daring illicit acts for massive coin payouts',
  cooldown: 45,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const keys = Object.keys(CRIMES);
    const shuffled = keys.sort(() => 0.5 - Math.random());
    const selected = [shuffled[0], shuffled[1], shuffled[2]];

    const keyboard = new InlineKeyboard();
    selected.forEach(k => {
      const c = CRIMES[k];
      keyboard.text(`${c.emoji} ${c.name}`, `crime:${k}:${userId}`);
    });

    const prompt = `🦸 <b>What crime will you attempt?</b>\n` +
      `High-risk endeavors with massive rewards. But beware: failure is often fatal!`;

    await ctx.reply(prompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const crimeKey = parts[1];
    const targetUserId = Number(parts[2]);

    const targetCrime = CRIMES[crimeKey];
    if (!targetCrime) {
      return ctx.answerCallbackQuery({ text: 'Crime not found!' });
    }

    const luckInfo = await getLuckBreakdown(targetUserId);
    const failReduction = luckInfo.totalBonus / 350;
    const effectiveFailChance = Math.max(0.02, targetCrime.failChance - failReduction);

    // Roll for failure/death
    if (Math.random() < effectiveFailChance) {
      const deathRes = await handleDeath(ctx, targetUserId, targetCrime.failReason);
      await ctx.editMessageText(deathRes.message, { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: deathRes.survived ? 'Saved by Life Saver!' : 'Busted & Ruined!' });
    }

    // Success!
    const baseCoins = randomBetween(targetCrime.coinRange[0], targetCrime.coinRange[1]);
    const earnedCoins = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 120)));
    await userRepo.updateCoins(targetUserId, {
      walletDelta: earnedCoins,
      sourceCommand: '/crime',
      details: `Committed ${targetCrime.name} (${targetCrime.emoji})`
    });

    let dropMsg = '';
    // 30% base chance for crime item, boosted by luck
    if (targetCrime.itemPool.length > 0 && (await checkDropChance(targetUserId, 0.30))) {
      const itmId = pickRandom(targetCrime.itemPool);
      await inventoryRepo.addItem(targetUserId, itmId, 1);
      const itm = items[itmId] || { emoji: '📦', name: itmId };
      dropMsg = `\n🎁 You also stashed away 1x ${itm.emoji} <b>${itm.name}</b>!`;
    }

    const xpRes = await addXp(targetUserId, randomBetween(25, 45));

    let luckTag = '';
    if (luckInfo.customLuck > 0) {
      luckTag = ` <i>(🎲 +${luckInfo.customLuck}% custom luck active!)</i>`;
    } else if (luckInfo.hasHorseshoe) {
      luckTag = ' <i>(🧲 Lucky Horseshoe bonus!)</i>';
    }

    const resultMsg = `🚨 <b>CRIME SUCCESSFUL!</b>\n` +
      `You pulled off <b>${targetCrime.emoji} ${targetCrime.name}</b> and walked away with <b>${formatCoins(earnedCoins)}</b>!` +
      luckTag +
      dropMsg +
      `\n⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
      (xpRes.message ? `\n${xpRes.message}` : '');

    await ctx.editMessageText(resultMsg, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery({ text: 'Crime completed!' });
  }
};

export default crime;
