import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { getCraftableItems, getItem, findItem, items } from '../../config/items.js';
import { formatCoins, sanitizeHtml } from '../../utils/formatters.js';

async function buildCraftMenu(userId) {
  const craftables = getCraftableItems();
  let text = `🔨 <b>TeleMemer Forge & Crafting Workshop</b>\n` +
    `Combine items from your travels to forge rare items and collectibles.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const keyboard = new InlineKeyboard();

  for (const c of craftables) {
    let canCraft = true;
    const recipeDetails = [];

    for (const [matId, reqQty] of Object.entries(c.craftRecipe)) {
      const owned = await inventoryRepo.getItem(userId, matId);
      const matItem = items[matId] || { name: matId, emoji: '📦' };
      const status = owned >= reqQty ? '✅' : '❌';
      recipeDetails.push(`${status} ${matItem.emoji} ${matItem.name}: <b>${owned}/${reqQty}</b>`);
      if (owned < reqQty) canCraft = false;
    }

    text += `${c.emoji} <b>${c.name}</b> (<code>${c.id}</code>)\n` +
      `• Sell Value: ${formatCoins(c.sellPrice)}\n` +
      `• <b>Recipe:</b>\n  ${recipeDetails.join('\n  ')}\n\n`;

    const buttonLabel = canCraft ? `🔨 Craft 1x ${c.name}` : `🔒 ${c.name} (Missing Mats)`;
    keyboard.text(buttonLabel, `craft:make:${c.id}:${userId}`).row();
  }

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>To craft via text:</i> <code>/craft &lt;item_id&gt;</code>`;

  return { text, keyboard };
}

function buildCraftConfirmation(item, userId) {
  const recipeLines = Object.entries(item.craftRecipe).map(([matId, reqQty]) => {
    const mat = items[matId] || { name: matId, emoji: '📦' };
    return `• ${reqQty}x ${mat.emoji} <b>${mat.name}</b>`;
  });

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', `craft:yes:${item.id}:1:${userId}`)
    .text('❌ Cancel', `craft:no:${userId}`);

  const text = `🔨 <b>Confirm Crafting</b>\n\n` +
    `You are about to forge: <b>1x ${item.emoji} ${item.name}</b>\n\n` +
    `<b>Materials Required:</b>\n${recipeLines.join('\n')}\n\n` +
    `<i>Proceed with forging this item?</i>`;

  return { text, keyboard };
}

export const craft = {
  name: 'craft',
  aliases: [],
  description: 'View crafting recipes and forge tickets and rare trophies with confirmation',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawInput = (ctx.match || '').trim() || ctx.message.text.trim().split(/\s+/).slice(1).join(' ').trim();

    if (!rawInput) {
      const { text, keyboard } = await buildCraftMenu(userId);
      return ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    const item = findItem(rawInput);
    if (!item || !item.craftRecipe) {
      return ctx.reply(
        `❌ "<b>${sanitizeHtml(rawInput)}</b>" is not a craftable item! Run <code>/craft</code> to see blueprints.`,
        { parse_mode: 'HTML' }
      );
    }

    // Verify materials
    for (const [matId, reqQty] of Object.entries(item.craftRecipe)) {
      const owned = await inventoryRepo.getItem(userId, matId);
      if (owned < reqQty) {
        const mat = items[matId] || { name: matId, emoji: '📦' };
        return ctx.reply(
          `🚫 <b>Missing Materials!</b>\n` +
          `You need <b>${reqQty}x</b> ${mat.emoji} <b>${mat.name}</b>, but you only have <b>${owned}x</b>.`,
          { parse_mode: 'HTML' }
        );
      }
    }

    // Send confirmation prompt (NO materials deducted yet)
    const { text, keyboard } = buildCraftConfirmation(item, userId);
    return ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your crafting session!",
        show_alert: true
      });
    }

    if (action === 'no') {
      await ctx.answerCallbackQuery({ text: 'Crafting cancelled.' });
      return ctx.editMessageText('❌ Transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    // Clicking a recipe button in the /craft menu prompts confirmation
    if (action === 'make') {
      const itemId = parts[2];
      const item = getItem(itemId);
      if (!item || !item.craftRecipe) {
        return ctx.answerCallbackQuery({ text: 'Recipe not found!', show_alert: true });
      }

      for (const [matId, reqQty] of Object.entries(item.craftRecipe)) {
        const owned = await inventoryRepo.getItem(targetUserId, matId);
        if (owned < reqQty) {
          const mat = items[matId] || { name: matId, emoji: '📦' };
          return ctx.answerCallbackQuery({
            text: `❌ Missing: ${reqQty - owned}x more ${mat.name}!`,
            show_alert: true
          });
        }
      }

      const { text, keyboard } = buildCraftConfirmation(item, targetUserId);
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(() => {});
    }

    // Confirmed crafting execution
    if (action === 'yes') {
      const itemId = parts[2];
      const item = getItem(itemId);
      if (!item || !item.craftRecipe) {
        await ctx.answerCallbackQuery({ text: 'Recipe not found!', show_alert: true });
        return ctx.editMessageText('❌ Transaction failed: Recipe not found.').catch(() => {});
      }

      for (const [matId, reqQty] of Object.entries(item.craftRecipe)) {
        const owned = await inventoryRepo.getItem(targetUserId, matId);
        if (owned < reqQty) {
          const mat = items[matId] || { name: matId, emoji: '📦' };
          await ctx.answerCallbackQuery({
            text: `❌ Missing: ${reqQty - owned}x more ${mat.name}!`,
            show_alert: true
          });
          return ctx.editMessageText(
            `🚫 <b>Crafting Failed: Missing Materials!</b>\n` +
            `You need <b>${reqQty}x</b> ${mat.emoji} <b>${mat.name}</b>, but only have <b>${owned}x</b>.`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }

      for (const [matId, reqQty] of Object.entries(item.craftRecipe)) {
        await inventoryRepo.removeItem(targetUserId, matId, reqQty);
      }
      await inventoryRepo.addItem(targetUserId, item.id, 1);

      await ctx.answerCallbackQuery({ text: `🔨 Forged 1x ${item.name}!` });
      return ctx.editMessageText(
        `🔨 <b>CRAFTING SUCCESSFUL!</b>\n` +
        `You forged <b>1x ${item.emoji} ${item.name}</b>!\n` +
        `Check your backpack with <code>/inv</code>.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default craft;
