import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { sanitizeHtml } from '../../utils/formatters.js';
import { getAvailableTitles, resolveEffectiveTitle } from '../../utils/titleEngine.js';

export const title = {
  name: 'title',
  aliases: ['titles', 'settitle'],
  description: 'View and equip your unlocked Prestige, Special, and Custom profile titles',
  cooldown: 2,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);
    const inventory = await inventoryRepo.getUserInventory(userId);
    const { unlockedTitles } = getAvailableTitles(user, inventory);
    const equippedTitle = await resolveEffectiveTitle(user, inventory, { syncFallback: true });

    const rawInput = (
      (typeof ctx.match === 'string' && ctx.match.trim())
        ? ctx.match.trim()
        : (ctx.message?.text?.trim().split(/\s+/).slice(1).join(' ').trim() || '')
    );

    // Case 1: List equipped + unlocked titles
    if (!rawInput) {
      const listLines = unlockedTitles.map(t => {
        const isCurrent = t.toLowerCase() === equippedTitle.toLowerCase();
        return `${isCurrent ? '👑' : '✅'} <b>「 ${sanitizeHtml(t)} 」</b>${isCurrent ? ' <i>(Equipped)</i>' : ''}`;
      }).join('\n');

      return ctx.reply(
        `🏷️ <b>Profile Titles &amp; Accolades</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `👑 <b>Currently Equipped:</b> <b>「 ${sanitizeHtml(equippedTitle)} 」</b>\n\n` +
        `🔓 <b>Unlocked Titles (${unlockedTitles.length}):</b>\n` +
        `${listLines}\n\n` +
        `✨ <b>How to Unlock More Titles:</b>\n` +
        `• 🏆 <b>Prestige:</b> Every Prestige tier (1, 2, 3, ...) unlocks a unique Prestige title!\n` +
        `• 📿 <b>Special Item:</b> Hold <code>mjnecklace</code> to unlock <b>"MJune's Fav"</b>!\n` +
        `• 🏷️ <b>Custom Title:</b> Buy &amp; use <code>owntitle</code> (<code>/use owntitle &lt;name&gt;</code>) to craft your own!\n\n` +
        `💡 Type <code>/title &lt;title name&gt;</code> to equip any unlocked title!`,
        { parse_mode: 'HTML' }
      );
    }

    // Case 2: Equip a requested title (case-insensitive match)
    const queryLower = rawInput.toLowerCase();
    const matchedTitle = unlockedTitles.find(t => t.toLowerCase() === queryLower);

    if (!matchedTitle) {
      return ctx.reply(
        `❌ You haven't unlocked the title <b>"${sanitizeHtml(rawInput)}"</b>! Type <code>/title</code> to see your unlocked titles, or buy &amp; use an <b>🏷️ Own Title</b> item (<code>/use owntitle &lt;name&gt;</code>) to create a custom title!`,
        { parse_mode: 'HTML' }
      );
    }

    await userRepo.setEquippedTitle(userId, matchedTitle);

    return ctx.reply(
      `👑 <b>Title Equipped!</b> Your profile title is now <b>「 ${sanitizeHtml(matchedTitle)} 」</b>!`,
      { parse_mode: 'HTML' }
    );
  }
};

export default title;
