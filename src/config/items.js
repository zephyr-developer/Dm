export const items = {
  // Tools
  shovel: {
    id: 'shovel',
    name: 'Shovel',
    emoji: '🪣',
    aliases: ['digshovel', 'spade'],
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
    aliases: ['huntingrifle', 'gun', 'hunt'],
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
    aliases: ['pole', 'rod', 'fishingrod', 'fishpole'],
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
    aliases: ['pc', 'computer', 'macbook'],
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
    aliases: ['ls', 'life', 'saver', 'totem'],
    description: 'Protects you from losing coins/items upon death. Auto-consumed on fatal injury.',
    buyPrice: 50000,
    sellPrice: 10000,
    type: 'defense'
  },
  padlock: {
    id: 'padlock',
    name: 'Padlock',
    emoji: '🔒',
    aliases: ['lock', 'pad'],
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
    aliases: ['mine', 'trap'],
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
    aliases: ['vault', 'vlock', 'banklock'],
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
    aliases: ['shoe', 'luckyhorseshoe', 'luck'],
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
    aliases: ['bn', 'bank', 'note'],
    description: 'Use to permanently expand your bank capacity by +15,000 to +30,000 coins.',
    buyPrice: 75000,
    sellPrice: 25000,
    type: 'consumable'
  },
  apple: {
    id: 'apple',
    name: 'Apple',
    emoji: '🍎',
    aliases: ['fruit', 'redapple'],
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
    aliases: ['worms', 'earthworm'],
    description: 'A wriggly little earthworm discovered while digging.',
    buyPrice: null,
    sellPrice: 500,
    type: 'loot'
  },
  ant: {
    id: 'ant',
    name: 'Ant',
    emoji: '🐜',
    aliases: ['ants', 'bug'],
    description: 'A tiny industrious ant unearthed from the dirt.',
    buyPrice: null,
    sellPrice: 500,
    type: 'loot'
  },
  garbage: {
    id: 'garbage',
    name: 'Garbage',
    emoji: '🗑️',
    aliases: ['trash', 'junk', 'rubbish'],
    description: 'Recyclable junk. Used in crafting Adventure Tickets.',
    buyPrice: null,
    sellPrice: 250,
    type: 'loot'
  },
  coinbomb: {
    id: 'coinbomb',
    name: 'Coin Bomb',
    emoji: '💣',
    aliases: ['bomb', 'cb'],
    description: 'Use in a group chat! Drops 10k–50k total coins for the first 3 quick clickers.',
    buyPrice: 30000,
    sellPrice: 8000,
    type: 'consumable'
  },
  boar: {
    id: 'boar',
    name: 'Wild Boar',
    emoji: '🐗',
    aliases: ['wildboar', 'pig', 'hog'],
    description: 'Tough wilderness game caught while hunting.',
    buyPrice: null,
    sellPrice: 2500,
    type: 'loot'
  },
  deer: {
    id: 'deer',
    name: 'Majestic Deer',
    emoji: '🦌',
    aliases: ['majesticdeer', 'buck', 'stag'],
    description: 'A swift forest deer brought down with your rifle.',
    buyPrice: null,
    sellPrice: 4000,
    type: 'loot'
  },
  dragon: {
    id: 'dragon',
    name: 'Mythic Dragon',
    emoji: '🐉',
    aliases: ['mythicdragon', 'drake', 'wyrm'],
    description: 'Extremely rare mythic beast! Required to forge the legendary Pepe Trophy.',
    buyPrice: null,
    sellPrice: 35000,
    type: 'loot'
  },
  commonfish: {
    id: 'commonfish',
    name: 'Common Fish',
    emoji: '🐟',
    aliases: ['fish', 'cfish', 'common'],
    description: 'A standard fresh catch from the lake.',
    buyPrice: null,
    sellPrice: 1500,
    type: 'loot'
  },
  tropicalfish: {
    id: 'tropicalfish',
    name: 'Tropical Fish',
    emoji: '🐠',
    aliases: ['tfish', 'tropical', 'clownfish'],
    description: 'A vibrant coral reef swimmer. High market value.',
    buyPrice: null,
    sellPrice: 4500,
    type: 'loot'
  },
  kraken: {
    id: 'kraken',
    name: 'Abyssal Kraken',
    emoji: '🦑',
    aliases: ['abyssalkraken', 'squid', 'leviathan'],
    description: 'Terrifying deep sea beast! 1% catch rate. Needed for Pepe Trophy.',
    buyPrice: null,
    sellPrice: 40000,
    type: 'loot'
  },
  ducttape: {
    id: 'ducttape',
    name: 'Duct Tape',
    emoji: '🩹',
    aliases: ['tape', 'duct'],
    description: 'Fixes anything. Crucial crafting ingredient.',
    buyPrice: 10000,
    sellPrice: 2000,
    type: 'loot'
  },
  adventureticket: {
    id: 'adventureticket',
    name: 'Adventure Ticket',
    emoji: '🎟️',
    aliases: ['adv', 'advticket', 'ticket'],
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
    aliases: ['pcoin', 'pepe', 'coin'],
    description: 'Solid gold rare collectible coin minted in the meme vaults.',
    buyPrice: 250000,
    sellPrice: 100000,
    type: 'collectible'
  },
  pepetrophy: {
    id: 'pepetrophy',
    name: 'Pepe Trophy',
    emoji: '🏆',
    aliases: ['trophy', 'peptrophy', 'pt'],
    description: 'The ultimate pinnacle of wealth and prestige. Preserved through resets.',
    buyPrice: 10000000,
    sellPrice: 5000000,
    type: 'collectible',
    prestigeKeep: true,
    craftRecipe: {
      pepecoin: 10,
      dragon: 1,
      kraken: 1
    }
  },
  zyloveletter: {
    id: 'zyloveletter',
    name: "ZYuan's Love Letter",
    emoji: '💌',
    aliases: ['zy', 'loveletter', 'letter', 'zyuan'],
    buyPrice: 200000000000,
    sellPrice: 20,
    type: 'collectible',
    prestigeKeep: true,
    stockLimit: 1,
    stockPeriod: 'weekly',
    description: 'An ultra-rare, heartfelt love letter from ZYuan. Kept after Prestige! (Limited: 1 per week)'
  },
  mjnecklace: {
    id: 'mjnecklace',
    name: "MJune's Necklace",
    emoji: '📿',
    aliases: ['mj', 'necklace', 'mjune'],
    buyPrice: 200000000000,
    sellPrice: 20,
    type: 'collectible',
    prestigeKeep: true,
    stockLimit: 1,
    stockPeriod: 'weekly',
    description: "MJune's dazzling signature necklace. Kept after Prestige! (Limited: 1 per week)"
  },
  gtkcondom: {
    id: 'gtkcondom',
    name: 'GTK Brand Condom',
    emoji: '🎈',
    aliases: ['gtk', 'condom', 'balloon'],
    buyPrice: 20000000000,
    sellPrice: 20,
    type: 'consumable',
    prestigeKeep: true,
    stockLimit: 1,
    stockPeriod: 'daily',
    description: '/use to immediately gain +10 Levels! Kept after Prestige! (Limited: 1 per day)'
  }
};

export function getItem(itemId) {
  if (!itemId) return null;
  return items[itemId.toLowerCase()] || null;
}

export function findItem(query) {
  if (!query) return null;
  const rawLower = String(query).trim().toLowerCase();
  const q = rawLower.replace(/[^a-z0-9]/g, '');
  if (!q) return null;

  if (items[q]) return items[q];

  const allItems = Object.values(items);

  // 1. Exact ID or exact alias match
  for (const item of allItems) {
    const cleanId = item.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanId === q) return item;
    if (Array.isArray(item.aliases)) {
      for (const alias of item.aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (alias.toLowerCase() === rawLower || cleanAlias === q) {
          return item;
        }
      }
    }
  }

  // 2. Exact name match
  for (const item of allItems) {
    const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (item.name.toLowerCase() === rawLower || cleanName === q) {
      return item;
    }
  }

  // 3. Prefix match on id, name, or aliases
  for (const item of allItems) {
    const cleanId = item.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanId.startsWith(q) || cleanName.startsWith(q)) {
      return item;
    }
    if (Array.isArray(item.aliases) && item.aliases.some(a => a.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q))) {
      return item;
    }
  }

  // 4. Case-insensitive substring match on id, name, or aliases
  for (const item of allItems) {
    const cleanId = item.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanId.includes(q) || cleanName.includes(q)) {
      return item;
    }
    if (Array.isArray(item.aliases) && item.aliases.some(a => a.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))) {
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

export function getPrestigeKeepItemIds() {
  return Object.values(items)
    .filter(i => i.type === 'collectible' || i.prestigeKeep === true)
    .map(i => i.id);
}

export function getLootItems() {
  return Object.values(items).filter(i => i.type === 'loot');
}

export default items;
