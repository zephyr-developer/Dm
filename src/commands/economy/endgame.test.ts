/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import userRepo, {
  OVERFLOW_THRESHOLD,
  OVERFLOW_BASE,
  SHARD_RATE,
  FRENZY_TARGET_AMOUNT
} from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { addXp } from '../../utils/levelEngine.js';
import { getAvailableTitles } from '../../utils/titleEngine.js';
import { compress } from './compress.js';
import { blackmarket } from '../items/blackmarket.js';
import { frenzy } from './frenzy.js';
import { balance } from './balance.js';
import { profile } from '../progression/profile.js';
import { leaderboard } from './leaderboard.js';
import { bankrob } from '../pvp/bankrob.js';
import { beg } from '../grind/beg.js';
import { hunt } from '../grind/hunt.js';
import { bot, commands, callbackHandlers, loadCommands } from '../../bot.js';
import { query } from '../../database/db.js';

function createMockCtx(userId: number, text = '', callbackData = '', chatType = 'supergroup') {
  const replies: Array<{ text: string; options?: any }> = [];
  const edits: Array<{ text: string; options?: any }> = [];
  const alerts: Array<any> = [];

  return {
    replies,
    edits,
    alerts,
    from: { id: userId, username: `endgame_${userId}`, first_name: `Sovereign ${userId}` },
    chat: { id: -100999888, type: chatType },
    match: text.split(/\s+/).slice(1).join(' '),
    message: { text, message_id: 700 },
    callbackQuery: callbackData
      ? {
          data: callbackData,
          message: { message_id: 999 }
        }
      : undefined,
    async reply(msg: string, options?: any) {
      replies.push({ text: msg, options });
      return { message_id: 1000 + replies.length };
    },
    async editMessageText(msg: string, options?: any) {
      edits.push({ text: msg, options });
      return true;
    },
    async answerCallbackQuery(payload?: any) {
      alerts.push(payload || {});
      return true;
    }
  };
}

function getKeyboardLabels(replyMarkup: any): string[] {
  const rows = replyMarkup?.inline_keyboard || [];
  return rows.flat().map((btn: any) => String(btn.text || ''));
}

test('Auto-Overflow: pushing wallet or bank above 1Q auto-compresses excess into Sovereign Shards', async () => {
  const uid = 950001;
  await userRepo.upsertUser(uid, 'overflow1', 'Overflow1');

  // Reset starter 500 coins, seed 950T wallet, then add +300T => 1.25Q raw -> 3 shards (300T), leaving 950T wallet
  await userRepo.setWallet(uid, 0, '/test', 'reset starter coins');
  await userRepo.updateCoins(uid, {
    walletDelta: 950_000_000_000_000,
    sourceCommand: '/test',
    details: 'seed 950T wallet',
    skipAntiCheat: true
  });

  const walletRes = await userRepo.updateCoins(uid, {
    walletDelta: 300_000_000_000_000,
    sourceCommand: '/test',
    details: 'push wallet to 1.25Q',
    skipAntiCheat: true
  });

  assert.ok(1_250_000_000_000_000 > OVERFLOW_THRESHOLD);
  assert.equal(walletRes.overflowShards, 3);
  assert.equal(walletRes.wallet, 950_000_000_000_000);
  assert.equal(walletRes.sovereign_shards, 3);

  // Now push bank to 1.5Q => 6 shards (600T), leaving 900T bank => total shards = 9
  const bankRes = await userRepo.updateCoins(uid, {
    bankDelta: 1_500_000_000_000_000,
    sourceCommand: '/test',
    details: 'push bank to 1.5Q',
    skipAntiCheat: true
  });

  assert.equal(bankRes.overflowShards, 6);
  assert.equal(bankRes.bank, 900_000_000_000_000);
  assert.equal(bankRes.sovereign_shards, 9);
});

test('/compress & /decompress: button order, atomic conversion, and 900T decompression cap', async () => {
  const uid = 950002;
  await userRepo.upsertUser(uid, 'compressor2', 'Compressor2');
  await userRepo.setWallet(uid, 0, '/test', 'reset starter coins');
  await userRepo.updateCoins(uid, {
    walletDelta: 250_000_000_000_000, // 250T
    sourceCommand: '/test',
    details: 'seed 250T',
    skipAntiCheat: true
  });

  // /compress 2 -> confirmation prompt has [❌ Cancel] LEFT, [✅ Confirm] RIGHT
  const ctxPrompt = createMockCtx(uid, '/compress 2');
  await compress.execute(ctxPrompt);
  assert.equal(ctxPrompt.replies.length, 1);
  const labels = getKeyboardLabels(ctxPrompt.replies[0].options?.reply_markup);
  assert.equal(labels[0], '❌ Cancel');
  assert.equal(labels[1], '✅ Confirm');

  // Execute confirmation callback -> 2 shards created, 50T wallet left
  const ctxCompYes = createMockCtx(uid, '', `compress:comp:2:${uid}`);
  await compress.handleCallback(ctxCompYes);
  let u = await userRepo.getUser(uid);
  assert.equal(Number(u.wallet), 50_000_000_000_000);
  assert.equal(Number(u.sovereign_shards), 2);

  // /decompress 1 (50T + 100T = 150T < 900T) -> allowed
  const ctxDecompPrompt = createMockCtx(uid, '/decompress 1');
  await compress.execute(ctxDecompPrompt);
  const dLabels = getKeyboardLabels(ctxDecompPrompt.replies[0].options?.reply_markup);
  assert.equal(dLabels[0], '❌ Cancel');
  assert.equal(dLabels[1], '✅ Confirm');

  const ctxDecompYes = createMockCtx(uid, '', `compress:decomp:1:${uid}`);
  await compress.handleCallback(ctxDecompYes);
  u = await userRepo.getUser(uid);
  assert.equal(Number(u.wallet), 150_000_000_000_000);
  assert.equal(Number(u.sovereign_shards), 1);

  // Push wallet to 850T, then try /decompress 1 (850T + 100T = 950T >= 900T) -> blocked!
  await userRepo.updateCoins(uid, {
    walletDelta: 700_000_000_000_000,
    sourceCommand: '/test',
    details: 'top up to 850T',
    skipAntiCheat: true
  });
  const ctxBlocked = createMockCtx(uid, '/decompress 1');
  await compress.execute(ctxBlocked);
  assert.match(ctxBlocked.replies[0].text, /Decompression Blocked/i);
  assert.ok(850_000_000_000_000 + SHARD_RATE >= OVERFLOW_BASE);

  // Verify /bal, /profile, and /leaderboard shards tab display Sovereign Shards
  const ctxBal = createMockCtx(uid, '/bal');
  await balance.execute(ctxBal);
  assert.match(ctxBal.replies[0].text, /Sovereign Shards/i);

  const ctxProf = createMockCtx(uid, '/profile');
  await profile.execute(ctxProf);
  assert.match(ctxProf.replies[0].text, /Sovereign Shards/i);

  const ctxLb = createMockCtx(uid, '', `leaderboard:type:global:shards:${uid}`);
  await leaderboard.handleCallback(ctxLb);
  assert.match(ctxLb.edits[0].text, /Top Sovereign Shard Holders/i);
  assert.match(ctxLb.edits[0].text, /Sovereign Shards/);
});

test('/blackmarket: luckboost cap (+25%), ultimatetoken, sovereigntitle, and unbreakable heistshield', async () => {
  const defenderId = 950003;
  const attackerId = 950004;
  await userRepo.upsertUser(defenderId, 'defender3', 'Defender3');
  await userRepo.upsertUser(attackerId, 'attacker4', 'Attacker4');
  await userRepo.addShards(defenderId, 100);
  await userRepo.updateCoins(defenderId, {
    bankDelta: 100_000,
    sourceCommand: '/test',
    details: 'seed bank for heist test',
    skipAntiCheat: true
  });

  // Check confirmation button order on /blackmarket luckboost
  const ctxBmPrompt = createMockCtx(defenderId, '/blackmarket luckboost');
  await blackmarket.execute(ctxBmPrompt);
  const bmLabels = getKeyboardLabels(ctxBmPrompt.replies[0].options?.reply_markup);
  assert.equal(bmLabels[0], '❌ Cancel');
  assert.equal(bmLabels[1], '✅ Confirm');

  // Buy luckboost 5 times (+5% each = +25% cap)
  for (let i = 1; i <= 5; i++) {
    const ctxYes = createMockCtx(defenderId, '', `blackmarket:yes:luckboost:${defenderId}`);
    await blackmarket.handleCallback(ctxYes);
    const u = await userRepo.getUser(defenderId);
    assert.equal(Number(u.perm_luck_bonus), i * 5);
  }
  // 6th purchase blocked at +25%
  const ctxCap = createMockCtx(defenderId, '/blackmarket luckboost');
  await blackmarket.execute(ctxCap);
  assert.match(ctxCap.replies[0].text, /maxed out/i);

  // Verify luckEngine includes +25% permLuck
  const luckBeforeFrenzy = await getLuckBreakdown(defenderId);
  assert.equal(luckBeforeFrenzy.permLuck, 25);
  assert.ok(luckBeforeFrenzy.totalBonus >= 25);

  // Buy ultimatetoken (25 shards) -> permanent ultimate_expires_at = -1
  await blackmarket.handleCallback(createMockCtx(defenderId, '', `blackmarket:yes:ultimatetoken:${defenderId}`));
  let defUser = await userRepo.getUser(defenderId);
  assert.equal(Number(defUser.ultimate_expires_at), -1);
  assert.equal(await userRepo.isUltimateGambler(defUser), true);

  // Buy sovereigntitle (15 shards) -> unlocks 「 Sovereign Overlord 」 in titleEngine
  await blackmarket.handleCallback(createMockCtx(defenderId, '', `blackmarket:yes:sovereigntitle:${defenderId}`));
  defUser = await userRepo.getUser(defenderId);
  const availTitles = getAvailableTitles(defUser, []);
  assert.ok(availTitles.unlockedTitles.includes('Sovereign Overlord'));

  // Buy heistshield (10 shards) -> grants 7-day (604,800s) unbreakable aegis_vault
  await blackmarket.handleCallback(createMockCtx(defenderId, '', `blackmarket:yes:heistshield:${defenderId}`));
  const aegisRem = await inventoryRepo.getBuffRemaining(defenderId, 'aegis_vault');
  assert.ok(aegisRem >= 604_790 && aegisRem <= 604_800, `Unexpected aegis duration ${aegisRem}`);

  // Attempt /bankrob against defenderId -> repelled AND aegis_vault remains intact!
  await userRepo.setWallet(attackerId, 0, '/test', 'reset starter coins');
  await userRepo.updateCoins(attackerId, {
    walletDelta: 10_000,
    sourceCommand: '/test',
    details: 'seed attacker fine wallet',
    skipAntiCheat: true
  });
  const ctxHeist = createMockCtx(attackerId, `/bankrob ${defenderId}`);
  await bankrob.execute(ctxHeist);
  assert.match(ctxHeist.replies[0].text, /AEGIS SOVEREIGN VAULT/i);
  assert.equal(await inventoryRepo.hasBuff(defenderId, 'aegis_vault'), true, 'Aegis shield must stay unbreakable');
  assert.equal(Number((await userRepo.getUser(attackerId)).wallet), 7_500);
});

test('/frenzy Altar: cumulative tracking, 5Q milestone Top Donor rewards, and active 2x coins / 2x XP / +15% luck', async () => {
  const donor1 = 950005;
  const donor2 = 950006;
  await userRepo.upsertUser(donor1, 'patron1', 'Patron1');
  await userRepo.upsertUser(donor2, 'helper2', 'Helper2');

  // Seed wallets: donor1 contributes 3Q first, donor2 contributes 2Q to trigger 5Q goal
  await userRepo.updateCoins(donor1, {
    walletDelta: 900_000_000_000_000,
    sourceCommand: '/test',
    details: 'seed 900T',
    skipAntiCheat: true
  });
  await userRepo.updateCoins(donor2, {
    walletDelta: 900_000_000_000_000,
    sourceCommand: '/test',
    details: 'seed 900T',
    skipAntiCheat: true
  });

  // Check confirmation button order on /frenzy 100t
  const ctxFrenzyPrompt = createMockCtx(donor1, '/frenzy 100t');
  await frenzy.execute(ctxFrenzyPrompt);
  const fLabels = getKeyboardLabels(ctxFrenzyPrompt.replies[0].options?.reply_markup);
  assert.equal(fLabels[0], '❌ Cancel');
  assert.equal(fLabels[1], '✅ Confirm');

  // Burn 3 * 900T + 300T = 3Q cumulatively for donor1 via atomic helper (or multiple donations)
  // First 900T from donor1
  let d1Res = await userRepo.donateToFrenzyAtomic(donor1, 900_000_000_000_000);
  assert.equal(d1Res.success, true);
  assert.equal(d1Res.goalReached, false);
  assert.equal(d1Res.topDonorId, donor1);

  // Give donor1 another 2.1Q via direct SQL/cycles or multiple 900T refills
  for (let i = 0; i < 2; i++) {
    await userRepo.updateCoins(donor1, { walletDelta: 900_000_000_000_000, sourceCommand: '/test', skipAntiCheat: true });
    await userRepo.donateToFrenzyAtomic(donor1, 900_000_000_000_000);
  }
  await userRepo.updateCoins(donor1, { walletDelta: 300_000_000_000_000, sourceCommand: '/test', skipAntiCheat: true });
  d1Res = await userRepo.donateToFrenzyAtomic(donor1, 300_000_000_000_000);
  assert.equal(d1Res.currentAmount, 3_000_000_000_000_000);
  assert.equal(d1Res.topDonorId, donor1);
  assert.equal(d1Res.topDonorAmount, 3_000_000_000_000_000);

  // Now donor2 donates 900T + 900T + 200T via UI callback for the final 200T
  await userRepo.donateToFrenzyAtomic(donor2, 900_000_000_000_000);
  await userRepo.updateCoins(donor2, { walletDelta: 900_000_000_000_000, sourceCommand: '/test', skipAntiCheat: true });
  await userRepo.donateToFrenzyAtomic(donor2, 900_000_000_000_000);
  await userRepo.updateCoins(donor2, { walletDelta: 200_000_000_000_000, sourceCommand: '/test', skipAntiCheat: true });

  const ctxTrigger = createMockCtx(donor2, '', `frenzy:yes:200000000000000:${donor2}`);
  await frenzy.handleCallback(ctxTrigger);

  // Should have edited confirmation AND replied with group announcement
  assert.equal(ctxTrigger.edits.length, 1);
  assert.equal(ctxTrigger.replies.length, 1);
  assert.match(ctxTrigger.replies[0].text, /SERVER FRENZY IS LIVE FOR 2 HOURS/i);
  assert.match(ctxTrigger.replies[0].text, /Meme Patron/);

  // Altar progress reset to 0 & Frenzy is active for ~2 hours
  const ev = await userRepo.getFrenzyEvent();
  assert.equal(ev.currentAmount, 0);
  assert.equal(ev.targetAmount, FRENZY_TARGET_AMOUNT);
  assert.equal(ev.isActive, true);
  assert.ok(ev.remainingSeconds > 7100 && ev.remainingSeconds <= 7200);

  // #1 Top Donor (donor1 with 3Q vs donor2's 2Q) got +5 Sovereign Shards + Meme Patron title
  const winnerAfter = await userRepo.getUser(donor1);
  assert.equal(Number(winnerAfter.sovereign_shards), 5);
  const winnerTitles = getAvailableTitles(winnerAfter, []);
  assert.ok(winnerTitles.unlockedTitles.includes('Meme Patron'));

  // Active Frenzy grants +15% luck
  const luckDuringFrenzy = await getLuckBreakdown(donor2);
  assert.equal(luckDuringFrenzy.frenzyActive, true);
  assert.equal(luckDuringFrenzy.frenzyBonus, 15);
  assert.ok(luckDuringFrenzy.totalBonus >= 15);

  // Active Frenzy grants 2x XP in levelEngine.addXp
  const xpRes = await addXp(donor2, 20);
  assert.equal(xpRes.earnedXp, 40, 'Expected 2x XP during Server Frenzy');

  // Active Frenzy grants 2x coins in /beg and /hunt
  const origRandom = Math.random;
  try {
    Math.random = () => 0.5; // Deterministic mid-roll (>25 and <=90 for /beg, >20 and <=80 / >80 for /hunt)
    const beforeWallet = Number((await userRepo.getUser(donor2)).wallet);
    const ctxBeg = createMockCtx(donor2, '/beg');
    await beg.execute(ctxBeg);
    assert.match(ctxBeg.replies[0].text, /2x Server Frenzy/i);
    const afterWallet = Number((await userRepo.getUser(donor2)).wallet);
    assert.ok(afterWallet > beforeWallet);

    // Also test /hunt with double kill (roll > 80 -> Math.random = 0.85)
    await inventoryRepo.setItem(donor2, 'rifle', 1);
    Math.random = () => 0.85;
    const ctxHunt = createMockCtx(donor2, '/hunt');
    await hunt.execute(ctxHunt);
    assert.match(ctxHunt.replies[0].text, /2x Server Frenzy/i);
  } finally {
    Math.random = origRandom;
  }

  // Clean up Frenzy timer so subsequent tests stay independent
  await query(`UPDATE global_events SET frenzy_expires_at = 0 WHERE event_key = 'frenzy_altar';`, []);
});

test('bot.js loadCommands() registers /compress (/decompress alias), /blackmarket, and /frenzy cleanly', async () => {
  await loadCommands();
  assert.ok(commands.has('compress'), 'compress command must be registered');
  assert.ok(commands.get('compress').aliases.includes('decompress'), 'decompress alias must exist');
  assert.ok(commands.has('blackmarket'), 'blackmarket command must be registered');
  assert.ok(commands.has('frenzy'), 'frenzy command must be registered');

  assert.equal(typeof callbackHandlers.get('compress'), 'function');
  assert.equal(typeof callbackHandlers.get('blackmarket'), 'function');
  assert.equal(typeof callbackHandlers.get('frenzy'), 'function');

  // Silence unused import lint check while ensuring bot instance exported properly
  assert.ok(bot);
});
