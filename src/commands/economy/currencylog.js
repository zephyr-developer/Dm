import { InlineKeyboard } from 'grammy';
import currencyLogRepo from '../../database/currencyLogRepo.js';
import userRepo from '../../database/userRepo.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { formatCoins, formatNumber, sanitizeHtml } from '../../utils/formatters.js';

function timeAgo(date) {
  const past = new Date(date).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - past) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function renderCurrencyLogPage(targetUserId, callerUserId, page = 1, filter = 'all') {
  const targetUser = await userRepo.getUser(targetUserId);
  const targetName = targetUser?.username ? `@${targetUser.username}` : (targetUser?.first_name || `User #${targetUserId}`);

  const totalCount = await currencyLogRepo.getLogCount(targetUserId, filter);
  const totalPages = Math.max(1, Math.ceil(totalCount / 10));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * 10;

  const logs = await currencyLogRepo.getLogs(targetUserId, { limit: 10, offset, filter });

  const filterNames = {
    all: 'All',
    gains: '🟢 Gains',
    losses: '🔴 Losses'
  };

  let text = `📜 <b>Currency Log — ${sanitizeHtml(targetName)}</b>\n` +
    `Page <b>${currentPage}/${totalPages}</b> • <b>${totalCount}</b> entries (${filterNames[filter] || 'All'})\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (logs.length === 0) {
    text += `<i>No financial transactions recorded under "${filterNames[filter]}" yet.</i>\n\n` +
      `💡 <i>Tip: Run /flow, /beg, /crime, /work, or /daily to earn coins!</i>`;
  } else {
    for (const log of logs) {
      const isPositive = Number(log.change_amount) >= 0;
      const indicator = isPositive ? '🟢' : '🔴';
      const sign = isPositive ? '+' : '';
      const formattedAmount = `${sign}🪙 ${formatNumber(log.change_amount)}`;
      const locLabel = log.location === 'bank' ? 'Bank' : 'Wallet';
      const elapsed = timeAgo(log.created_at);
      const wBal = `🪙 ${formatNumber(log.wallet_after)} W`;
      const bBal = `🪙 ${formatNumber(log.bank_after)} B`;

      text += `${indicator} <b>${formattedAmount}</b> (${locLabel}) • <code>${sanitizeHtml(log.source_command)}</code>\n` +
        `├ 📝 <i>${sanitizeHtml(log.details)}</i>\n` +
        `└ 🏦 Bal After: <code>${wBal}</code> | <code>${bBal}</code> • <i>${elapsed}</i>\n\n`;
    }
  }

  // Row 1: Pagination Controls
  const keyboard = new InlineKeyboard();

  const prevPage = Math.max(1, currentPage - 1);
  const nextPage = Math.min(totalPages, currentPage + 1);

  if (currentPage > 1) {
    keyboard.text('⏮️ First', `currencylog:page:1:${filter}:${targetUserId}:${callerUserId}`);
    keyboard.text('⬅️ Prev', `currencylog:page:${prevPage}:${filter}:${targetUserId}:${callerUserId}`);
  } else {
    keyboard.text('⏹️', `currencylog:noop:1:${filter}:${targetUserId}:${callerUserId}`);
  }

  keyboard.text(`📄 ${currentPage}/${totalPages}`, `currencylog:noop:${currentPage}:${filter}:${targetUserId}:${callerUserId}`);

  if (currentPage < totalPages) {
    keyboard.text('Next ➡️', `currencylog:page:${nextPage}:${filter}:${targetUserId}:${callerUserId}`);
    keyboard.text('Last ⏭️', `currencylog:page:${totalPages}:${filter}:${targetUserId}:${callerUserId}`);
  } else {
    keyboard.text('⏹️', `currencylog:noop:${currentPage}:${filter}:${targetUserId}:${callerUserId}`);
  }

  keyboard.row();

  // Row 2: Quick Filter Buttons
  keyboard
    .text(filter === 'all' ? '• 🌐 All •' : '🌐 All', `currencylog:filter:1:all:${targetUserId}:${callerUserId}`)
    .text(filter === 'gains' ? '• 🟢 Gains •' : '🟢 Gains', `currencylog:filter:1:gains:${targetUserId}:${callerUserId}`)
    .text(filter === 'losses' ? '• 🔴 Losses •' : '🔴 Losses', `currencylog:filter:1:losses:${targetUserId}:${callerUserId}`)
    .text('🔄 Refresh', `currencylog:page:${currentPage}:${filter}:${targetUserId}:${callerUserId}`);

  return { text, keyboard };
}

export const currencylog = {
  name: 'currencylog',
  aliases: ['clog', 'transactions', 'logs'],
  description: 'View your detailed transaction history and coin movement audit log',
  cooldown: 10,

  async execute(ctx) {
    const callerId = ctx.from.id;
    let targetUserId = callerId;

    // Check if Bot Owner (@tzhunyuan) is inspecting another user's audit log
    if (isOwner(ctx)) {
      if (ctx.message?.reply_to_message?.from) {
        targetUserId = ctx.message.reply_to_message.from.id;
      } else {
        const args = ctx.message.text.trim().split(/\s+/).slice(1);
        if (args[0]) {
          const rawArg = args[0].replace(/^@/, '');
          const maybeId = Number(rawArg);
          if (!isNaN(maybeId) && maybeId > 1000) {
            targetUserId = maybeId;
          } else {
            const found = await userRepo.getUserByUsername(rawArg);
            if (found) {
              targetUserId = found.user_id;
            }
          }
        }
      }
    }

    await userRepo.getOrInitUser(targetUserId, ctx.from.username, ctx.from.first_name);

    const { text, keyboard } = await renderCurrencyLogPage(targetUserId, callerId, 1, 'all');

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    // currencylog:action:page:filter:targetUserId:callerUserId
    const action = parts[1];
    const page = parseInt(parts[2], 10) || 1;
    const filter = parts[3] || 'all';
    const targetUserId = Number(parts[4]);
    const callerUserId = Number(parts[5]);

    if (action === 'noop') {
      return ctx.answerCallbackQuery();
    }

    // Button Ownership Lock: Only the original caller can navigate
    if (ctx.from.id !== callerUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your currency log view! Run /currencylog to see your own history.",
        show_alert: true
      });
    }

    try {
      const { text, keyboard } = await renderCurrencyLogPage(targetUserId, callerUserId, page, filter);
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      // Ignore identical message edit errors
      if (!err.message?.includes('message is not modified')) {
        console.error('[currencylog callback error]:', err.message);
      }
      await ctx.answerCallbackQuery().catch(() => {});
    }
  }
};

export default currencylog;
