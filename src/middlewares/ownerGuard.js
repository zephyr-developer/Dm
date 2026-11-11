import dotenv from 'dotenv';

dotenv.config();

const TARGET_OWNER_USERNAME = (process.env.OWNER_USERNAME || 'tzhunyuan').toLowerCase().replace(/^@/, '');
const TARGET_OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

export function isOwner(ctx) {
  const from = ctx.from;
  if (!from) return false;

  // Check username match (case-insensitive)
  if (from.username && from.username.toLowerCase().replace(/^@/, '') === TARGET_OWNER_USERNAME) {
    return true;
  }

  // Check user ID match if configured
  if (TARGET_OWNER_ID && from.id === TARGET_OWNER_ID) {
    return true;
  }

  return false;
}

export async function ownerGuard(ctx, next) {
  if (!isOwner(ctx)) {
    // Keep underground commands secret: return standard unknown command message or silently ignore
    return ctx.reply('❌ Unknown command. Type /help to see all available commands.');
  }

  return next();
}

export default {
  isOwner,
  ownerGuard
};
