import userRepo from '../database/userRepo.js';
import inventoryRepo from '../database/inventoryRepo.js';
import { randomBetween } from './formatters.js';

export async function getLuckBreakdown(userId) {
  const user = await userRepo.getUser(userId);
  const customLuck = user ? Number(user.custom_luck || 0) : 0;
  const hasHorseshoe = await inventoryRepo.hasBuff(userId, 'horseshoe');
  const isPremium = user ? Number(user.premium_until || 0) > Date.now() : false;

  const horseshoeBonus = hasHorseshoe ? 15 : 0;
  const premiumBonus = isPremium ? 10 : 0;
  const totalBonus = customLuck + horseshoeBonus + premiumBonus;

  return {
    customLuck,
    hasHorseshoe,
    horseshoeBonus,
    isPremium,
    premiumBonus,
    totalBonus
  };
}

export async function getLuckBonus(userId) {
  const breakdown = await getLuckBreakdown(userId);
  return breakdown.totalBonus;
}

export async function getRareDropMultiplier(userId) {
  const totalLuck = await getLuckBonus(userId);
  return 1 + (totalLuck / 100);
}

export async function rollLuck(userId, min = 0, max = 100) {
  const bonus = await getLuckBonus(userId);
  const baseRoll = randomBetween(min, max);
  return baseRoll + bonus;
}

export async function checkDropChance(userId, baseProbability, maxCap = 0.95) {
  const multiplier = await getRareDropMultiplier(userId);
  const effectiveProb = Math.min(maxCap, baseProbability * multiplier);
  return Math.random() < effectiveProb;
}

export default {
  getLuckBreakdown,
  getLuckBonus,
  getRareDropMultiplier,
  rollLuck,
  checkDropChance
};
