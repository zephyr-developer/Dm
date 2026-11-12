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

export function parseBet(input, wallet) {
  if (!input) return { valid: false, error: 'NO_INPUT', bet: 0 };
  const str = String(input).trim().toLowerCase();
  const currentWallet = Number(wallet || 0);

  if (str === 'all' || str === 'max') {
    if (currentWallet <= 0) {
      return { valid: false, error: 'NO_COINS', bet: 0 };
    }
    return { valid: true, bet: currentWallet };
  }

  if (str === 'half') {
    const half = Math.floor(currentWallet / 2);
    if (half <= 0) {
      return { valid: false, error: 'NO_COINS', bet: 0 };
    }
    return { valid: true, bet: half };
  }

  let num = NaN;
  if (str.endsWith('k')) {
    num = parseFloat(str.slice(0, -1)) * 1000;
  } else if (str.endsWith('m')) {
    num = parseFloat(str.slice(0, -1)) * 1000000;
  } else if (str.endsWith('b')) {
    num = parseFloat(str.slice(0, -1)) * 1000000000;
  } else if (str.endsWith('t')) {
    num = parseFloat(str.slice(0, -1)) * 1000000000000;
  } else {
    num = parseInt(str.replace(/[,_]/g, ''), 10);
  }

  if (isNaN(num) || num <= 0) {
    return { valid: false, error: 'INVALID_NUMBER', bet: 0 };
  }

  const bet = Math.floor(num);
  if (bet > currentWallet) {
    return { valid: false, error: 'INSUFFICIENT_FUNDS', bet };
  }

  return { valid: true, bet };
}

export default {
  formatCoins,
  formatNumber,
  progressBar,
  formatTime,
  randomBetween,
  pickRandom,
  sanitizeHtml,
  parseBet
};

