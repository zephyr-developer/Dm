import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { getCraftableItems, getItem, findItem, items } from '../../config/items.js';
import { formatCoins } from '../../utils/formatters.js';

function buildCraftMenu(userId) {
  const craftables = getCraftableItems();
  let text = `🔨 <b>TeleMemer Forge & Crafting Workshop</b>\n` +
    `Combine items from your travels to forge rare items and collectibles.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const keyboard = new InlineKeyboard();

  craftables.forEach(c => {
    let canCraft = true;
    let recipeDetails = [];

    for (const [matId, reqQty] of Object.entries(c.craftRecipe)) {
      const owned = inventoryRepo.getItem(userId, matId);
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
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👉 <i>To craft via text:</i> <code>/craft &lt;item_id&gt;</code>`;

  return { text, keyboard };
}

export const craft = {
  name: 'craft',
  aliases: [],
  description: 'View crafting recipes and forge tickets and rare trophies',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    const itemQuery = args.join(' ');

    if (!itemQuery) {
      const { text, keyboard } = buildCraftMenu(userId);
      return ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    const item = findItem(itemQuery);
    if (!item || !item.craftRecipe) {
      return ctx.reply(
        `❌ "<b>${itemQuery}</b>" is not a craftable item! Run <code>/craft</code> to see blueprints.`,
        { parse_mode: 'HTML' }
      );
    }

    // Verify materials
    const recipe = item.craftRecipe;
    for (const [matId, reqQty] of Object.entries(recipe)) {
      const owned = inventoryRepo.getItem(userId, matId);
      if (owned < reqQty) {
        const mat = items[matId] || { name: matId, emoji: '📦' };
        return ctx.reply(
          `🚫 <b>Missing Materials!</b>\n` +
          `You need <b>${reqQty}x</b> ${mat.emoji} <b>${mat.name}</b>, but you only have <b>${owned}x</b>.`,
          { parse_mode: 'HTML' }
        );
      }
    }

    // Deduct materials and grant item
    for (const [matId, reqQty] of Object.entries(recipe)) {
      inventoryRepo.removeItem(userId, matId, reqQty);
    }
    inventoryRepo.addItem(userId, item.id, 1);

    return ctx.reply(
      `🔨 <b>CRAFTING SUCCESSFUL!</b>\n` +
      `You forged 1x ${item.emoji} <b>${item.name}</b>!\n` +
      `Check your backpack with <code>/inv</code>.`,
      { parse_mode: 'HTML' }
    );
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const itemId = parts[2];
    const targetUserId = Number(parts[3]);

    const item = getItem(itemId);
    if (!item || !item.craftRecipe) {
      return ctx.answerCallbackQuery({ text: 'Recipe not found!', show_alert: true });
    }

    const recipe = item.craftRecipe;
    for (const [matId, reqQty] of Object.entries(recipe)) {
      const owned = inventoryRepo.getItem(targetUserId, matId);
      if (owned < reqQty) {
        const mat = items[matId] || { name: matId, emoji: '📦' };
        return ctx.answerCallbackQuery({
          text: `❌ Missing: ${reqQty - owned}x more ${mat.name}!`,
          show_alert: true
        });
      }
    }

    // Deduct materials and grant item
    for (const [matId, reqQty] of Object.entries(recipe)) {
      inventoryRepo.removeItem(targetUserId, matId, reqQty);
    }
    inventoryRepo.addItem(targetUserId, item.id, 1);

    const { text, keyboard } = buildCraftMenu(targetUserId);
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    }).catch(() => {});

    await ctx.answerCallbackQuery({
      text: `🎉 Successfully crafted 1x ${item.name}!`,
      show_alert: true
    });
  }
};

export default craft;
