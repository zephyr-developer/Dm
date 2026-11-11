import userRepo from '../database/userRepo.js';
import inventoryRepo from '../database/inventoryRepo.js';
import { randomBetween } from './formatters.js';

export function getLuckBreakdown(userId) {
  const user = userRepo.getUser(userId);
  const customLuck = user ? (user.custom_luck || 0) : 0;
  const hasHorseshoe = inventoryRepo.hasBuff(userId, 'horseshoe');
  const isPremium = user ? (user.premium_until || 0) > Date.now() : false;

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

export function getLuckBonus(userId) {
  return getLuckBreakdown(userId).totalBonus;
}

export function getRareDropMultiplier(userId) {
  const totalLuck = getLuckBonus(userId);
  // e.g. 50% luck -> 1.5x drop rate; 100% luck -> 2.0x drop rate; 500% luck -> 6.0x drop rate
  return 1 + (totalLuck / 100);
}

export function rollLuck(userId, min = 0, max = 100) {
  const bonus = getLuckBonus(userId);
  const baseRoll = randomBetween(min, max);
  return baseRoll + bonus;
}

export function checkDropChance(userId, baseProbability, maxCap = 0.95) {
  const multiplier = getRareDropMultiplier(userId);
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
