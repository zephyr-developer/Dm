import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { getJob } from '../../config/jobs.js';
import { getXpProgress } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, formatTime, progressBar, sanitizeHtml } from '../../utils/formatters.js';

async function buildProfileCard(targetUserId) {
  const user = await userRepo.getUser(targetUserId);
  if (!user) return { text: 'User profile not found.', keyboard: null };

  const xpProg = getXpProgress(user);
  const xpBar = progressBar(xpProg.current, xpProg.max, 8);
  const currentJob = getJob(user.job_id);
  const activeBuffs = await inventoryRepo.getActiveBuffs(targetUserId);
  const luckBreakdown = await getLuckBreakdown(targetUserId);

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
    (user.username ? `👤 <i>@${user.username}</i>\n` : '') +
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

  const keyboard = new InlineKeyboard()
    .text(
      isPassive ? '🛡️ Disable Passive Mode' : '🛡️ Enable Passive Mode',
      `profile:toggle_passive:${targetUserId}`
    )
    .text('🔄 Refresh', `profile:refresh:${targetUserId}`);

  return { text: card, keyboard };
}

export const profile = {
  name: 'profile',
  aliases: [],
  description: 'View your level progress, job history, active buffs, and passive mode',
  cooldown: 3,

  async execute(ctx) {
    let targetUserId = ctx.from.id;
    let targetUsername = ctx.from.username;
    let targetFirstName = ctx.from.first_name;

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      targetUserId = replied.id;
      targetUsername = replied.username;
      targetFirstName = replied.first_name;
    }

    await userRepo.getOrInitUser(targetUserId, targetUsername, targetFirstName);

    const { text, keyboard } = await buildProfileCard(targetUserId);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard || undefined
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[2]);

    if (action === 'toggle_passive') {
      // Check 12-hour cooldown before toggling Passive Mode
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

      // Immediately apply 12-hour (43,200 seconds) cooldown
      await cooldownRepo.setCooldown(ctx.from.id, 'passive_toggle', 43200);

      const { text, keyboard } = await buildProfileCard(targetUserId);
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(() => {});

      const notice = newMode === 1
        ? '🛡️ Passive Mode Enabled! You are immune to /rob & /bankrob, and locked out of PvP/social transfers for 12 hours.'
        : '⚔️ Passive Mode Disabled! You can now rob, heist, and send gifts, but you are vulnerable to attacks. (12h toggle cooldown applied)';

      return ctx.answerCallbackQuery({ text: notice, show_alert: true });
    }

    if (action === 'refresh') {
      const { text, keyboard } = await buildProfileCard(targetUserId);
      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        await ctx.answerCallbackQuery({ text: 'Profile refreshed!' });
      } catch (err) {
        await ctx.answerCallbackQuery({ text: 'Profile is already up to date.' });
      }
    }
  }
};

export default profile;
