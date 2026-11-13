import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { getJob } from '../../config/jobs.js';
import { getXpProgress } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, formatTime, progressBar, sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { resolveEffectiveTitle } from '../../utils/titleEngine.js';

async function buildProfileCard(targetUserId, viewerId = targetUserId) {
  const user = await userRepo.getUser(targetUserId);
  if (!user) return { text: 'User profile not found.', keyboard: null };

  const xpProg = getXpProgress(user);
  const xpBar = progressBar(xpProg.current, xpProg.max, 8);
  const currentJob = getJob(user.job_id);
  const activeBuffs = await inventoryRepo.getActiveBuffs(targetUserId);
  const luckBreakdown = await getLuckBreakdown(targetUserId);
  const effectiveTitle = await resolveEffectiveTitle(user, null, { syncFallback: true });

  const isPrem = await userRepo.isPremium(targetUserId);
  const premRemaining = await userRepo.getPremiumRemaining(targetUserId);

  let premiumBadge = '';
  if (isPrem) {
    const formattedRemaining = formatTime(Math.floor(premRemaining / 1000));
    premiumBadge = `💎 <b>PREMIUM VIP MEMBER</b> (<i>${formattedRemaining} left</i>)\n` +
      `⚡ <i>Perks: 50% Cooldown Reductions, +10% Passive Luck, 2x Claim Payouts</i>\n\n`;
  }

  let buffsText = '<i>None active</i>';
  if (activeBuffs.length > 0) {
    buffsText = activeBuffs
      .map(b => `• <b>${b.buff_type.toUpperCase()}</b>: ${formatTime(b.remaining_seconds)} remaining`)
      .join('\n');
  }

  const isPassive = Number(user.passive_mode) === 1;

  const card = `📜 <b>Player Profile: ${sanitizeHtml(user.first_name)}</b>\n` +
    (user.username ? `👤 <i>@${sanitizeHtml(user.username)}</i>\n` : '') +
    `🏷️ <b>Title:</b> 「 ${sanitizeHtml(effectiveTitle)} 」\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    premiumBadge +
    `⭐ <b>Level:</b> ${user.level} (Prestige: <b>Tier ${user.prestige}</b>)\n` +
    `📈 <b>XP Progress:</b> ${xpBar} (${xpProg.current}/${xpProg.max})\n\n` +
    `💼 <b>Occupation:</b> ${currentJob ? `${currentJob.emoji} ${currentJob.name} (${user.work_shifts} shifts)` : '<i>Unemployed</i>'}\n` +
    `🔥 <b>Daily Streak:</b> ${user.streak_daily} days\n` +
    `🍀 <b>Total Luck:</b> +${luckBreakdown.totalBonus}%\n` +
    `🛡️ <b>Passive Mode:</b> ${isPassive ? '🟢 <b>ENABLED</b> (Robbery Immune)' : '🔴 <b>DISABLED</b> (Vulnerable to /rob)'}\n\n` +
    `👛 <b>Wallet:</b> ${formatCoins(user.wallet)}\n` +
    `🏦 <b>Bank Vault:</b> ${formatCoins(user.bank)} / ${formatCoins(user.bank_max)}\n\n` +
    `✨ <b>Active Boosts & Defenses:</b>\n${buffsText}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard();
  if (targetUserId === viewerId) {
    keyboard.text(
      isPassive ? '🛡️ Disable Passive Mode' : '🛡️ Enable Passive Mode',
      `profile:toggle_passive:${targetUserId}`
    );
  }
  keyboard.text('🔄 Refresh', `profile:refresh:${targetUserId}:${viewerId}`);

  return { text: card, keyboard };
}

export const profile = {
  name: 'profile',
  aliases: [],
  description: 'View your level progress, job history, active buffs, and passive mode',
  cooldown: 3,

  async execute(ctx) {
    const callerId = ctx.from.id;
    await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    const { user: targetUser, notFound, errorMessage } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: true,
      allowBareUsername: true,
      allowNumericId: true
    });

    if (notFound || !targetUser) {
      return ctx.reply(errorMessage || '❌ Could not find that TeleMemer account.', { parse_mode: 'HTML' });
    }

    const { text, keyboard } = await buildProfileCard(targetUser.user_id, callerId);

    return ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard || undefined
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);
    const viewerId = Number(parts[3]) || ctx.from.id;

    // Step 1 & 2: Warn before toggling Passive Mode
    if (action === 'toggle_passive') {
      if (ctx.from.id !== targetUserId) {
        return ctx.answerCallbackQuery({
          text: '🚫 You can only toggle Passive Mode on your own profile!',
          show_alert: true
        });
      }

      const cd = await cooldownRepo.getCooldown(ctx.from.id, 'passive_toggle');
      if (cd && cd.remaining > 0) {
        return ctx.answerCallbackQuery({
          text: `⏳ You can only toggle Passive Mode once every 12 hours! Wait ${formatTime(cd.remaining)}.`,
          show_alert: true
        });
      }

      const user = await userRepo.getUser(targetUserId);
      if (!user) return ctx.answerCallbackQuery({ text: 'User not found.' });

      const nextStateLabel = Number(user.passive_mode) === 1 ? 'DISABLE' : 'ENABLE';

      // Step 3: Strictly Cancel on left, Confirm on right
      const confirmKeyboard = new InlineKeyboard()
        .text('❌ Cancel', `profile:passive_cancel:${targetUserId}`)
        .text('✅ Confirm Toggle', `profile:passive_confirm:${targetUserId}`);

      await ctx.answerCallbackQuery();
      return ctx.editMessageText(
        `⚠️ <b>WARNING:</b> Are you sure you want to <b>${nextStateLabel}</b> Passive Mode?\n\n` +
        `If you proceed, you will NOT be able to change this setting again for <b>12 hours</b>!`,
        {
          parse_mode: 'HTML',
          reply_markup: confirmKeyboard
        }
      ).catch(() => {});
    }

    // Step 4a: Cancel Passive Mode toggle -> revert to normal profile view
    if (action === 'passive_cancel') {
      if (ctx.from.id !== targetUserId) {
        return ctx.answerCallbackQuery({
          text: "🚫 This isn't your profile!",
          show_alert: true
        });
      }

      const { text, keyboard } = await buildProfileCard(targetUserId, targetUserId);
      await ctx.answerCallbackQuery({ text: 'Passive Mode toggle cancelled.' });
      return ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard || undefined
      }).catch(() => {});
    }

    // Step 4b: Confirm Passive Mode toggle -> execute DB toggle + apply 12h cooldown + show success
    if (action === 'passive_confirm') {
      if (ctx.from.id !== targetUserId) {
        return ctx.answerCallbackQuery({
          text: "🚫 This isn't your profile!",
          show_alert: true
        });
      }

      const cd = await cooldownRepo.getCooldown(ctx.from.id, 'passive_toggle');
      if (cd && cd.remaining > 0) {
        return ctx.answerCallbackQuery({
          text: `⏳ You can only toggle Passive Mode once every 12 hours! Wait ${formatTime(cd.remaining)}.`,
          show_alert: true
        });
      }

      const user = await userRepo.getUser(targetUserId);
      if (!user) return ctx.answerCallbackQuery({ text: 'User not found.' });

      const newMode = Number(user.passive_mode) === 1 ? 0 : 1;
      await userRepo.setPassiveMode(targetUserId, newMode);
      await cooldownRepo.setCooldown(ctx.from.id, 'passive_toggle', 43200);

      const successText = newMode === 1
        ? `🛡️ <b>Passive Mode ENABLED!</b>\n\n` +
          `• You are now immune to <code>/rob</code> and <code>/bankrob</code>.\n` +
          `• You are locked out of initiating PvP/social transfers (<code>/rob</code>, <code>/bankrob</code>, <code>/give</code>).\n` +
          `• ⏳ A <b>12-hour cooldown</b> has been applied before you can toggle this again.`
        : `⚔️ <b>Passive Mode DISABLED!</b>\n\n` +
          `• You can now use <code>/rob</code>, <code>/bankrob</code>, and <code>/give</code>.\n` +
          `• Beware: other players can now rob you!\n` +
          `• ⏳ A <b>12-hour cooldown</b> has been applied before you can toggle this again.`;

      const backKeyboard = new InlineKeyboard()
        .text('📜 Back to Profile', `profile:refresh:${targetUserId}:${targetUserId}`);

      await ctx.answerCallbackQuery({ text: newMode === 1 ? '🛡️ Passive Mode Enabled!' : '⚔️ Passive Mode Disabled!' });
      return ctx.editMessageText(successText, {
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      }).catch(() => {});
    }

    if (action === 'refresh') {
      const { text, keyboard } = await buildProfileCard(targetUserId, viewerId);
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard || undefined
        });
        await ctx.answerCallbackQuery({ text: 'Profile refreshed!' });
      } catch {
        await ctx.answerCallbackQuery({ text: 'Profile is already up to date.' });
      }
    }
  }
};

export default profile;
