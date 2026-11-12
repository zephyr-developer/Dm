import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { formatCoins, randomBetween, pickRandom, sanitizeHtml } from '../../utils/formatters.js';

// In-memory active bank heists: heistId -> HeistSession
const activeHeists = new Map();

async function evaluateHeist(ctx, heistId) {
  const heist = activeHeists.get(heistId);
  if (!heist || heist.resolved) return;
  heist.resolved = true;
  activeHeists.delete(heistId);

  const { targetUserId, targetName, participants, messageId, chatId } = heist;
  const targetUser = await userRepo.getUser(targetUserId);

  if (!targetUser || Number(targetUser.bank || 0) < 10000) {
    return ctx.api.editMessageText(
      chatId,
      messageId,
      `🏦 <b>Heist Aborted:</b> The target user withdrew their funds or emptied their bank vault!`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  // Minimum 2 players required
  if (participants.length < 2) {
    return ctx.api.editMessageText(
      chatId,
      messageId,
      `🏦 <b>Heist Cancelled:</b> Only 1 player joined. A bank heist requires at least <b>2 brave robbers</b>!`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  const participantCount = participants.length;
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

    return ctx.api.editMessageText(chatId, messageId, summary, { parse_mode: 'HTML' }).catch(() => {});
  } else {
    // Heist Failed!
    for (const p of participants) {
      await userRepo.updateCoins(p.userId, {
        walletDelta: -2500,
        sourceCommand: '/bankrob',
        details: `SWAT bail fine from botched bank heist on @${heist.targetName}`
      });
    }

    const failedMsg = `🚨 <b>HEIST BUSTED BY SWAT!</b> 🚨\n` +
      `The silent alarm was tripped while cutting the titanium vault locks!\n` +
      `Heavy armed police surrounded the building. All <b>${participantCount}</b> robbers were fined <b>🪙 2,500</b> each to post emergency bail!\n\n` +
      `Busted Crew: ${participants.map(p => sanitizeHtml(p.name)).join(', ')}`;

    return ctx.api.editMessageText(chatId, messageId, failedMsg, { parse_mode: 'HTML' }).catch(() => {});
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

    let target = null;
    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
    } else {
      const args = ctx.message.text.trim().split(/\s+/).slice(1);
      const usernameArg = args[0];
      if (usernameArg) {
        target = await userRepo.getUserByUsername(usernameArg);
      }
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

    const heistId = `heist_${Date.now()}_${callerId}`;
    const heistSession = {
      heistId,
      leaderId: callerId,
      targetUserId: target.user_id,
      targetName: target.first_name,
      participants: [{ userId: callerId, name: caller.first_name }],
      chatId: ctx.chat.id,
      messageId: null,
      resolved: false
    };

    activeHeists.set(heistId, heistSession);

    const keyboard = new InlineKeyboard()
      .text('🥷 Join Heist (1/5)', `heist_join:${heistId}:shared`);

    const lobbyMsg = `🏦 <b>BANK HEIST ASSEMBLED!</b> 🏦\n` +
      `<b>${sanitizeHtml(caller.first_name)}</b> is planning a vault raid on <b>${sanitizeHtml(target.first_name)}</b>'s bank account (${formatCoins(target.bank)})!\n\n` +
      `• Required: 2–5 robbers\n` +
      `• Success Chance: +20% per robber (up to 80%)\n` +
      `• ⏳ Lobby open for <b>45 seconds</b>! Click below to join the crew:`;

    const sent = await ctx.reply(lobbyMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    heistSession.messageId = sent.message_id;

    // Trigger timer for 45 seconds
    setTimeout(() => {
      evaluateHeist(ctx, heistId);
    }, 45000);
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[0];
    const heistId = parts[1];

    if (action === 'heist_join') {
      const heist = activeHeists.get(heistId);
      if (!heist || heist.resolved) {
        return ctx.answerCallbackQuery({ text: 'This heist lobby has already expired or concluded!', show_alert: true });
      }

      const joinerId = ctx.from.id;
      const joinerName = ctx.from.first_name || 'Robber';

      if (joinerId === heist.targetUserId) {
        return ctx.answerCallbackQuery({ text: 'You cannot participate in robbing your own bank vault!', show_alert: true });
      }

      const alreadyIn = heist.participants.some(p => p.userId === joinerId);
      if (alreadyIn) {
        return ctx.answerCallbackQuery({ text: 'You are already in this heist crew!', show_alert: true });
      }

      if (heist.participants.length >= 5) {
        return ctx.answerCallbackQuery({ text: 'Crew is full! (Maximum 5 robbers reached)', show_alert: true });
      }

      await userRepo.getOrInitUser(joinerId, ctx.from.username, joinerName);
      heist.participants.push({ userId: joinerId, name: joinerName });

      const currentCount = heist.participants.length;

      const keyboard = new InlineKeyboard()
        .text(`🥷 Join Heist (${currentCount}/5)`, `heist_join:${heistId}:shared`);

      const updatedLobby = `🏦 <b>BANK HEIST ASSEMBLED!</b> 🏦\n` +
        `Target: <b>${sanitizeHtml(heist.targetName)}</b>'s bank account!\n\n` +
        `👥 <b>Crew Members (${currentCount}/5):</b>\n` +
        heist.participants.map(p => `• 🥷 <b>${sanitizeHtml(p.name)}</b>`).join('\n') +
        `\n\n⏳ Lobby will launch automatically when full or in remaining seconds!`;

      await ctx.editMessageText(updatedLobby, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(() => {});

      await ctx.answerCallbackQuery({ text: `Joined the heist! (${currentCount}/5)` });

      // If full (5 members), trigger immediately
      if (currentCount >= 5) {
        await evaluateHeist(ctx, heistId);
      }
    }
  }
};

export default bankrob;
