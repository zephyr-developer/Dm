import crypto from 'crypto';

// Global shared store for pending confirmation payloads so callback_data stays well under Telegram's 64-byte limit
global.pendingConfirmations = global.pendingConfirmations || new Map();

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function pruneExpiredConfirmations() {
  const now = Date.now();
  for (const [token, entry] of global.pendingConfirmations.entries()) {
    if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
      global.pendingConfirmations.delete(token);
    }
  }
}

export function createConfirmation(prefix, payload, ttlMs = DEFAULT_TTL_MS) {
  pruneExpiredConfirmations();
  const rand = crypto.randomBytes(4).toString('hex');
  const token = `${prefix}_${rand}`;
  global.pendingConfirmations.set(token, {
    ...payload,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs
  });
  return token;
}

export function getConfirmation(token) {
  pruneExpiredConfirmations();
  if (!token) return null;
  const entry = global.pendingConfirmations.get(token);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    global.pendingConfirmations.delete(token);
    return null;
  }
  return entry;
}

export function consumeConfirmation(token) {
  const entry = getConfirmation(token);
  if (entry) {
    global.pendingConfirmations.delete(token);
  }
  return entry;
}

export function deleteConfirmation(token) {
  if (!token) return false;
  return global.pendingConfirmations.delete(token);
}

export default {
  createConfirmation,
  getConfirmation,
  consumeConfirmation,
  deleteConfirmation,
  pruneExpiredConfirmations
};
