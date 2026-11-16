import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import fightRepo from '../../database/fightRepo.js';
import { formatCoins, parseBet, randomBetween, sanitizeHtml } from '../../utils/formatters.js';
import { isGenuineUserReply, resolveTargetUser } from '../../utils/targetResolver.js';

export const MAX_ROUNDS = 20;
const FORCE_TURN_WAIT_MS = 30_000;

export const PRESET_MODES = {
  normal: {
    key: 'normal',
    label: 'Normal Fight',
    hp: 100,
    moves: ['punch', 'kick', 'defend', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: false
  },
  nodefend: {
    key: 'nodefend',
    label: 'No Defend Fight',
    hp: 100,
    moves: ['punch', 'kick', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: false
  },
  kickonly: {
    key: 'kickonly',
    label: 'Kick Only Fight',
    hp: 100,
    moves: ['kick', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: false
  },
  punchonly: {
    key: 'punchonly',
    label: 'Punch Only Fight',
    hp: 100,
    moves: ['punch', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: false
  },
  halfhealth: {
    key: 'halfhealth',
    label: 'Half Health Fight',
    hp: 50,
    moves: ['punch', 'kick', 'defend', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: false
  },
  surprise: {
    key: 'surprise',
    label: 'Surprise Fight',
    hp: 100,
    moves: ['punch', 'kick', 'flee'],
    hideHealth: true,
    hideLogValues: true,
    chaos: false
  },
  chaos: {
    key: 'chaos',
    label: 'Chaos Fight',
    hp: 100,
    moves: ['chaos', 'flee'],
    hideHealth: false,
    hideLogValues: false,
    chaos: true
  }
};

const MOVE_BUTTON_META = {
  punch: { label: '👊 Punch', key: 'punch' },
  kick: { label: '🦶 Kick', key: 'kick' },
  defend: { label: '🛡️ Defend', key: 'defend' },
  flee: { label: '🏃 Flee', key: 'flee' },
  chaos: { label: '🌀 Chaos', key: 'chaos' },
  kiss: { label: '💋 Kiss', key: 'kiss' },
  spin: { label: '🌪️ Spin', key: 'spin' },
  flick: { label: '🤏 Flick', key: 'flick' }
};

const CUSTOM_HEALTH_STEPS = [50, 100, 200, 500];
const CUSTOM_TOGGLE_MOVES = ['punch', 'kick', 'defend', 'flee', 'kiss', 'spin', 'flick'];

// Collision-free compact session ID (11-12 chars -> keeps all callback_data well under Telegram's 64-byte cap)
function nextSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}${rand}`;
}

// Helpers for pendingMoves (stored as plain JSON object in active_fights, also supports Map for tests)
function getPendingMove(session, userId) {
  const pm = session?.pendingMoves;
  if (!pm) return undefined;
  if (pm instanceof Map) return pm.get(userId);
  return pm[String(userId)] || pm[userId];
}

function hasPendingMove(session, userId) {
  return Boolean(getPendingMove(session, userId));
}

function setPendingMove(session, userId, value) {
  if (!session.pendingMoves) session.pendingMoves = {};
  if (session.pendingMoves instanceof Map) {
    session.pendingMoves.set(userId, value);
  } else {
    session.pendingMoves[String(userId)] = value;
  }
}

function clearPendingMoves(session) {
  if (session.pendingMoves instanceof Map) {
    session.pendingMoves.clear();
  } else {
    session.pendingMoves = {};
  }
}

function countPendingMoves(session) {
  const pm = session?.pendingMoves;
  if (!pm) return 0;
  if (pm instanceof Map) return pm.size;
  return Object.keys(pm).length;
}

// Helpers for readyUsers & moves (stored as JSON arrays in active_fights)
function getReadySet(lobby) {
  if (lobby.readyUsers instanceof Set) return lobby.readyUsers;
  return new Set((lobby.readyUsers || []).map(Number));
}

function setReadyList(lobby, setObj) {
  lobby.readyUsers = [...setObj].map(Number);
}

function getLobbyMovesList(lobby) {
  if (lobby.moves instanceof Set) return [...lobby.moves];
  return Array.isArray(lobby.moves) ? [...lobby.moves] : ['punch', 'kick', 'defend', 'flee'];
}

// Crash-proof Telegram edit & answer helpers
async function safeEditMessage(ctx, text, opts = {}) {
  try {
    if (typeof ctx.editMessageText === 'function') {
      return await ctx.editMessageText(text, opts);
    }
    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (ctx.api && chatId && messageId) {
      return await ctx.api.editMessageText(chatId, messageId, text, opts);
    }
  } catch (err) {
    const desc = String(err?.description || err?.message || err || '').toLowerCase();
    if (
      desc.includes('message is not modified') ||
      desc.includes('message to edit not found') ||
      desc.includes("message can't be edited") ||
      desc.includes('query is too old') ||
      desc.includes('chat not found')
    ) {
      return null;
    }
    console.error('[Fight] safeEditMessage error:', err?.description || err?.message || err);
  }
  return null;
}

async function safeAnswerCallback(ctx, opts = {}) {
  try {
    if (typeof ctx.answerCallbackQuery === 'function') {
      return await ctx.answerCallbackQuery(opts);
    }
  } catch (err) {
    const desc = String(err?.description || err?.message || err || '').toLowerCase();
    if (!desc.includes('query is too old')) {
      console.error('[Fight] safeAnswerCallback error:', err?.description || err?.message || err);
    }
  }
  return null;
}

function buildHpBar(hp, maxHp, side = 'left', hideHealth = false) {
  const heart = side === 'left' ? '💙' : '❤️';
  if (hideHealth) {
    return `🙈 <code>[??????????] ???%</code>`;
  }
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0;
  const filled = Math.max(0, Math.min(10, Math.round((pct / 100) * 10)));
  const bar = '■'.repeat(filled) + '□'.repeat(10 - filled);
  return `${heart} <code>[${bar}] ${pct}%</code>`;
}

function formatFighterHandle(fighter) {
  if (fighter.username) return `@${sanitizeHtml(fighter.username)}`;
  return sanitizeHtml(fighter.firstName || `Player ${fighter.userId}`);
}

function createFighterState(user, maxHp) {
  const rankMeta = fightRepo.getRankMeta(user.fight_rank || 'Bronze');
  return {
    userId: Number(user.user_id),
    username: user.username || null,
    firstName: user.first_name || 'Meme Lord',
    hp: maxHp,
    maxHp,
    rank: rankMeta.name,
    rankEmoji: rankMeta.emoji,
    rep: Number(user.fight_rep || 0),
    streak: Number(user.fight_streak || 0),
    defendCd: 0,
    kissCd: 0,
    fled: false,
    damageDealt: 0,
    damageBlocked: 0,
    healsDone: 0,
    hits: 0,
    misses: 0,
    actionCounts: {}
  };
}

function renderFighterBlock(f, side, session, isFinished = false) {
  const rankMeta = fightRepo.getRankMeta(f.rank || 'Bronze');
  const hideHp = Boolean(session.hideHealth) && !isFinished;
  const hpBar = buildHpBar(f.hp, f.maxHp, side, hideHp);
  const hpNumeric = hideHp ? '' : ` (${f.hp}/${f.maxHp})`;

  let statusTag = '';
  if (!isFinished && session.phase === 'fighting') {
    if (f.fled) {
      statusTag = ' <i>(🏃 fled)</i>';
    } else if (f.hp <= 0) {
      statusTag = ' <i>(💀 KO)</i>';
    } else if (hasPendingMove(session, f.userId)) {
      statusTag = ' <i>(✅ ready)</i>';
    } else {
      statusTag = ' <i>(waiting)</i>';
    }
  } else if (f.fled) {
    statusTag = ' <i>(🏃 fled)</i>';
  } else if (f.hp <= 0) {
    statusTag = ' <i>(💀 KO)</i>';
  }

  const streakStr = Number(f.streak || 0) >= 3 ? `  🏆 ${f.streak}` : '';
  return (
    `👤 <b>${formatFighterHandle(f)}</b> ${rankMeta.emoji}${statusTag}\n` +
    `${hpBar}${hpNumeric}\n` +
    `🎖️ ${Number(f.rep || 0)}${streakStr}`
  );
}

function renderBattleMessage(session, { isFinished = false, endSummary = '' } = {}) {
  const maxR = Number(session.maxRounds || MAX_ROUNDS);
  const header = isFinished
    ? `⚔️ <b>${sanitizeHtml(session.modeLabel)} — Fight Ended (Round ${session.round} / ${maxR})</b>`
    : `⚔️ <b>${sanitizeHtml(session.modeLabel)} — Round ${session.round} / ${maxR}</b>`;

  const hiddenHint = (!isFinished && session.hideHealth)
    ? `\n🙈 <i>Health is hidden! Fight ends automatically at KO or Round ${maxR} max.</i>`
    : '';

  const leftText = (session.leftTeam || []).map(f => renderFighterBlock(f, 'left', session, isFinished)).join('\n\n');
  const rightText = (session.rightTeam || []).map(f => renderFighterBlock(f, 'right', session, isFinished)).join('\n\n');

  let logBlock = '';
  if (session.lastRoundLines && session.lastRoundLines.length > 0) {
    logBlock = `\n\n📜 <b>Last Round:</b>\n${session.lastRoundLines.join('\n')}`;
  }

  const wagerCoins = Number(session.wagerCoins || 0);
  const totalPlayers = (session.leftTeam?.length || 0) + (session.rightTeam?.length || 0);
  const wagerLine = wagerCoins > 0
    ? `\n💰 <b>Pot:</b> ${formatCoins(wagerCoins * totalPlayers)}`
    : '';

  const timerLine = !isFinished
    ? `\n⏳ <i>All active fighters choose simultaneously (Force Turn unlocks after 30s)</i>`
    : '';

  return (
    `${header}${wagerLine}${hiddenHint}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `${leftText}\n\n` +
    `⚡ <b>VS</b> ⚡\n\n` +
    `${rightText}\n` +
    `━━━━━━━━━━━━━━━━━━━━━` +
    logBlock +
    (endSummary ? `\n\n${endSummary}` : '') +
    timerLine
  );
}

function buildActiveMoveKeyboard(session) {
  const kb = new InlineKeyboard();
  const moves = session.allowedMoves || ['punch', 'kick', 'defend', 'flee'];

  moves.forEach((m, idx) => {
    const meta = MOVE_BUTTON_META[m] || { label: m, key: m };
    kb.text(meta.label, `fight:mv:${session.sid}:${session.round}:${meta.key}`);
    if ((idx + 1) % 2 === 0 && idx < moves.length - 1) {
      kb.row();
    }
  });

  kb.row().text('⏰ Force Turn', `fight:ft:${session.sid}:${session.round}`);

  if (Number(session.wagerCoins || 0) > 0) {
    kb.text('⚠️', 'gamble:warning');
  }
  return kb;
}

export function buildPostFightKeyboard(fightRecord, rematchCount = 0) {
  const totalFighters = (fightRecord.left_team?.length || 1) + (fightRecord.right_team?.length || 1);
  const fightId = fightRecord.fight_id;
  const kb = new InlineKeyboard()
    .text('📝 Logs', `fpost:logs:${fightId}`)
    .text('🔄 Watch Replay', `fpost:replay:${fightId}:0`)
    .text('📊 Analysis', `fpost:analysis:${fightId}`)
    .row()
    .text(`🔄 Fight Again (${rematchCount}/${totalFighters})`, `fpost:rematch:${fightId}`);

  if (fightRecord.type === 'quick') {
    kb.text('🎖️ Give Reputation', `fpost:rep:${fightId}`);
  }
  if (Number(fightRecord.wager_coins || 0) > 0) {
    kb.row().text('⚠️', 'gamble:warning');
  }
  return kb;
}

function getAllAliveFighters(session) {
  return [...(session.leftTeam || []), ...(session.rightTeam || [])].filter(f => f.hp > 0 && !f.fled);
}

function pickRandomAlive(team) {
  const alive = team.filter(f => f.hp > 0 && !f.fled);
  if (alive.length === 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

function calculateTeamHpPct(team) {
  let hpSum = 0;
  let maxSum = 0;
  for (const f of team || []) {
    if (!f.fled) {
      hpSum += Math.max(0, Number(f.hp || 0));
    }
    maxSum += Math.max(1, Number(f.maxHp || 100));
  }
  return maxSum > 0 ? (hpSum / maxSum) * 100 : 0;
}

export function resolveFightRoundEngine(session, { forceAutoUnpicked = false } = {}) {
  const leftAliveBefore = session.leftTeam.filter(f => f.hp > 0 && !f.fled);
  const rightAliveBefore = session.rightTeam.filter(f => f.hp > 0 && !f.fled);
  const activeFighters = [...leftAliveBefore, ...rightAliveBefore];
  const nonFlee = (session.allowedMoves || ['punch']).filter(m => m !== 'flee');
  const fallbackPool = nonFlee.length > 0 ? nonFlee : ['punch'];

  const resolvedMoves = new Map();
  const defendingIds = new Set();

  // 1. Expand Chaos & mark defending/fleeing fighters first
  for (const f of activeFighters) {
    let picked = getPendingMove(session, f.userId);
    if (!picked) {
      if (forceAutoUnpicked) {
        let choices = [...fallbackPool];
        if (f.defendCd > 0) choices = choices.filter(m => m !== 'defend');
        if (f.kissCd > 0) choices = choices.filter(m => m !== 'kiss');
        if (choices.length === 0) choices = ['punch'];
        picked = { move: choices[Math.floor(Math.random() * choices.length)], auto: true };
      } else {
        // Unpicked fighter (e.g., teammate when opponent fled early): tick cooldowns safely, skip action
        if (f.defendCd > 0) f.defendCd -= 1;
        if (f.kissCd > 0) f.kissCd -= 1;
        continue;
      }
    }

    let actualMove = picked.move;
    let wasChaos = false;

    if (actualMove === 'chaos') {
      wasChaos = true;
      const pool = ['punch', 'kick'];
      if (f.defendCd <= 0) pool.push('defend');
      actualMove = pool[Math.floor(Math.random() * pool.length)];
    }

    f.actionCounts = f.actionCounts || {};
    f.actionCounts[actualMove] = Number(f.actionCounts[actualMove] || 0) + 1;

    if (actualMove === 'defend') {
      defendingIds.add(f.userId);
      f.defendCd = 3; // 3-turn cooldown afterward
    } else if (f.defendCd > 0) {
      f.defendCd -= 1;
    }

    if (actualMove === 'kiss') {
      f.kissCd = 3; // 3-turn cooldown
    } else if (f.kissCd > 0) {
      f.kissCd -= 1;
    }

    resolvedMoves.set(f.userId, {
      actualMove,
      wasChaos,
      auto: Boolean(picked.auto)
    });
  }

  const actionsLog = [];
  const roundLines = [];
  const hideVals = Boolean(session.hideLogValues);

  const sideOf = (uid) => (session.leftTeam.some(f => f.userId === uid) ? 'left' : 'right');

  // 2. Process all submitted simultaneous moves
  for (const f of activeFighters) {
    const info = resolvedMoves.get(f.userId);
    if (!info) continue;

    const move = info.actualMove;
    const fName = formatFighterHandle(f);
    const mySide = sideOf(f.userId);
    const enemyTeam = mySide === 'left' ? session.rightTeam : session.leftTeam;
    const autoPrefix = info.auto ? '⏰ ' : '';
    const chaosTag = info.wasChaos ? '🌀→' : '';

    if (move === 'flee') {
      f.fled = true;
      f.hp = 0;
      const summary = `${autoPrefix}🏃 <b>${fName}</b> fled the fight!`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move: 'flee',
        wasChaos: info.wasChaos,
        damage: 0,
        healed: 0,
        blocked: false,
        missed: false,
        text: summary
      });
      continue;
    }

    if (move === 'defend') {
      const summary = `${autoPrefix}${chaosTag}🛡️ <b>${fName}</b> raised their shield (100% block)!`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move: 'defend',
        wasChaos: info.wasChaos,
        damage: 0,
        healed: 0,
        blocked: false,
        missed: false,
        text: summary
      });
      continue;
    }

    if (move === 'kiss') {
      const target = pickRandomAlive(enemyTeam);
      if (target) {
        const healAmt = randomBetween(15, 25);
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + healAmt);
        const actualHeal = target.hp - before;
        f.healsDone += actualHeal;
        const valText = hideVals ? '??? HP' : `+${actualHeal} HP`;
        const summary = `${autoPrefix}💋 <b>${fName}</b> kissed <b>${formatFighterHandle(target)}</b>, healing ${valText}!`;
        roundLines.push(summary);
        actionsLog.push({
          userId: f.userId,
          name: fName,
          side: mySide,
          move: 'kiss',
          targetId: target.userId,
          targetName: formatFighterHandle(target),
          damage: 0,
          healed: actualHeal,
          blocked: false,
          missed: false,
          text: summary
        });
      }
      continue;
    }

    if (move === 'spin') {
      const targets = enemyTeam.filter(e => e.hp > 0 && !e.fled);
      let totalDmg = 0;
      let anyBlocked = false;
      for (const target of targets) {
        const rawDmg = randomBetween(10, 18);
        if (defendingIds.has(target.userId)) {
          target.damageBlocked += rawDmg;
          anyBlocked = true;
        } else {
          const dealt = Math.min(target.hp, rawDmg);
          target.hp = Math.max(0, target.hp - rawDmg);
          f.damageDealt += dealt;
          f.hits += 1;
          totalDmg += dealt;
        }
      }
      const valText = hideVals ? '??? DMG' : `${totalDmg} total DMG`;
      const blockNote = anyBlocked ? ' (blocked by shield!)' : '';
      const summary = `${autoPrefix}🌪️ <b>${fName}</b> used Spin AoE for <b>${valText}</b>${blockNote}!`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move: 'spin',
        damage: totalDmg,
        healed: 0,
        blocked: anyBlocked && totalDmg === 0,
        missed: false,
        text: summary
      });
      continue;
    }

    // Single-target attacks: punch, kick, flick
    const target = pickRandomAlive(enemyTeam);
    if (!target) continue;

    let rawDmg = 0;
    let didHit = true;
    let moveEmoji = '👊';
    let moveLabel = 'Punch';

    if (move === 'punch') {
      moveEmoji = '👊';
      moveLabel = 'Punch';
      didHit = Math.random() < 0.90;
      rawDmg = didHit ? randomBetween(12, 20) : 0;
    } else if (move === 'kick') {
      moveEmoji = '🦶';
      moveLabel = 'Kick';
      didHit = Math.random() < 0.65;
      rawDmg = didHit ? randomBetween(18, 32) : 0;
    } else if (move === 'flick') {
      moveEmoji = '🤏';
      moveLabel = 'Flick';
      didHit = true;
      rawDmg = 10;
    }

    if (!didHit) {
      f.misses += 1;
      const summary = `${autoPrefix}${chaosTag}${moveEmoji} <b>${fName}</b> tried to ${moveLabel} <b>${formatFighterHandle(target)}</b>, but <i>MISSED!</i>`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move,
        wasChaos: info.wasChaos,
        targetId: target.userId,
        targetName: formatFighterHandle(target),
        damage: 0,
        healed: 0,
        blocked: false,
        missed: true,
        text: summary
      });
    } else if (defendingIds.has(target.userId)) {
      target.damageBlocked += rawDmg;
      f.hits += 1;
      const valText = hideVals ? '??? DMG' : `${rawDmg} DMG`;
      const summary = `${autoPrefix}${chaosTag}${moveEmoji} <b>${fName}</b> struck <b>${formatFighterHandle(target)}</b> (${valText}), but 🛡️ <b>BLOCKED!</b>`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move,
        wasChaos: info.wasChaos,
        targetId: target.userId,
        targetName: formatFighterHandle(target),
        damage: 0,
        blockedDamage: rawDmg,
        healed: 0,
        blocked: true,
        missed: false,
        text: summary
      });
    } else {
      const dealt = Math.min(target.hp, rawDmg);
      target.hp = Math.max(0, target.hp - rawDmg);
      f.damageDealt += dealt;
      f.hits += 1;
      const valText = hideVals ? '??? DMG' : `${rawDmg} DMG`;
      const summary = `${autoPrefix}${chaosTag}${moveEmoji} <b>${fName}</b> hit <b>${formatFighterHandle(target)}</b> with ${moveLabel} for <b>${valText}</b>!`;
      roundLines.push(summary);
      actionsLog.push({
        userId: f.userId,
        name: fName,
        side: mySide,
        move,
        wasChaos: info.wasChaos,
        targetId: target.userId,
        targetName: formatFighterHandle(target),
        damage: rawDmg,
        healed: 0,
        blocked: false,
        missed: false,
        text: summary
      });
    }
  }

  const snapshotSide = (team) => team.map(f => ({
    userId: f.userId,
    username: f.username,
    firstName: f.firstName,
    hp: f.hp,
    maxHp: f.maxHp,
    fled: f.fled,
    rank: f.rank,
    rankEmoji: f.rankEmoji,
    rep: f.rep,
    streak: f.streak
  }));

  session.roundsLog = session.roundsLog || [];
  session.roundsLog.push({
    round: session.round,
    actions: actionsLog,
    leftSnapshot: snapshotSide(session.leftTeam),
    rightSnapshot: snapshotSide(session.rightTeam)
  });

  session.lastRoundLines = roundLines;
  clearPendingMoves(session);

  const leftAliveAfter = session.leftTeam.filter(f => f.hp > 0 && !f.fled).length;
  const rightAliveAfter = session.rightTeam.filter(f => f.hp > 0 && !f.fled).length;

  let winnerSide = null;
  let endedByTimeLimit = false;
  let leftPct = null;
  let rightPct = null;

  if (leftAliveAfter === 0 && rightAliveAfter === 0) {
    winnerSide = 'draw';
  } else if (rightAliveAfter === 0) {
    winnerSide = 'left';
  } else if (leftAliveAfter === 0) {
    winnerSide = 'right';
  } else if (Number(session.round) >= Number(session.maxRounds || MAX_ROUNDS)) {
    // Strict 20-Round Max Cap -> Reveal HP & Decide by Remaining HP %
    endedByTimeLimit = true;
    session.hideHealth = false;
    leftPct = calculateTeamHpPct(session.leftTeam);
    rightPct = calculateTeamHpPct(session.rightTeam);
    if (Math.abs(leftPct - rightPct) < 0.001) {
      winnerSide = 'draw';
    } else {
      winnerSide = leftPct > rightPct ? 'left' : 'right';
    }
  }

  return { winnerSide, roundLines, endedByTimeLimit, leftPct, rightPct };
}

async function finalizeFight(session, winnerSide, { endedByTimeLimit = false, leftPct = null, rightPct = null } = {}) {
  session.phase = 'finished';
  session.hideHealth = false;

  const allFighters = [...session.leftTeam, ...session.rightTeam];
  const leftIds = session.leftTeam.map(f => f.userId);
  const rightIds = session.rightTeam.map(f => f.userId);

  // Settle wagers
  let wagerSummary = '';
  const wagerCoins = Number(session.wagerCoins || 0);
  if (wagerCoins > 0) {
    const totalPot = wagerCoins * allFighters.length;
    if (winnerSide === 'draw') {
      for (const f of allFighters) {
        await userRepo.updateCoins(f.userId, {
          walletDelta: wagerCoins,
          sourceCommand: '/fight',
          details: 'Fight Draw Wager Refund'
        });
      }
      wagerSummary = `\n🤝 <b>Draw Refund:</b> Everyone received ${formatCoins(wagerCoins)} back.`;
    } else {
      const winners = winnerSide === 'left' ? session.leftTeam : session.rightTeam;
      const share = Math.floor(totalPot / winners.length);
      for (const w of winners) {
        await userRepo.updateCoins(w.userId, {
          walletDelta: share,
          sourceCommand: '/fight',
          details: `Won Fight Wager Pot (${formatCoins(share)})`
        });
      }
      wagerSummary = `\n💰 <b>Wager Payout:</b> ${winners.map(formatFighterHandle).join(', ')} won <b>${formatCoins(share)}</b>${winners.length > 1 ? ' each' : ''}!`;
    }
  }

  // Record rankings (Quick Fights ONLY) vs action stats (Custom Fights)
  let rankSummary = '';
  const actionCountsByUser = {};
  const hpPercentByUser = {};
  const accuracyBonusByUser = {};
  const fledUserIds = new Set();

  for (const f of allFighters) {
    actionCountsByUser[f.userId] = f.actionCounts || {};
    hpPercentByUser[f.userId] = f.maxHp > 0 ? Math.round((f.hp / f.maxHp) * 100) : 0;
    const totalSwings = Number(f.hits || 0) + Number(f.misses || 0);
    accuracyBonusByUser[f.userId] = (totalSwings > 0 && Number(f.misses || 0) === 0) ? 5 : 0;
    if (f.fled) fledUserIds.add(f.userId);
  }

  if (session.type === 'quick') {
    const rankRes = await fightRepo.recordQuickFightOutcome({
      leftIds,
      rightIds,
      winnerSide,
      fledUserIds,
      hpPercentByUser,
      accuracyBonusByUser,
      actionCountsByUser
    });

    const ptsLines = allFighters.map(f => {
      const pts = rankRes.pointsAwardedByUser[f.userId] ?? 0;
      return `${formatFighterHandle(f)} (+${pts} pts)`;
    });
    const antiFarmNote = rankRes.diminishingFactor < 1
      ? ` <i>(Daily pair scaling: ${Math.round(rankRes.diminishingFactor * 100)}%)</i>`
      : '';
    rankSummary = `\n📊 <b>Ranked Points:</b> ${ptsLines.join(' | ')}${antiFarmNote}`;

    if (rankRes.promotions.length > 0) {
      rankSummary += `\n🎉 <b>RANK UP!</b> ` + rankRes.promotions
        .map(p => {
          const fighter = allFighters.find(x => x.userId === p.userId);
          return `${fighter ? formatFighterHandle(fighter) : p.userId} promoted to ${p.toRank.emoji} <b>${p.toRank.name}</b> (Unlocked title: <i>"${p.toRank.title}"</i>)!`;
        })
        .join('\n');
    }

    for (const f of allFighters) {
      const fresh = await userRepo.getUser(f.userId);
      if (fresh) {
        const rm = fightRepo.getRankMeta(fresh.fight_rank || 'Bronze');
        f.rank = rm.name;
        f.rankEmoji = rm.emoji;
        f.rep = Number(fresh.fight_rep || 0);
        f.streak = Number(fresh.fight_streak || 0);
      }
    }
  } else {
    await fightRepo.recordCustomActionCounts(actionCountsByUser);
    rankSummary = `\n🎮 <i>Unranked Custom Fight — Rankings, streaks &amp; reputation unaffected.</i>`;
  }

  // Persist stateless fight record BEFORE deleting active_fights row
  const serializeTeam = (team, isLeft = false) => team.map((f, idx) => ({
    userId: f.userId,
    username: f.username,
    firstName: f.firstName,
    hp: f.hp,
    maxHp: f.maxHp,
    fled: f.fled,
    damageDealt: f.damageDealt,
    damageBlocked: f.damageBlocked,
    healsDone: f.healsDone,
    hits: f.hits,
    misses: f.misses,
    rank: f.rank,
    rankEmoji: f.rankEmoji,
    rep: f.rep,
    streak: f.streak,
    ...(isLeft && idx === 0 && session.type === 'custom'
      ? {
          customConfig: {
            hp: session.hp,
            hideHealth: Boolean(session.wasHiddenHealth),
            hideLogValues: Boolean(session.hideLogValues),
            allowedMoves: session.allowedMoves || ['punch', 'kick', 'defend', 'flee']
          }
        }
      : {})
  }));

  const savedFight = await fightRepo.saveFightRecord({
    type: session.type,
    mode: session.mode,
    wagerCoins,
    leftTeam: serializeTeam(session.leftTeam, true),
    rightTeam: serializeTeam(session.rightTeam, false),
    winnerSide,
    roundsLog: session.roundsLog
  });

  await fightRepo.deleteActiveFight(session.sid);

  let winBanner = '';
  if (endedByTimeLimit) {
    const lStr = Number(leftPct || 0).toFixed(1);
    const rStr = Number(rightPct || 0).toFixed(1);
    const timeHeader = `⏱️ <b>20-ROUND TIME LIMIT REACHED!</b>\n⚖️ <b>Judge's Decision:</b> 💙 ${lStr}% HP vs ❤️ ${rStr}% HP\n`;
    if (winnerSide === 'draw') {
      winBanner = `${timeHeader}🤝 <b>IT'S A DRAW!</b> Exact tie on remaining HP%!`;
    } else {
      const winTeam = winnerSide === 'left' ? session.leftTeam : session.rightTeam;
      winBanner = `${timeHeader}🏆 <b>VICTORY BY DECISION:</b> ${winTeam.map(formatFighterHandle).join(', ')}!`;
    }
  } else if (winnerSide === 'draw') {
    winBanner = `🤝 <b>IT'S A DRAW!</b> Both sides fell at the same time!`;
  } else {
    const winTeam = winnerSide === 'left' ? session.leftTeam : session.rightTeam;
    winBanner = `🏆 <b>VICTORY:</b> ${winTeam.map(formatFighterHandle).join(', ')}!`;
  }

  const endSummary =
    `${winBanner}${wagerSummary}${rankSummary}\n` +
    `🆔 <i>Fight #${savedFight.fight_id} archived permanently.</i>`;

  const finalText = renderBattleMessage(session, { isFinished: true, endSummary });
  const finalKb = buildPostFightKeyboard(savedFight, 0);

  return { finalText, finalKb, savedFight };
}

async function resolveRoundAndRender(session, ctx, { forceAutoUnpicked = false } = {}) {
  const { winnerSide, endedByTimeLimit, leftPct, rightPct } = resolveFightRoundEngine(session, { forceAutoUnpicked });

  if (winnerSide) {
    const { finalText, finalKb } = await finalizeFight(session, winnerSide, { endedByTimeLimit, leftPct, rightPct });
    await safeEditMessage(ctx, finalText, {
      parse_mode: 'HTML',
      reply_markup: finalKb
    });
    return { finished: true };
  }

  session.round += 1;
  session.roundStartedAt = Date.now();
  await fightRepo.saveActiveFight(session.sid, session);

  const nextText = renderBattleMessage(session, { isFinished: false });
  const nextKb = buildActiveMoveKeyboard(session);

  await safeEditMessage(ctx, nextText, {
    parse_mode: 'HTML',
    reply_markup: nextKb
  });
  return { finished: false };
}

// ==========================================
// CUSTOM LOBBY RENDERING
// ==========================================
function renderCustomLobbyText(lobby) {
  const readySet = getReadySet(lobby);
  const movesList = getLobbyMovesList(lobby);

  const leftList = lobby.leftTeam.length > 0
    ? lobby.leftTeam.map(u => `• ${formatFighterHandle(u)}${readySet.has(Number(u.userId)) ? ' ✅' : ''}`).join('\n')
    : '<i>Empty — click Join Left Side</i>';
  const rightList = lobby.rightTeam.length > 0
    ? lobby.rightTeam.map(u => `• ${formatFighterHandle(u)}${readySet.has(Number(u.userId)) ? ' ✅' : ''}`).join('\n')
    : '<i>Empty — click Join Right Side</i>';

  const activeMovesStr = movesList
    .map(m => MOVE_BUTTON_META[m]?.label || m)
    .join(', ');

  const wagerStr = Number(lobby.wagerCoins || 0) > 0 ? formatCoins(lobby.wagerCoins) : 'None (Friendly)';
  const totalJoined = lobby.leftTeam.length + lobby.rightTeam.length;

  return (
    `⚔️ <b>Custom Team Fight Lobby (Unranked • Max ${MAX_ROUNDS} Rounds)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💙 <b>Left Team (${lobby.leftTeam.length}):</b>\n${leftList}\n\n` +
    `❤️ <b>Right Team (${lobby.rightTeam.length}):</b>\n${rightList}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ <b>Rules &amp; Settings</b> <i>(Changing rules resets Ready 0/${totalJoined})</i>:\n` +
    `• 💰 <b>Wager:</b> ${wagerStr}\n` +
    `• ❤️ <b>Starting HP:</b> <b>${lobby.hp} HP</b>\n` +
    `• 🙈 <b>Hide Health:</b> <b>${lobby.hideHealth ? 'ON' : 'OFF'}</b> | 📝 <b>Hide Log Values:</b> <b>${lobby.hideLogValues ? 'ON' : 'OFF'}</b>\n` +
    `• 🥊 <b>Active Moves:</b> ${activeMovesStr || 'None!'}`
  );
}

function buildCustomLobbyKeyboard(lobby) {
  const readySet = getReadySet(lobby);
  const movesSet = new Set(getLobbyMovesList(lobby));
  const totalJoined = lobby.leftTeam.length + lobby.rightTeam.length;
  const readyCount = readySet.size;
  const mvMark = (m) => `${movesSet.has(m) ? '✅' : '❌'} ${MOVE_BUTTON_META[m].label}`;

  const kb = new InlineKeyboard()
    .text('⬅️ Join Left Side', `fight:jl:${lobby.sid}`)
    .text('➡️ Join Right Side', `fight:jr:${lobby.sid}`)
    .row()
    .text(mvMark('punch'), `fight:tm:${lobby.sid}:punch`)
    .text(mvMark('kick'), `fight:tm:${lobby.sid}:kick`)
    .text(mvMark('defend'), `fight:tm:${lobby.sid}:defend`)
    .text(mvMark('flee'), `fight:tm:${lobby.sid}:flee`)
    .row()
    .text(mvMark('kiss'), `fight:tm:${lobby.sid}:kiss`)
    .text(mvMark('spin'), `fight:tm:${lobby.sid}:spin`)
    .text(mvMark('flick'), `fight:tm:${lobby.sid}:flick`)
    .row()
    .text(`❤️ Edit Health (${lobby.hp})`, `fight:hp:${lobby.sid}`)
    .text(`🙈 Hide Health: ${lobby.hideHealth ? 'ON' : 'OFF'}`, `fight:hh:${lobby.sid}`)
    .row()
    .text(`📝 Hide Log Values: ${lobby.hideLogValues ? 'ON' : 'OFF'}`, `fight:hl:${lobby.sid}`)
    .row()
    .text('❌ Cancel Lobby', `fight:cl:${lobby.sid}`)
    .text(`⚔️ Start Fight (${readyCount}/${totalJoined})`, `fight:go:${lobby.sid}`);

  if (Number(lobby.wagerCoins || 0) > 0) {
    kb.row().text('⚠️', 'gamble:warning');
  }
  return kb;
}

// ==========================================
// RANKING & HISTORY VIEWS
// ==========================================
async function renderRankingView(callerId, page = 0) {
  const standings = await fightRepo.getBucketStandings(null, callerId);
  const caller = await userRepo.getUser(callerId);
  const callerRankMeta = fightRepo.getRankMeta(caller?.fight_rank || 'Bronze');
  const nextRankMeta = fightRepo.FIGHT_RANKS[callerRankMeta.idx + 1] || null;

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(standings.rows.length / pageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, Number(page || 0)));
  const slice = standings.rows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  let lines = '';
  if (slice.length === 0) {
    lines = `<i>No fighters in this week's bucket yet! Start one with <code>/fight quick @user</code>.</i>\n`;
  } else {
    slice.forEach((row, idx) => {
      const globalIdx = safePage * pageSize + idx;
      const rMeta = fightRepo.getRankMeta(row.fight_rank || 'Bronze');
      let zoneIcon = '➖';
      if (globalIdx < standings.promoteCutoff) zoneIcon = '🔼';
      else if (globalIdx >= standings.demoteStart) zoneIcon = '🔽';

      const handle = row.username
        ? `@${sanitizeHtml(row.username)}`
        : sanitizeHtml(row.first_name || `User ${row.user_id}`);
      const isYou = Number(row.user_id) === Number(callerId) ? ' <b>(You)</b>' : '';
      lines += `${zoneIcon} <b>#${globalIdx + 1}</b> ${rMeta.emoji} <b>${handle}</b>${isYou} — <b>${Number(row.fight_score || 0)} pts</b> (${Number(row.fight_wins || 0)}W/${Number(row.fight_losses || 0)}L, 🎖️ ${Number(row.fight_rep || 0)})\n`;
    });
  }

  const nextRankHint = nextRankMeta
    ? `📈 Next Rank: ${nextRankMeta.emoji} <b>${nextRankMeta.name}</b> at <b>${nextRankMeta.minScore} pts</b>`
    : `👑 <b>Maximum Rank Achieved!</b>`;

  const text =
    `🏆 <b>Fight 2.0 Weekly Bucket Rankings</b> (<code>${sanitizeHtml(standings.bucketId)}</code>)\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Your Rank:</b> ${callerRankMeta.emoji} <b>${callerRankMeta.name}</b> (Title: <i>"${sanitizeHtml(callerRankMeta.title)}"</i>)\n` +
    `📊 <b>Your Score:</b> <b>${Number(caller?.fight_score || 0)} pts</b> | 🎖️ Rep: <b>${Number(caller?.fight_rep || 0)}</b> | 🔥 Streak: <b>${Number(caller?.fight_streak || 0)}</b>\n` +
    `${nextRankHint}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔼 Top 20% = <b>Promotion Zone</b> (Cut: #${standings.promoteCutoff || 1})\n` +
    `➖ Middle 60% = <b>Safe Zone</b>\n` +
    `🔽 Bottom 20% = <b>Demotion Zone</b>\n\n` +
    lines +
    `\n<i>Page ${safePage + 1}/${totalPages} • Total Fighters: ${standings.total}</i>`;

  const kb = new InlineKeyboard()
    .text('⏮️', `fight:rk:0:${callerId}`)
    .text('◀️', `fight:rk:${Math.max(0, safePage - 1)}:${callerId}`)
    .text('▶️', `fight:rk:${Math.min(totalPages - 1, safePage + 1)}:${callerId}`)
    .text('⏭️', `fight:rk:${totalPages - 1}:${callerId}`);

  return { text, keyboard: kb };
}

async function renderHistoryView(targetUser, callerId, page = 0) {
  const fights = await fightRepo.getUserFightHistory(targetUser.user_id);
  const handle = targetUser.username
    ? `@${sanitizeHtml(targetUser.username)}`
    : sanitizeHtml(targetUser.first_name || String(targetUser.user_id));

  if (fights.length === 0) {
    return {
      text:
        `📜 <b>${handle}</b> has no recorded fights yet! Start one with <code>/fight quick @user</code>.\n\n` +
        `📊 <b>Record:</b> ${Number(targetUser.fight_wins || 0)}W / ${Number(targetUser.fight_losses || 0)}L | 🔥 Streak: <b>${Number(targetUser.fight_streak || 0)}</b> | 🎖️ Rep: <b>${Number(targetUser.fight_rep || 0)}</b>`,
      keyboard: undefined
    };
  }

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(fights.length / pageSize));
  const safePage = Math.max(0, Math.min(totalPages - 1, Number(page || 0)));
  const slice = fights.slice(safePage * pageSize, (safePage + 1) * pageSize);

  let lines = '';
  for (const f of slice) {
    const uid = Number(targetUser.user_id);
    const onLeft = (f.left_team || []).some(p => Number(p?.userId) === uid);
    const opps = onLeft ? (f.right_team || []) : (f.left_team || []);
    const oppNames = opps.map(p => (p.username ? `@${sanitizeHtml(p.username)}` : sanitizeHtml(p.firstName || String(p.userId)))).join(', ') || 'Unknown';
    let outcome = '🤝 Draw';
    if (f.winner_side === 'left') outcome = onLeft ? '🏆 Win' : '💀 Loss';
    else if (f.winner_side === 'right') outcome = !onLeft ? '🏆 Win' : '💀 Loss';

    const wagerTxt = Number(f.wager_coins || 0) > 0 ? ` | 💰 ${formatCoins(f.wager_coins)}` : '';
    const typeTag = f.type === 'quick' ? 'Ranked' : 'Custom';
    lines += `• <code>#${f.fight_id}</code> [${typeTag} • ${sanitizeHtml(f.mode)}] ${outcome} vs <b>${oppNames}</b>${wagerTxt}\n`;
  }

  const text =
    `📜 <b>Fight History: ${handle}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Record:</b> ${Number(targetUser.fight_wins || 0)}W / ${Number(targetUser.fight_losses || 0)}L | 🔥 Streak: <b>${Number(targetUser.fight_streak || 0)}</b> | 🎖️ Rep: <b>${Number(targetUser.fight_rep || 0)}</b>\n\n` +
    lines +
    `\n<i>Page ${safePage + 1}/${totalPages} • Total Fights: ${fights.length}</i>`;

  const kb = new InlineKeyboard()
    .text('⏮️', `fight:hs:${targetUser.user_id}:0:${callerId}`)
    .text('◀️', `fight:hs:${targetUser.user_id}:${Math.max(0, safePage - 1)}:${callerId}`)
    .text('▶️', `fight:hs:${targetUser.user_id}:${Math.min(totalPages - 1, safePage + 1)}:${callerId}`)
    .text('⏭️', `fight:hs:${targetUser.user_id}:${totalPages - 1}:${callerId}`);

  return { text, keyboard: kb };
}

// ==========================================
// POST-FIGHT STATELESS RENDERERS
// ==========================================
function renderStatelessSummary(fightRecord) {
  const modeLabel = PRESET_MODES[fightRecord.mode]?.label || 'Custom Team Fight';
  const allLeft = fightRecord.left_team || [];
  const allRight = fightRecord.right_team || [];
  const sessionView = {
    modeLabel,
    round: (fightRecord.rounds_log || []).length || 1,
    maxRounds: MAX_ROUNDS,
    wagerCoins: Number(fightRecord.wager_coins || 0),
    hideHealth: false,
    leftTeam: allLeft,
    rightTeam: allRight,
    lastRoundLines: []
  };

  let winBanner = `🤝 <b>IT'S A DRAW!</b>`;
  if (fightRecord.winner_side === 'left') {
    winBanner = `🏆 <b>VICTORY:</b> ${allLeft.map(formatFighterHandle).join(', ')}!`;
  } else if (fightRecord.winner_side === 'right') {
    winBanner = `🏆 <b>VICTORY:</b> ${allRight.map(formatFighterHandle).join(', ')}!`;
  }

  const endSummary = `${winBanner}\n🆔 <i>Archived Fight #${fightRecord.fight_id}</i>`;
  return renderBattleMessage(sessionView, { isFinished: true, endSummary });
}

function renderStatelessLogs(fightRecord) {
  const rounds = fightRecord.rounds_log || [];
  let body = `📝 <b>Fight #${fightRecord.fight_id} — Complete Move-by-Move Logs</b>\n` +
    `Mode: <b>${sanitizeHtml(fightRecord.mode)}</b> (${String(fightRecord.type || 'quick').toUpperCase()})\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (rounds.length === 0) {
    body += `<i>No rounds recorded.</i>`;
  } else {
    for (const r of rounds) {
      body += `\n<b>Round ${r.round}:</b>\n`;
      for (const act of r.actions || []) {
        body += `• ${act.text}\n`;
      }
    }
  }

  if (body.length > 3800) {
    body = body.slice(0, 3780) + '\n<i>...(truncated)...</i>';
  }
  return body;
}

function renderStatelessReplay(fightRecord, roundIdx = 0) {
  const rounds = fightRecord.rounds_log || [];
  if (rounds.length === 0) {
    return {
      text: `🔄 <b>Replay — Fight #${fightRecord.fight_id}</b>\n<i>No rounds recorded.</i>`,
      keyboard: new InlineKeyboard().text('🔙 Back to Summary', `fpost:summary:${fightRecord.fight_id}`)
    };
  }

  const safeIdx = Math.max(0, Math.min(rounds.length - 1, Number(roundIdx || 0)));
  const snap = rounds[safeIdx];
  const modeLabel = PRESET_MODES[fightRecord.mode]?.label || 'Custom Team Fight';

  const leftStr = (snap.leftSnapshot || []).map(f =>
    `👤 <b>${formatFighterHandle(f)}</b> ${f.rankEmoji || '🥉'}\n${buildHpBar(f.hp, f.maxHp, 'left', false)} (${f.hp}/${f.maxHp})`
  ).join('\n\n');

  const rightStr = (snap.rightSnapshot || []).map(f =>
    `👤 <b>${formatFighterHandle(f)}</b> ${f.rankEmoji || '🥉'}\n${buildHpBar(f.hp, f.maxHp, 'right', false)} (${f.hp}/${f.maxHp})`
  ).join('\n\n');

  const actLines = (snap.actions || []).map(a => `• ${a.text}`).join('\n');

  const text =
    `🔄 <b>Fight Replay #${fightRecord.fight_id} — ${sanitizeHtml(modeLabel)}</b>\n` +
    `📍 <b>Round ${snap.round} of ${rounds.length}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `${leftStr}\n\n⚡ <b>VS</b> ⚡\n\n${rightStr}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📜 <b>Moves Executed:</b>\n${actLines || '<i>None</i>'}`;

  const kb = new InlineKeyboard()
    .text('⏮️ Prev Round', `fpost:replay:${fightRecord.fight_id}:${Math.max(0, safeIdx - 1)}`)
    .text('⏭️ Next Round', `fpost:replay:${fightRecord.fight_id}:${Math.min(rounds.length - 1, safeIdx + 1)}`)
    .row()
    .text('🔙 Back to Summary', `fpost:summary:${fightRecord.fight_id}`);

  return { text, keyboard: kb };
}

function renderStatelessAnalysis(fightRecord) {
  const all = [...(fightRecord.left_team || []), ...(fightRecord.right_team || [])];
  const rounds = fightRecord.rounds_log || [];

  let mvp = all[0] || null;
  for (const f of all) {
    if (mvp && Number(f.damageDealt || 0) > Number(mvp.damageDealt || 0)) {
      mvp = f;
    }
  }

  let fighterStats = '';
  for (const f of all) {
    const hits = Number(f.hits || 0);
    const misses = Number(f.misses || 0);
    const totalAtt = hits + misses;
    const acc = totalAtt > 0 ? Math.round((hits / totalAtt) * 100) : 100;
    fighterStats +=
      `👤 <b>${formatFighterHandle(f)}</b> — ` +
      `💥 ${Number(f.damageDealt || 0)} DMG | 🛡️ ${Number(f.damageBlocked || 0)} Blocked | 🎯 ${acc}% Acc (${hits}/${totalAtt})` +
      (Number(f.healsDone || 0) > 0 ? ` | 💋 ${f.healsDone} Healed` : '') +
      `\n`;
  }

  let graphLines = '';
  for (const r of rounds) {
    const lPctAvg = (r.leftSnapshot || []).length
      ? Math.round(r.leftSnapshot.reduce((s, p) => s + (p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0), 0) / r.leftSnapshot.length)
      : 0;
    const rPctAvg = (r.rightSnapshot || []).length
      ? Math.round(r.rightSnapshot.reduce((s, p) => s + (p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0), 0) / r.rightSnapshot.length)
      : 0;
    const roundDmg = (r.actions || []).reduce((s, a) => s + Number(a.damage || 0), 0);
    const lBar = '🟦'.repeat(Math.max(0, Math.round(lPctAvg / 20))) || '▫️';
    const rBar = '🟥'.repeat(Math.max(0, Math.round(rPctAvg / 20))) || '▫️';
    graphLines += `<code>R${String(r.round).padStart(2, '0')}</code> 💙 ${lBar} ${lPctAvg}% | ❤️ ${rBar} ${rPctAvg}% (💥 ${roundDmg})\n`;
  }

  return (
    `📊 <b>Fight #${fightRecord.fight_id} — Post-Match Analysis</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    (mvp ? `🌟 <b>MVP:</b> <b>${formatFighterHandle(mvp)}</b> (${Number(mvp.damageDealt || 0)} Total DMG)\n\n` : '') +
    `<b>Fighter Telemetry:</b>\n${fighterStats}\n` +
    `<b>Round-by-Round HP &amp; Damage Graph:</b>\n${graphLines || '<i>No rounds</i>'}`
  );
}

// ==========================================
// MAIN /fight COMMAND & CALLBACKS
// ==========================================
export const fight = {
  name: 'fight',
  aliases: ['duel', 'battle'],
  description: 'Fight 2.0: Quick Ranked, Custom Team Battles, Rankings & History',
  cooldown: 5,

  async execute(ctx) {
    await fightRepo.ensureFightSchema();

    const callerId = ctx.from.id;
    const caller = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    const rawInput = (
      (typeof ctx.match === 'string' && ctx.match.trim())
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    );
    const tokens = rawInput ? rawInput.split(/\s+/).filter(Boolean) : [];
    const sub = (tokens[0] || '').toLowerCase();

    // 1. /fight ranking | rank
    if (sub === 'ranking' || sub === 'rank') {
      const { text, keyboard } = await renderRankingView(callerId, 0);
      return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    // 2. /fight history [@user]
    if (sub === 'history') {
      const subArgs = tokens.slice(1).join(' ').trim();
      let targetUser = caller;

      if (subArgs) {
        const resolved = await resolveTargetUser(ctx, subArgs, {
          fallbackToCaller: false,
          allowBareUsername: true,
          allowNumericId: true
        });
        if (resolved.notFound || !resolved.user) {
          return ctx.reply(resolved.errorMessage || '❌ Target user not found.', { parse_mode: 'HTML' });
        }
        targetUser = resolved.user;
      } else if (isGenuineUserReply(ctx)) {
        const repFrom = ctx.message.reply_to_message.from;
        targetUser = await userRepo.getOrInitUser(repFrom.id, repFrom.username, repFrom.first_name);
      }

      const { text, keyboard } = await renderHistoryView(targetUser, callerId, 0);
      return ctx.reply(text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) });
    }

    // 3. /fight create [wager]
    if (sub === 'create') {
      if (Number(caller.passive_mode) === 1) {
        return ctx.reply('🛡️ You cannot host or join fights while <b>Passive Mode</b> is enabled!', { parse_mode: 'HTML' });
      }
      let wagerCoins = 0;
      const wagerToken = tokens[1];
      if (wagerToken) {
        const parsed = parseBet(wagerToken, caller.wallet);
        if (!parsed.valid || parsed.bet <= 0) {
          return ctx.reply(`❌ Invalid wager or insufficient wallet funds! Wallet: ${formatCoins(caller.wallet)}`, { parse_mode: 'HTML' });
        }
        wagerCoins = parsed.bet;
      }

      const sid = nextSessionId();
      const lobby = {
        sid,
        phase: 'lobby',
        type: 'custom',
        mode: 'custom',
        modeLabel: 'Custom Team Fight',
        creatorId: callerId,
        wagerCoins,
        hp: 100,
        maxRounds: MAX_ROUNDS,
        hideHealth: false,
        hideLogValues: false,
        moves: ['punch', 'kick', 'defend', 'flee'],
        leftTeam: [createFighterState(caller, 100)],
        rightTeam: [],
        readyUsers: [],
        createdAt: Date.now()
      };

      await fightRepo.saveActiveFight(sid, lobby);

      return ctx.reply(renderCustomLobbyText(lobby), {
        parse_mode: 'HTML',
        reply_markup: buildCustomLobbyKeyboard(lobby)
      });
    }

    // 4. /fight quick <@user|reply> [mode] [wager] OR /fight <@user|reply> [mode] [wager]
    const quickInput = sub === 'quick' ? tokens.slice(1).join(' ') : rawInput;
    const quickTokens = quickInput ? quickInput.split(/\s+/).filter(Boolean) : [];

    if (quickTokens.length === 0 && !isGenuineUserReply(ctx)) {
      return ctx.reply(
        `⚔️ <b>TeleMemer Fight 2.0</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `• <code>/fight quick &lt;@user|reply&gt; [mode] [wager]</code> — Ranked 1v1 Quick Fight\n` +
        `• <code>/fight create [wager]</code> — Custom Team Fight Lobby (up to 6 players)\n` +
        `• <code>/fight ranking</code> — View Weekly Bucket Standings &amp; Ranks\n` +
        `• <code>/fight history [@user]</code> — View Archived Fight History\n\n` +
        `<b>7 Preset Modes:</b> <code>normal</code>, <code>nodefend</code>, <code>kickonly</code>, <code>punchonly</code>, <code>halfhealth</code>, <code>surprise</code>, <code>chaos</code>`,
        { parse_mode: 'HTML' }
      );
    }

    if (Number(caller.passive_mode) === 1) {
      return ctx.reply('🛡️ You cannot start a fight while <b>Passive Mode</b> is enabled!', { parse_mode: 'HTML' });
    }

    const resolved = await resolveTargetUser(ctx, quickInput, {
      fallbackToCaller: false,
      allowBareUsername: !isGenuineUserReply(ctx) && quickTokens.length >= 1,
      allowNumericId: true,
      initRepliedUser: true
    });

    if (resolved.notFound || !resolved.user) {
      return ctx.reply(
        resolved.errorMessage || '⚔️ Please mention or reply to an opponent to challenge! Example: <code>/fight quick @user normal 10k</code>',
        { parse_mode: 'HTML' }
      );
    }

    const target = resolved.user;
    if (Number(target.user_id) === callerId) {
      return ctx.reply('🤡 You cannot fight yourself!');
    }
    if (Number(target.passive_mode) === 1) {
      return ctx.reply(`🛡️ <b>${sanitizeHtml(target.first_name || target.username)}</b> is in <b>Passive Mode</b> and cannot be challenged!`, { parse_mode: 'HTML' });
    }

    let rem = resolved.remainingArgs || [];
    if (sub === 'quick' && rem[0]?.toLowerCase() === 'quick') {
      rem = rem.slice(1);
    }
    let modeKey = 'normal';
    let wagerArg = null;

    if (rem.length > 0) {
      const candidate = rem[0].toLowerCase();
      if (PRESET_MODES[candidate]) {
        modeKey = candidate;
        wagerArg = rem[1] || null;
      } else {
        wagerArg = rem[0];
      }
    }

    const modeCfg = PRESET_MODES[modeKey];
    let wagerCoins = 0;

    if (wagerArg) {
      const parsedCallerBet = parseBet(wagerArg, caller.wallet);
      if (!parsedCallerBet.valid || parsedCallerBet.bet <= 0) {
        return ctx.reply(`❌ Invalid wager or insufficient funds! Your wallet: ${formatCoins(caller.wallet)}`, { parse_mode: 'HTML' });
      }
      wagerCoins = parsedCallerBet.bet;
      if (Number(target.wallet || 0) < wagerCoins) {
        return ctx.reply(
          `❌ <b>${sanitizeHtml(target.username ? `@${target.username}` : target.first_name)}</b> does not have ${formatCoins(wagerCoins)} in their wallet to match this wager!`,
          { parse_mode: 'HTML' }
        );
      }
    }

    const sid = nextSessionId();
    const challengeSession = {
      sid,
      phase: 'challenge',
      type: 'quick',
      mode: modeCfg.key,
      modeLabel: modeCfg.label,
      callerId,
      targetId: Number(target.user_id),
      wagerCoins,
      hp: modeCfg.hp,
      maxRounds: MAX_ROUNDS,
      hideHealth: modeCfg.hideHealth,
      wasHiddenHealth: modeCfg.hideHealth,
      hideLogValues: modeCfg.hideLogValues,
      allowedMoves: [...modeCfg.moves],
      leftTeam: [createFighterState(caller, modeCfg.hp)],
      rightTeam: [createFighterState(target, modeCfg.hp)],
      round: 1,
      roundStartedAt: Date.now(),
      pendingMoves: {},
      roundsLog: [],
      lastRoundLines: [],
      createdAt: Date.now()
    };

    await fightRepo.saveActiveFight(sid, challengeSession);

    const callerTag = caller.username ? `@${sanitizeHtml(caller.username)}` : sanitizeHtml(caller.first_name);
    const targetTag = target.username ? `@${sanitizeHtml(target.username)}` : sanitizeHtml(target.first_name);
    const wagerLine = wagerCoins > 0
      ? `\n💰 <b>Wager:</b> ${formatCoins(wagerCoins)} each (Pot: ${formatCoins(wagerCoins * 2)})`
      : '\n💰 <b>Wager:</b> Friendly Ranked (0 coins)';

    // CRITICAL: [❌ Cancel] on LEFT, [✅ Accept Fight] on RIGHT
    const kb = new InlineKeyboard()
      .text('❌ Cancel', `fight:can:${sid}`)
      .text('✅ Accept Fight', `fight:acc:${sid}`);
    if (wagerCoins > 0) {
      kb.row().text('⚠️', 'gamble:warning');
    }

    return ctx.reply(
      `⚔️ <b>RANKED FIGHT CHALLENGE!</b>\n` +
      `<b>${callerTag}</b> challenged <b>${targetTag}</b> to a <b>${modeCfg.label}</b>!\n` +
      `❤️ <b>Starting HP:</b> ${modeCfg.hp} HP | ⏱️ <b>Max Rounds:</b> ${MAX_ROUNDS}${wagerLine}\n\n` +
      `⏳ <i>${targetTag}, click <b>✅ Accept Fight</b> to enter the arena!</i>`,
      { parse_mode: 'HTML', reply_markup: kb }
    );
  },

  async handleCallback(ctx) {
    await fightRepo.ensureFightSchema();

    const data = String(ctx.callbackQuery?.data || '');
    const parts = data.split(':');
    const prefix = parts[0];
    const action = parts[1];
    const userId = Number(ctx.from.id);

    // ==========================================
    // STATELESS POST-FIGHT HANDLERS (fpost:...)
    // ==========================================
    if (prefix === 'fpost') {
      const fightId = Number(parts[2]);
      const fightRecord = await fightRepo.getFightById(fightId);
      if (!fightRecord) {
        return safeAnswerCallback(ctx, { text: '⚠️ Fight record not found.', show_alert: true });
      }

      if (action === 'logs') {
        const logsText = renderStatelessLogs(fightRecord);
        const kb = new InlineKeyboard().text('🔙 Back to Summary', `fpost:summary:${fightId}`);
        await safeEditMessage(ctx, logsText, { parse_mode: 'HTML', reply_markup: kb });
        return safeAnswerCallback(ctx);
      }

      if (action === 'replay') {
        const roundIdx = Number(parts[3] || 0);
        const { text, keyboard } = renderStatelessReplay(fightRecord, roundIdx);
        await safeEditMessage(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
        return safeAnswerCallback(ctx);
      }

      if (action === 'analysis') {
        const analysisText = renderStatelessAnalysis(fightRecord);
        const kb = new InlineKeyboard().text('🔙 Back to Summary', `fpost:summary:${fightId}`);
        await safeEditMessage(ctx, analysisText, { parse_mode: 'HTML', reply_markup: kb });
        return safeAnswerCallback(ctx);
      }

      const rematchKey = `rematch_${fightId}`;
      const existingRematch = await fightRepo.getActiveFight(rematchKey);
      const currentRematchVotes = existingRematch?.votes ? existingRematch.votes.length : 0;

      if (action === 'summary') {
        const summaryText = renderStatelessSummary(fightRecord);
        await safeEditMessage(ctx, summaryText, {
          parse_mode: 'HTML',
          reply_markup: buildPostFightKeyboard(fightRecord, currentRematchVotes)
        });
        return safeAnswerCallback(ctx);
      }

      const leftIds = (fightRecord.left_team || []).map(p => Number(p.userId));
      const rightIds = (fightRecord.right_team || []).map(p => Number(p.userId));
      const allIds = [...leftIds, ...rightIds];

      if (action === 'rep') {
        if (fightRecord.type !== 'quick') {
          return safeAnswerCallback(ctx, { text: '🎖️ Reputation can only be awarded in Ranked Quick Fights!', show_alert: true });
        }
        if (!allIds.includes(userId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Only participants of this fight can give reputation!', show_alert: true });
        }

        const oppId = leftIds.includes(userId) ? rightIds[0] : leftIds[0];
        if (!oppId) {
          return safeAnswerCallback(ctx, { text: '⚠️ Opponent not found.', show_alert: true });
        }

        const repRes = await fightRepo.giveReputation(userId, oppId);
        if (repRes.alreadyGiven) {
          return safeAnswerCallback(ctx, {
            text: '⚠️ You already gave this player +1 Reputation before! (Lifetime limit: 1 per user)',
            show_alert: true
          });
        }

        return safeAnswerCallback(ctx, {
          text: `🎖️ Awarded +1 Fight Reputation! Their total rep is now ${repRes.totalRep}.`,
          show_alert: true
        });
      }

      if (action === 'rematch') {
        if (!allIds.includes(userId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Only fighters from this match can vote to Fight Again!', show_alert: true });
        }

        const state = existingRematch || { votes: [], launched: false };
        if (state.launched) {
          return safeAnswerCallback(ctx, { text: '⚔️ Rematch already started!' });
        }

        const voteSet = new Set((state.votes || []).map(Number));
        voteSet.add(userId);
        state.votes = [...voteSet];
        const totalNeeded = allIds.length;

        if (voteSet.size < totalNeeded) {
          await fightRepo.saveActiveFight(rematchKey, state);
          const summaryText = renderStatelessSummary(fightRecord);
          await safeEditMessage(ctx, summaryText, {
            parse_mode: 'HTML',
            reply_markup: buildPostFightKeyboard(fightRecord, voteSet.size)
          });
          return safeAnswerCallback(ctx, { text: `🔄 Rematch vote registered (${voteSet.size}/${totalNeeded})!` });
        }

        // All fighters agreed -> validate wallets & launch rematch
        const wager = Number(fightRecord.wager_coins || 0);
        const freshUsers = new Map();
        for (const uid of allIds) {
          const u = await userRepo.getUser(uid);
          if (!u) {
            return safeAnswerCallback(ctx, { text: '❌ A fighter account could not be loaded.', show_alert: true });
          }
          if (Number(u.passive_mode) === 1) {
            return safeAnswerCallback(ctx, { text: `🛡️ Rematch blocked: ${u.first_name || uid} enabled Passive Mode.`, show_alert: true });
          }
          if (wager > 0 && Number(u.wallet || 0) < wager) {
            return safeAnswerCallback(ctx, { text: `❌ Rematch cancelled: ${u.first_name || uid} no longer has ${formatCoins(wager)}.`, show_alert: true });
          }
          freshUsers.set(uid, u);
        }

        if (wager > 0) {
          for (const uid of allIds) {
            await userRepo.updateCoins(uid, {
              walletDelta: -wager,
              sourceCommand: '/fight',
              details: 'Rematch Fight Wager Escrow'
            });
          }
        }

        state.launched = true;
        await fightRepo.saveActiveFight(rematchKey, state);

        const preset = PRESET_MODES[fightRecord.mode];
        const customCfg = fightRecord.left_team?.[0]?.customConfig;
        const maxHp = preset ? preset.hp : (customCfg?.hp || fightRecord.left_team?.[0]?.maxHp || 100);
        const hideHealth = preset ? preset.hideHealth : Boolean(customCfg?.hideHealth);
        const sid = nextSessionId();

        const rematchSession = {
          sid,
          phase: 'fighting',
          type: fightRecord.type,
          mode: fightRecord.mode,
          modeLabel: preset ? preset.label : 'Custom Team Fight',
          wagerCoins: wager,
          hp: maxHp,
          maxRounds: MAX_ROUNDS,
          hideHealth,
          wasHiddenHealth: hideHealth,
          hideLogValues: preset ? preset.hideLogValues : Boolean(customCfg?.hideLogValues),
          allowedMoves: preset ? [...preset.moves] : [...(customCfg?.allowedMoves || ['punch', 'kick', 'defend', 'flee'])],
          leftTeam: leftIds.map(id => createFighterState(freshUsers.get(id), maxHp)),
          rightTeam: rightIds.map(id => createFighterState(freshUsers.get(id), maxHp)),
          round: 1,
          roundStartedAt: Date.now(),
          pendingMoves: {},
          roundsLog: [],
          lastRoundLines: [],
          createdAt: Date.now()
        };

        await fightRepo.saveActiveFight(sid, rematchSession);

        await safeEditMessage(ctx, renderBattleMessage(rematchSession, { isFinished: false }), {
          parse_mode: 'HTML',
          reply_markup: buildActiveMoveKeyboard(rematchSession)
        });

        return safeAnswerCallback(ctx, { text: '⚔️ Rematch started!' });
      }
      return safeAnswerCallback(ctx);
    }

    // ==========================================
    // RANKING & HISTORY PAGINATION
    // ==========================================
    if (action === 'rk') {
      const page = Number(parts[2] || 0);
      const ownerId = Number(parts[3]);
      if (ownerId && userId !== ownerId) {
        return safeAnswerCallback(ctx, { text: '🚫 Run /fight ranking to browse your own view.', show_alert: true });
      }
      const { text, keyboard } = await renderRankingView(userId, page);
      await safeEditMessage(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
      return safeAnswerCallback(ctx);
    }

    if (action === 'hs') {
      const targetUserId = Number(parts[2]);
      const page = Number(parts[3] || 0);
      const ownerId = Number(parts[4]);
      if (ownerId && userId !== ownerId) {
        return safeAnswerCallback(ctx, { text: '🚫 Run /fight history to browse your own view.', show_alert: true });
      }
      const targetUser = await userRepo.getUser(targetUserId);
      if (!targetUser) return safeAnswerCallback(ctx, { text: 'User not found.' });
      const { text, keyboard } = await renderHistoryView(targetUser, ownerId || userId, page);
      await safeEditMessage(ctx, text, { parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) });
      return safeAnswerCallback(ctx);
    }

    // ==========================================
    // POSTGRES-PERSISTED ACTIVE SESSIONS (fight:...)
    // ==========================================
    const sid = parts[2];
    const session = await fightRepo.getActiveFight(sid);
    if (!session) {
      return safeAnswerCallback(ctx, { text: '⏳ This fight or lobby has ended.', show_alert: true });
    }

    // 1. Quick challenge Cancel / Accept
    if (action === 'can') {
      if (userId !== Number(session.callerId) && userId !== Number(session.targetId)) {
        return safeAnswerCallback(ctx, { text: '🚫 Only the challenger or opponent can cancel.', show_alert: true });
      }
      await fightRepo.deleteActiveFight(sid);
      await safeEditMessage(ctx, '❌ Fight challenge was cancelled.', { parse_mode: 'HTML' });
      return safeAnswerCallback(ctx, { text: 'Challenge cancelled.' });
    }

    if (action === 'acc') {
      if (userId !== Number(session.targetId)) {
        return safeAnswerCallback(ctx, { text: '🚫 Only the challenged player can accept this fight!', show_alert: true });
      }
      if (session.phase !== 'challenge') {
        return safeAnswerCallback(ctx, { text: '⚔️ This fight has already started!' });
      }

      const freshCaller = await userRepo.getUser(session.callerId);
      const freshTarget = await userRepo.getUser(session.targetId);

      if (!freshCaller || !freshTarget) {
        await fightRepo.deleteActiveFight(sid);
        return safeAnswerCallback(ctx, { text: '❌ Player data missing.', show_alert: true });
      }
      if (Number(freshCaller.passive_mode) === 1 || Number(freshTarget.passive_mode) === 1) {
        await fightRepo.deleteActiveFight(sid);
        await safeEditMessage(ctx, '🛡️ Fight cancelled because one player enabled Passive Mode.', { parse_mode: 'HTML' });
        return safeAnswerCallback(ctx, { text: 'Passive Mode active.', show_alert: true });
      }

      const wagerCoins = Number(session.wagerCoins || 0);
      if (wagerCoins > 0) {
        if (Number(freshCaller.wallet || 0) < wagerCoins || Number(freshTarget.wallet || 0) < wagerCoins) {
          await fightRepo.deleteActiveFight(sid);
          await safeEditMessage(ctx, '❌ Fight cancelled: one player no longer has enough coins to cover the wager.', { parse_mode: 'HTML' });
          return safeAnswerCallback(ctx, { text: 'Insufficient wallet funds for wager.', show_alert: true });
        }
        await userRepo.updateCoins(session.callerId, {
          walletDelta: -wagerCoins,
          sourceCommand: '/fight',
          details: 'Fight Wager Escrow'
        });
        await userRepo.updateCoins(session.targetId, {
          walletDelta: -wagerCoins,
          sourceCommand: '/fight',
          details: 'Fight Wager Escrow'
        });
      }

      session.phase = 'fighting';
      session.round = 1;
      session.maxRounds = session.maxRounds || MAX_ROUNDS;
      session.roundStartedAt = Date.now();
      session.pendingMoves = {};
      session.leftTeam = [createFighterState(freshCaller, session.hp)];
      session.rightTeam = [createFighterState(freshTarget, session.hp)];

      await fightRepo.saveActiveFight(sid, session);

      await safeEditMessage(ctx, renderBattleMessage(session, { isFinished: false }), {
        parse_mode: 'HTML',
        reply_markup: buildActiveMoveKeyboard(session)
      });
      return safeAnswerCallback(ctx, { text: '⚔️ Fight accepted! Pick your move!' });
    }

    // 2. Custom Lobby Handlers
    if (session.phase === 'lobby') {
      const clicker = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);
      const isJoined = session.leftTeam.some(f => Number(f.userId) === userId) || session.rightTeam.some(f => Number(f.userId) === userId);
      const totalJoined = session.leftTeam.length + session.rightTeam.length;

      if (action === 'cl') {
        if (userId !== Number(session.creatorId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Only the lobby creator can cancel the lobby.', show_alert: true });
        }
        await fightRepo.deleteActiveFight(sid);
        await safeEditMessage(ctx, '❌ Custom Team Fight lobby cancelled.', { parse_mode: 'HTML' });
        return safeAnswerCallback(ctx, { text: 'Lobby cancelled.' });
      }

      if (action === 'jl' || action === 'jr') {
        if (Number(clicker.passive_mode) === 1) {
          return safeAnswerCallback(ctx, { text: '🛡️ Disable Passive Mode before joining a fight!', show_alert: true });
        }
        if (Number(session.wagerCoins || 0) > 0 && Number(clicker.wallet || 0) < Number(session.wagerCoins)) {
          return safeAnswerCallback(ctx, { text: `❌ Need ${formatCoins(session.wagerCoins)} in wallet to join!`, show_alert: true });
        }
        if (!isJoined && totalJoined >= 6) {
          return safeAnswerCallback(ctx, { text: '❌ Lobby is full (max 6 players)!', show_alert: true });
        }

        session.leftTeam = session.leftTeam.filter(f => Number(f.userId) !== userId);
        session.rightTeam = session.rightTeam.filter(f => Number(f.userId) !== userId);
        const fObj = createFighterState(clicker, session.hp);
        if (action === 'jl') session.leftTeam.push(fObj);
        else session.rightTeam.push(fObj);
        session.readyUsers = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderCustomLobbyText(session), {
          parse_mode: 'HTML',
          reply_markup: buildCustomLobbyKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: action === 'jl' ? 'Joined Left Team!' : 'Joined Right Team!' });
      }

      if (action === 'tm') {
        if (!isJoined && userId !== Number(session.creatorId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Join the lobby to customize rules!', show_alert: true });
        }
        const mv = parts[3];
        if (!CUSTOM_TOGGLE_MOVES.includes(mv)) return safeAnswerCallback(ctx);
        const movesSet = new Set(getLobbyMovesList(session));
        if (movesSet.has(mv)) {
          if (movesSet.size <= 1) {
            return safeAnswerCallback(ctx, { text: '⚠️ Keep at least 1 move enabled!', show_alert: true });
          }
          movesSet.delete(mv);
        } else {
          movesSet.add(mv);
        }
        session.moves = [...movesSet];
        session.readyUsers = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderCustomLobbyText(session), {
          parse_mode: 'HTML',
          reply_markup: buildCustomLobbyKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: 'Move rules updated — Ready count reset!' });
      }

      if (action === 'hp') {
        if (!isJoined && userId !== Number(session.creatorId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Join the lobby to customize health!', show_alert: true });
        }
        const currIdx = CUSTOM_HEALTH_STEPS.indexOf(session.hp);
        const nextHp = CUSTOM_HEALTH_STEPS[(currIdx + 1) % CUSTOM_HEALTH_STEPS.length];
        session.hp = nextHp;
        session.leftTeam.forEach(f => { f.hp = nextHp; f.maxHp = nextHp; });
        session.rightTeam.forEach(f => { f.hp = nextHp; f.maxHp = nextHp; });
        session.readyUsers = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderCustomLobbyText(session), {
          parse_mode: 'HTML',
          reply_markup: buildCustomLobbyKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: `Starting HP set to ${nextHp}! Ready reset.` });
      }

      if (action === 'hh') {
        if (!isJoined && userId !== Number(session.creatorId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Join the lobby to edit settings!', show_alert: true });
        }
        session.hideHealth = !session.hideHealth;
        session.wasHiddenHealth = session.hideHealth;
        session.readyUsers = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderCustomLobbyText(session), {
          parse_mode: 'HTML',
          reply_markup: buildCustomLobbyKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: `Hide Health: ${session.hideHealth ? 'ON' : 'OFF'}` });
      }

      if (action === 'hl') {
        if (!isJoined && userId !== Number(session.creatorId)) {
          return safeAnswerCallback(ctx, { text: '🚫 Join the lobby to edit settings!', show_alert: true });
        }
        session.hideLogValues = !session.hideLogValues;
        session.readyUsers = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderCustomLobbyText(session), {
          parse_mode: 'HTML',
          reply_markup: buildCustomLobbyKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: `Hide Log Values: ${session.hideLogValues ? 'ON' : 'OFF'}` });
      }

      if (action === 'go') {
        if (!isJoined) {
          return safeAnswerCallback(ctx, { text: '🚫 Join Left or Right Team first!', show_alert: true });
        }
        if (session.leftTeam.length === 0 || session.rightTeam.length === 0) {
          return safeAnswerCallback(ctx, { text: '⚠️ Need at least 1 player on Left AND 1 player on Right to start!', show_alert: true });
        }

        const readySet = getReadySet(session);
        if (readySet.has(userId)) {
          readySet.delete(userId);
        } else {
          readySet.add(userId);
        }
        setReadyList(session, readySet);

        if (readySet.size < totalJoined) {
          await fightRepo.saveActiveFight(sid, session);
          await safeEditMessage(ctx, renderCustomLobbyText(session), {
            parse_mode: 'HTML',
            reply_markup: buildCustomLobbyKeyboard(session)
          });
          return safeAnswerCallback(ctx, { text: `Ready (${readySet.size}/${totalJoined})` });
        }

        // All players ready -> validate wallets & deduct wagers if any
        const allParticipants = [...session.leftTeam, ...session.rightTeam];
        const wagerCoins = Number(session.wagerCoins || 0);
        if (wagerCoins > 0) {
          for (const p of allParticipants) {
            const fresh = await userRepo.getUser(p.userId);
            if (!fresh || Number(fresh.wallet || 0) < wagerCoins) {
              session.readyUsers = [];
              await fightRepo.saveActiveFight(sid, session);
              return safeAnswerCallback(ctx, {
                text: `❌ ${p.firstName} lacks ${formatCoins(wagerCoins)} to start!`,
                show_alert: true
              });
            }
          }
          for (const p of allParticipants) {
            await userRepo.updateCoins(p.userId, {
              walletDelta: -wagerCoins,
              sourceCommand: '/fight',
              details: 'Custom Fight Wager Escrow'
            });
          }
        }

        session.phase = 'fighting';
        session.allowedMoves = getLobbyMovesList(session);
        session.maxRounds = session.maxRounds || MAX_ROUNDS;
        session.wasHiddenHealth = Boolean(session.hideHealth);
        session.round = 1;
        session.roundStartedAt = Date.now();
        session.pendingMoves = {};
        session.roundsLog = [];
        session.lastRoundLines = [];

        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderBattleMessage(session, { isFinished: false }), {
          parse_mode: 'HTML',
          reply_markup: buildActiveMoveKeyboard(session)
        });
        return safeAnswerCallback(ctx, { text: '⚔️ Custom Team Fight Started!' });
      }
      return safeAnswerCallback(ctx);
    }

    // 3. Force Turn Button (`fight:ft:<sid>:<round>`)
    if (action === 'ft' && session.phase === 'fighting') {
      const btnRound = Number(parts[3]);
      if (btnRound !== Number(session.round)) {
        return safeAnswerCallback(ctx, { text: '⏳ That round already resolved!' });
      }
      const aliveFighters = getAllAliveFighters(session);
      const clicker = aliveFighters.find(f => Number(f.userId) === userId);
      if (!clicker) {
        return safeAnswerCallback(ctx, { text: '🚫 Only active fighters in this match can force a turn!', show_alert: true });
      }

      const elapsed = Date.now() - Number(session.roundStartedAt || session.createdAt || 0);
      if (elapsed < FORCE_TURN_WAIT_MS) {
        const secsLeft = Math.max(1, Math.ceil((FORCE_TURN_WAIT_MS - elapsed) / 1000));
        return safeAnswerCallback(ctx, {
          text: `⏳ Give your opponent time to pick! Force Turn unlocks in ${secsLeft}s.`,
          show_alert: false
        });
      }

      const { finished } = await resolveRoundAndRender(session, ctx, { forceAutoUnpicked: true });
      return safeAnswerCallback(ctx, { text: finished ? '🏁 Fight finished!' : '⏰ AFK turn forced & resolved!' });
    }

    // 4. Active Simultaneous Fight Move Submission (`fight:mv:<sid>:<round>:<move>`)
    if (action === 'mv' && session.phase === 'fighting') {
      const btnRound = Number(parts[3]);
      const move = parts[4];

      if (btnRound !== Number(session.round)) {
        return safeAnswerCallback(ctx, { text: '⏳ That round already resolved!' });
      }

      const aliveFighters = getAllAliveFighters(session);
      const fighter = aliveFighters.find(f => Number(f.userId) === userId);
      if (!fighter) {
        return safeAnswerCallback(ctx, { text: '🚫 You are not an active fighter in this match!', show_alert: true });
      }

      if (hasPendingMove(session, userId)) {
        return safeAnswerCallback(ctx, {
          text: '✅ You already locked in your move for this round! Waiting for opponent...',
          show_alert: false
        });
      }

      if (move === 'defend' && Number(fighter.defendCd || 0) > 0) {
        return safeAnswerCallback(ctx, {
          text: `⏳ That move is on cooldown for ${fighter.defendCd} more turn(s)!`,
          show_alert: true
        });
      }

      if (move === 'kiss' && Number(fighter.kissCd || 0) > 0) {
        return safeAnswerCallback(ctx, {
          text: `⏳ That move is on cooldown for ${fighter.kissCd} more turn(s)!`,
          show_alert: true
        });
      }

      setPendingMove(session, userId, { move, auto: false });

      const pendingCount = countPendingMoves(session);
      const allChosen = pendingCount >= aliveFighters.length;
      const fleeTriggered = move === 'flee';

      if (!allChosen && !fleeTriggered) {
        await fightRepo.saveActiveFight(sid, session);
        await safeEditMessage(ctx, renderBattleMessage(session, { isFinished: false }), {
          parse_mode: 'HTML',
          reply_markup: buildActiveMoveKeyboard(session)
        });
        return safeAnswerCallback(ctx, {
          text: `✅ Move locked in! (${pendingCount}/${aliveFighters.length} ready)`,
          show_alert: false
        });
      }

      // ALL alive fighters chose (or someone chose Flee) -> resolve immediately!
      const { finished } = await resolveRoundAndRender(session, ctx, { forceAutoUnpicked: false });
      return safeAnswerCallback(ctx, { text: finished ? '🏁 Fight ended!' : '⚔️ Round resolved!' });
    }

    return safeAnswerCallback(ctx);
  }
};

export default fight;
