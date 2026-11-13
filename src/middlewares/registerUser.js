import userRepo from '../database/userRepo.js';

export async function registerUser(ctx, next) {
  const from = ctx.from;
  if (!from) {
    return next();
  }

  // Upsert user into database
  let user = await userRepo.upsertUser(from.id, from.username, from.first_name);

  // Dynamically record @tzhunyuan's numeric Telegram DM chat/user ID so Owner alerts always reach them
  const uname = from.username ? from.username.toLowerCase().replace(/^@/, '') : '';
  if (uname === 'tzhunyuan') {
    const targetDmId = ctx.chat?.type === 'private' ? ctx.chat.id : from.id;
    if (Number(user?.owner_chat_id) !== Number(targetDmId)) {
      user = (await userRepo.setOwnerChatId(from.id, targetDmId)) || user;
    }
  }

  ctx.dbUser = user;

  // Link group membership if message/callback is from a group or supergroup
  const chat = ctx.chat;
  if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
    await userRepo.linkGroupMember(chat.id, from.id);
  }

  return next();
}

export default registerUser;
