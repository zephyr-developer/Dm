import { heistParticipants } from '../utils/heistState.js';

export async function heistGuard(ctx, next) {
  const userId = ctx.from?.id;

  if (userId && (heistParticipants.has(userId) || heistParticipants.has(Number(userId)) || heistParticipants.has(String(userId)))) {
    // Intercept any command attempts (text messages starting with '/')
    if (ctx.message?.text?.startsWith('/')) {
      return ctx.reply('❌ You are currently participating in an active bank heist! Focus on the mission! You cannot use other commands until the heist finishes.');
    }

    // Intercept callback queries except for the bankrob heist lobby actions
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data || '';
      if (!data.startsWith('bankrob:join')) {
        return ctx.answerCallbackQuery({
          text: '❌ You are currently participating in an active bank heist! Focus on the mission! You cannot use other commands until the heist finishes.',
          show_alert: true
        });
      }
    }
  }

  return next();
}

export default heistGuard;
