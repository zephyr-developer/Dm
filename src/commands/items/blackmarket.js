import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { formatTime, sanitizeHtml } from '../../utils/formatters.js';

export const BLACK_MARKET_ITEMS = {
  luckboost: {
    id: 'luckboost',
    name: 'Permanent Casino Charm',
    emoji: '🍀',
    costShards: 5,
    description: 'Permanently increases your perm_luck_bonus by +5% (stackable up to +25% max).'
  },
  heistshield: {
    id: 'heistshield',
    name: 'Aegis Sovereign Vault',
    emoji: '🛡️',
    costShards: 10,
    description: 'Grants 7 full days of unbreakable Vault Lock protection against bank heists.'
  },
  sovereigntitle: {
    id: 'sovereigntitle',
    name: 'Title: 「 Sovereign Overlord 」',
    emoji: '👑',
    costShards: 15,
    description: 'Unlocks the exclusive prestige-proof title Sovereign Overlord in /title.'
  },
  ultimatetoken: {
    id: 'ultimatetoken',
    name: 'Permanent Ultimate Gambler Pass',
    emoji: '🎰',
    costShards: 25,
    description: 'Permanently unlocks Ultimate Gambler (no 100M bet cap + VIP casino multipliers forever!).'
  }
};

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60; // 604,800s
const MAX_PERM_LUCK = 25;

function hasUnlockedSpecialTitle(user, titleName) {
  return String(user?.unlocked_titles || '')
    .split('|')
    .map(s => s.trim().toLowerCase())
    .includes(titleName.toLowerCase());
}

async function buildBlackMarketMenu(userId) {
  const user = await userRepo.getUser(userId);
  const shards = Math.max(0, Math.floor(Number(user?.sovereign_shards || 0)));
  const permLuck = Math.min(MAX_PERM_LUCK, Math.max(0, Number(user?.perm_luck_bonus || 0)));
  const isPermUlt = Number(user?.ultimate_expires_at) === -1;
  const aegisRemSec = await inventoryRepo.getBuffRemaining(userId, 'aegis_vault');
  const hasSovTitle = hasUnlockedSpecialTitle(user, 'Sovereign Overlord');

  const text =
    `🕶️ <b>THE SOVEREIGN BLACK MARKET</b>\n` +
    `<i>Endgame VIP Upgrades Exclusively Priced in 💠 Sovereign Shards</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💠 <b>Your Sovereign Shards:</b> <b>${shards.toLocaleString('en-US')} 💠</b>\n\n` +
    `🍀 <b>luckboost</b> — <b>Permanent Casino Charm</b> (<b>5 💠</b>)\n` +
    `• +5% Permanent Luck (Current: <b>+${permLuck}% / +25%</b>)\n` +
    `• <i>${BLACK_MARKET_ITEMS.luckboost.description}</i>\n\n` +
    `🛡️ <b>heistshield</b> — <b>Aegis Sovereign Vault</b> (<b>10 💠</b>)\n` +
    `• Status: ${aegisRemSec > 0 ? `🟢 Active (${formatTime(aegisRemSec)} left)` : '⚪ Inactive'}\n` +
    `• <i>${BLACK_MARKET_ITEMS.heistshield.description}</i>\n\n` +
    `👑 <b>sovereigntitle</b> — <b>「 Sovereign Overlord 」</b> (<b>15 💠</b>)\n` +
    `• Status: ${hasSovTitle ? '✅ Unlocked' : '🔒 Locked'}\n` +
    `• <i>${BLACK_MARKET_ITEMS.sovereigntitle.description}</i>\n\n` +
    `🎰 <b>ultimatetoken</b> — <b>Permanent Ultimate Gambler Pass</b> (<b>25 💠</b>)\n` +
    `• Status: ${isPermUlt ? '✅ Permanent Active' : '🔒 Locked / Timed'}\n` +
    `• <i>${BLACK_MARKET_ITEMS.ultimatetoken.description}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>Click an upgrade below or run</i> <code>/blackmarket &lt;item_id&gt;</code>!`;

  const keyboard = new InlineKeyboard()
    .text('🍀 Charm (5 💠)', `blackmarket:pick:luckboost:${userId}`)
    .text('🛡️ Aegis (10 💠)', `blackmarket:pick:heistshield:${userId}`)
    .row()
    .text('👑 Overlord (15 💠)', `blackmarket:pick:sovereigntitle:${userId}`)
    .text('🎰 Ultimate (25 💠)', `blackmarket:pick:ultimatetoken:${userId}`);

  return { text, keyboard };
}

function validatePurchaseEligibility(itemKey, user) {
  const item = BLACK_MARKET_ITEMS[itemKey];
  if (!item) return { ok: false, error: '❌ Unknown Black Market upgrade.' };

  const shards = Math.max(0, Math.floor(Number(user?.sovereign_shards || 0)));
  if (shards < item.costShards) {
    return {
      ok: false,
      error: `❌ <b>Insufficient Sovereign Shards!</b>\n<b>${item.emoji} ${item.name}</b> costs <b>${item.costShards} 💠</b>, but you only have <b>${shards.toLocaleString('en-US')} 💠</b>.`
    };
  }

  if (itemKey === 'luckboost') {
    const curLuck = Math.max(0, Number(user?.perm_luck_bonus || 0));
    if (curLuck >= MAX_PERM_LUCK) {
      return {
        ok: false,
        error: `🍀 You have already maxed out your <b>Permanent Casino Charm</b> at <b>+${MAX_PERM_LUCK}%</b>!`
      };
    }
  }

  if (itemKey === 'ultimatetoken' && Number(user?.ultimate_expires_at) === -1) {
    return {
      ok: false,
      error: `🎰 You already own the <b>Permanent Ultimate Gambler Pass</b> forever!`
    };
  }

  if (itemKey === 'sovereigntitle' && hasUnlockedSpecialTitle(user, 'Sovereign Overlord')) {
    return {
      ok: false,
      error: `👑 You have already unlocked the <b>「 Sovereign Overlord 」</b> title! Equip it anytime via <code>/title Sovereign Overlord</code>.`
    };
  }

  return { ok: true, item };
}

export const blackmarket = {
  name: 'blackmarket',
  aliases: ['bm'],
  description: 'Spend 💠 Sovereign Shards on permanent endgame upgrades',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawArg = (
      (typeof ctx.match === 'string' && ctx.match.trim())
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    ).toLowerCase();

    if (!rawArg) {
      const { text, keyboard } = await buildBlackMarketMenu(userId);
      return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    const key = rawArg.replace(/[^a-z]/g, '');
    const check = validatePurchaseEligibility(key, user);
    if (!check.ok) {
      return ctx.reply(check.error, { parse_mode: 'HTML' });
    }

    const item = check.item;
    const shards = Math.max(0, Math.floor(Number(user.sovereign_shards || 0)));
    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `blackmarket:no:${userId}`)
      .text('✅ Confirm', `blackmarket:yes:${item.id}:${userId}`);

    return ctx.reply(
      `🕶️ <b>Confirm Black Market Purchase</b>\n\n` +
      `• <b>Upgrade:</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b>\n` +
      `• <b>Cost:</b> <b>${item.costShards} 💠 Sovereign Shards</b>\n` +
      `• <b>Your Shards:</b> ${shards.toLocaleString('en-US')} 💠\n` +
      `• <b>Effect:</b> <i>${sanitizeHtml(item.description)}</i>\n\n` +
      `<i>Proceed with this Black Market deal?</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your Black Market session!",
        show_alert: true
      });
    }

    if (action === 'no') {
      await ctx.answerCallbackQuery({ text: 'Black Market deal cancelled.' });
      return ctx.editMessageText('❌ Black Market transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (action === 'pick') {
      const itemKey = parts[2];
      const user = await userRepo.getUser(targetUserId);
      const check = validatePurchaseEligibility(itemKey, user);
      if (!check.ok) {
        return ctx.answerCallbackQuery({
          text: check.error.replace(/<[^>]+>/g, ''),
          show_alert: true
        });
      }

      const item = check.item;
      const shards = Math.max(0, Math.floor(Number(user.sovereign_shards || 0)));
      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `blackmarket:no:${targetUserId}`)
        .text('✅ Confirm', `blackmarket:yes:${item.id}:${targetUserId}`);

      await ctx.answerCallbackQuery();
      return ctx.editMessageText(
        `🕶️ <b>Confirm Black Market Purchase</b>\n\n` +
        `• <b>Upgrade:</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b>\n` +
        `• <b>Cost:</b> <b>${item.costShards} 💠 Sovereign Shards</b>\n` +
        `• <b>Your Shards:</b> ${shards.toLocaleString('en-US')} 💠\n` +
        `• <b>Effect:</b> <i>${sanitizeHtml(item.description)}</i>\n\n` +
        `<i>Proceed with this Black Market deal?</i>`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      ).catch(() => {});
    }

    if (action === 'yes') {
      const itemKey = parts[2];
      const user = await userRepo.getUser(targetUserId);
      const check = validatePurchaseEligibility(itemKey, user);
      if (!check.ok) {
        await ctx.answerCallbackQuery({
          text: check.error.replace(/<[^>]+>/g, ''),
          show_alert: true
        });
        return ctx.editMessageText(check.error, { parse_mode: 'HTML' }).catch(() => {});
      }

      const item = check.item;
      const spendRes = await userRepo.spendShardsAtomic(targetUserId, item.costShards);
      if (!spendRes.success) {
        await ctx.answerCallbackQuery({ text: 'Insufficient Sovereign Shards!', show_alert: true });
        return ctx.editMessageText('❌ <b>Purchase Failed:</b> Insufficient Sovereign Shards!', { parse_mode: 'HTML' }).catch(() => {});
      }

      let rewardDetail = '';
      if (itemKey === 'luckboost') {
        const updated = await userRepo.addPermLuck(targetUserId, 5, MAX_PERM_LUCK);
        const newLuck = Number(updated?.perm_luck_bonus || 5);
        rewardDetail = `🍀 Your permanent luck bonus increased to <b>+${newLuck}% / +25%</b>!`;
      } else if (itemKey === 'ultimatetoken') {
        await userRepo.setUltimateGambler(targetUserId, -1);
        rewardDetail = `🎰 You are now a <b>Permanent Ultimate Gambler</b> forever (No 100M bet cap + VIP casino multipliers)!`;
      } else if (itemKey === 'heistshield') {
        const currentRem = await inventoryRepo.getBuffRemaining(targetUserId, 'aegis_vault');
        const newDuration = Math.min(30 * 86_400, (currentRem > 0 ? currentRem : 0) + SEVEN_DAYS_SEC);
        await inventoryRepo.setBuff(targetUserId, 'aegis_vault', newDuration);
        rewardDetail = `🛡️ Your bank vault is now protected by an <b>Unbreakable Aegis Sovereign Vault</b> for <b>${formatTime(newDuration)}</b>!`;
      } else if (itemKey === 'sovereigntitle') {
        await userRepo.unlockTitle(targetUserId, 'Sovereign Overlord');
        rewardDetail = `👑 Unlocked prestige-proof title <b>「 Sovereign Overlord 」</b>! Equip it with <code>/title Sovereign Overlord</code>.`;
      }

      await ctx.answerCallbackQuery({ text: `Purchased ${item.name}!` });
      return ctx.editMessageText(
        `🕶️ <b>BLACK MARKET ACQUISITION COMPLETE!</b>\n\n` +
        `• <b>Acquired:</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b>\n` +
        `• <b>Paid:</b> ${item.costShards} 💠 Sovereign Shards\n` +
        `• <b>Remaining Shards:</b> <b>${spendRes.remainingShards.toLocaleString('en-US')} 💠</b>\n\n` +
        `${rewardDetail}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default blackmarket;
