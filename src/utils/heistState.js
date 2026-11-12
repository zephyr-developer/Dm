// In-memory state tracking active heist locks
export const heistTargets = new Set();
export const heistParticipants = new Set();

/**
 * Remove target and participants from the active heist state
 * @param {number|string} targetId
 * @param {Array<number|string|object>} participantIdsArray
 */
export function clearHeistState(targetId, participantIdsArray = []) {
  if (targetId !== undefined && targetId !== null) {
    heistTargets.delete(Number(targetId));
    heistTargets.delete(String(targetId));
  }

  if (Array.isArray(participantIdsArray)) {
    for (const item of participantIdsArray) {
      if (item !== undefined && item !== null) {
        const id = typeof item === 'object' && item !== null ? (item.userId || item.id) : item;
        if (id !== undefined && id !== null) {
          heistParticipants.delete(Number(id));
          heistParticipants.delete(String(id));
        }
      }
    }
  }
}

export default {
  heistTargets,
  heistParticipants,
  clearHeistState
};
