import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import fightRepo from '../../database/fightRepo.js';
import { formatCoins, formatNumber, sanitizeHtml } from '../../utils/formatters.js';

async function buildLeaderboardMessage(chatId, scope, type, callerUserId) {
  const isGlobal = scope === 'global';
  const targetChatId = isGlobal ? null : chatId;

  let rows = [];
  let title = '🪙 Richest Meme Lords';
  if (type === 'shards') {
    title = '💠 Top Sovereign Shard Holders';
    rows = await userRepo.getLeaderboard(targetChatId, 'shards', 10);
  } else if (type === 'level') {
    title = '⭐ Top Level Masters';
    rows = await userRepo.getLeaderboard(targetChatId, 'level', 10);
  } else if (type === 'fight') {
    title = '🎖️ Top Fighters (Rep & Ranks)';
    rows = await fightRepo.getFightLeaderboard(targetChatId, 10);
  } else {
    rows = await userRepo.getLeaderboard(targetChatId, 'coins', 10);
  }

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

      let valStr = '';
      if (type === 'shards') {
        const shards = Math.max(0, Math.floor(Number(row.sovereign_shards || 0)));
        valStr = `<b>${shards.toLocaleString('en-US')} 💠 Sovereign Shards</b>`;
      } else if (type === 'fight') {
        const fMeta = fightRepo.getRankMeta(row.fight_rank || 'Bronze');
        valStr = `${fMeta.emoji} ${fMeta.name} • <b>${Number(row.fight_score || 0)} pts</b> • 🎖️ ${Number(row.fight_rep || 0)} (${Number(row.fight_wins || 0)}W/${Number(row.fight_losses || 0)}L)`;
      } else if (type === 'level') {
        valStr = `Lvl ${row.level} (${formatNumber(row.xp)} XP)`;
      } else {
        valStr = formatCoins(row.total_coins || (Number(row.wallet) + Number(row.bank)));
      }

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
    .row()
    .text(type === 'coins' ? '✅ 🪙 Coins' : '🪙 Coins', `leaderboard:type:${scope}:coins:${callerUserId}`)
    .text(type === 'shards' ? '✅ 💠 Sovereign Shards' : '💠 Sovereign Shards', `leaderboard:type:${scope}:shards:${callerUserId}`)
    .row()
    .text(type === 'level' ? '✅ ⭐ Levels' : '⭐ Levels', `leaderboard:type:${scope}:level:${callerUserId}`)
    .text(type === 'fight' ? '✅ 🎖️ Fight Rep & Ranks' : '🎖️ Fight Rep & Ranks', `leaderboard:type:${scope}:fight:${callerUserId}`);

  return { text, keyboard };
}

export const leaderboard = {
  name: 'leaderboard',
  aliases: ['lb'],
  description: 'View top wealth, level, and Fight 2.0 rankings globally or in this group',
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
      scope = parts[2];
      type = parts[3];
    } else if (toggleField === 'type') {
      scope = parts[2];
      type = parts[3];
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
