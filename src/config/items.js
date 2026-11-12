export const items = {
  // Tools
  shovel: {
    id: 'shovel',
    name: 'Shovel',
    emoji: '🪣',
    description: 'Required for /dig. 5% chance to break on use.',
    buyPrice: 25000,
    sellPrice: 5000,
    type: 'tool',
    breakChance: 0.05
  },
  rifle: {
    id: 'rifle',
    name: 'Hunting Rifle',
    emoji: '🔫',
    description: 'Required for /hunt. 5% chance to break on use.',
    buyPrice: 25000,
    sellPrice: 5000,
    type: 'tool',
    breakChance: 0.05
  },
  fishingpole: {
    id: 'fishingpole',
    name: 'Fishing Pole',
    emoji: '🎣',
    description: 'Required for /fish. 5% chance to break on failed catch.',
    buyPrice: 25000,
    sellPrice: 5000,
    type: 'tool',
    breakChance: 0.05
  },
  laptop: {
    id: 'laptop',
    name: 'Laptop',
    emoji: '💻',
    description: 'Required for /postmemes. 8% chance to break on downvoted post.',
    buyPrice: 20000,
    sellPrice: 4000,
    type: 'tool',
    breakChance: 0.08
  },

  // Defense & Buffs
  lifesaver: {
    id: 'lifesaver',
    name: 'Life Saver',
    emoji: '🛟',
    description: 'Protects you from losing coins/items upon death. Auto-consumed on fatal injury.',
    buyPrice: 50000,
    sellPrice: 10000,
    type: 'defense'
  },
  padlock: {
    id: 'padlock',
    name: 'Padlock',
    emoji: '🔒',
    description: 'Use to protect your wallet against 1 /rob attempt for 24h or until broken.',
    buyPrice: 15000,
    sellPrice: 3000,
    type: 'defense',
    buffType: 'padlock',
    buffDuration: 86400
  },
  landmine: {
    id: 'landmine',
    name: 'Landmine',
    emoji: '💣',
    description: 'Use to arm your wallet for 24h. 50% chance to kill whoever tries to rob you!',
    buyPrice: 20000,
    sellPrice: 4000,
    type: 'defense',
    buffType: 'landmine',
    buffDuration: 86400
  },
  vaultlock: {
    id: 'vaultlock',
    name: 'Vault Lock',
    emoji: '🏦',
    description: '/use: Protects your bank from 1 /bankrob attempt. Consumed upon use or broken during a heist.',
    buyPrice: 50000,
    sellPrice: 10000,
    type: 'defense',
    buffType: 'vaultlock',
    buffDuration: 86400
  },
  horseshoe: {
    id: 'horseshoe',
    name: 'Lucky Horseshoe',
    emoji: '🧲',
    description: 'Use for +15% extra luck on /beg, /search, /crime, /dig, /hunt, /fish for 30 minutes.',
    buyPrice: 35000,
    sellPrice: 7000,
    type: 'consumable',
    buffType: 'horseshoe',
    buffDuration: 1800
  },
  banknote: {
    id: 'banknote',
    name: 'Bank Note',
    emoji: '📜',
    description: 'Use to permanently expand your bank capacity by +15,000 to +30,000 coins.',
    buyPrice: 75000,
    sellPrice: 25000,
    type: 'consumable'
  },
  apple: {
    id: 'apple',
    name: 'Apple',
    emoji: '🍎',
    description: 'Use to prevent item loss on death for 24 hours. (You will only lose coins).',
    buyPrice: 15000,
    sellPrice: 3000,
    type: 'consumable',
    buffType: 'apple',
    buffDuration: 86400
  },

  // Loot & Craftables
  worm: {
    id: 'worm',
    name: 'Worm',
    emoji: '🪱',
    description: 'A wriggly little earthworm discovered while digging.',
    buyPrice: null,
    sellPrice: 500,
    type: 'loot'
  },
  ant: {
    id: 'ant',
    name: 'Ant',
    emoji: '🐜',
    description: 'A tiny industrious ant unearthed from the dirt.',
    buyPrice: null,
    sellPrice: 500,
    type: 'loot'
  },
  garbage: {
    id: 'garbage',
    name: 'Garbage',
    emoji: '🗑️',
    description: 'Recyclable junk. Used in crafting Adventure Tickets.',
    buyPrice: null,
    sellPrice: 250,
    type: 'loot'
  },
  coinbomb: {
    id: 'coinbomb',
    name: 'Coin Bomb',
    emoji: '💣',
    description: 'Use in a group chat! Drops 10k–50k total coins for the first 3 quick clickers.',
    buyPrice: 30000,
    sellPrice: 8000,
    type: 'consumable'
  },
  boar: {
    id: 'boar',
    name: 'Wild Boar',
    emoji: '🐗',
    description: 'Tough wilderness game caught while hunting.',
    buyPrice: null,
    sellPrice: 2500,
    type: 'loot'
  },
  deer: {
    id: 'deer',
    name: 'Majestic Deer',
    emoji: '🦌',
    description: 'A swift forest deer brought down with your rifle.',
    buyPrice: null,
    sellPrice: 4000,
    type: 'loot'
  },
  dragon: {
    id: 'dragon',
    name: 'Mythic Dragon',
    emoji: '🐉',
    description: 'Extremely rare mythic beast! Required to forge the legendary Pepe Trophy.',
    buyPrice: null,
    sellPrice: 35000,
    type: 'loot'
  },
  commonfish: {
    id: 'commonfish',
    name: 'Common Fish',
    emoji: '🐟',
    description: 'A standard fresh catch from the lake.',
    buyPrice: null,
    sellPrice: 1500,
    type: 'loot'
  },
  tropicalfish: {
    id: 'tropicalfish',
    name: 'Tropical Fish',
    emoji: '🐠',
    description: 'A vibrant coral reef swimmer. High market value.',
    buyPrice: null,
    sellPrice: 4500,
    type: 'loot'
  },
  kraken: {
    id: 'kraken',
    name: 'Abyssal Kraken',
    emoji: '🦑',
    description: 'Terrifying deep sea beast! 1% catch rate. Needed for Pepe Trophy.',
    buyPrice: null,
    sellPrice: 40000,
    type: 'loot'
  },
  ducttape: {
    id: 'ducttape',
    name: 'Duct Tape',
    emoji: '🩹',
    description: 'Fixes anything. Crucial crafting ingredient.',
    buyPrice: 10000,
    sellPrice: 2000,
    type: 'loot'
  },
  adventureticket: {
    id: 'adventureticket',
    name: 'Adventure Ticket',
    emoji: '🎟️',
    description: 'Pass for deep 3-stage /adventure expeditions. Can be purchased or crafted.',
    buyPrice: 25000,
    sellPrice: 15000,
    type: 'consumable',
    craftRecipe: {
      ducttape: 2,
      garbage: 5
    }
  },
  pepecoin: {
    id: 'pepecoin',
    name: 'Pepe Coin',
    emoji: '🪙',
    description: 'Solid gold rare collectible coin minted in the meme vaults.',
    buyPrice: 250000,
    sellPrice: 100000,
    type: 'collectible'
  },
  pepetrophy: {
    id: 'pepetrophy',
    name: 'Pepe Trophy',
    emoji: '🏆',
    description: 'The ultimate pinnacle of wealth and prestige. Preserved through resets.',
    buyPrice: 10000000,
    sellPrice: 5000000,
    type: 'collectible',
    craftRecipe: {
      pepecoin: 10,
      dragon: 1,
      kraken: 1
    }
  }
};

export function getItem(itemId) {
  if (!itemId) return null;
  return items[itemId.toLowerCase()] || null;
}

export function findItem(query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (items[q]) return items[q];

  // Try matching by id or name
  for (const item of Object.values(items)) {
    const cleanId = item.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanId === q || cleanName === q || cleanName.includes(q)) {
      return item;
    }
  }
  return null;
}

export function getAllItems() {
  return Object.values(items);
}

export function getBuyableItems() {
  return Object.values(items).filter(i => i.buyPrice !== null && i.buyPrice > 0);
}

export function getCraftableItems() {
  return Object.values(items).filter(i => !!i.craftRecipe);
}

export function getCollectibleItemIds() {
  return Object.values(items)
    .filter(i => i.type === 'collectible')
    .map(i => i.id);
}

export function getLootItems() {
  return Object.values(items).filter(i => i.type === 'loot');
}

export default items;
