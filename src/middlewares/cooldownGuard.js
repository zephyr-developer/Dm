import cooldownRepo from '../database/cooldownRepo.js';
import userRepo from '../database/userRepo.js';
import { formatTime } from '../utils/formatters.js';

export function createCooldownGuard(commandName, baseDurationSeconds) {
  return async function cooldownGuard(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId || !baseDurationSeconds || baseDurationSeconds <= 0) {
      return next();
    }

    const { onCooldown, remainingSeconds } = await cooldownRepo.checkCooldown(userId, commandName);

    if (onCooldown) {
      const isPremium = await userRepo.isPremium(userId);
      let waitMsg = `⏳ <b>Slow down!</b> Wait <b>${formatTime(remainingSeconds)}</b> before using <code>/${commandName}</code> again.`;

      if (!isPremium) {
        const premiumWait = Math.max(3, Math.floor(baseDurationSeconds * 0.5));
        waitMsg += `\n💎 <i>Tip: Premium users only wait ${formatTime(premiumWait)}!</i>`;
      }

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

    // Set effective cooldown (50% reduction for Premium)
    await cooldownRepo.applyEffectiveCooldown(userId, commandName, baseDurationSeconds);
  };
}

export async function enforceCooldown(userId, commandName, baseDurationSeconds) {
  const { onCooldown, remainingSeconds } = await cooldownRepo.checkCooldown(userId, commandName);
  if (onCooldown) {
    const isPremium = await userRepo.isPremium(userId);
    let message = `⏳ Cooldown active! Wait ${formatTime(remainingSeconds)}.`;
    if (!isPremium) {
      const premiumWait = Math.max(3, Math.floor(baseDurationSeconds * 0.5));
      message += ` (💎 Premium only waits ${formatTime(premiumWait)}!)`;
    }
    return { allowed: false, remainingSeconds, message };
  }

  await cooldownRepo.applyEffectiveCooldown(userId, commandName, baseDurationSeconds);
  return { allowed: true, remainingSeconds: 0 };
}

export default {
  createCooldownGuard,
  enforceCooldown
};
