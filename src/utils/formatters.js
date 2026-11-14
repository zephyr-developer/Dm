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

export function parseDuration(str) {
  if (!str || typeof str !== 'string') {
    return { isDurationToken: false, durationMs: null, label: 'Permanent' };
  }
  const clean = str.trim().toLowerCase();

  if (clean === 'perm' || clean === 'permanent' || clean === 'forever' || clean === 'inf' || clean === 'infinite') {
    return { isDurationToken: true, durationMs: null, label: 'Permanent' };
  }

  const match = clean.match(/^(\d+(?:\.\d+)?)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|y|yr|yrs|year|years)$/);
  if (!match) {
    return { isDurationToken: false, durationMs: null, label: 'Permanent' };
  }

  const value = parseFloat(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value <= 0) {
    return { isDurationToken: false, durationMs: null, label: 'Permanent' };
  }

  let multiplier = 0;
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
    multiplier = 60 * 1000;
  } else if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) {
    multiplier = 3600 * 1000;
  } else if (['d', 'day', 'days'].includes(unit)) {
    multiplier = 86400 * 1000;
  } else if (['w', 'wk', 'wks', 'week', 'weeks'].includes(unit)) {
    multiplier = 604800 * 1000;
  } else if (['y', 'yr', 'yrs', 'year', 'years'].includes(unit)) {
    multiplier = 31536000 * 1000;
  }

  const durationMs = Math.floor(value * multiplier);
  if (durationMs <= 0) {
    return { isDurationToken: false, durationMs: null, label: 'Permanent' };
  }

  return {
    isDurationToken: true,
    durationMs,
    label: formatDurationMs(durationMs)
  };
}

export function formatDurationMs(ms) {
  const num = Math.max(0, Math.floor(Number(ms) || 0));
  if (!num) return 'Permanent';
  const totalSeconds = Math.max(1, Math.ceil(num / 1000));
  const totalHours = Math.round((num / 3600000) * 10) / 10;
  const days = Math.floor(totalSeconds / 86400);
  if (days >= 1 && num % 86400000 === 0) {
    return `${days} Day${days === 1 ? '' : 's'} (${Math.round(num / 3600000)}h)`;
  }
  if (totalSeconds >= 86400) {
    return `${formatTime(totalSeconds)} (${totalHours}h)`;
  }
  return formatTime(totalSeconds);
}

export default {
  formatCoins,
  formatNumber,
  progressBar,
  formatTime,
  parseDuration,
  formatDurationMs,
  randomBetween,
  pickRandom,
  sanitizeHtml,
  parseBet
};

