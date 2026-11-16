import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { parseDuration, sanitizeHtml } from '../../utils/formatters.js';
import { isGenuineUserReply, resolveTargetUser } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';
import { sendUserDm } from '../../services/antiCheat.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

function parseUltimateDuration(tokens) {
  if (!tokens || tokens.length === 0) {
    return { valid: false, isPermanent: false, durationMs: null, label: '' };
  }

  const single = parseDuration(tokens[0]);
  if (single.isDurationToken) {
    return {
      valid: true,
      isPermanent: single.durationMs === null,
      durationMs: single.durationMs,
      label: single.label
    };
  }

  if (tokens.length >= 2 && /^\d+(?:\.\d+)?$/.test(tokens[0])) {
    const twoToken = parseDuration(`${tokens[0]}${tokens[1]}`);
    if (twoToken.isDurationToken) {
      return {
        valid: true,
        isPermanent: twoToken.durationMs === null,
        durationMs: twoToken.durationMs,
        label: twoToken.label
      };
    }
  }

  return { valid: false, isPermanent: false, durationMs: null, label: '' };
}

export const addultimate = {
  name: 'addultimate',
  aliases: ['giveultimate', 'addelite'],
  category: 'owner',
  description: 'Owner: Grant Ultimate Gambler (Elite) membership (Unlimited Bets, VIP Luck & Supercharged Multipliers)',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const rawInput = (
      typeof ctx.match === 'string' && ctx.match.trim()
        ? ctx.match
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ') || '')
    ).trim();
    const tokens = rawInput ? rawInput.split(/\s+/).filter(Boolean) : [];

    let target = null;
    let remainingArgs = [];

    // 1. Numeric user_id in first token
    if (tokens.length > 0 && /^\d+$/.test(tokens[0]) && Number(tokens[0]) > 1000) {
      target = await userRepo.getUser(Number(tokens[0]));
      if (!target) {
        return ctx.reply(
          `❌ User <code>${sanitizeHtml(tokens[0])}</code> has not registered/played TeleMemer yet!`,
          { parse_mode: 'HTML' }
        );
      }
      remainingArgs = tokens.slice(1);
    } else {
      const resolved = await resolveTargetUser(ctx, rawInput, {
        fallbackToCaller: false,
        allowBareUsername: !isGenuineUserReply(ctx) && tokens.length >= 2,
        allowNumericId: false,
        initRepliedUser: true
      });

      if (resolved.notFound) {
        return ctx.reply(resolved.errorMessage, { parse_mode: 'HTML' });
      }

      target = resolved.user;
      remainingArgs = resolved.remainingArgs || [];
    }

    if (!target) {
      return ctx.reply(
        '🎰 <b>Grant Ultimate Gambler Membership</b>\n' +
        'Usage: <code>/addultimate &lt;@username|user_id|reply&gt; &lt;time&gt;</code>\n' +
        'Examples: <code>/addultimate @user 7d</code>, <code>/addultimate @user 12h</code>, <code>/addultimate @user perm</code>',
        { parse_mode: 'HTML' }
      );
    }

    const parsedDur = parseUltimateDuration(remainingArgs);
    if (!parsedDur.valid) {
      return ctx.reply(
        '❌ <b>Duration Required!</b> Usage: <code>/addultimate @username &lt;time&gt;</code> (e.g., <code>30m</code>, <code>12h</code>, <code>7d</code>, <code>2w</code>, <code>1y</code>, or <code>perm</code>).',
        { parse_mode: 'HTML' }
      );
    }

    const callerId = ctx.from.id;
    const targetDisplay = target.username ? `@${target.username}` : (target.first_name || String(target.user_id));

    const token = createConfirmation('ult', {
      callerId,
      targetId: Number(target.user_id),
      targetDisplay,
      isPermanent: parsedDur.isPermanent,
      durationMs: parsedDur.durationMs,
      durationLabel: parsedDur.label
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `addultimate:no:${token}:${callerId}`)
      .text('✅ Confirm', `addultimate:yes:${token}:${callerId}`);

    return ctx.reply(
      `🎰 <b>Confirm Ultimate Gambler Membership</b>\n` +
      `Grant <b>🎰 ULTIMATE GAMBLER (Elite)</b> to <b>${sanitizeHtml(targetDisplay)}</b> (<code>${target.user_id}</code>)?\n` +
      `⏳ <b>Duration:</b> <code>${sanitizeHtml(parsedDur.label)}</code>\n\n` +
      `🔥 <b>Elite Perks Included:</b>\n` +
      `1. <b>Unlimited Max Bets</b> (No 100M table cap)\n` +
      `2. <b>VIP Casino Luck Boost</b> across all 4 gambling games\n` +
      `3. <b>Supercharged Multipliers</b> (Up to <code>15x</code> Scratch, <code>50x</code> Slots, <code>3.5x</code> Blackjack, and <code>2x/10x</code> High-Low!)`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.answerCallbackQuery({ text: '❌ Unauthorized.', show_alert: true }).catch(() => {});
    }

    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const token = parts[2];
    const ownerId = Number(parts[3]);

    if (ctx.from.id !== ownerId) {
      return ctx.answerCallbackQuery({ text: "🚫 This isn't your confirmation!", show_alert: true }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.callerId !== ownerId) {
      await ctx.editMessageText(
        '⏳ This Ultimate Gambler confirmation has expired. Please run <code>/addultimate</code> again.',
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Ultimate Gambler membership grant cancelled.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    consumeConfirmation(token);

    const freshTarget = await userRepo.getUser(pending.targetId);
    let newExpiresAt = -1;
    if (!pending.isPermanent) {
      const currentExp = Number(freshTarget?.ultimate_expires_at || 0);
      if (currentExp === -1) {
        newExpiresAt = Date.now() + Number(pending.durationMs);
      } else {
        const baseTime = currentExp > Date.now() ? currentExp : Date.now();
        newExpiresAt = baseTime + Number(pending.durationMs);
      }
    }

    await userRepo.setUltimateGambler(pending.targetId, newExpiresAt);

    await sendUserDm(
      pending.targetId,
      `🎰 <b>CONGRATULATIONS!</b> 🎰\n` +
      `The Bot Owner (@tzhunyuan) has granted you <b>🎰 ULTIMATE GAMBLER (Elite Membership)</b> for <b>${sanitizeHtml(pending.durationLabel)}</b>!\n\n` +
      `🔥 <b>Your Elite Casino Perks:</b>\n` +
      `1. 🔓 <b>Unlimited Max Bets:</b> The 🪙 100,000,000 table bet cap is completely REMOVED!\n` +
      `2. 🍀 <b>VIP Casino Luck Boost:</b> Boosted win rates across <code>/scratch</code>, <code>/slots</code>, <code>/blackjack</code>, and <code>/highlow</code>!\n` +
      `3. ⚡ <b>Supercharged Multipliers:</b> Up to <b>15x</b> Scratch, <b>50x</b> Slots Jackpot, <b>2.5x / 3.5x</b> Blackjack, and <b>2x / 10x</b> High-Low!`
    );

    await ctx.editMessageText(
      `🎰 <b>ULTIMATE GAMBLER GRANTED!</b>\n` +
      `👤 <b>Member:</b> <b>${sanitizeHtml(pending.targetDisplay)}</b> (<code>${pending.targetId}</code>)\n` +
      `⏳ <b>Granted Duration:</b> <code>${sanitizeHtml(pending.durationLabel)}</code>\n` +
      `🔥 <i>Unlimited bets, VIP Casino Luck Boost &amp; Supercharged Multipliers (15x Scratch, 50x Slots, 3.5x BJ, 2x/10x High-Low) activated!</i>`,
      { parse_mode: 'HTML' }
    );

    return ctx.answerCallbackQuery({ text: '🎰 Ultimate Gambler granted!' }).catch(() => {});
  }
};

export default addultimate;
