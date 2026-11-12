import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { formatCoins, formatNumber, sanitizeHtml } from '../../utils/formatters.js';

async function buildLeaderboardMessage(chatId, scope, type, callerUserId) {
  const isGlobal = scope === 'global';
  const isCoins = type === 'coins';
  const targetChatId = isGlobal ? null : chatId;

  const rows = await userRepo.getLeaderboard(targetChatId, type, 10);
  const title = isCoins ? '🪙 Richest Meme Lords' : '⭐ Top Level Masters';
  const scopeLabel = isGlobal ? '🌍 Global' : '🏠 This Group';

  let text = `🏆 <b>Leaderboard: ${title}</b> (${scopeLabel})\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (rows.length === 0) {
    text += `<i>No players recorded in this leaderboard yet! Run some commands to appear here.</i>\n`;
  } else {
    rows.forEach((row, index) => {
      const medals = ['🥇', '🥈', '🥉'];
      const rankBadge = medals[index] || `<b>#${index + 1}</b>`;
      const isPrem = Number(row.premium_until || 0) > Date.now();
      const premBadge = isPrem ? ' 💎' : '';
      const name = sanitizeHtml(row.first_name || row.username || `Player ${row.user_id}`);
      const valStr = isCoins
        ? formatCoins(row.total_coins || (Number(row.wallet) + Number(row.bank)))
        : `Lvl ${row.level} (${formatNumber(row.xp)} XP)`;

      text += `${rankBadge} <b>${name}</b>${premBadge} — ${valStr}\n`;
    });
  }

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `<i>Toggle views below:</i>`;

  const keyboard = new InlineKeyboard()
    .text(
      isGlobal ? '🏠 Show This Group' : '🌍 Show Global',
      `leaderboard:scope:${isGlobal ? 'group' : 'global'}:${type}:${callerUserId}`
    )
    .text(
      isCoins ? '⭐ Show Levels' : '🪙 Show Coins',
      `leaderboard:type:${scope}:${isCoins ? 'level' : 'coins'}:${callerUserId}`
    );

  return { text, keyboard };
}

export const leaderboard = {
  name: 'leaderboard',
  aliases: ['lb'],
  description: 'View top wealth and level rankings globally or in this group',
  cooldown: 5,

  async execute(ctx) {
    const chatId = ctx.chat.id;
    const callerId = ctx.from.id;
    const initialScope = ctx.chat.type === 'private' ? 'global' : 'group';

    const { text, keyboard } = await buildLeaderboardMessage(chatId, initialScope, 'coins', callerId);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const toggleField = parts[1];
    let scope = parts[2];
    let type = parts[3];
    const callerUserId = Number(parts[4]);

    const chatId = ctx.chat.id;

    if (toggleField === 'scope') {
      scope = parts[2]; // new scope
      type = parts[3];
    } else if (toggleField === 'type') {
      scope = parts[2];
      type = parts[3]; // new type
    }

    const { text, keyboard } = await buildLeaderboardMessage(chatId, scope, type, callerUserId);

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Already displaying this view.' });
    }
  }
};

export default leaderboard;
