import cooldownRepo from '../database/cooldownRepo.js';
import { formatTime } from '../utils/formatters.js';

export function createCooldownGuard(commandName, durationSeconds) {
  return async function cooldownGuard(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId || !durationSeconds || durationSeconds <= 0) {
      return next();
    }

    const { onCooldown, remainingSeconds } = cooldownRepo.checkCooldown(userId, commandName);

    if (onCooldown) {
      const waitMsg = `⏳ <b>Slow down!</b> You can use <code>/${commandName}</code> again in <b>${formatTime(remainingSeconds)}</b>.`;

      if (ctx.callbackQuery) {
        return ctx.answerCallbackQuery({
          text: `⏳ Cooldown active! Wait ${formatTime(remainingSeconds)}.`,
          show_alert: true
        });
      }

      return ctx.reply(waitMsg, { parse_mode: 'HTML' });
    }

    // Execute the command handler
    await next();

    // Set cooldown only if command ran without unhandled exception
    cooldownRepo.setCooldown(userId, commandName, durationSeconds);
  };
}

export function enforceCooldown(userId, commandName, durationSeconds) {
  const { onCooldown, remainingSeconds } = cooldownRepo.checkCooldown(userId, commandName);
  if (onCooldown) {
    return { allowed: false, remainingSeconds, message: `⏳ Cooldown active! Please wait ${formatTime(remainingSeconds)}.` };
  }
  cooldownRepo.setCooldown(userId, commandName, durationSeconds);
  return { allowed: true, remainingSeconds: 0 };
}

export default {
  createCooldownGuard,
  enforceCooldown
};
