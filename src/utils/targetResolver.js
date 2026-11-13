import userRepo from '../database/userRepo.js';
import { sanitizeHtml } from './formatters.js';

/**
 * Checks whether ctx.message.reply_to_message is a genuine reply to a human user,
 * ignoring Telegram Forum Topic header/service messages and bot messages.
 */
export function isGenuineUserReply(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply) return false;
  if (reply.forum_topic_created) return false;
  if (ctx.message?.message_thread_id && reply.message_id === ctx.message.message_thread_id) {
    return false;
  }
  if (!reply.from || reply.from.is_bot) return false;
  return true;
}

/**
 * Topic-safe centralized target user resolver.
 * Priority:
 *  1. Explicit @username (or text_mention, or bare username/ID when allowBareUsername is true)
 *  2. Genuine human reply_to_message (ignoring Forum Topic service headers & bots)
 *  3. Optional fallback to ctx.from (when fallbackToCaller is true)
 */
export async function resolveTargetUser(
  ctx,
  argsString = '',
  {
    fallbackToCaller = true,
    allowBareUsername = false,
    allowNumericId = false,
    initRepliedUser = true
  } = {}
) {
  const rawString = (
    typeof argsString === 'string' && argsString.trim()
      ? argsString
      : (typeof ctx.match === 'string' && ctx.match.trim()
          ? ctx.match
          : ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ') || '')
  ).trim();

  const tokens = rawString ? rawString.split(/\s+/).filter(Boolean) : [];

  // 1a. Explicit @username token anywhere in arguments ALWAYS takes top priority
  const atIndex = tokens.findIndex(t => t.startsWith('@') && t.length > 1);
  if (atIndex !== -1) {
    const cleanUsername = tokens[atIndex].replace(/^@+/, '').trim();
    const remainingArgs = tokens.filter((_, idx) => idx !== atIndex);
    const found = await userRepo.getUserByUsername(cleanUsername);

    if (!found) {
      return {
        user: null,
        notFound: true,
        explicitUsername: cleanUsername,
        errorMessage: `❌ User @${sanitizeHtml(cleanUsername)} has not registered/played TeleMemer yet!`,
        remainingArgs,
        source: 'username'
      };
    }

    return {
      user: found,
      notFound: false,
      explicitUsername: cleanUsername,
      errorMessage: null,
      remainingArgs,
      source: 'username'
    };
  }

  // 1b. Telegram text_mention entity (users without a public @username)
  const entities = ctx.message?.entities || [];
  const textMention = entities.find(e => e.type === 'text_mention' && e.user && !e.user.is_bot);
  if (textMention?.user) {
    const u = textMention.user;
    let remainingArgs = [...tokens];
    if (typeof ctx.message?.text === 'string') {
      const mentionText = ctx.message.text.slice(textMention.offset, textMention.offset + textMention.length).trim();
      const mentionTokens = mentionText.split(/\s+/).filter(Boolean);
      for (const mt of mentionTokens) {
        const idx = remainingArgs.indexOf(mt);
        if (idx !== -1) remainingArgs.splice(idx, 1);
      }
    }

    const resolved = initRepliedUser
      ? await userRepo.getOrInitUser(u.id, u.username, u.first_name)
      : await userRepo.getUser(u.id);

    if (!resolved) {
      const label = u.username || u.first_name || String(u.id);
      return {
        user: null,
        notFound: true,
        explicitUsername: label,
        errorMessage: `❌ User ${sanitizeHtml(label)} has not registered/played TeleMemer yet!`,
        remainingArgs,
        source: 'text_mention'
      };
    }

    return {
      user: resolved,
      notFound: false,
      explicitUsername: resolved.username || resolved.first_name,
      errorMessage: null,
      remainingArgs,
      source: 'text_mention'
    };
  }

  // 1c. Bare username or numeric user ID (for lookup commands like /bal, /inv, /rob, /bankrob, /removepremium)
  if (allowBareUsername && tokens.length > 0) {
    const candidate = tokens[0].replace(/^@+/, '').trim();
    const remainingArgs = tokens.slice(1);

    if (allowNumericId && /^\d+$/.test(candidate) && Number(candidate) > 1000) {
      const foundById = await userRepo.getUser(Number(candidate));
      if (!foundById) {
        return {
          user: null,
          notFound: true,
          explicitUsername: candidate,
          errorMessage: `❌ User <code>${sanitizeHtml(candidate)}</code> has not registered/played TeleMemer yet!`,
          remainingArgs,
          source: 'id'
        };
      }
      return {
        user: foundById,
        notFound: false,
        explicitUsername: foundById.username || String(foundById.user_id),
        errorMessage: null,
        remainingArgs,
        source: 'id'
      };
    }

    if (candidate && !/^\d+$/.test(candidate)) {
      const found = await userRepo.getUserByUsername(candidate);
      if (!found) {
        return {
          user: null,
          notFound: true,
          explicitUsername: candidate,
          errorMessage: `❌ User @${sanitizeHtml(candidate)} has not registered/played TeleMemer yet!`,
          remainingArgs,
          source: 'username'
        };
      }
      return {
        user: found,
        notFound: false,
        explicitUsername: candidate,
        errorMessage: null,
        remainingArgs,
        source: 'username'
      };
    }
  }

  // 2. Genuine human reply_to_message (ignoring Forum Topic headers and bots)
  if (isGenuineUserReply(ctx)) {
    const replied = ctx.message.reply_to_message.from;
    const resolved = initRepliedUser
      ? await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name)
      : await userRepo.getUser(replied.id);

    if (!resolved) {
      const label = replied.username ? `@${replied.username}` : (replied.first_name || String(replied.id));
      return {
        user: null,
        notFound: true,
        explicitUsername: label,
        errorMessage: `❌ User ${sanitizeHtml(label)} has not registered/played TeleMemer yet!`,
        remainingArgs: tokens,
        source: 'reply'
      };
    }

    return {
      user: resolved,
      notFound: false,
      explicitUsername: resolved.username || resolved.first_name,
      errorMessage: null,
      remainingArgs: tokens,
      source: 'reply'
    };
  }

  // 3. Fallback to caller if enabled
  if (fallbackToCaller && ctx.from) {
    const caller = await userRepo.getOrInitUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
    return {
      user: caller,
      notFound: false,
      explicitUsername: null,
      errorMessage: null,
      remainingArgs: tokens,
      source: 'self'
    };
  }

  return {
    user: null,
    notFound: false,
    explicitUsername: null,
    errorMessage: null,
    remainingArgs: tokens,
    source: 'none'
  };
}

export default {
  isGenuineUserReply,
  resolveTargetUser
};
