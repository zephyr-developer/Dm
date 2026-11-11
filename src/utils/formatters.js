export function formatCoins(amount) {
  const num = Math.floor(Number(amount) || 0);
  return `🪙 ${num.toLocaleString('en-US')}`;
}

export function formatNumber(num) {
  return (Math.floor(Number(num) || 0)).toLocaleString('en-US');
}

export function progressBar(current, max, size = 10) {
  if (max <= 0) return `[${'🟩'.repeat(size)}] 100%`;
  const ratio = Math.max(0, Math.min(1, current / max));
  const filledCount = Math.round(ratio * size);
  const emptyCount = size - filledCount;

  const filledBar = '🟩'.repeat(filledCount);
  const emptyBar = '⬜'.repeat(emptyCount);
  const percent = Math.floor(ratio * 100);

  return `[${filledBar}${emptyBar}] ${percent}%`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  const remainingSecs = s % 60;
  if (minutes < 60) {
    return remainingSecs > 0 ? `${minutes}m ${remainingSecs}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sanitizeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default {
  formatCoins,
  formatNumber,
  progressBar,
  formatTime,
  randomBetween,
  pickRandom,
  sanitizeHtml
};
