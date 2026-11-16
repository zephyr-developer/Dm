import { InlineKeyboard } from 'grammy';
import userRepo, { FRENZY_TARGET_AMOUNT } from '../../database/userRepo.js';
import { formatCoins, formatTime, progressBar, sanitizeHtml } from '../../utils/formatters.js';

function parseDonationAmount(inputStr, wallet) {
  if (!inputStr) return { valid: false, error: 'NO_INPUT', amount: 0 };
  const clean = String(inputStr).trim().toLowerCase();
  const currentWallet = Math.max(0, Math.floor(Number(wallet || 0)));

  if (clean === 'all' || clean === 'max') {
    if (currentWallet <= 0) {
      return { valid: false, error: 'NO_COINS', amount: 0 };
    }
    return { valid: true, amount: currentWallet };
  }

  let mult = 1;
  let numStr = clean.replace(/[,_]/g, '');
  if (numStr.endsWith('k')) {
    mult = 1_000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('m')) {
    mult = 1_000_000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('b')) {
    mult = 1_000_000_000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('t')) {
    mult = 1_000_000_000_000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('q')) {
    mult = 1_000_000_000_000_000;
    numStr = numStr.slice(0, -1);
  }

  const parsed = Number(numStr);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { valid: false, error: 'INVALID_NUMBER', amount: 0 };
  }

  const amount = Math.floor(parsed * mult);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { valid: false, error: 'INVALID_NUMBER', amount: 0 };
  }

  if (amount > currentWallet) {
    return { valid: false, error: 'INSUFFICIENT_FUNDS', amount };
  }

  return { valid: true, amount };
}

export const frenzy = {
  name: 'frenzy',
  aliases: ['altar', 'burn'],
  description: 'Donate coins to the Group Frenzy Altar to trigger 2h Server-Wide 2x Rewards!',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawArg = (
      (typeof ctx.match === 'string' && ctx.match.trim())
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    );

    if (!rawArg) {
      const ev = await userRepo.getFrenzyEvent();
      const bar = progressBar(ev.currentAmount, ev.targetAmount || FRENZY_TARGET_AMOUNT, 12);
      const topName = ev.topDonorUser
        ? (ev.topDonorUser.username ? `@${sanitizeHtml(ev.topDonorUser.username)}` : sanitizeHtml(ev.topDonorUser.first_name || 'Unknown'))
        : '<i>None yet</i>';
      const topDonorLine = ev.topDonorId
        ? `${topName} (<b>${formatCoins(ev.topDonorAmount)}</b>)`
        : '<i>No donations in this cycle yet</i>';

      const statusLine = ev.isActive
        ? `🔥 <b>SERVER FRENZY IS ACTIVE!</b> (<b>${formatTime(ev.remainingSeconds)}</b> remaining)\n` +
          `⚡ <i>Active Buffs: 2x Grind Coins, 2x XP, and +15% Luck for ALL players!</i>`
        : `💤 <i>Server Frenzy is currently dormant. Reach 5 Quadrillion burned coins to unleash it!</i>`;

      return ctx.reply(
        `🔥 <b>GROUP FRENZY ALTAR (GLOBAL COIN SINK)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `${statusLine}\n\n` +
        `📊 <b>Altar Progress:</b> ${bar}\n` +
        `🪙 <b>Burned:</b> ${formatCoins(ev.currentAmount)} / ${formatCoins(ev.targetAmount)}\n` +
        `👑 <b>Current #1 Top Donor:</b> ${topDonorLine}\n` +
        `🕯️ <b>Your Lifetime Burned:</b> ${formatCoins(user.frenzy_donated || 0)}\n\n` +
        `🎁 <b>5Q Milestone Rewards:</b>\n` +
        `• 🔥 <b>2 Hours</b> of 2x Grind Coins, 2x XP, &amp; +15% Global Luck!\n` +
        `• 👑 #1 Top Donor earns <b>+5 💠 Sovereign Shards</b> + title <b>「 Meme Patron 」</b>!\n\n` +
        `👉 Donate via <code>/frenzy &lt;amount | all&gt;</code> (Supports <code>1t</code>, <code>500b</code>, etc.)`,
        { parse_mode: 'HTML' }
      );
    }

    const parsed = parseDonationAmount(rawArg, user.wallet);
    if (!parsed.valid) {
      if (parsed.error === 'NO_COINS' || parsed.error === 'INSUFFICIENT_FUNDS') {
        return ctx.reply(
          `❌ <b>Insufficient Wallet Funds!</b>\nYour Wallet: <b>${formatCoins(user.wallet)}</b>`,
          { parse_mode: 'HTML' }
        );
      }
      return ctx.reply(
        `❌ Invalid donation amount. Usage: <code>/frenzy &lt;amount | all&gt;</code> (e.g. <code>/frenzy 100t</code>)`,
        { parse_mode: 'HTML' }
      );
    }

    const amount = parsed.amount;
    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `frenzy:no:${userId}`)
      .text('✅ Confirm', `frenzy:yes:${amount}:${userId}`);

    return ctx.reply(
      `🔥 <b>Confirm Frenzy Altar Sacrifice</b>\n\n` +
      `• <b>Burning:</b> ${formatCoins(amount)}\n` +
      `• <b>Your Wallet:</b> ${formatCoins(user.wallet)}\n` +
      `• <b>Effect:</b> Coins are permanently burned into the Altar toward the <b>5 Quadrillion</b> Group Frenzy milestone!\n\n` +
      `<i>Are you sure you want to burn these coins?</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your Frenzy Altar donation!",
        show_alert: true
      });
    }

    if (action === 'no') {
      await ctx.answerCallbackQuery({ text: 'Frenzy sacrifice cancelled.' });
      return ctx.editMessageText('❌ Frenzy Altar sacrifice cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (action === 'yes') {
      const amount = Number(parts[2]);
      const res = await userRepo.donateToFrenzyAtomic(targetUserId, amount);
      if (!res.success) {
        await ctx.answerCallbackQuery({ text: 'Insufficient wallet funds!', show_alert: true });
        return ctx.editMessageText('❌ <b>Donation Failed:</b> Insufficient wallet funds.', { parse_mode: 'HTML' }).catch(() => {});
      }

      if (res.goalReached) {
        const winnerHandle = res.winnerUser
          ? (res.winnerUser.username ? `@${sanitizeHtml(res.winnerUser.username)}` : sanitizeHtml(res.winnerUser.first_name || `User ${res.winnerTopDonorId}`))
          : `User ${res.winnerTopDonorId}`;

        await ctx.answerCallbackQuery({ text: '🔥 5 QUADRILLION GOAL REACHED! SERVER FRENZY LIVE!' });
        await ctx.editMessageText(
          `🔥 <b>FRENZY SACRIFICE ACCEPTED!</b>\n` +
          `You burned <b>${formatCoins(res.donated)}</b> and shattered the <b>5 Quadrillion</b> Altar Goal!\n` +
          `👛 <b>Remaining Wallet:</b> ${formatCoins(res.newWallet)}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        return ctx.reply(
          `🔥🔥🔥 <b>SERVER FRENZY IS LIVE FOR 2 HOURS!</b> 🔥🔥🔥\n` +
          `<i>(2x Grind Coins, 2x XP, and +15% Luck for all players!)</i>\n\n` +
          `👑 <b>#1 Top Donor Champion:</b> ${winnerHandle} (<b>${formatCoins(res.winnerTopDonorAmount)}</b>)\n` +
          `🎁 <b>Champion Rewards Granted:</b> <b>+5 💠 Sovereign Shards</b> &amp; Exclusive Title <b>「 Meme Patron 」</b>!\n` +
          `🔄 <i>Altar progress has reset to 0 for the next 5Q cycle!</i>`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }

      const bar = progressBar(res.currentAmount, res.targetAmount, 12);
      await ctx.answerCallbackQuery({ text: `Burned ${formatCoins(res.donated)} into the Altar!` });
      return ctx.editMessageText(
        `🔥 <b>Altar Sacrifice Complete!</b>\n` +
        `Burned <b>${formatCoins(res.donated)}</b> into the Group Frenzy Altar!\n\n` +
        `📊 <b>Altar Progress:</b> ${bar}\n` +
        `🪙 <b>Total Progress:</b> ${formatCoins(res.currentAmount)} / ${formatCoins(res.targetAmount)}\n` +
        `👛 <b>Remaining Wallet:</b> ${formatCoins(res.newWallet)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default frenzy;
