import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { addXp, getXpProgress } from '../../utils/levelEngine.js';
import { getLuckBreakdown, checkDropChance, rollLuck } from '../../utils/luckEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, formatTime, progressBar, randomBetween, pickRandom, sanitizeHtml } from '../../utils/formatters.js';
import { SEARCH_LOCATIONS } from './search.js';
import { CRIMES } from './crime.js';

async function buildFlowDashboard(userId, lastActionReport = null) {
  const user = await userRepo.getUser(userId);
  if (!user) return { text: 'User account not found.', keyboard: new InlineKeyboard() };

  const xpProg = getXpProgress(user);
  const xpBar = progressBar(xpProg.current, xpProg.max, 8);
  const activeBuffs = await inventoryRepo.getActiveBuffs(userId);
  const isPremium = await userRepo.isPremium(userId);
  const luckInfo = await getLuckBreakdown(userId);

  let buffsList = [];
  if (isPremium) buffsList.push('💎 Premium (2x Perks)');
  if (luckInfo.customLuck > 0) buffsList.push(`🎲 Custom Luck (+${luckInfo.customLuck}%)`);
  activeBuffs.forEach(b => {
    buffsList.push(`${b.buff_type.toUpperCase()} (${formatTime(b.remaining_seconds)})`);
  });

  const buffsText = buffsList.length > 0 ? buffsList.join(' • ') : 'None';

  let text = `⚡ <b>TeleMemer Grinding Flow Dashboard</b>${isPremium ? ' 💎' : ''}\n` +
    `👤 <b>Player:</b> ${sanitizeHtml(user.first_name)} | ⭐ <b>Level:</b> ${user.level} (Prestige: ${user.prestige})\n` +
    `👛 <b>Wallet:</b> ${formatCoins(user.wallet)} | 🏦 <b>Bank:</b> ${formatCoins(user.bank)} / ${formatCoins(user.bank_max)}\n` +
    `⭐ <b>XP Progress:</b> ${xpBar} (${xpProg.current}/${xpProg.max})\n` +
    `✨ <b>Active Boosts:</b> ${buffsText}\n`;

  if (lastActionReport) {
    text += `━━━━━━━━━━━━━━━━━━━━━\n${lastActionReport}\n━━━━━━━━━━━━━━━━━━━━━\n`;
  } else {
    text += `━━━━━━━━━━━━━━━━━━━━━\n<i>Tap any grinding action button below to play directly in this message!</i>\n━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  // Get cooldown statuses
  const cdBeg = await cooldownRepo.checkCooldown(userId, 'beg');
  const cdSearch = await cooldownRepo.checkCooldown(userId, 'search');
  const cdCrime = await cooldownRepo.checkCooldown(userId, 'crime');
  const cdDig = await cooldownRepo.checkCooldown(userId, 'dig');
  const cdHunt = await cooldownRepo.checkCooldown(userId, 'hunt');
  const cdFish = await cooldownRepo.checkCooldown(userId, 'fish');
  const cdMeme = await cooldownRepo.checkCooldown(userId, 'postmemes');

  const btnBeg = cdBeg.onCooldown ? `🙏 Beg (${formatTime(cdBeg.remainingSeconds)})` : '🙏 Beg';
  const btnSearch = cdSearch.onCooldown ? `🔍 Search (${formatTime(cdSearch.remainingSeconds)})` : '🔍 Search';
  const btnCrime = cdCrime.onCooldown ? `🦸 Crime (${formatTime(cdCrime.remainingSeconds)})` : '🦸 Crime';
  const btnDig = cdDig.onCooldown ? `🪣 Dig (${formatTime(cdDig.remainingSeconds)})` : '🪣 Dig';
  const btnHunt = cdHunt.onCooldown ? `🔫 Hunt (${formatTime(cdHunt.remainingSeconds)})` : '🔫 Hunt';
  const btnFish = cdFish.onCooldown ? `🎣 Fish (${formatTime(cdFish.remainingSeconds)})` : '🎣 Fish';
  const btnMeme = cdMeme.onCooldown ? `💻 Meme (${formatTime(cdMeme.remainingSeconds)})` : '💻 Meme';

  const keyboard = new InlineKeyboard()
    .text(btnBeg, `flow:beg:${userId}`)
    .text(btnSearch, `flow:search:${userId}`)
    .text(btnCrime, `flow:crime:${userId}`)
    .row()
    .text(btnDig, `flow:dig:${userId}`)
    .text(btnHunt, `flow:hunt:${userId}`)
    .text(btnFish, `flow:fish:${userId}`)
    .row()
    .text(btnMeme, `flow:postmemes:${userId}`)
    .text('🔄 Refresh Status', `flow:refresh:${userId}`)
    .row()
    .text('📜 View Currency Logs', `currencylog:page:1:all:${userId}:${userId}`);

  return { text, keyboard };
}

export const flow = {
  name: 'flow',
  aliases: [],
  description: 'Open a persistent, single-message continuous grinding dashboard',
  cooldown: 0,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const { text, keyboard } = await buildFlowDashboard(userId);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);

    if (action === 'refresh') {
      const { text, keyboard } = await buildFlowDashboard(targetUserId);
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Dashboard refreshed!' });
    }

    // Base cooldown duration map
    const cooldownMap = {
      beg: 25,
      search: 30,
      crime: 45,
      dig: 35,
      hunt: 35,
      fish: 35,
      postmemes: 35
    };

    const baseCooldownSecs = cooldownMap[action] || 30;
    const cd = await cooldownRepo.checkCooldown(targetUserId, action);
    if (cd.onCooldown) {
      const isPrem = await userRepo.isPremium(targetUserId);
      const tip = isPrem ? '' : ` (💎 Premium cooldown is ${Math.max(3, Math.floor(baseCooldownSecs * 0.5))}s!)`;
      return ctx.answerCallbackQuery({
        text: `⏳ Cooldown active for ${action}! Wait ${formatTime(cd.remainingSeconds)}.${tip}`,
        show_alert: true
      });
    }

    const luckInfo = await getLuckBreakdown(targetUserId);
    let report = '';

    // ==========================================
    // ACTION 1: BEG
    // ==========================================
    if (action === 'beg') {
      const roll = await rollLuck(targetUserId, 0, 100);
      if (roll <= 25) {
        const xpRes = await addXp(targetUserId, 10);
        report = `🥺 <b>A grumpy stranger ignored you!</b> Earned $0. (+${xpRes.earnedXp} XP)`;
      } else {
        const baseEarned = roll <= 90 ? randomBetween(250, 1200) : randomBetween(1500, 3500);
        const earned = Math.floor(baseEarned * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow beg',
          details: 'Grinding Flow: Beg handout'
        });
        const xpRes = await addXp(targetUserId);
        report = `🥺 <b>Someone spared some coins!</b> Received <b>${formatCoins(earned)}</b> (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 2: SEARCH
    // ==========================================
    else if (action === 'search') {
      const locKey = pickRandom(Object.keys(SEARCH_LOCATIONS));
      const loc = SEARCH_LOCATIONS[locKey];
      const deathChance = Math.max(0.01, loc.deathChance - (luckInfo.totalBonus / 400));

      if (Math.random() < deathChance) {
        const deathRes = await handleDeath(ctx, targetUserId, loc.deathReason);
        report = deathRes.survived
          ? `🛟 <b>Almost died searching ${loc.name}!</b> Life Saver saved your soul.`
          : `💀 <b>Died searching ${loc.name}!</b> Lost ${formatCoins(deathRes.coinsLost)}.`;
      } else {
        const baseEarned = randomBetween(loc.coinRange[0], loc.coinRange[1]);
        const earned = Math.floor(baseEarned * (1 + (luckInfo.totalBonus / 150)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow search',
          details: `Grinding Flow: Searched ${loc.name}`
        });
        let itemDrop = '';
        if (loc.itemPool.length > 0 && (await checkDropChance(targetUserId, 0.40))) {
          const itm = pickRandom(loc.itemPool);
          await inventoryRepo.addItem(targetUserId, itm, 1);
          itemDrop = ` & found 1x <b>${items[itm]?.name || itm}</b>`;
        }
        const xpRes = await addXp(targetUserId);
        report = `🔍 <b>Searched ${loc.emoji} ${loc.name}!</b> Found <b>${formatCoins(earned)}</b>${itemDrop}! (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 3: CRIME
    // ==========================================
    else if (action === 'crime') {
      const crimeKey = pickRandom(Object.keys(CRIMES));
      const crimeObj = CRIMES[crimeKey];
      const failChance = Math.max(0.02, crimeObj.failChance - (luckInfo.totalBonus / 350));

      if (Math.random() < failChance) {
        const deathRes = await handleDeath(ctx, targetUserId, crimeObj.failReason);
        report = deathRes.survived
          ? `🛟 <b>Busted during ${crimeObj.name}!</b> Your Life Saver protected you.`
          : `💀 <b>Busted during ${crimeObj.name}!</b> Lost ${formatCoins(deathRes.coinsLost)}.`;
      } else {
        const baseEarned = randomBetween(crimeObj.coinRange[0], crimeObj.coinRange[1]);
        const earned = Math.floor(baseEarned * (1 + (luckInfo.totalBonus / 120)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow crime',
          details: `Grinding Flow: ${crimeObj.name}`
        });
        const xpRes = await addXp(targetUserId, 30);
        report = `🚨 <b>Pulled off ${crimeObj.emoji} ${crimeObj.name}!</b> Escaped with <b>${formatCoins(earned)}</b>! (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 4: DIG
    // ==========================================
    else if (action === 'dig') {
      if (!(await inventoryRepo.hasItem(targetUserId, 'shovel', 1))) {
        return ctx.answerCallbackQuery({
          text: '❌ You do not have a Shovel! Run /buy shovel first.',
          show_alert: true
        });
      }

      const breakProb = Math.max(0.01, 0.05 - (luckInfo.totalBonus / 2000));
      if (Math.random() < breakProb) {
        await inventoryRepo.removeItem(targetUserId, 'shovel', 1);
        report = `💥 <b>SNAP!</b> Your 🪣 <b>Shovel broke</b> while digging!`;
      } else {
        const itm = pickRandom(['worm', 'ant', 'garbage']);
        await inventoryRepo.addItem(targetUserId, itm, 1);
        const baseEarned = randomBetween(500, 1500);
        const earned = Math.floor(baseEarned * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow dig',
          details: `Grinding Flow: Dug up ${items[itm].name}`
        });
        const xpRes = await addXp(targetUserId, 20);
        report = `🪣 <b>Dug into dirt:</b> Found 1x <b>${items[itm].name}</b> & <b>${formatCoins(earned)}</b>! (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 5: HUNT
    // ==========================================
    else if (action === 'hunt') {
      if (!(await inventoryRepo.hasItem(targetUserId, 'rifle', 1))) {
        return ctx.answerCallbackQuery({
          text: '❌ You do not have a Hunting Rifle! Run /buy rifle first.',
          show_alert: true
        });
      }

      const breakProb = Math.max(0.01, 0.05 - (luckInfo.totalBonus / 2000));
      if (Math.random() < breakProb) {
        await inventoryRepo.removeItem(targetUserId, 'rifle', 1);
        report = `💥 <b>MISFIRE!</b> Your 🔫 <b>Hunting Rifle backfired and broke!</b>`;
      } else if (await checkDropChance(targetUserId, 0.01)) {
        await inventoryRepo.addItem(targetUserId, 'dragon', 1);
        const earned = Math.floor(randomBetween(5000, 15000) * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow hunt',
          details: 'Grinding Flow: Slain Mythic Dragon'
        });
        const xpRes = await addXp(targetUserId, 100);
        report = `🐉 <b>MYTHIC DRAGON SLAIN!</b> Found 1x <b>Mythic Dragon</b> & <b>${formatCoins(earned)}</b>! (+${xpRes.earnedXp} XP)`;
      } else {
        const prey = Math.random() < 0.5 ? 'boar' : 'deer';
        await inventoryRepo.addItem(targetUserId, prey, 1);
        const xpRes = await addXp(targetUserId, 25);
        report = `🔫 <b>Hunt Successful!</b> Bagged 1x ${items[prey].emoji} <b>${items[prey].name}</b>! (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 6: FISH
    // ==========================================
    else if (action === 'fish') {
      if (!(await inventoryRepo.hasItem(targetUserId, 'fishingpole', 1))) {
        return ctx.answerCallbackQuery({
          text: '❌ You do not have a Fishing Pole! Run /buy fishingpole first.',
          show_alert: true
        });
      }

      const breakProb = Math.max(0.01, 0.05 - (luckInfo.totalBonus / 2000));
      if (Math.random() < breakProb) {
        await inventoryRepo.removeItem(targetUserId, 'fishingpole', 1);
        report = `💥 <b>CRACK!</b> Your 🎣 <b>Fishing Pole snapped!</b>`;
      } else if (await checkDropChance(targetUserId, 0.01)) {
        await inventoryRepo.addItem(targetUserId, 'kraken', 1);
        const earned = Math.floor(randomBetween(8000, 20000) * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow fish',
          details: 'Grinding Flow: Caught Kraken'
        });
        const xpRes = await addXp(targetUserId, 100);
        report = `🦑 <b>ABYSSAL KRAKEN REELED IN!</b> Added 1x <b>Kraken</b> & <b>${formatCoins(earned)}</b>! (+${xpRes.earnedXp} XP)`;
      } else {
        const fishId = Math.random() < (0.35 + (luckInfo.totalBonus / 300)) ? 'tropicalfish' : 'commonfish';
        await inventoryRepo.addItem(targetUserId, fishId, 1);
        const earned = Math.floor(randomBetween(200, 800) * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow fish',
          details: `Grinding Flow: Caught ${items[fishId].name}`
        });
        const xpRes = await addXp(targetUserId, 25);
        report = `🎣 <b>Reeled in:</b> 1x ${items[fishId].emoji} <b>${items[fishId].name}</b> & <b>${formatCoins(earned)}</b>! (+${xpRes.earnedXp} XP)`;
      }
    }

    // ==========================================
    // ACTION 7: POST MEMES
    // ==========================================
    else if (action === 'postmemes') {
      if (!(await inventoryRepo.hasItem(targetUserId, 'laptop', 1))) {
        return ctx.answerCallbackQuery({
          text: '❌ You do not have a Laptop! Run /buy laptop first.',
          show_alert: true
        });
      }

      const roll = await rollLuck(targetUserId, 1, 100);
      if (roll <= 20) {
        const breakProb = Math.max(0.05, 0.35 - (luckInfo.totalBonus / 500));
        if (Math.random() < breakProb) {
          await inventoryRepo.removeItem(targetUserId, 'laptop', 1);
          report = `📉 <b>Downvoted!</b> You rage-smashed your 💻 <b>Laptop</b>!`;
        } else {
          report = `📉 <b>Downvoted!</b> Your meme was called cringe and deleted.`;
        }
      } else if (roll > 80) {
        const earned = Math.floor(randomBetween(3500, 7000) * (1 + (luckInfo.totalBonus / 150)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow postmemes',
          details: 'Grinding Flow: Viral Meme'
        });
        const bonusItm = pickRandom(['banknote', 'ducttape']);
        await inventoryRepo.addItem(targetUserId, bonusItm, 1);
        const xpRes = await addXp(targetUserId, 40);
        report = `🚀 <b>VIRAL MEME!</b> Earned <b>${formatCoins(earned)}</b> & 1x <b>${items[bonusItm].name}</b>! (+${xpRes.earnedXp} XP)`;
      } else {
        const earned = Math.floor(randomBetween(800, 2500) * (1 + (luckInfo.totalBonus / 200)));
        await userRepo.updateCoins(targetUserId, {
          walletDelta: earned,
          sourceCommand: '/flow postmemes',
          details: 'Grinding Flow: Meme Ad Revenue'
        });
        const xpRes = await addXp(targetUserId, 25);
        report = `📈 <b>Decent post!</b> Received <b>${formatCoins(earned)}</b> in ad revenue. (+${xpRes.earnedXp} XP)`;
      }
    }

    // Apply effective cooldown (50% reduction for Premium)
    await cooldownRepo.applyEffectiveCooldown(targetUserId, action, baseCooldownSecs);

    // Rebuild dashboard with updated status and action report
    const { text, keyboard } = await buildFlowDashboard(targetUserId, report);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery({ text: 'Action resolved!' });
  }
};

export default flow;
