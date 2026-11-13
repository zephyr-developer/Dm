import { InlineKeyboard } from 'grammy';
import inventoryRepo from '../../database/inventoryRepo.js';
import { findItem, getItem } from '../../config/items.js';
import { isOwner } from '../../middlewares/ownerGuard.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { resolveTargetUser } from '../../utils/targetResolver.js';
import { createConfirmation, consumeConfirmation, deleteConfirmation, getConfirmation } from '../../utils/confirmations.js';

function isAuthorizedOwner(ctx) {
  const callerUsername = ctx.from?.username?.toLowerCase()?.replace(/^@/, '');
  return callerUsername === 'tzhunyuan' || isOwner(ctx);
}

function buildUsageMessage() {
  return (
    '⚠️ <b>Usage:</b>\n' +
    '• <code>/voiditem &lt;item&gt; &lt;amount|all&gt; &lt;@username|reply&gt;</code>\n' +
    '• <code>/voiditem set &lt;item&gt; &lt;exact_amount&gt; &lt;@username|reply&gt;</code>\n' +
    '• <code>/voiditem all &lt;@username|reply&gt;</code> (Wipe entire inventory)\n\n' +
    '<b>Examples:</b>\n' +
    '• <code>/voiditem pepetrophy 1 @user</code>\n' +
    '• <code>/voiditem banknote all @user</code>\n' +
    '• <code>/voiditem set padlock 5 @user</code>\n' +
    '• <code>/voiditem all @user</code>'
  );
}

export const voiditem = {
  name: 'voiditem',
  aliases: ['removeitem', 'clearitem'],
  category: 'owner',
  description: 'Underground: Forcefully void, set, or wipe items from a user inventory',
  cooldown: 0,

  async execute(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.reply('❌ Unknown command.');
    }

    const {
      user: target,
      notFound,
      errorMessage,
      explicitUsername,
      remainingArgs
    } = await resolveTargetUser(ctx, ctx.match, {
      fallbackToCaller: false,
      allowBareUsername: false
    });

    if (notFound) {
      return ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }

    if (!target) {
      return ctx.reply(`⚠️ <b>Target user not found!</b>\n\n${buildUsageMessage()}`, { parse_mode: 'HTML' });
    }

    if (remainingArgs.length === 0) {
      return ctx.reply(buildUsageMessage(), { parse_mode: 'HTML' });
    }

    const callerId = ctx.from.id;
    const targetUsername = explicitUsername || target.username || target.first_name || String(target.user_id);
    const firstLower = remainingArgs[0].toLowerCase();

    // ====================================================
    // MODE 1: /voiditem all <@username|reply> (Wipe all)
    // ====================================================
    if (remainingArgs.length === 1 && firstLower === 'all') {
      const inv = await inventoryRepo.getUserInventory(target.user_id);
      if (inv.length === 0) {
        return ctx.reply(
          `📦 @${sanitizeHtml(targetUsername)}'s inventory is already completely empty.`,
          { parse_mode: 'HTML' }
        );
      }

      const totalUnits = inv.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      const previewLines = inv.slice(0, 6).map(r => {
        const meta = getItem(r.item_id);
        return `• ${meta?.emoji || '📦'} ${sanitizeHtml(meta?.name || r.item_id)}: <b>${Number(r.quantity).toLocaleString('en-US')}x</b>`;
      });
      if (inv.length > 6) {
        previewLines.push(`<i>...and ${inv.length - 6} more item type(s)</i>`);
      }

      const token = createConfirmation('vi', {
        callerId,
        targetId: target.user_id,
        targetUsername,
        targetFirstName: target.first_name,
        mode: 'wipe_all',
        totalStacks: inv.length,
        totalUnits
      });

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `voiditem:no:${token}:${callerId}`)
        .text('✅ Confirm', `voiditem:yes:${token}:${callerId}`);

      return ctx.reply(
        `⚠️ <b>CONFIRM FULL INVENTORY WIPE</b>\n\n` +
        `👤 <b>Target:</b> @${sanitizeHtml(targetUsername)} (<code>${target.user_id}</code>)\n` +
        `🎒 <b>Current Inventory:</b> <b>${inv.length}</b> item types (<b>${totalUnits.toLocaleString('en-US')}</b> total units)\n` +
        `${previewLines.join('\n')}\n\n` +
        `💥 <b>Action:</b> Permanently DELETE ALL items from target's backpack?`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    // ====================================================
    // MODE 2: /voiditem set <item> <exact_amount> <@user>
    // ====================================================
    if (firstLower === 'set') {
      if (remainingArgs.length < 3) {
        return ctx.reply(buildUsageMessage(), { parse_mode: 'HTML' });
      }

      const qtyStr = remainingArgs[remainingArgs.length - 1];
      if (!/^\d+$/.test(qtyStr)) {
        return ctx.reply('⚠️ Invalid exact amount. Specify a non-negative integer (e.g., <code>/voiditem set padlock 5 @user</code>).', { parse_mode: 'HTML' });
      }

      const exactAmount = Math.min(1_000_000_000, Math.max(0, parseInt(qtyStr, 10)));
      const itemQuery = remainingArgs.slice(1, -1).join(' ');
      const item = findItem(itemQuery);

      if (!item) {
        return ctx.reply(`❌ Unknown item "<b>${sanitizeHtml(itemQuery)}</b>". Use <code>/items</code> to check valid item IDs.`, { parse_mode: 'HTML' });
      }

      const currentQty = await inventoryRepo.getItem(target.user_id, item.id);

      const token = createConfirmation('vi', {
        callerId,
        targetId: target.user_id,
        targetUsername,
        targetFirstName: target.first_name,
        mode: 'set',
        itemId: item.id,
        itemName: item.name,
        itemEmoji: item.emoji,
        exactAmount,
        currentQty
      });

      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `voiditem:no:${token}:${callerId}`)
        .text('✅ Confirm', `voiditem:yes:${token}:${callerId}`);

      return ctx.reply(
        `⚖️ <b>CONFIRM INVENTORY SET</b>\n\n` +
        `👤 <b>Target:</b> @${sanitizeHtml(targetUsername)} (<code>${target.user_id}</code>)\n` +
        `📦 <b>Item:</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b> (<code>${item.id}</code>)\n` +
        `🎒 <b>Current Owned:</b> <b>${currentQty.toLocaleString('en-US')}x</b>\n` +
        `🎯 <b>New Exact Count:</b> <b>${exactAmount.toLocaleString('en-US')}x</b>`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    // ====================================================
    // MODE 3: /voiditem <item> <amount|all> <@user|reply>
    // ====================================================
    if (remainingArgs.length < 2) {
      return ctx.reply(buildUsageMessage(), { parse_mode: 'HTML' });
    }

    const amountArg = remainingArgs[remainingArgs.length - 1].toLowerCase();
    const itemQuery = remainingArgs.slice(0, -1).join(' ');
    const item = findItem(itemQuery);

    if (!item) {
      return ctx.reply(`❌ Unknown item "<b>${sanitizeHtml(itemQuery)}</b>". Use <code>/items</code> to check valid item IDs.`, { parse_mode: 'HTML' });
    }

    const currentQty = await inventoryRepo.getItem(target.user_id, item.id);
    if (currentQty <= 0) {
      return ctx.reply(
        `📦 @${sanitizeHtml(targetUsername)} currently owns <b>0x</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b>.`,
        { parse_mode: 'HTML' }
      );
    }

    let removeQty = 0;
    let isRemoveAll = false;
    if (amountArg === 'all' || amountArg === 'max') {
      isRemoveAll = true;
      removeQty = currentQty;
    } else if (/^\d+$/.test(amountArg)) {
      const parsed = parseInt(amountArg, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return ctx.reply('⚠️ Specify a positive integer or <code>all</code>.', { parse_mode: 'HTML' });
      }
      removeQty = Math.min(currentQty, parsed);
    } else {
      return ctx.reply(buildUsageMessage(), { parse_mode: 'HTML' });
    }

    const projectedRemaining = Math.max(0, currentQty - removeQty);
    const token = createConfirmation('vi', {
      callerId,
      targetId: target.user_id,
      targetUsername,
      targetFirstName: target.first_name,
      mode: isRemoveAll ? 'remove_all_item' : 'remove',
      itemId: item.id,
      itemName: item.name,
      itemEmoji: item.emoji,
      requestedQty: isRemoveAll ? currentQty : parseInt(amountArg, 10),
      removeQty,
      currentQty
    });

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `voiditem:no:${token}:${callerId}`)
      .text('✅ Confirm', `voiditem:yes:${token}:${callerId}`);

    return ctx.reply(
      `⚠️ <b>CONFIRM ITEM VOID</b>\n\n` +
      `👤 <b>Target:</b> @${sanitizeHtml(targetUsername)} (<code>${target.user_id}</code>)\n` +
      `📦 <b>Item:</b> ${item.emoji} <b>${sanitizeHtml(item.name)}</b> (<code>${item.id}</code>)\n` +
      `🎒 <b>Current Owned:</b> <b>${currentQty.toLocaleString('en-US')}x</b>\n` +
      `💥 <b>Will Remove:</b> <b>-${removeQty.toLocaleString('en-US')}x</b>\n` +
      `📊 <b>Projected Remaining:</b> <b>${projectedRemaining.toLocaleString('en-US')}x</b>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    if (!isAuthorizedOwner(ctx)) {
      return ctx.answerCallbackQuery({ text: '❌ Unauthorized.', show_alert: true }).catch(() => {});
    }

    const parts = ctx.callbackQuery.data.split(':');
    const action = parts[1];
    const token = parts[2];
    const ownerId = Number(parts[3]);

    if (ctx.from.id !== ownerId) {
      return ctx.answerCallbackQuery({ text: "🚫 This isn't your confirmation!", show_alert: true }).catch(() => {});
    }

    const pending = getConfirmation(token);
    if (!pending || pending.callerId !== ownerId) {
      await ctx.editMessageText('⏳ This confirmation has expired. Please run <code>/voiditem</code> again.', { parse_mode: 'HTML' }).catch(() => {});
      return ctx.answerCallbackQuery({ text: 'Confirmation expired.' }).catch(() => {});
    }

    if (action === 'no') {
      deleteConfirmation(token);
      await ctx.editMessageText('❌ Void item action cancelled.', { parse_mode: 'HTML' });
      return ctx.answerCallbackQuery({ text: 'Cancelled.' }).catch(() => {});
    }

    if (action !== 'yes') {
      return ctx.answerCallbackQuery().catch(() => {});
    }

    consumeConfirmation(token);

    if (pending.mode === 'wipe_all') {
      await inventoryRepo.clearInventory(pending.targetId);
      await ctx.editMessageText(
        `💥 <b>INVENTORY WIPED:</b> Permanently cleared all items from @${sanitizeHtml(pending.targetUsername)}'s inventory.`,
        { parse_mode: 'HTML' }
      );
      return ctx.answerCallbackQuery({ text: 'Inventory wiped.' }).catch(() => {});
    }

    if (pending.mode === 'set') {
      await inventoryRepo.setItem(pending.targetId, pending.itemId, pending.exactAmount);
      await ctx.editMessageText(
        `⚖️ <b>INVENTORY SET SUCCESSFUL:</b> Set @${sanitizeHtml(pending.targetUsername)}'s ${pending.itemEmoji} <b>${sanitizeHtml(pending.itemName)}</b> to <b>${pending.exactAmount.toLocaleString('en-US')}x</b>.`,
        { parse_mode: 'HTML' }
      );
      return ctx.answerCallbackQuery({ text: 'Inventory updated.' }).catch(() => {});
    }

    // remove or remove_all_item
    const freshQty = await inventoryRepo.getItem(pending.targetId, pending.itemId);
    const actualRemove = pending.mode === 'remove_all_item'
      ? freshQty
      : Math.min(freshQty, pending.requestedQty);
    const remainingQty = Math.max(0, freshQty - actualRemove);

    await inventoryRepo.setItem(pending.targetId, pending.itemId, remainingQty);

    await ctx.editMessageText(
      `💥 <b>ITEM VOID SUCCESSFUL:</b> Removed <b>${actualRemove.toLocaleString('en-US')}x</b> ${pending.itemEmoji} <b>${sanitizeHtml(pending.itemName)}</b> from @${sanitizeHtml(pending.targetUsername)}.\n` +
      `(Remaining: <b>${remainingQty.toLocaleString('en-US')}x</b>)`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCallbackQuery({ text: 'Items voided.' }).catch(() => {});
  }
};

export default voiditem;
