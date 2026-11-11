export const jobs = {
  janitor: {
    id: 'janitor',
    name: 'Janitor',
    emoji: '🧹',
    salary: 8000,
    requiredShifts: 0,
    description: 'Sweep up dust, clean spills, and collect discarded treasures.',
    workDrop: ['garbage', 'ducttape']
  },
  cook: {
    id: 'cook',
    name: 'Fast Food Cook',
    emoji: '🍔',
    salary: 12000,
    requiredShifts: 5,
    description: 'Flip burgers, fry chips, and dodge oil burns under pressure.',
    workDrop: ['apple']
  },
  mod: {
    id: 'mod',
    name: 'Discord Mod',
    emoji: '🛡️',
    salary: 18000,
    requiredShifts: 15,
    description: 'Mute unruly raiders, type in #general 24/7, and protect the server.',
    workDrop: ['laptop', 'worm']
  },
  crypto: {
    id: 'crypto',
    name: 'Crypto Bro',
    emoji: '📈',
    salary: 28000,
    requiredShifts: 30,
    description: 'Stare at 1-minute candlestick charts and hype up volatile tokens.',
    workDrop: ['coinbomb', 'pepecoin']
  },
  ceo: {
    id: 'ceo',
    name: 'Meme CEO',
    emoji: '👑',
    salary: 45000,
    requiredShifts: 60,
    description: 'Post viral shitposts on X, crash stock tickers, and swim in fiat.',
    workDrop: ['banknote', 'pepecoin']
  }
};

export function getJob(jobId) {
  if (!jobId) return null;
  return jobs[jobId.toLowerCase()] || null;
}

export function findJob(query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (jobs[q]) return jobs[q];

  for (const job of Object.values(jobs)) {
    const cleanId = job.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = job.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanId === q || cleanName === q || cleanName.includes(q)) {
      return job;
    }
  }
  return null;
}

export function getAllJobs() {
  return Object.values(jobs);
}

export default jobs;
