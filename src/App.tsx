/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Bot, 
  Coins, 
  Pickaxe, 
  ShoppingBag, 
  Swords, 
  Dices, 
  Sparkles, 
  ShieldCheck, 
  Terminal, 
  BookOpen, 
  ChevronRight,
  RefreshCw,
  Zap,
  Info
} from 'lucide-react';

interface ItemEntry {
  id: string;
  name: string;
  emoji: string;
  type: string;
  buyPrice: number | null;
  sellPrice: number;
  description: string;
  recipe?: string;
}

const CATALOG_ITEMS: ItemEntry[] = [
  { id: 'shovel', name: 'Shovel', emoji: '🪣', type: 'tool', buyPrice: 25000, sellPrice: 5000, description: 'Required for /dig. 5% chance to break on use.' },
  { id: 'rifle', name: 'Hunting Rifle', emoji: '🔫', type: 'tool', buyPrice: 25000, sellPrice: 5000, description: 'Required for /hunt. 5% chance to break on use.' },
  { id: 'fishingpole', name: 'Fishing Pole', emoji: '🎣', type: 'tool', buyPrice: 25000, sellPrice: 5000, description: 'Required for /fish. 5% break on failed catch.' },
  { id: 'laptop', name: 'Laptop', emoji: '💻', type: 'tool', buyPrice: 20000, sellPrice: 4000, description: 'Required for /postmemes. 8% break on downvote.' },
  { id: 'lifesaver', name: 'Life Saver', emoji: '🛟', type: 'defense', buyPrice: 50000, sellPrice: 10000, description: 'Auto-shields you from losing coins & items on death.' },
  { id: 'padlock', name: 'Padlock', emoji: '🔒', type: 'defense', buyPrice: 15000, sellPrice: 3000, description: 'Protects wallet against 1 /rob attempt (lasts 24h).' },
  { id: 'landmine', name: 'Landmine', emoji: '💣', type: 'defense', buyPrice: 20000, sellPrice: 4000, description: '50% chance to blow up and kill anyone robbing you (24h).' },
  { id: 'horseshoe', name: 'Lucky Horseshoe', emoji: '🧲', type: 'consumable', buyPrice: 35000, sellPrice: 7000, description: '+15% luck bonus on all grinding commands for 30m.' },
  { id: 'banknote', name: 'Bank Note', emoji: '📜', type: 'consumable', buyPrice: 75000, sellPrice: 25000, description: 'Permanently increases bank capacity by +15,000 to +30,000.' },
  { id: 'apple', name: 'Apple', emoji: '🍎', type: 'consumable', buyPrice: 15000, sellPrice: 3000, description: 'Protects all inventory items from loss on death for 24h.' },
  { id: 'worm', name: 'Worm', emoji: '🪱', type: 'loot', buyPrice: null, sellPrice: 500, description: 'Discovered while digging. Common bait.' },
  { id: 'ant', name: 'Ant', emoji: '🐜', type: 'loot', buyPrice: null, sellPrice: 500, description: 'Tiny critter found in topsoil.' },
  { id: 'garbage', name: 'Garbage', emoji: '🗑️', type: 'loot', buyPrice: null, sellPrice: 250, description: 'Recyclable junk. Used to craft Adventure Tickets.' },
  { id: 'coinbomb', name: 'Coin Bomb', emoji: '💣', type: 'consumable', buyPrice: 30000, sellPrice: 8000, description: 'Drops 10k–50k coins in chat for the first 3 clickers!' },
  { id: 'boar', name: 'Wild Boar', emoji: '🐗', type: 'loot', buyPrice: null, sellPrice: 2500, description: 'Tough wilderness game brought down with rifle.' },
  { id: 'deer', name: 'Majestic Deer', emoji: '🦌', type: 'loot', buyPrice: null, sellPrice: 4000, description: 'Swift forest game with high market value.' },
  { id: 'dragon', name: 'Mythic Dragon', emoji: '🐉', type: 'loot', buyPrice: null, sellPrice: 35000, description: '1% rare hunt drop! Required for Pepe Trophy.' },
  { id: 'commonfish', name: 'Common Fish', emoji: '🐟', type: 'loot', buyPrice: null, sellPrice: 1500, description: 'Standard lake catch with fishing pole.' },
  { id: 'tropicalfish', name: 'Tropical Fish', emoji: '🐠', type: 'loot', buyPrice: null, sellPrice: 4500, description: 'Vibrant exotic fish from deep waters.' },
  { id: 'kraken', name: 'Abyssal Kraken', emoji: '🦑', type: 'loot', buyPrice: null, sellPrice: 40000, description: '1% rare catch! Key ingredient for Pepe Trophy.' },
  { id: 'ducttape', name: 'Duct Tape', emoji: '🩹', type: 'loot', buyPrice: 10000, sellPrice: 2000, description: 'Crafting material for tickets and repairs.' },
  { id: 'adventureticket', name: 'Adventure Ticket', emoji: '🎟️', type: 'consumable', buyPrice: null, sellPrice: 15000, description: 'High value expedition pass.', recipe: '2x Duct Tape + 5x Garbage' },
  { id: 'pepecoin', name: 'Pepe Coin', emoji: '🪙', type: 'collectible', buyPrice: 250000, sellPrice: 100000, description: 'Rare golden collectible minted in meme vaults.' },
  { id: 'pepetrophy', name: 'Pepe Trophy', emoji: '🏆', type: 'collectible', buyPrice: 10000000, sellPrice: 5000000, description: 'Ultimate trophy. Preserved through prestige resets.', recipe: '10x Pepe Coin + 1x Dragon + 1x Kraken' }
];

const CAREERS = [
  { id: 'janitor', name: 'Janitor', emoji: '🧹', salary: 8000, shifts: 0, desc: 'Entry-level cleaning. 5% item drop: Garbage or Duct Tape.' },
  { id: 'cook', name: 'Fast Food Cook', emoji: '🍔', salary: 12000, shifts: 5, desc: 'Flip burgers, fry chips. 5% item drop: Apple.' },
  { id: 'mod', name: 'Discord Mod', emoji: '🛡️', salary: 18000, shifts: 15, desc: 'Ban trolls and raiders. 5% item drop: Laptop or Worm.' },
  { id: 'crypto', name: 'Crypto Bro', emoji: '📈', salary: 28000, shifts: 30, desc: 'Stare at candlestick charts. 5% item drop: Coin Bomb or Pepe Coin.' },
  { id: 'ceo', name: 'Meme CEO', emoji: '👑', salary: 45000, shifts: 60, desc: 'Shitpost on X, pump tokens. 5% item drop: Bank Note or Pepe Coin.' }
];

const ALL_COMMANDS = [
  { name: 'flow', category: 'grind', cooldown: 'Instant', desc: 'Persistent single-message grinding action bar' },
  { name: 'balance', aliases: 'bal', category: 'economy', cooldown: 'None', desc: 'View wallet, bank progress bar, and total net worth' },
  { name: 'deposit', aliases: 'dep', category: 'economy', cooldown: '5s', desc: 'Deposit coins into bank vault (/dep <amt>, max, all)' },
  { name: 'withdraw', aliases: 'with', category: 'economy', cooldown: '5s', desc: 'Withdraw coins from bank vault (/with <amt>, max, all)' },
  { name: 'daily', aliases: '', category: 'economy', cooldown: '24h', desc: 'Claim daily paycheck with streak bonus and weekly Bank Note' },
  { name: 'work', aliases: '', category: 'economy', cooldown: '45m', desc: 'Career list, applications, and 3-emoji memory shift mini-game' },
  { name: 'leaderboard', aliases: 'lb', category: 'economy', cooldown: '5s', desc: 'Top 10 players with Group/Global and Coins/Level toggles' },
  { name: 'beg', aliases: '', category: 'grind', cooldown: '25s', desc: 'Ask quirky NPCs and billionaires for handouts' },
  { name: 'search', aliases: '', category: 'grind', cooldown: '30s', desc: 'Scavenge 12 locations for coins with death risk & item drops' },
  { name: 'crime', aliases: '', category: 'grind', cooldown: '45s', desc: 'High-risk crimes with big payouts and jail/fatality checks' },
  { name: 'dig', aliases: '', category: 'grind', cooldown: '35s', desc: 'Dig for worms, ants, and treasure (requires Shovel)' },
  { name: 'hunt', aliases: '', category: 'grind', cooldown: '35s', desc: 'Hunt boars, deer, and 1% Mythic Dragon (requires Rifle)' },
  { name: 'fish', aliases: '', category: 'grind', cooldown: '35s', desc: 'Catch fish and 1% Abyssal Kraken (requires Fishing Pole)' },
  { name: 'postmemes', aliases: 'pm', category: 'grind', cooldown: '35s', desc: 'Post OC memes for ad revenue (requires Laptop)' },
  { name: 'shop', aliases: '', category: 'items', cooldown: '3s', desc: 'Paginated shop catalog with one-click quick buy' },
  { name: 'buy', aliases: '', category: 'items', cooldown: '3s', desc: 'Purchase items from store (/buy <item> [quantity])' },
  { name: 'sell', aliases: '', category: 'items', cooldown: '3s', desc: 'Sell items or run /sell all to liquidate all loot' },
  { name: 'inventory', aliases: 'inv', category: 'items', cooldown: '3s', desc: 'Paginated backpack with itemized resell valuations' },
  { name: 'use', aliases: '', category: 'items', cooldown: '2s', desc: 'Activate buffs, expand bank capacity, or drop coin bombs' },
  { name: 'craft', aliases: '', category: 'items', cooldown: '3s', desc: 'Forge tickets and rare trophies from collected materials' },
  { name: 'rob', aliases: '', category: 'pvp', cooldown: '2m', desc: 'Pickpocket other players in chat (Landmine/Padlock defenses)' },
  { name: 'bankrob', aliases: 'heist', category: 'pvp', cooldown: '5m', desc: 'Cooperative 2-5 player bank vault heist lobby' },
  { name: 'give', aliases: 'pay, share', category: 'pvp', cooldown: '5s', desc: 'Transfer coins (5% tax) or gift items to other users' },
  { name: 'blackjack', aliases: 'bj', category: 'gambling', cooldown: '3s', desc: 'Soft-17 Blackjack with Double Down (Max bet: 100k)' },
  { name: 'highlow', aliases: 'hl', category: 'gambling', cooldown: '20s', desc: 'Guess higher, lower, or exact 25,000 coin jackpot match' },
  { name: 'slots', aliases: '', category: 'gambling', cooldown: '5s', desc: 'Casino slots with 25x Pepe Jackpot and 10x Diamonds' },
  { name: 'scratch', aliases: '', category: 'gambling', cooldown: '5s', desc: '3x3 Scratchcard ticket with 3 picks and Skull hazard' },
  { name: 'profile', aliases: '', category: 'progression', cooldown: '3s', desc: 'View RPG card, active buffs, and toggle passive mode' },
  { name: 'prestige', aliases: '', category: 'progression', cooldown: '10s', desc: 'Ascend to higher rank for permanent +100k bank capacity' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'commands' | 'catalog' | 'jobs' | 'setup'>('overview');
  const [filterType, setFilterType] = useState<string>('all');
  const [commandCategory, setCommandCategory] = useState<string>('all');

  const filteredItems = filterType === 'all' 
    ? CATALOG_ITEMS 
    : CATALOG_ITEMS.filter(item => item.type === filterType);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🐸</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">TeleMemer</h1>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  v1.0.0 • Dank Memer for TG
                </span>
              </div>
              <p className="text-xs text-slate-400">Node.js + grammY + SQLite Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300 font-medium">Engine Ready</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full flex flex-col gap-8">
        
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'overview'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Bot className="w-4 h-4" /> Architecture & Spec
          </button>
          <button
            onClick={() => setActiveTab('commands')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'commands'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Terminal className="w-4 h-4" /> Commands ({ALL_COMMANDS.length})
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'catalog'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <ShoppingBag className="w-4 h-4" /> Item Catalog ({CATALOG_ITEMS.length})
          </button>
          <button
            onClick={() => setActiveTab('jobs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'jobs'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Coins className="w-4 h-4" /> Careers & Jobs ({CAREERS.length})
          </button>
          <button
            onClick={() => setActiveTab('setup')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'setup'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Terminal className="w-4 h-4" /> BotFather Setup
          </button>
        </div>

        {/* Tab 1: Overview & Architecture */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                    <span>Database Engine</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">better-sqlite3</div>
                  <p className="text-xs text-slate-400 mt-1">Zero latency local storage with WAL mode enabled.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-500 font-mono">
                  users, inventories, active_buffs, cooldowns
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                    <span>Bot Framework</span>
                    <Bot className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">grammY 1.x</div>
                  <p className="text-xs text-slate-400 mt-1">Modern TypeScript/ESM Telegram Bot framework.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-500 font-mono">
                  Dynamic Category & Callback Loader
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-slate-400 text-sm mb-2">
                    <span>Anti-Spam & Rate Limiting</span>
                    <Zap className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">Button Lock</div>
                  <p className="text-xs text-slate-400 mt-1">User ID validation on callback queries & in-place message edits.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-500 font-mono">
                  Telegram 20 msg/min group rate bypass
                </div>
              </div>
            </div>

            {/* Core Game Loop Highlights */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" /> TeleMemer Core Features & Mechanics
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-emerald-400 flex items-center gap-2 mb-1">
                    <span>⚡ /flow Command</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Single-message interactive grinding loop. Tap Beg, Search, Crime, Dig, Hunt, Fish, or Meme without spamming the chat.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-rose-400 flex items-center gap-2 mb-1">
                    <span>💀 Death Engine</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Failures can be fatal! Life Savers sacrifice themselves to save you, while Apples protect your backpack from being plundered.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-amber-400 flex items-center gap-2 mb-1">
                    <span>🥷 High-Stakes PvP & Heists</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Pickpocket other players or team up with up to 5 crew members in <code>/bankrob</code> to breach high-roller vault accounts.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-purple-400 flex items-center gap-2 mb-1">
                    <span>🎰 Full Casino Suite</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Hit soft-17 Blackjack with Double Down, 3x3 Multiplier Scratchcards, Slots with 25x Pepe Jackpots, and High-Low.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-blue-400 flex items-center gap-2 mb-1">
                    <span>⭐ Leveling & Prestige</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Earn XP with every action. Max out your level, reset with prestige, retain your Pepe Trophies, and gain massive permanent bank space.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <div className="font-semibold text-cyan-400 flex items-center gap-2 mb-1">
                    <span>🔨 Crafting & Tool Degradation</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Tools like shovels and hunting rifles have a 5% chance of wear-and-tear break. Combine loot into rare trophies and tickets.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Commands */}
        {activeTab === 'commands' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {['all', 'economy', 'grind', 'items', 'pvp', 'gambling', 'progression'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCommandCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      commandCategory === cat
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {cat === 'all' ? 'All (29)' : cat}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500">
                {ALL_COMMANDS.filter(c => commandCategory === 'all' || c.category === commandCategory).length} commands
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ALL_COMMANDS
                .filter(c => commandCategory === 'all' || c.category === commandCategory)
                .map(cmd => (
                  <div key={cmd.name} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <code className="text-sm font-bold text-emerald-400">/{cmd.name}</code>
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                          {cmd.category}
                        </span>
                      </div>
                      {cmd.aliases && (
                        <div className="text-[11px] text-slate-500 font-mono mb-2">
                          Aliases: {cmd.aliases.split(',').map(a => `/${a.trim()}`).join(', ')}
                        </div>
                      )}
                      <p className="text-xs text-slate-300 leading-relaxed">{cmd.desc}</p>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Cooldown:</span>
                      <span className="text-amber-400 font-medium font-mono">{cmd.cooldown}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Tab 2: Item Catalog */}
        {activeTab === 'catalog' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {['all', 'tool', 'defense', 'consumable', 'loot', 'collectible'].map(type => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      filterType === type
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500">Showing {filteredItems.length} items</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map(item => (
                <div key={item.id} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{item.emoji}</span>
                        <div>
                          <div className="font-semibold text-white text-sm">{item.name}</div>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                            {item.type}
                          </span>
                        </div>
                      </div>
                      <code className="text-xs text-slate-500">id: {item.id}</code>
                    </div>

                    <p className="text-xs text-slate-400 my-2">{item.description}</p>

                    {item.recipe && (
                      <div className="mt-2 text-xs bg-slate-950/80 p-2 rounded border border-slate-800 text-emerald-400">
                        🔨 <b>Craft Recipe:</b> {item.recipe}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-500">Buy: </span>
                      <span className="font-mono text-emerald-400 font-medium">
                        {item.buyPrice !== null ? `🪙 ${item.buyPrice.toLocaleString()}` : 'Unbuyable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Sell: </span>
                      <span className="font-mono text-amber-400 font-medium">
                        🪙 {item.sellPrice.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Careers & Jobs */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl text-xs text-slate-400 flex items-center gap-3">
              <Info className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span>
                Work shifts require completing a 3-emoji memory mini-game. Successful shifts yield full pay, shift progression, and 5% drop rates for job items.
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CAREERS.map(career => (
                <div key={career.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{career.emoji}</span>
                        <div>
                          <h3 className="text-base font-bold text-white">{career.name}</h3>
                          <span className="text-xs text-slate-400 font-mono">ID: {career.id}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-emerald-400 font-bold text-sm">🪙 {career.salary.toLocaleString()} / shift</div>
                        <div className="text-[11px] text-slate-500">{career.shifts} shifts required</div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">{career.desc}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Apply command:</span>
                    <code className="text-emerald-400 bg-slate-950 px-2 py-1 rounded">/work apply {career.id}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: BotFather Setup */}
        {activeTab === 'setup' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6 max-w-3xl mx-auto">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Terminal className="w-5 h-5 text-emerald-400" /> Telegram BotFather Configuration
            </h2>

            <div className="space-y-4 text-sm text-slate-300">
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                <h4 className="font-semibold text-white mb-1">Step 1: Create your bot token</h4>
                <p className="text-xs text-slate-400 mb-2">
                  Open Telegram, search for <code>@BotFather</code>, send <code>/newbot</code>, and follow the instructions to choose a name and username.
                </p>
                <div className="bg-slate-900 p-2.5 rounded font-mono text-xs text-emerald-300 border border-slate-800">
                  Use this token to access the HTTP API: 1234567890:ABCdef...
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                <h4 className="font-semibold text-white mb-1">Step 2: Add Token to .env</h4>
                <p className="text-xs text-slate-400 mb-2">
                  Create or edit your <code>.env</code> file in the project root:
                </p>
                <div className="bg-slate-900 p-2.5 rounded font-mono text-xs text-emerald-300 border border-slate-800">
                  BOT_TOKEN="your_token_here"<br />
                  BOT_USERNAME="YourBotName_bot"<br />
                  DATABASE_PATH="./telememer.sqlite"
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                <h4 className="font-semibold text-white mb-1">Step 3: Register Bot Commands in BotFather</h4>
                <p className="text-xs text-slate-400 mb-2">
                  Send <code>/setcommands</code> to @BotFather and paste this list for auto-complete:
                </p>
                <pre className="bg-slate-900 p-3 rounded font-mono text-xs text-slate-300 border border-slate-800 overflow-x-auto max-h-48">
{`flow - Single-message grinding action bar
bal - Check wallet, bank & net worth
dep - Deposit coins into bank
with - Withdraw coins from bank
daily - Claim daily coins and streak
work - Apply for jobs and work shifts
lb - View richest users in group or globally
beg - Beg for coins from random NPCs
search - Search locations for coins and loot
crime - High risk high reward illicit acts
dig - Unearth worms and treasure with shovel
hunt - Hunt wild boars and rare dragons
fish - Cast line and reel in fresh catches
pm - Post memes for viral rewards
shop - Browse items and buy gear
buy - Purchase an item from shop
sell - Sell items or all loot
inv - Inspect your inventory backpack
use - Consume a buff or deploy an item
craft - Combine items to forge rare collectibles
rob - Pickpocket another user in the chat
bankrob - Initiate a multi-player vault heist
give - Transfer coins or items to a friend
bj - Play Blackjack with soft-17 rules
hl - Guess higher or lower
slots - Spin slots for 25x Pepe jackpot
scratch - Scratch 3 mystery multipliers
profile - View stats, buffs & toggle passive
prestige - Reset for permanent prestige rank`}
                </pre>
              </div>

              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800">
                <h4 className="font-semibold text-white mb-1">Step 4: Enable Group Privacy & Inline Queries</h4>
                <p className="text-xs text-slate-400">
                  In @BotFather: send <code>/setprivacy</code> → choose <b>Disable</b> so your bot can register commands without needing <code>/cmd@BotName</code> in group chats.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-4 text-center text-xs text-slate-500">
        TeleMemer Engine • SQLite WAL mode • 100% complete architecture with zero placeholders
      </footer>
    </div>
  );
}
