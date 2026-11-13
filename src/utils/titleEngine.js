import userRepo from '../database/userRepo.js';
import inventoryRepo from '../database/inventoryRepo.js';

export const PRESTIGE_TITLES = {
  1: 'Novice Grinder',
  2: 'Coin Hustler',
  3: 'Meme Apprentice',
  4: 'Vault Breaker',
  5: 'High Roller',
  6: 'Shadow Tycoon',
  7: 'Crypto Whale',
  8: 'Grand Sovereign',
  9: 'Mythic Demi-God',
  10: 'Immortal Meme God'
};

export function toRoman(num) {
  let n = Math.floor(Number(num) || 0);
  if (n <= 0) return '';
  const numerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let out = '';
  for (const [val, sym] of numerals) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}

export function getPrestigeTitleForLevel(prestigeLevel) {
  const p = Math.floor(Number(prestigeLevel) || 0);
  if (p <= 0) return null;
  if (PRESTIGE_TITLES[p]) return PRESTIGE_TITLES[p];
  return `Prestige ${toRoman(p)} Legend`;
}

export function inventoryHasItem(inventory, itemId) {
  if (!inventory) return false;
  if (Array.isArray(inventory)) {
    return inventory.some(entry => entry.item_id === itemId && Number(entry.quantity || 0) > 0);
  }
  if (inventory instanceof Map) {
    return Number(inventory.get(itemId) || 0) > 0;
  }
  if (typeof inventory === 'object') {
    return Number(inventory[itemId] || 0) > 0;
  }
  return false;
}

export function getAvailableTitles(user, inventory = []) {
  const unlocked = ['Newbie'];
  const seenLower = new Set(['newbie']);

  const addUnique = (title) => {
    if (!title || typeof title !== 'string') return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      unlocked.push(trimmed);
    }
  };

  // Special Item Title: owning at least 1x MJune's Necklace unlocks "MJune's Fav"
  const hasMjNecklace = inventoryHasItem(inventory, 'mjnecklace');
  if (hasMjNecklace) {
    addUnique("MJune's Fav");
  }

  // Prestige Level Titles: unlock ALL titles from Prestige 1 up to user.prestige
  const prestige = Math.max(0, Math.floor(Number(user?.prestige || 0)));
  for (let p = 1; p <= prestige; p++) {
    addUnique(getPrestigeTitleForLevel(p));
  }

  // Custom Title from Own Title consumable
  const customTitle = user?.custom_title ? String(user.custom_title).trim() : null;
  if (customTitle) {
    addUnique(customTitle);
  }

  return {
    unlockedTitles: unlocked,
    hasMjNecklace,
    prestigeCount: prestige,
    customTitle
  };
}

export async function resolveEffectiveTitle(user, inventory = null, { syncFallback = false } = {}) {
  if (!user) return 'Newbie';
  const equipped = user.equipped_title ? String(user.equipped_title).trim() : 'Newbie';
  if (!equipped) return 'Newbie';

  const inv = inventory !== null ? inventory : await inventoryRepo.getUserInventory(user.user_id);
  const { hasMjNecklace } = getAvailableTitles(user, inv);

  if (equipped.toLowerCase() === "mjune's fav" && !hasMjNecklace) {
    if (syncFallback) {
      await userRepo.setEquippedTitle(user.user_id, 'Newbie').catch(() => {});
    }
    return 'Newbie';
  }

  return equipped;
}

export default {
  PRESTIGE_TITLES,
  toRoman,
  getPrestigeTitleForLevel,
  inventoryHasItem,
  getAvailableTitles,
  resolveEffectiveTitle
};
