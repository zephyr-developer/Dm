import userRepo from '../database/userRepo.js';

export async function registerUser(ctx, next) {
  const from = ctx.from;
  if (!from) {
    return next();
  }

  // Upsert user into database
  const user = await userRepo.upsertUser(from.id, from.username, from.first_name);
  ctx.dbUser = user;

  // Link group membership if message/callback is from a group or supergroup
  const chat = ctx.chat;
  if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
    await userRepo.linkGroupMember(chat.id, from.id);
  }

  return next();
}

export default registerUser;
