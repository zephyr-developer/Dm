import userRepo from '../database/userRepo.js';
import inventoryRepo from '../database/inventoryRepo.js';
import { items, getCollectibleItemIds } from '../config/items.js';
import { formatCoins, randomBetween, pickRandom } from './formatters.js';

export async function handleDeath(ctx, userId, reason = 'a fatal accident') {
  // 1. Check if user has a Life Saver in inventory
  if (await inventoryRepo.hasItem(userId, 'lifesaver', 1)) {
    await inventoryRepo.removeItem(userId, 'lifesaver', 1);
    return {
      survived: true,
      coinsLost: 0,
      itemLost: null,
      message: `🛟 <b>Saved by the Bell!</b> You almost died from <i>${reason}</i>, but your <b>Life Saver</b> consumed itself to shield your soul! <i>(1x 🛟 Life Saver removed)</i>`
    };
  }

  // 2. Player died: calculate coin loss (30% to 60% of wallet)
  const user = await userRepo.getUser(userId);
  const currentWallet = user ? Number(user.wallet) : 0;
  let coinsLost = 0;

  if (currentWallet > 0) {
    const lossPercent = randomBetween(30, 60) / 100;
    coinsLost = Math.floor(currentWallet * lossPercent);
    await userRepo.updateCoins(userId, {
      walletDelta: -coinsLost,
      sourceCommand: '/death',
      details: `Succumbed to fatal accident: ${reason}`
    });
  }

  // 3. Check Apple buff: if active, prevent item loss!
  const hasAppleBuff = await inventoryRepo.hasBuff(userId, 'apple');
  let itemLost = null;

  if (!hasAppleBuff) {
    const collectibleIds = new Set(getCollectibleItemIds());
    const inventory = await inventoryRepo.getUserInventory(userId);
    const eligibleItems = inventory.filter(inv => !collectibleIds.has(inv.item_id) && inv.quantity > 0);

    if (eligibleItems.length > 0) {
      const chosen = pickRandom(eligibleItems);
      const itemConfig = items[chosen.item_id] || { name: chosen.item_id, emoji: '📦' };
      const lostQuantity = Math.min(chosen.quantity, randomBetween(1, 2));

      await inventoryRepo.removeItem(userId, chosen.item_id, lostQuantity);
      itemLost = {
        item_id: chosen.item_id,
        name: itemConfig.name,
        emoji: itemConfig.emoji,
        quantity: lostQuantity
      };
    }
  }

  // Construct death summary message
  let message = `💀 <b>YOU DIED!</b>\nYou succumbed to <i>${reason}</i>!\n`;
  message += `💸 <b>Coins Lost:</b> ${formatCoins(coinsLost)} (from your wallet)\n`;

  if (hasAppleBuff) {
    message += `🍎 Your <b>Apple</b> buff protected your items from being looted!\n`;
  } else if (itemLost) {
    message += `🎒 <b>Item Lost:</b> ${itemLost.quantity}x ${itemLost.emoji} <b>${itemLost.name}</b> was ruined in the tragedy.\n`;
  } else {
    message += `🎒 No items were lost because your backpack was empty.\n`;
  }

  message += `💡 <i>Tip: Keep a 🛟 Life Saver in your inventory or eat an 🍎 Apple to protect your assets!</i>`;

  return {
    survived: false,
    coinsLost,
    itemLost,
    message
  };
}

export default {
  handleDeath
};
