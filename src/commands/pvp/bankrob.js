import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { formatCoins, randomBetween, sanitizeHtml } from '../../utils/formatters.js';
import { heistTargets, heistParticipants, clearHeistState } from '../../utils/heistState.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';

// Global Map keyed by Telegram message_id to reliably track participants across stateless webhook calls
if (!global.heistLobbies) {
  global.heistLobbies = new Map();
}

async function evaluateHeist(ctx, messageId) {
  const lobbyKey = String(messageId);
  const lobby = global.heistLobbies?.get(lobbyKey);
  if (!lobby || lobby.resolved) return;
  lobby.resolved = true;
  if (lobby.timeoutId) clearTimeout(lobby.timeoutId);
  global.heistLobbies.delete(lobbyKey);

  const { targetUserId, targetName, chatId } = lobby;
  const participants = Array.from(lobby.participants.values());
  const participantCount = participants.length;
  const participantIds = participants.map(p => p.userId);

  try {
    const targetUser = await userRepo.getUser(targetUserId);

    if (!targetUser || Number(targetUser.bank || 0) < 10000) {
      return await ctx.api.editMessageText(
        chatId,
        Number(messageId),
        `🏦 <b>Heist Aborted:</b> The target user emptied their bank vault!`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    // Minimum 2 players required
    if (participantCount < 2) {
      return await ctx.api.editMessageText(
        chatId,
        Number(messageId),
        `🏦 <b>Heist Cancelled:</b> Only 1 player joined. A bank heist requires at least <b>2 brave robbers</b>!`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    // Check the Target's active_buffs for vaultlock
    const hasVaultLock = await inventoryRepo.hasBuff(targetUserId, 'vaultlock');
    if (hasVaultLock) {
      // The lock is consumed upon use/broken during heist
      await inventoryRepo.removeActiveBuff(targetUserId, 'vaultlock');

      // The robbers are fined!
      for (const p of participants) {
        await userRepo.updateCoins(p.userId, {
          walletDelta: -2500,
          sourceCommand: '/bankrob',
          details: `SWAT bail fine from failed bank heist against @${targetName}'s locked vault`
        });
      }

      const lockedMsg = `🏦 <b>VAULT LOCK TRIGGERED! HEIST INSTANTLY FAILED!</b> 🔒\n\n` +
        `The crew drilled into the bank vault, but <b>${sanitizeHtml(targetName)}</b> had an active <b>🏦 Vault Lock</b> defense!\n\n` +
        `💥 The reinforced biometric vault lock sealed the vault doors shut and alerted federal police!\n` +
        `🛡️ <b>${sanitizeHtml(targetName)}</b>'s Vault Lock was broken and consumed in the defense.\n` +
        `🚨 All <b>${participantCount}</b> robbers were arrested on site and fined <b>🪙 2,500</b> each to post emergency bail!\n\n` +
        `Busted Crew: ${participants.map(p => sanitizeHtml(p.name)).join(', ')}`;

      return await ctx.api.editMessageText(chatId, Number(messageId), lockedMsg, { parse_mode: 'HTML' }).catch(() => {});
    }

    const successChance = Math.min(0.80, participantCount * 0.20);
    const isSuccess = Math.random() < successChance;

    if (isSuccess) {
      // Steal 30%–60% of target's bank
      const stealPercent = randomBetween(30, 60) / 100;
      const stolenTotal = Math.floor(Number(targetUser.bank) * stealPercent);
      await userRepo.updateCoins(targetUserId, {
        bankDelta: -stolenTotal,
        sourceCommand: '/bankrob',
        details: `Vault breached by crew of ${participantCount} robbers`
      });

      // 15% chance 1 participant dies during getaway
      let casualty = null;
      let survivors = [...participants];

      if (Math.random() < 0.15) {
        const unluckyIdx = Math.floor(Math.random() * survivors.length);
        casualty = survivors.splice(unluckyIdx, 1)[0];
        await handleDeath(ctx, casualty.userId, 'being shot by bank security snipers on the getaway roof');
      }

      const share = Math.floor(stolenTotal / Math.max(1, survivors.length));
      for (const p of survivors) {
        await userRepo.updateCoins(p.userId, {
          walletDelta: share,
          sourceCommand: '/bankrob',
          details: `Vault heist cut from @${targetName}'s bank`
        });
      }

      let summary = `🎉 <b>VAULT HEIST SUCCESSFUL!</b> 🏦\n` +
        `The crew breached <b>${sanitizeHtml(targetName)}</b>'s bank vault and escaped with <b>${formatCoins(stolenTotal)}</b> (${Math.round(stealPercent * 100)}% of their vault)!\n\n` +
        `👥 <b>Crew Cut:</b> Each survivor bagged <b>+${formatCoins(share)}</b>!\n` +
        `Survivors: ${survivors.map(s => sanitizeHtml(s.name)).join(', ')}\n`;

      if (casualty) {
        summary += `\n💀 <b>Casualty:</b> <b>${sanitizeHtml(casualty.name)}</b> was gunned down by SWAT snipers during the getaway and received no share.`;
      }

      return await ctx.api.editMessageText(chatId, Number(messageId), summary, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      // Heist Failed!
      for (const p of participants) {
        await userRepo.updateCoins(p.userId, {
          walletDelta: -2500,
          sourceCommand: '/bankrob',
          details: `SWAT bail fine from botched bank heist on @${targetName}`
        });
      }

      const failedMsg = `🚨 <b>HEIST BUSTED BY SWAT!</b> 🚨\n` +
        `The silent alarm was tripped while cutting the titanium vault locks!\n` +
        `Heavy armed police surrounded the building. All <b>${participantCount}</b> robbers were fined <b>🪙 2,500</b> each to post emergency bail!\n\n` +
        `Busted Crew: ${participants.map(p => sanitizeHtml(p.name)).join(', ')}`;

      return await ctx.api.editMessageText(chatId, Number(messageId), failedMsg, { parse_mode: 'HTML' }).catch(() => {});
    }
  } finally {
    // ALWAYS remove lockdown on target's bank and release all participants from heist state
    clearHeistState(targetUserId, participantIds);
  }
}

export const bankrob = {
  name: 'bankrob',
  aliases: ['heist'],
  description: 'Assemble a crew of up to 5 players to breach another user bank vault',
  cooldown: 300,

  async execute(ctx) {
    if (ctx.chat.type === 'private') {
      return ctx.reply('🏦 Bank heists can only be planned inside a group chat!');
    }

    const callerId = ctx.from.id;
    const caller = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    if (Number(caller.passive_mode) === 1) {
      return ctx.reply('❌ You cannot start a bank heist while in <b>Passive Mode</b>!', { parse_mode: 'HTML' });
    }

    const { user: target, notFound, errorMessage } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: true,
      allowNumericId: true
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(
        `🏦 <b>Bank Heist Planning</b>\n` +
        `Usage: Reply to a player with <code>/bankrob</code> or type <code>/bankrob @username</code>.`,
        { parse_mode: 'HTML' }
      );
    }

    if (target.user_id === callerId) {
      return ctx.reply('🤡 You cannot rob your own bank vault!');
    }

    if (target.passive_mode === 1) {
      return ctx.reply(`🛡️ <b>${sanitizeHtml(target.first_name)}</b> has <b>Passive Mode</b> enabled. Their bank is protected by federal immunity!`, { parse_mode: 'HTML' });
    }

    if (Number(target.bank || 0) < 10000) {
      return ctx.reply(`🏦 <b>${sanitizeHtml(target.first_name)}</b> only has ${formatCoins(target.bank)} in their bank. Target must have at least <b>🪙 10,000</b> to justify a heist!`, { parse_mode: 'HTML' });
    }

    // Check if target is ALREADY under an active heist
    if (heistTargets.has(Number(target.user_id)) || heistTargets.has(String(target.user_id))) {
      return ctx.reply(`🚨 <b>LOCKDOWN:</b> <b>${sanitizeHtml(target.first_name)}</b>'s bank vault is ALREADY under an active heist right now! Wait for the current raid to conclude.`, { parse_mode: 'HTML' });
    }

    // BEFORE starting the 45-second lobby, check the Target's active buffs for vaultlock
    const targetHasVaultLock = await inventoryRepo.hasBuff(target.user_id, 'vaultlock');
    if (targetHasVaultLock) {
      // 1. Immediately block the heist & break/consume the shield
      await inventoryRepo.removeActiveBuff(target.user_id, 'vaultlock');

      // 2. Fine the caller for triggering a locked vault
      const fineAmount = Math.min(Number(caller.wallet || 0), 2500);
      if (fineAmount > 0) {
        await userRepo.updateCoins(callerId, {
          walletDelta: -fineAmount,
          sourceCommand: '/bankrob',
          details: `Fined for triggering @${target.first_name}'s Vault Lock defense`
        });
      }

      // 3. Send message to the chat
      const blockedMsg = `🛡️ <b>HEIST BLOCKED!</b> The target had a 🏦 <b>Vault Lock</b> active. The heist was thwarted and the lock has been broken!\n\n` +
        `🚨 <b>${sanitizeHtml(caller.first_name)}</b> tripped the vault alarm and was fined <b>${formatCoins(fineAmount || 2500)}</b> to post emergency bail!`;

      // 4. Abort the rest of the /bankrob command
      return ctx.reply(blockedMsg, { parse_mode: 'HTML' });
    }

    // 1. Lock Target Bank and 2. Lock Caller into Heist
    heistTargets.add(Number(target.user_id));
    heistParticipants.add(Number(callerId));

    const lobbyMsg = `🏦 <b>BANK HEIST ASSEMBLED!</b> 🏦\n` +
      `<b>${sanitizeHtml(caller.first_name)}</b> is planning a vault raid on <b>${sanitizeHtml(target.first_name)}</b>'s bank account (${formatCoins(target.bank)})!\n\n` +
      `• Required: 2–5 robbers\n` +
      `• Success Chance: +20% per robber (up to 80%)\n` +
      `• ⏳ Lobby open for <b>45 seconds</b>! Click below to join the crew:`;

    const sent = await ctx.reply(lobbyMsg, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🥷 Join Heist (1/5)', `bankrob:join:pending:shared`)
    });

    const messageId = sent.message_id;
    const keyboard = new InlineKeyboard()
      .text('🥷 Join Heist (1/5)', `bankrob:join:${messageId}:shared`);

    await ctx.api.editMessageReplyMarkup(ctx.chat.id, messageId, {
      reply_markup: keyboard
    }).catch(() => {});

    if (!global.heistLobbies) {
      global.heistLobbies = new Map();
    }

    const participants = new Map();
    participants.set(callerId, { userId: callerId, name: caller.first_name, username: caller.username });

    const timeoutId = setTimeout(() => {
      evaluateHeist(ctx, messageId);
    }, 45000);

    const lobbySession = {
      messageId: Number(messageId),
      chatId: ctx.chat.id,
      targetUserId: target.user_id,
      targetName: target.first_name,
      leaderId: callerId,
      participants,
      timeoutId,
      resolved: false
    };

    global.heistLobbies.set(String(messageId), lobbySession);
  },

  async handleCallback(ctx) {
    if (!global.heistLobbies) {
      global.heistLobbies = new Map();
    }

    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[0];
    const subAction = parts[1];

    if ((action === 'bankrob' && subAction === 'join') || action === 'heist_join') {
      const messageId = (parts[2] && parts[2] !== 'pending' && parts[2] !== 'shared')
        ? String(parts[2])
        : String(ctx.callbackQuery.message?.message_id);

      const lobby = global.heistLobbies.get(messageId);
      if (!lobby || lobby.resolved) {
        return ctx.answerCallbackQuery({ text: 'This heist lobby has already expired or concluded!', show_alert: true });
      }

      const joinerId = ctx.from.id;
      const joinerName = ctx.from.first_name || 'Robber';

      if (joinerId === lobby.targetUserId) {
        return ctx.answerCallbackQuery({ text: 'You cannot participate in robbing your own bank vault!', show_alert: true });
      }

      if (lobby.participants.has(joinerId)) {
        return ctx.answerCallbackQuery({ text: 'You are already in this heist crew!', show_alert: true });
      }

      if (lobby.participants.size >= 5) {
        return ctx.answerCallbackQuery({ text: 'Crew is full! (Maximum 5 robbers reached)', show_alert: true });
      }

      const joiner = await userRepo.getOrInitUser(joinerId, ctx.from.username, joinerName);
      if (joiner && Number(joiner.passive_mode) === 1) {
        return ctx.answerCallbackQuery({
          text: '❌ You cannot join bank heists while in Passive Mode!',
          show_alert: true
        });
      }

      lobby.participants.set(joinerId, { userId: joinerId, name: joinerName, username: ctx.from.username });

      // Lock joiner into heist participant state
      heistParticipants.add(Number(joinerId));

      global.heistLobbies.set(messageId, lobby);

      const currentCount = lobby.participants.size;

      const keyboard = new InlineKeyboard()
        .text(`🥷 Join Heist (${currentCount}/5)`, `bankrob:join:${messageId}:shared`);

      const crewList = Array.from(lobby.participants.values())
        .map(p => `• 🥷 <b>${sanitizeHtml(p.name)}</b>`)
        .join('\n');

      const updatedLobby = `🏦 <b>BANK HEIST ASSEMBLED!</b> 🏦\n` +
        `Target: <b>${sanitizeHtml(lobby.targetName)}</b>'s bank account!\n\n` +
        `👥 <b>Crew Members (${currentCount}/5):</b>\n` +
        crewList +
        `\n\n⏳ Lobby will launch automatically when full or in remaining seconds!`;

      await ctx.editMessageText(updatedLobby, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(() => {});

      await ctx.answerCallbackQuery({ text: `Joined the heist! (${currentCount}/5)` });

      if (currentCount >= 5) {
        if (lobby.timeoutId) clearTimeout(lobby.timeoutId);
        await evaluateHeist(ctx, messageId);
      }
    }
  }
};

export default bankrob;
