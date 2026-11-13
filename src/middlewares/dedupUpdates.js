// Global deduplication sets (persisted on globalThis to survive module re-evaluations)
const processedUpdates = (globalThis.__teleMemerProcessedUpdates ??= new Set());
const processedMessages = (globalThis.__teleMemerProcessedMessages ??= new Set());
const processedCallbacks = (globalThis.__teleMemerProcessedCallbacks ??= new Set());

const MAX_CACHE_SIZE = 2000;

function trackWithLimit(set, key) {
  if (set.has(key)) {
    return false;
  }
  set.add(key);
  if (set.size > MAX_CACHE_SIZE) {
    const oldest = set.values().next().value;
    set.delete(oldest);
  }
  return true;
}

export async function dedupUpdates(ctx, next) {
  // 1. Deduplicate by Telegram update_id
  const updateId = ctx.update?.update_id;
  if (updateId !== undefined && updateId !== null) {
    if (!trackWithLimit(processedUpdates, updateId)) {
      return; // Silently drop duplicate update
    }
  }

  // 2. Deduplicate by chat_id + message_id for incoming messages (never for callback_query clicks on the same message)
  if (!ctx.callbackQuery && ctx.message?.message_id && ctx.chat?.id) {
    const msgKey = `${ctx.chat.id}:${ctx.message.message_id}`;
    if (!trackWithLimit(processedMessages, msgKey)) {
      return; // Silently drop duplicate message processing
    }
  }

  // 3. Deduplicate by callback_query.id for inline button clicks
  const callbackId = ctx.callbackQuery?.id;
  if (callbackId) {
    if (!trackWithLimit(processedCallbacks, callbackId)) {
      return; // Silently drop duplicate callback delivery
    }
  }

  await next();
}

export default dedupUpdates;
