import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { getOwnerDmTargetId } from '../../services/antiCheat.js';

const MAX_REPLY_LENGTH = 1000;

export const replyowner = {
  name: 'replyowner',
  aliases: ['replyadmin'],
  description: 'Reply directly to an official inquiry from the Bot Owner',
  cooldown: 0,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);
    const status = String(user?.account_status || 'active').toLowerCase();
    const canReply = Number(user?.can_reply_owner || 0) === 1;

    if (!canReply) {
      if (status === 'active') {
        return ctx.reply(
          '❌ You do not have an open inquiry from the Bot Owner. Use <code>/appeal</code> if your account is restricted, or <code>/report</code> to report a rulebreaker.',
          { parse_mode: 'HTML' }
        );
      }
      return ctx.reply(
        '❌ You do not have an open inquiry from the Bot Owner right now. Wait for the Bot Owner to message you, or use <code>/appeal &lt;your explanation&gt;</code> if your case has not been appealed yet.',
        { parse_mode: 'HTML' }
      );
    }

    const replyText = (
      typeof ctx.match === 'string' && ctx.match.trim()
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    );

    if (!replyText) {
      return ctx.reply(
        '❌ Please include your response message! Example:\n<code>/replyowner Here is what happened...</code>',
        { parse_mode: 'HTML' }
      );
    }

    if (replyText.length > MAX_REPLY_LENGTH) {
      return ctx.reply(`❌ Your reply is too long (max ${MAX_REPLY_LENGTH} characters). Please keep it concise.`);
    }

    const ownerChatId = await getOwnerDmTargetId();
    if (!ownerChatId) {
      return ctx.reply('⚠️ Unable to reach Bot Owner DM right now. Please try again shortly.');
    }

    const userHandle = user?.username
      ? `@${sanitizeHtml(user.username)}`
      : sanitizeHtml(user?.first_name || String(userId));
    const statusLabel = status.toUpperCase();

    const ownerCard =
      `📨 <b>USER RESPONSE TO YOUR INQUIRY</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>From:</b> ${userHandle} (<code>${userId}</code>)\n` +
      `🔒 <b>Status:</b> <code>${sanitizeHtml(statusLabel)}</code>\n` +
      `💬 <b>Reply:</b>\n` +
      `"<i>${sanitizeHtml(replyText)}</i>"\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 <i>Reply back with <code>/contact ${userId} &lt;message&gt;</code> or use the moderation buttons below:</i>`;

    const ownerKeyboard = new InlineKeyboard()
      .text('✅ Unban/Unfreeze', `ac:unfreeze:${userId}`)
      .text('💸 Clawback & Unfreeze', `ac:clawback:${userId}`)
      .row()
      .text('🔨 Keep Banned', `ac:keepban:${userId}`)
      .text('💬 Ask User for Info', `ac:askinfo:${userId}`);

    try {
      await ctx.api.sendMessage(ownerChatId, ownerCard, {
        parse_mode: 'HTML',
        reply_markup: ownerKeyboard
      });
    } catch (err) {
      console.warn(`[ReplyOwner] Failed to deliver reply from ${userId} to Owner DM:`, err?.message || err);
      return ctx.reply('⚠️ Failed to deliver your reply to the Bot Owner. Please try again later.');
    }

    // Consume reply permission so the user cannot spam the Owner DM after replying
    await userRepo.setCanReplyOwner(userId, 0);

    return ctx.reply(
      '✅ <b>Reply Delivered!</b> Your response has been forwarded directly to the Bot Owner.',
      { parse_mode: 'HTML' }
    );
  }
};

export default replyowner;
