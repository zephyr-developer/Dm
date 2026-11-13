import { InlineKeyboard } from 'grammy';
import userRepo from '../database/userRepo.js';
import { formatCoins, sanitizeHtml } from '../utils/formatters.js';

export const GAIN_SPIKE_THRESHOLD = 500_000_000_000; // 500B single gain spike
export const HARD_CAP_ANOMALY_THRESHOLD = 500_000_000_000; // 500B total balance anomaly
export const GIVE_TRANSFER_LIMIT = 100_000_000_000; // 100B single /give limit
export const GIVE_PERCENT_NETWORTH_THRESHOLD = 50_000_000_000; // 50B net worth threshold for >90% transfer check

const EXEMPT_COMMANDS = new Set([
  '/generatecoin',
  '/voidcoin',
  '/voidcoin set',
  '/ac_clawback',
  '/system',
  '/prestige',
  '/deposit',
  '/withdraw',
  '/givepremium',
  '/removepremium',
  '/incluck',
  '/restock',
  '/voiditem'
]);

let botInstance = null;

export function setSecurityBot(bot) {
  botInstance = bot;
}

export function getSecurityBot() {
  return botInstance;
}

export function isOwnerUserRecord(user) {
  if (!user) return false;
  const uname = user.username ? String(user.username).toLowerCase().replace(/^@/, '') : '';
  if (uname === 'tzhunyuan') return true;
  if (process.env.OWNER_ID && Number(user.user_id) === Number(process.env.OWNER_ID)) return true;
  return false;
}

export function isExemptSourceCommand(sourceCommand = '') {
  const norm = String(sourceCommand || '').trim().toLowerCase();
  if (!norm) return false;
  if (EXEMPT_COMMANDS.has(norm)) return true;
  if (norm.startsWith('/generatecoin') || norm.startsWith('/voidcoin') || norm.startsWith('/ac_')) {
    return true;
  }
  return false;
}

export async function sendUserDm(userId, htmlMessage, extra = {}) {
  if (!botInstance || !userId) return false;
  try {
    await botInstance.api.sendMessage(Number(userId), htmlMessage, {
      parse_mode: 'HTML',
      ...extra
    });
    return true;
  } catch {
    return false;
  }
}

export async function getOwnerDmTargetId() {
  const owner = await userRepo.getOwnerUser();
  if (owner) {
    return Number(owner.owner_chat_id || owner.user_id);
  }
  if (process.env.OWNER_ID) {
    return Number(process.env.OWNER_ID);
  }
  return null;
}

export async function sendOwnerSecurityAlert({
  user,
  sourceCommand,
  flaggedAmount,
  wallet,
  bank,
  details
}) {
  const ownerChatId = await getOwnerDmTargetId();
  if (!ownerChatId || !botInstance) return false;

  const targetId = Number(user.user_id);
  const handle = user.username ? `@${sanitizeHtml(user.username)}` : sanitizeHtml(user.first_name || String(targetId));

  const keyboard = new InlineKeyboard()
    .text('🔨 Ban (Keep Data)', `ac:ban:${targetId}`)
    .row()
    .text('💸 Remove Gained Coins & Unfreeze', `ac:clawback:${targetId}`)
    .row()
    .text('✅ Unfreeze (Keep Coins)', `ac:unfreeze:${targetId}`);

  const text =
    `🚨 <b>ANTI-CHEAT AUTO-FREEZE TRIGGERED</b> 🚨\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>User:</b> ${handle} (<code>${targetId}</code>)\n` +
    `⚡ <b>Source Command:</b> <code>${sanitizeHtml(sourceCommand)}</code>\n` +
    `💰 <b>Suspicious Amount:</b> <code>${formatCoins(flaggedAmount)}</code>\n` +
    `👛 <b>Current Wallet:</b> <code>${formatCoins(wallet)}</code>\n` +
    `🏦 <b>Current Bank:</b> <code>${formatCoins(bank)}</code>\n` +
    `📝 <b>Details:</b> ${sanitizeHtml(details || 'Anomalous transaction spike')}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `Select an enforcement action below:`;

  try {
    await botInstance.api.sendMessage(ownerChatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendAppealReviewCard(user, appealText) {
  const ownerChatId = await getOwnerDmTargetId();
  if (!ownerChatId) {
    return { sent: false, reason: 'OWNER_NOT_FOUND' };
  }
  if (!botInstance) {
    return { sent: false, reason: 'BOT_UNINITIALIZED' };
  }

  const targetId = Number(user.user_id);
  const handle = user.username ? `@${sanitizeHtml(user.username)}` : sanitizeHtml(user.first_name || String(targetId));
  const statusLabel = String(user.account_status || 'frozen').toUpperCase();

  const keyboard = new InlineKeyboard()
    .text('✅ Approve & Unban/Unfreeze', `ac:unfreeze:${targetId}`)
    .row()
    .text('💸 Remove Flagged Gain & Unfreeze', `ac:clawback:${targetId}`)
    .row()
    .text('❌ Reject Appeal (Stay Locked)', `ac:reject:${targetId}`);

  const msg =
    `📨 <b>NEW ACCOUNT APPEAL RECEIVED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>User:</b> ${handle} (<code>${targetId}</code>)\n` +
    `🔒 <b>Current Status:</b> <code>${sanitizeHtml(statusLabel)}</code>\n` +
    `📌 <b>Ban/Freeze Reason:</b> ${sanitizeHtml(user.status_reason || 'Suspicious / Illogical Economy Activity Detected')}\n` +
    `💰 <b>Balances:</b> Wallet <code>${formatCoins(user.wallet)}</code> | Bank <code>${formatCoins(user.bank)}</code>\n` +
    `🚩 <b>Flagged Gain:</b> <code>${formatCoins(user.flagged_amount || 0)}</code>\n\n` +
    `💬 <b>Player's Appeal Message:</b>\n` +
    `"<i>${sanitizeHtml(appealText)}</i>"\n` +
    `━━━━━━━━━━━━━━━━━━━━━`;

  try {
    await botInstance.api.sendMessage(ownerChatId, msg, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err?.message || 'DM_FAILED' };
  }
}

/**
 * Evaluates a non-owner balance change against anti-cheat thresholds.
 * Preserves all balances/items, sets account_status='frozen', and alerts @tzhunyuan via DM.
 */
export async function evaluateTransactionAnomaly({
  user,
  oldWallet = 0,
  oldBank = 0,
  newWallet = 0,
  newBank = 0,
  walletDelta = 0,
  bankDelta = 0,
  sourceCommand = '/system',
  details = ''
}) {
  if (!user || isOwnerUserRecord(user) || isExemptSourceCommand(sourceCommand)) {
    return { triggered: false };
  }

  const numericWalletDelta = Number(walletDelta || 0);
  const oldTotal = Number(oldWallet || 0) + Number(oldBank || 0);
  const newTotal = Number(newWallet || 0) + Number(newBank || 0);

  let triggered = false;
  let anomalyAmount = 0;
  let triggerDetails = details || '';

  // Rule 1: Single gain / payout spike (> 500B walletDelta in a single action)
  if (numericWalletDelta > GAIN_SPIKE_THRESHOLD) {
    triggered = true;
    anomalyAmount = Math.floor(numericWalletDelta);
    triggerDetails = triggerDetails || `Single payout spike (+${formatCoins(anomalyAmount)})`;
  }

  // Rule 3: Account hard cap anomaly (suddenly crossing 500B total balance from non-owner source)
  if (oldTotal <= HARD_CAP_ANOMALY_THRESHOLD && newTotal > HARD_CAP_ANOMALY_THRESHOLD) {
    triggered = true;
    const netGain = Math.max(0, newTotal - oldTotal);
    anomalyAmount = Math.max(anomalyAmount, Math.floor(numericWalletDelta > 0 ? numericWalletDelta : netGain));
    triggerDetails = triggerDetails
      ? `${triggerDetails} (Total balance crossed 500B threshold)`
      : 'Total balance suddenly crossed 500B threshold';
  }

  if (!triggered) {
    return { triggered: false };
  }

  const reason = `Auto-Frozen: Illogical transaction/balance spike of 🪙 ${anomalyAmount.toLocaleString('en-US')} via ${sourceCommand}`;
  const updatedUser = await userRepo.setAccountStatus(user.user_id, 'frozen', reason, anomalyAmount);

  await sendOwnerSecurityAlert({
    user: updatedUser || user,
    sourceCommand,
    flaggedAmount: anomalyAmount,
    wallet: newWallet,
    bank: newBank,
    details: triggerDetails
  });

  return {
    triggered: true,
    flaggedAmount: anomalyAmount,
    reason,
    user: updatedUser
  };
}

/**
 * Evaluates /give coin transfer anomalies and freezes BOTH sender and receiver if triggered.
 */
export async function evaluateGiveTransferAnomaly({
  sender,
  receiver,
  amount,
  netAmount,
  senderWalletAfter,
  senderBankAfter,
  receiverWalletAfter,
  receiverBankAfter
}) {
  const senderNetWorthBefore = Number(sender.wallet || 0) + Number(sender.bank || 0);
  const isOverSingleLimit = amount > GIVE_TRANSFER_LIMIT;
  const isOverPctAnomaly = senderNetWorthBefore > GIVE_PERCENT_NETWORTH_THRESHOLD && amount > senderNetWorthBefore * 0.90;
  const receiverCrossedHardCap =
    (Number(receiver.wallet || 0) + Number(receiver.bank || 0)) <= HARD_CAP_ANOMALY_THRESHOLD &&
    (Number(receiverWalletAfter || 0) + Number(receiverBankAfter || 0)) > HARD_CAP_ANOMALY_THRESHOLD;
  const isReceiverGainSpike = netAmount > GAIN_SPIKE_THRESHOLD;

  if (!isOverSingleLimit && !isOverPctAnomaly && !receiverCrossedHardCap && !isReceiverGainSpike) {
    return { triggered: false };
  }

  const reasonDetail = isOverSingleLimit
    ? `Illogical /give transfer exceeding 100B (🪙 ${amount.toLocaleString('en-US')})`
    : isOverPctAnomaly
      ? `Suspicious liquidation transfer (>90% of >50B net worth: 🪙 ${amount.toLocaleString('en-US')})`
      : `Receiver crossed 500B hard cap anomaly via /give`;

  const senderFlagReason = `Auto-Frozen: Illogical transaction/balance spike of 🪙 ${amount.toLocaleString('en-US')} via /give`;
  const receiverFlagReason = `Auto-Frozen: Illogical transaction/balance spike of 🪙 ${netAmount.toLocaleString('en-US')} via /give`;

  if (!isOwnerUserRecord(sender)) {
    const frozenSender = await userRepo.setAccountStatus(sender.user_id, 'frozen', senderFlagReason, amount);
    await sendOwnerSecurityAlert({
      user: frozenSender || sender,
      sourceCommand: '/give (Sender)',
      flaggedAmount: amount,
      wallet: senderWalletAfter,
      bank: senderBankAfter,
      details: `${reasonDetail} -> Sent to @${receiver.username || receiver.user_id}`
    });
  }

  if (!isOwnerUserRecord(receiver)) {
    const frozenReceiver = await userRepo.setAccountStatus(receiver.user_id, 'frozen', receiverFlagReason, netAmount);
    await sendOwnerSecurityAlert({
      user: frozenReceiver || receiver,
      sourceCommand: '/give (Receiver)',
      flaggedAmount: netAmount,
      wallet: receiverWalletAfter,
      bank: receiverBankAfter,
      details: `${reasonDetail} <- Received from @${sender.username || sender.user_id}`
    });
  }

  return {
    triggered: true,
    reasonDetail
  };
}

/**
 * Handles Owner inline keyboard review actions (`ac:ban:<uid>`, `ac:clawback:<uid>`, `ac:unfreeze:<uid>`, `ac:reject:<uid>`).
 */
export async function handleAntiCheatCallback(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  const isEnvOwner = process.env.OWNER_ID && Number(ctx.from?.id) === Number(process.env.OWNER_ID);
  if (callerUsername !== 'tzhunyuan' && !isEnvOwner) {
    return ctx.answerCallbackQuery({ text: '❌ Unauthorized: Owner only.', show_alert: true }).catch(() => {});
  }

  const parts = String(ctx.callbackQuery?.data || '').split(':');
  const action = parts[1];
  const targetUserId = Number(parts[2]);

  if (!action || isNaN(targetUserId)) {
    return ctx.answerCallbackQuery({ text: '⚠️ Invalid security action payload.' }).catch(() => {});
  }

  const target = await userRepo.getUser(targetUserId);
  if (!target) {
    return ctx.answerCallbackQuery({ text: '❌ Target user not found.', show_alert: true }).catch(() => {});
  }

  const targetHandle = target.username ? `@${sanitizeHtml(target.username)}` : sanitizeHtml(target.first_name || String(targetUserId));
  const originalText = ctx.callbackQuery?.message?.text || '';
  const safeBase = sanitizeHtml(originalText);

  if (action === 'ban') {
    const reason = target.status_reason || 'Banned by Bot Owner during Security Review';
    await userRepo.setAccountStatus(targetUserId, 'banned', reason, Number(target.flagged_amount || 0));

    await sendUserDm(
      targetUserId,
      `🔨 <b>ACCOUNT BANNED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `❌ Your TeleMemer account has been <b>BANNED</b> by the Bot Owner.\n` +
      `📝 <b>Reason:</b> ${sanitizeHtml(reason)}\n\n` +
      `<i>All your data, coins, and items have been preserved. You may submit an appeal once every 24 hours using:</i>\n` +
      `<code>/appeal &lt;your explanation&gt;</code>`
    );

    await ctx.editMessageText(
      `${safeBase}\n\n🔨 <b>ACTION TAKEN:</b> ${targetHandle} (<code>${targetUserId}</code>) has been <b>BANNED</b> (all data preserved).`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.answerCallbackQuery({ text: '🔨 User banned (data preserved).' }).catch(() => {});
  }

  if (action === 'clawback') {
    const currentWallet = Number(target.wallet || 0);
    const currentBank = Number(target.bank || 0);
    const flagged = Math.max(0, Number(target.flagged_amount || 0));

    const deductWallet = Math.min(currentWallet, flagged);
    const remaining = Math.max(0, flagged - deductWallet);
    const deductBank = Math.min(currentBank, remaining);
    const totalRemoved = deductWallet + deductBank;

    if (totalRemoved > 0) {
      await userRepo.updateCoins(targetUserId, {
        walletDelta: -deductWallet,
        bankDelta: -deductBank,
        sourceCommand: '/ac_clawback',
        details: `Owner anti-cheat clawback of ${formatCoins(totalRemoved)}`,
        skipAntiCheat: true
      });
    }

    await userRepo.setAccountStatus(targetUserId, 'active', null, 0);

    await sendUserDm(
      targetUserId,
      `💸 <b>ACCOUNT RESTORED (FLAGGED GAIN REMOVED)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Your TeleMemer account has been <b>UNFROZEN</b> by the Bot Owner.\n` +
      `💰 <b>Removed Illegitimate Gain:</b> ${formatCoins(totalRemoved)}\n` +
      `👛 <b>Remaining Wallet:</b> ${formatCoins(currentWallet - deductWallet)} | 🏦 <b>Bank:</b> ${formatCoins(currentBank - deductBank)}\n\n` +
      `<i>Please play fairly to avoid future automatic freezes.</i>`
    );

    await ctx.editMessageText(
      `${safeBase}\n\n💸 <b>ACTION TAKEN:</b> Removed <b>${formatCoins(totalRemoved)}</b> from ${targetHandle} and <b>UNFROZEN</b> their account.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.answerCallbackQuery({ text: '💸 Flagged coins removed & account unfrozen.' }).catch(() => {});
  }

  if (action === 'unfreeze') {
    await userRepo.setAccountStatus(targetUserId, 'active', null, 0);

    await sendUserDm(
      targetUserId,
      `✅ <b>ACCOUNT APPROVED &amp; UNFROZEN</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 Good news! The Bot Owner reviewed your account and cleared all restrictions.\n` +
      `You can now use all TeleMemer commands normally!`
    );

    await ctx.editMessageText(
      `${safeBase}\n\n✅ <b>ACTION TAKEN:</b> ${targetHandle} (<code>${targetUserId}</code>) has been <b>CLEARED &amp; UNFROZEN</b> (coins kept).`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.answerCallbackQuery({ text: '✅ Account unfrozen & approved.' }).catch(() => {});
  }

  if (action === 'reject') {
    const currentStatus = String(target.account_status || 'banned').toUpperCase();

    await sendUserDm(
      targetUserId,
      `❌ <b>APPEAL REJECTED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your appeal was reviewed by the Bot Owner and <b>REJECTED</b>.\n` +
      `🔒 Your account remains <b>${sanitizeHtml(currentStatus)}</b>.\n\n` +
      `⏳ You must wait <b>24 hours</b> from your submission before appealing again.`
    );

    await ctx.editMessageText(
      `${safeBase}\n\n❌ <b>ACTION TAKEN:</b> Appeal for ${targetHandle} (<code>${targetUserId}</code>) was <b>REJECTED</b> (account stays ${sanitizeHtml(currentStatus)}).`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.answerCallbackQuery({ text: '❌ Appeal rejected.' }).catch(() => {});
  }

  return ctx.answerCallbackQuery().catch(() => {});
}

export default {
  GAIN_SPIKE_THRESHOLD,
  HARD_CAP_ANOMALY_THRESHOLD,
  GIVE_TRANSFER_LIMIT,
  GIVE_PERCENT_NETWORTH_THRESHOLD,
  setSecurityBot,
  getSecurityBot,
  isOwnerUserRecord,
  isExemptSourceCommand,
  sendUserDm,
  getOwnerDmTargetId,
  sendOwnerSecurityAlert,
  sendAppealReviewCard,
  evaluateTransactionAnomaly,
  evaluateGiveTransferAnomaly,
  handleAntiCheatCallback
};
