import { query } from './db.js';

export const FIGHT_RANKS = [
  { name: 'Bronze', emoji: '🥉', title: 'Bronze Brawler', minScore: 0, idx: 0 },
  { name: 'Iron', emoji: '⚙️', title: 'Iron Fighter', minScore: 100, idx: 1 },
  { name: 'Silver', emoji: '🥈', title: 'Silver Gladiator', minScore: 250, idx: 2 },
  { name: 'Gold', emoji: '🥇', title: 'Gold Champion', minScore: 500, idx: 3 },
  { name: 'Platinum', emoji: '💠', title: 'Platinum Warlord', minScore: 900, idx: 4 },
  { name: 'Jade', emoji: '🟢', title: 'Jade Grandmaster', minScore: 1400, idx: 5 },
  { name: 'Amethyst', emoji: '🔮', title: 'Amethyst God of War', minScore: 2000, idx: 6 }
];

export const FIGHT_ACTIONS = {
  punch: { key: 'punch', emoji: '👊', label: '👊 Punch' },
  kick: { key: 'kick', emoji: '🦶', label: '🦶 Kick' },
  defend: { key: 'defend', emoji: '🛡️', label: '🛡️ Defend' },
  flee: { key: 'flee', emoji: '🏃', label: '🏃 Flee' },
  kiss: { key: 'kiss', emoji: '💋', label: '💋 Kiss' },
  spin: { key: 'spin', emoji: '🌪️', label: '🌪️ Spin' },
  flick: { key: 'flick', emoji: '🤏', label: '🤏 Flick' }
};

export function getRankMeta(rankName) {
  const clean = String(rankName || 'Bronze').trim().toLowerCase();
  return FIGHT_RANKS.find(r => r.name.toLowerCase() === clean) || FIGHT_RANKS[0];
}

export function getTitleForRank(rankName) {
  return getRankMeta(rankName).title;
}

export function getRankForScore(score) {
  const s = Math.max(0, Number(score || 0));
  let best = FIGHT_RANKS[0];
  for (const r of FIGHT_RANKS) {
    if (s >= r.minScore) best = r;
  }
  return best;
}

export function mergeUnlockedRanks(existingCsv, ...rankNames) {
  const set = new Set(['Bronze']);
  if (existingCsv) {
    for (const part of String(existingCsv).split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        set.add(getRankMeta(trimmed).name);
      }
    }
  }
  for (const r of rankNames) {
    if (r) {
      set.add(getRankMeta(r).name);
    }
  }
  return FIGHT_RANKS
    .filter(r => set.has(r.name))
    .map(r => r.name)
    .join(',');
}

export function getUnlockedFightTitles(user) {
  const csv = user?.fight_unlocked_ranks || 'Bronze';
  const mergedCsv = mergeUnlockedRanks(csv, user?.fight_rank || 'Bronze');
  return mergedCsv
    .split(',')
    .map(r => getTitleForRank(r.trim()))
    .filter(Boolean);
}

export function parseActionCounts(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? { ...parsed } : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return { ...raw };
  }
  return {};
}

export function getFavoriteAndLeastActions(rawCounts) {
  const counts = parseActionCounts(rawCounts);
  const entries = Object.entries(counts)
    .filter(([key, val]) => FIGHT_ACTIONS[key] && Number(val) > 0)
    .map(([key, val]) => ({ key, count: Number(val), meta: FIGHT_ACTIONS[key] }));

  if (entries.length === 0) {
    return {
      favAction: 'None yet',
      leastFavAction: 'None yet'
    };
  }

  entries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const fav = entries[0];
  const least = entries[entries.length - 1];

  return {
    favAction: `${fav.meta.label} (${fav.count})`,
    leastFavAction: entries.length === 1 ? `${least.meta.label} (${least.count})` : `${least.meta.label} (${least.count})`
  };
}

export function getTodayDateKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getCurrentWeekBucketId(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function getDiminishingFactorForCount(priorCountToday) {
  const n = Math.max(0, Number(priorCountToday || 0));
  if (n === 0) return 1.0;
  if (n === 1) return 0.6;
  if (n === 2) return 0.3;
  if (n === 3) return 0.1;
  return 0.0;
}

function makePairKey(userAId, userBId) {
  const a = Number(userAId);
  const b = Number(userBId);
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

export const fightRepo = {
  FIGHT_RANKS,
  FIGHT_ACTIONS,
  getRankMeta,
  getTitleForRank,
  getRankForScore,
  mergeUnlockedRanks,
  getUnlockedFightTitles,
  getFavoriteAndLeastActions,
  getCurrentWeekBucketId,
  getDiminishingFactorForCount,

  async getPairFightCountToday(userAId, userBId) {
    const dayKey = getTodayDateKey();
    const pairKey = makePairKey(userAId, userBId);
    const res = await query(
      `SELECT fight_count FROM fight_daily_pairs WHERE day_key = $1 AND pair_key = $2;`,
      [dayKey, pairKey]
    );
    return Number(res.rows[0]?.fight_count || 0);
  },

  async incrementPairFightCount(userAId, userBId) {
    const dayKey = getTodayDateKey();
    const pairKey = makePairKey(userAId, userBId);
    const res = await query(
      `INSERT INTO fight_daily_pairs (day_key, pair_key, fight_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (day_key, pair_key) DO UPDATE SET
         fight_count = fight_daily_pairs.fight_count + 1
       RETURNING fight_count;`,
      [dayKey, pairKey]
    );
    return Number(res.rows[0]?.fight_count || 1);
  },

  async checkAndRunWeeklyRollover() {
    const currentWeek = getCurrentWeekBucketId();
    const settingRes = await query(`SELECT value FROM settings WHERE key = $1;`, ['fight_active_week']);
    const prevWeek = settingRes.rows[0]?.value;

    if (!prevWeek) {
      await query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
        ['fight_active_week', currentWeek]
      );
      return { rolledOver: false, week: currentWeek };
    }

    if (prevWeek === currentWeek) {
      return { rolledOver: false, week: currentWeek };
    }

    // Weekly rollover: promote Top 20%, demote Bottom 20% across bucket participants, keep unlocked titles permanent
    const usersRes = await query(
      `SELECT * FROM users WHERE fight_bucket_id = $1 OR (fight_wins + fight_losses) > 0 ORDER BY fight_score DESC, fight_wins DESC;`,
      [prevWeek]
    );
    const fighters = usersRes.rows || [];
    const total = fighters.length;

    if (total > 0) {
      const topCutoff = Math.max(1, Math.floor(total * 0.2));
      const bottomStart = total >= 5 ? total - Math.max(1, Math.floor(total * 0.2)) : total;

      for (let i = 0; i < total; i++) {
        const u = fighters[i];
        const currMeta = getRankMeta(u.fight_rank || 'Bronze');
        let nextIdx = currMeta.idx;

        if (i < topCutoff && currMeta.idx < FIGHT_RANKS.length - 1) {
          nextIdx = currMeta.idx + 1;
        } else if (i >= bottomStart && currMeta.idx > 0) {
          nextIdx = currMeta.idx - 1;
        }

        const nextRank = FIGHT_RANKS[nextIdx];
        const nextUnlocked = mergeUnlockedRanks(u.fight_unlocked_ranks, currMeta.name, nextRank.name);
        const nextScore = nextRank.minScore;

        await query(
          `UPDATE users
           SET fight_wins = $1, fight_losses = $2, fight_streak = $3, fight_score = $4, fight_rank = $5, fight_bucket_id = $6, fight_unlocked_ranks = $7, fight_action_counts = $8
           WHERE user_id = $9;`,
          [
            Number(u.fight_wins || 0),
            Number(u.fight_losses || 0),
            Number(u.fight_streak || 0),
            nextScore,
            nextRank.name,
            currentWeek,
            nextUnlocked,
            JSON.stringify(parseActionCounts(u.fight_action_counts)),
            Number(u.user_id)
          ]
        );
      }
    }

    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
      ['fight_active_week', currentWeek]
    );

    return { rolledOver: true, week: currentWeek };
  },

  async recordQuickFightOutcome({
    leftIds = [],
    rightIds = [],
    winnerSide = 'draw',
    fledUserIds = new Set(),
    hpPercentByUser = {},
    accuracyBonusByUser = {},
    actionCountsByUser = {}
  }) {
    await this.checkAndRunWeeklyRollover().catch(() => {});
    const currentBucket = getCurrentWeekBucketId();

    const is1v1 = leftIds.length === 1 && rightIds.length === 1;
    let pairCountBefore = 0;
    let diminishingFactor = 1.0;

    if (is1v1) {
      pairCountBefore = await this.getPairFightCountToday(leftIds[0], rightIds[0]);
      diminishingFactor = getDiminishingFactorForCount(pairCountBefore);
      await this.incrementPairFightCount(leftIds[0], rightIds[0]);
    }

    const winnerIds = new Set(
      winnerSide === 'left' ? leftIds : (winnerSide === 'right' ? rightIds : [])
    );
    const allIds = [...new Set([...leftIds, ...rightIds])];
    const pointsAwardedByUser = {};
    const promotions = [];

    for (const uid of allIds) {
      const userRes = await query('SELECT * FROM users WHERE user_id = $1;', [uid]);
      const user = userRes.rows[0];
      if (!user) continue;

      const isWinner = winnerIds.has(uid);
      const isDraw = winnerSide === 'draw';
      const didFlee = fledUserIds instanceof Set ? fledUserIds.has(uid) : Boolean(fledUserIds?.[uid]);

      let wins = Number(user.fight_wins || 0);
      let losses = Number(user.fight_losses || 0);
      let streak = Number(user.fight_streak || 0);
      let score = Number(user.fight_score || 0);

      let rawPoints = 0;
      if (isWinner) {
        wins += 1;
        streak += 1;
        const hpPct = Math.max(0, Math.min(100, Number(hpPercentByUser[uid] || 0)));
        const hpBonus = Math.round((hpPct / 100) * 15);
        const accBonus = Number(accuracyBonusByUser[uid] || 0);
        rawPoints = 25 + hpBonus + accBonus;
      } else if (isDraw) {
        rawPoints = didFlee ? 0 : 8;
      } else {
        losses += 1;
        streak = 0;
        rawPoints = didFlee ? 0 : 5;
      }

      const earnedPoints = Math.max(0, Math.round(rawPoints * diminishingFactor));
      score += earnedPoints;
      pointsAwardedByUser[uid] = earnedPoints;

      const currentRankMeta = getRankMeta(user.fight_rank || 'Bronze');
      const scoreRankMeta = getRankForScore(score);
      const nextRankMeta = scoreRankMeta.idx > currentRankMeta.idx ? scoreRankMeta : currentRankMeta;
      const unlockedCsv = mergeUnlockedRanks(user.fight_unlocked_ranks, currentRankMeta.name, nextRankMeta.name);

      if (nextRankMeta.idx > currentRankMeta.idx) {
        promotions.push({
          userId: uid,
          fromRank: currentRankMeta,
          toRank: nextRankMeta
        });
      }

      const mergedCounts = parseActionCounts(user.fight_action_counts);
      const roundAdded = actionCountsByUser[uid] || {};
      for (const [actKey, delta] of Object.entries(roundAdded)) {
        mergedCounts[actKey] = Number(mergedCounts[actKey] || 0) + Number(delta || 0);
      }

      await query(
        `UPDATE users
         SET fight_wins = $1,
             fight_losses = $2,
             fight_streak = $3,
             fight_score = $4,
             fight_rank = $5,
             fight_bucket_id = $6,
             fight_unlocked_ranks = $7,
             fight_action_counts = $8
         WHERE user_id = $9;`,
        [
          wins,
          losses,
          streak,
          score,
          nextRankMeta.name,
          currentBucket,
          unlockedCsv,
          JSON.stringify(mergedCounts),
          uid
        ]
      );
    }

    return {
      pointsAwardedByUser,
      diminishingFactor,
      pairCountBefore,
      promotions
    };
  },

  async recordCustomActionCounts(actionCountsByUser = {}) {
    for (const [uidStr, roundAdded] of Object.entries(actionCountsByUser)) {
      const uid = Number(uidStr);
      const userRes = await query('SELECT fight_action_counts FROM users WHERE user_id = $1;', [uid]);
      const user = userRes.rows[0];
      if (!user) continue;
      const mergedCounts = parseActionCounts(user.fight_action_counts);
      for (const [actKey, delta] of Object.entries(roundAdded || {})) {
        mergedCounts[actKey] = Number(mergedCounts[actKey] || 0) + Number(delta || 0);
      }
      await query(
        `UPDATE users SET fight_action_counts = $1 WHERE user_id = $2;`,
        [JSON.stringify(mergedCounts), uid]
      );
    }
  },

  async saveFightRecord({ type, mode, wagerCoins = 0, leftTeam, rightTeam, winnerSide, roundsLog }) {
    const res = await query(
      `INSERT INTO fights (type, mode, wager_coins, left_team, right_team, winner_side, rounds_log, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *;`,
      [
        String(type),
        String(mode),
        Math.max(0, Math.floor(Number(wagerCoins || 0))),
        JSON.stringify(leftTeam || []),
        JSON.stringify(rightTeam || []),
        winnerSide || 'draw',
        JSON.stringify(roundsLog || []),
        Date.now()
      ]
    );
    return res.rows[0];
  },

  async getFightById(fightId) {
    const res = await query(`SELECT * FROM fights WHERE fight_id = $1;`, [Number(fightId)]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      ...row,
      left_team: typeof row.left_team === 'string' ? JSON.parse(row.left_team) : row.left_team,
      right_team: typeof row.right_team === 'string' ? JSON.parse(row.right_team) : row.right_team,
      rounds_log: typeof row.rounds_log === 'string' ? JSON.parse(row.rounds_log) : row.rounds_log
    };
  },

  async getUserFightHistory(userId) {
    const uid = Number(userId);
    const res = await query(
      `SELECT * FROM fights
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(left_team) elem WHERE (elem->>'userId')::bigint = $1
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(right_team) elem WHERE (elem->>'userId')::bigint = $1
       )
       ORDER BY created_at DESC;`,
      [uid]
    );
    return (res.rows || []).map(row => ({
      ...row,
      left_team: typeof row.left_team === 'string' ? JSON.parse(row.left_team) : row.left_team,
      right_team: typeof row.right_team === 'string' ? JSON.parse(row.right_team) : row.right_team,
      rounds_log: typeof row.rounds_log === 'string' ? JSON.parse(row.rounds_log) : row.rounds_log
    }));
  },

  async giveReputation(giverId, receiverId) {
    const gId = Number(giverId);
    const rId = Number(receiverId);
    if (gId === rId) {
      return { granted: false, alreadyGiven: true, totalRep: 0, selfError: true };
    }

    const insRes = await query(
      `INSERT INTO fight_reputations (giver_id, receiver_id)
       VALUES ($1, $2)
       ON CONFLICT (giver_id, receiver_id) DO NOTHING
       RETURNING *;`,
      [gId, rId]
    );

    if (!insRes.rows || insRes.rows.length === 0) {
      const uRes = await query(`SELECT fight_rep FROM users WHERE user_id = $1;`, [rId]);
      return {
        granted: false,
        alreadyGiven: true,
        totalRep: Number(uRes.rows[0]?.fight_rep || 0)
      };
    }

    const updRes = await query(
      `UPDATE users SET fight_rep = fight_rep + 1 WHERE user_id = $1 RETURNING fight_rep;`,
      [rId]
    );
    return {
      granted: true,
      alreadyGiven: false,
      totalRep: Number(updRes.rows[0]?.fight_rep || 1)
    };
  },

  async getBucketStandings(bucketId = null) {
    await this.checkAndRunWeeklyRollover().catch(() => {});
    const targetBucket = bucketId || getCurrentWeekBucketId();
    const res = await query(
      `SELECT user_id, username, first_name, fight_rank, fight_score, fight_rep, fight_wins, fight_losses, fight_streak, fight_bucket_id
       FROM users
       WHERE fight_bucket_id = $1
          OR (fight_wins + fight_losses) > 0
       ORDER BY fight_score DESC, fight_wins DESC;`,
      [targetBucket]
    );
    const rows = res.rows || [];
    const total = rows.length;
    const promoteCutoff = total > 0 ? Math.max(1, Math.floor(total * 0.2)) : 0;
    const demoteStart = total >= 5 ? total - Math.max(1, Math.floor(total * 0.2)) : total;

    return {
      bucketId: targetBucket,
      rows,
      total,
      promoteCutoff,
      demoteStart
    };
  },

  async getFightLeaderboard(chatId = null, limit = 10) {
    if (chatId) {
      const sql = `
        SELECT u.user_id, u.username, u.first_name, u.premium_until,
               u.fight_rank, u.fight_score, u.fight_rep, u.fight_wins, u.fight_losses, u.fight_streak
        FROM users u
        INNER JOIN group_members gm ON u.user_id = gm.user_id
        WHERE gm.chat_id = $1
        ORDER BY u.fight_score DESC, u.fight_rep DESC, u.fight_wins DESC
        LIMIT $2;
      `;
      const res = await query(sql, [chatId, limit]);
      return res.rows || [];
    }

    const sql = `
      SELECT u.user_id, u.username, u.first_name, u.premium_until,
             u.fight_rank, u.fight_score, u.fight_rep, u.fight_wins, u.fight_losses, u.fight_streak
      FROM users u
      ORDER BY u.fight_score DESC, u.fight_rep DESC, u.fight_wins DESC
      LIMIT $1;
    `;
    const res = await query(sql, [limit]);
    return res.rows || [];
  }
};

export default fightRepo;
