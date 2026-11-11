import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import cooldownRepo from '../../database/cooldownRepo.js';
import { jobs, getJob, findJob, getAllJobs } from '../../config/jobs.js';
import { items } from '../../config/items.js';
import { addXp } from '../../utils/levelEngine.js';
import { formatCoins, formatTime, pickRandom } from '../../utils/formatters.js';

const EMOJI_POOL = ['🍎', '🚗', '🐶', '🍕', '🚀', '🐱', '⚽', '🎸', '🍦', '💎', '👑', '🌈'];

// In-memory active mini-game sessions: userId -> session
const activeWorkSessions = new Map();

export const work = {
  name: 'work',
  aliases: [],
  description: 'Work your shift at your job or apply for promotions',
  cooldown: 0, // Handled dynamically in execute to permit /work list and /work apply without cooldown

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const subCommand = args[0]?.toLowerCase();

    // 1. /work list
    if (subCommand === 'list') {
      const allJobs = getAllJobs();
      let listMsg = `💼 <b>Available Career Positions:</b>\n\n`;

      for (const j of allJobs) {
        const isCurrent = user.job_id === j.id;
        const qualified = user.work_shifts >= j.requiredShifts;
        const status = isCurrent ? ' (🟢 YOUR CURRENT JOB)' : qualified ? ' (✅ Qualified)' : ` (🔒 Requires ${j.requiredShifts} shifts)`;

        listMsg += `${j.emoji} <b>${j.name}</b>${status}\n` +
          `• ID: <code>${j.id}</code> | Salary: <b>${formatCoins(j.salary)}</b>/shift\n` +
          `• ${j.description}\n\n`;
      }

      listMsg += `👉 <i>To apply for a job, run:</i> <code>/work apply &lt;job_id&gt;</code>`;
      return ctx.reply(listMsg, { parse_mode: 'HTML' });
    }

    // 2. /work apply <job>
    if (subCommand === 'apply') {
      const targetQuery = args.slice(1).join(' ');
      if (!targetQuery) {
        return ctx.reply('❌ Please specify a job ID to apply for. Run <code>/work list</code> to view careers.', { parse_mode: 'HTML' });
      }

      const job = findJob(targetQuery);
      if (!job) {
        return ctx.reply(`❌ Could not find a job matching "<b>${targetQuery}</b>". Run <code>/work list</code>.`, { parse_mode: 'HTML' });
      }

      if (user.job_id === job.id) {
        return ctx.reply(`💼 You are already employed as a <b>${job.name}</b>!`, { parse_mode: 'HTML' });
      }

      if (user.work_shifts < job.requiredShifts) {
        return ctx.reply(
          `🚫 <b>Application Rejected:</b> You have completed <b>${user.work_shifts}</b> shifts, but <b>${job.name}</b> requires at least <b>${job.requiredShifts}</b> shifts of experience.`,
          { parse_mode: 'HTML' }
        );
      }

      userRepo.setJob(userId, job.id);
      return ctx.reply(
        `🎉 <b>Congratulations!</b> You were hired as a ${job.emoji} <b>${job.name}</b>!\n` +
        `Your new salary is <b>${formatCoins(job.salary)}</b> per shift.\n` +
        `Run <code>/work</code> to complete your first shift!`,
        { parse_mode: 'HTML' }
      );
    }

    // 3. /work (no args -> shift mini-game)
    if (!user.job_id) {
      return ctx.reply(
        `💼 <b>Unemployed!</b> You do not currently have a job.\n` +
        `Run <code>/work list</code> to browse positions and <code>/work apply janitor</code> to start!`,
        { parse_mode: 'HTML' }
      );
    }

    // Check cooldown for working (45 minutes = 2700s base, 22.5 minutes for Premium)
    const { onCooldown, remainingSeconds } = cooldownRepo.checkCooldown(userId, 'work');
    if (onCooldown) {
      const isPrem = userRepo.isPremium(userId);
      let waitMsg = `⏳ <b>Your shift ended recently!</b> You can work again in <b>${formatTime(remainingSeconds)}</b>.`;
      if (!isPrem) {
        waitMsg += `\n💎 <i>Tip: Premium users only wait 22m 30s!</i>`;
      }
      return ctx.reply(waitMsg, { parse_mode: 'HTML' });
    }

    const currentJob = getJob(user.job_id);
    if (!currentJob) {
      userRepo.setJob(userId, null);
      return ctx.reply('❌ Your previous job is no longer available. Please choose a new one with <code>/work list</code>.', { parse_mode: 'HTML' });
    }

    // Pick 3 unique random emojis
    const shuffled = [...EMOJI_POOL].sort(() => 0.5 - Math.random());
    const [e1, e2, e3] = [shuffled[0], shuffled[1], shuffled[2]];
    const positions = ['1st', '2nd', '3rd'];
    const chosenIndex = Math.floor(Math.random() * 3);
    const targetPos = positions[chosenIndex];
    const correctEmoji = [e1, e2, e3][chosenIndex];

    activeWorkSessions.set(userId, {
      jobId: currentJob.id,
      emojis: [e1, e2, e3],
      targetPos,
      correctEmoji,
      timestamp: Date.now()
    });

    const keyboard = new InlineKeyboard()
      .text('👀 I have memorized the order! [Click to answer]', `work:ready:${userId}`);

    const promptText = `💼 <b>Shift at ${currentJob.name} (${currentJob.emoji})</b>\n\n` +
      `🧠 <b>Memorize this emoji sequence carefully:</b>\n\n` +
      `       <b>${e1}   ${e2}   ${e3}</b>\n\n` +
      `Click the button below when you are ready to answer!`;

    await ctx.reply(promptText, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    const session = activeWorkSessions.get(targetUserId);
    if (!session) {
      return ctx.answerCallbackQuery({
        text: '⚠️ This work session has expired. Run /work again.',
        show_alert: true
      });
    }

    // Step 1: User clicked "I'm ready"
    if (action === 'ready') {
      const options = [...session.emojis].sort(() => 0.5 - Math.random());
      const keyboard = new InlineKeyboard();

      options.forEach(opt => {
        keyboard.text(opt, `work:guess:${encodeURIComponent(opt)}:${targetUserId}`);
      });

      const questionText = `💼 <b>Working shift at ${getJob(session.jobId)?.name}...</b>\n\n` +
        `❓ <b>Quick! Which emoji was in the ${session.targetPos} position?</b>`;

      await ctx.editMessageText(questionText, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      return ctx.answerCallbackQuery();
    }

    // Step 2: User selected an emoji guess
    if (action === 'guess') {
      const guess = decodeURIComponent(parts[2]);
      const job = getJob(session.jobId);
      activeWorkSessions.delete(targetUserId);

      // Set 45-minute base cooldown (halved to 22.5 mins if Premium)
      cooldownRepo.applyEffectiveCooldown(targetUserId, 'work', 2700);

      const isCorrect = guess === session.correctEmoji;
      let payout = 0;
      let dropText = '';

      if (isCorrect) {
        payout = job.salary;
        userRepo.updateWallet(targetUserId, payout);
        userRepo.incrementWorkShifts(targetUserId);

        // 5% chance of item drop
        if (Math.random() < 0.05 && job.workDrop?.length > 0) {
          const droppedId = pickRandom(job.workDrop);
          inventoryRepo.addItem(targetUserId, droppedId, 1);
          const droppedItem = items[droppedId];
          dropText = `\n🎁 <b>Special Bonus Drop:</b> Found 1x ${droppedItem?.emoji || '📦'} <b>${droppedItem?.name || droppedId}</b> during your shift!`;
        }
      } else {
        // Partial pay for trying
        payout = Math.floor(job.salary * 0.25);
        userRepo.updateWallet(targetUserId, payout);
      }

      const xpResult = addXp(targetUserId, isCorrect ? 40 : 15);

      let resultText = '';
      if (isCorrect) {
        resultText = `✅ <b>EXCELLENT WORK!</b>\n` +
          `You correctly chose <b>${guess}</b>!\n\n` +
          `🪙 <b>Salary Paid:</b> +${formatCoins(payout)}\n` +
          `⭐ <b>Work Shift Recorded:</b> +1 shift\n` +
          `⭐ <b>XP Earned:</b> +40 XP` +
          dropText +
          (xpResult.message ? `\n${xpResult.message}` : '');
      } else {
        resultText = `❌ <b>OOPS! WRONG EMOJI!</b>\n` +
          `The ${session.targetPos} emoji was actually <b>${session.correctEmoji}</b>, but you guessed <b>${guess}</b>.\n\n` +
          `Your boss gave you partial pay for effort: <b>+${formatCoins(payout)}</b>.\n` +
          `⭐ <b>XP Earned:</b> +15 XP` +
          (xpResult.message ? `\n${xpResult.message}` : '');
      }

      await ctx.editMessageText(resultText, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery({ text: isCorrect ? 'Great job!' : 'Wrong emoji!' });
    }
  }
};

export default work;
