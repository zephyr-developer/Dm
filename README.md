# 🐸 TeleMemer — Telegram RPG & Economy Bot

**TeleMemer** is a production-grade Telegram RPG and Economy Bot inspired by Discord's famous *Dank Memer*. Built on **Node.js (ES Modules)**, **grammY**, and **better-sqlite3**, it runs completely self-contained out-of-the-box with zero external database servers required.

---

## ⚡ Key Highlights & Architecture

1. **Strict File Separation:** Every command lives in its own dedicated file inside its category folder (`src/commands/<category>/<command>.js`).
2. **Dynamic Command & Callback Loader:** `src/bot.js` dynamically scans and registers all commands and associated inline button callbacks at startup.
3. **Persistent Single-Message Flow Dashboard (`/flow`):** A custom grinding dashboard that executes all grinding commands (`/beg`, `/search`, `/crime`, `/dig`, `/hunt`, `/fish`, `/pm`) via inline message edits, preventing Telegram's 20 msg/minute group chat rate limit.
4. **Button Ownership Lock:** All interactive callbacks encode the initiator's Telegram user ID (`callback:action:userId`). Attempts by other group members to hijack a player's active session trigger an alert popup (`"This isn't your game!"`).
5. **Death Engine:** Fatal accidents trigger a check for a 🛟 Life Saver to sacrifice itself. Without one, players lose 30%–60% of their wallet, and without an 🍎 Apple buff, loose items in their backpack can be plundered.
6. **Casino Suite:** Soft-17 Blackjack with Double Down, 3x3 Scratchcards with skull hazards, High-Low, and Slots with a 25x Pepe Jackpot.
7. **High-Performance SQLite:** Synchronous WAL (Write-Ahead Logging) mode using `better-sqlite3` provides sub-millisecond ACID transactions.

---

## 📁 Directory Structure

```text
telememer/
├── package.json                      # Scripts & dependencies
├── .env.example                      # Sample configuration template
├── README.md                         # This setup and user handbook
├── src/
│   ├── index.js                      # DB bootstrapping, API service, Bot launch
│   ├── bot.js                        # grammY instance & dynamic loader
│   ├── database/
│   │   ├── db.js                     # SQLite initialization & schema definitions
│   │   ├── userRepo.js               # CRUD transactions (Wallet, Bank, Net Worth)
│   │   ├── inventoryRepo.js          # Backpack items & 24h/30m active buffs
│   │   └── cooldownRepo.js           # Atomic cooldown verification
│   ├── config/
│   │   ├── items.js                  # Master catalog: 24 items, prices & recipes
│   │   └── jobs.js                   # Master career paths, salaries & required shifts
│   ├── middlewares/
│   │   ├── registerUser.js           # Auto-upserts users and group memberships
│   │   └── cooldownGuard.js          # Reusable rate-limiting guard
│   ├── utils/
│   │   ├── deathEngine.js            # Life Saver, coin penalty & Apple protection
│   │   ├── levelEngine.js            # XP curve, level celebrations & bank upgrades
│   │   └── formatters.js             # Currency, progress bars & time humanizer
│   └── commands/
│       ├── economy/
│       │   ├── balance.js            # /balance (/bal)
│       │   ├── deposit.js            # /deposit (/dep)
│       │   ├── withdraw.js           # /withdraw (/with)
│       │   ├── daily.js              # /daily
│       │   ├── work.js               # /work (list, apply, shift mini-game)
│       │   └── leaderboard.js        # /leaderboard (/lb)
│       ├── grind/
│       │   ├── beg.js                # /beg
│       │   ├── search.js             # /search
│       │   ├── crime.js              # /crime
│       │   ├── dig.js                # /dig
│       │   ├── hunt.js               # /hunt
│       │   ├── fish.js               # /fish
│       │   ├── postmemes.js          # /postmemes (/pm)
│       │   └── flow.js               # /flow (Persistent grinding action bar)
│       ├── items/
│       │   ├── shop.js               # /shop
│       │   ├── buy.js                # /buy
│       │   ├── sell.js               # /sell
│       │   ├── inventory.js          # /inventory (/inv)
│       │   ├── use.js                # /use
│       │   └── craft.js              # /craft
│       ├── pvp/
│       │   ├── rob.js                # /rob
│       │   ├── bankrob.js            # /bankrob (/heist)
│       │   └── give.js               # /give (/share, /pay)
│       ├── gambling/
│       │   ├── blackjack.js          # /blackjack (/bj)
│       │   ├── highlow.js            # /highlow (/hl)
│       │   ├── slots.js              # /slots
│       │   └── scratch.js            # /scratch
│       └── progression/
│           ├── profile.js            # /profile
│           └── prestige.js           # /prestige
```

---

## 🤖 Telegram BotFather Setup Instructions

### 1. Create Your Bot
1. Open Telegram and search for **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. Choose a display name (e.g., `TeleMemer Bot`) and a unique username ending in `bot` (e.g., `MyTeleMemer_bot`).
4. Copy the **HTTP API Token** provided by BotFather.

### 2. Configure Environment
Create a `.env` file in the root folder with:
```env
BOT_TOKEN="1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ"
BOT_USERNAME="MyTeleMemer_bot"
DATABASE_PATH="./telememer.sqlite"
PORT=3000
```

### 3. Disable Group Privacy Mode (CRITICAL)
In groups, Telegram restricts which messages bots can see unless privacy mode is disabled:
1. In `@BotFather`, send `/setprivacy`.
2. Select your bot.
3. Click **Disable**. (This allows the bot to listen to text commands without requiring `@BotUsername` every time).

### 4. Register Command Autocomplete
Send `/setcommands` to `@BotFather`, pick your bot, and paste this list:
```text
flow - Persistent single-message grinding dashboard
bal - Check wallet, bank vault, and total net worth
dep - Deposit coins into your bank vault
with - Withdraw coins from your bank vault
daily - Claim your 24h paycheck and build your streak
work - Apply for career positions and work shift mini-games
lb - View wealth and level leaderboards (Group & Global)
beg - Beg eccentric NPCs and passersby for spare change
search - Scavenge 12 locations for coins and secret items
crime - High-risk high-reward illicit acts
dig - Unearth worms, ants, and buried treasure with a shovel
hunt - Hunt wild boars, deer, and rare mythic dragons
fish - Reel in freshwater fish and abyssal krakens
pm - Post viral memes from your laptop for ad revenue
shop - Browse items, tools, defenses, and buffs
buy - Purchase items from the black market store
sell - Pawn items or liquidate all loot in your backpack
inv - Inspect owned items and total backpack valuation
use - Activate buffs, expand bank capacity, or drop coin bombs
craft - Forge tickets and rare trophies from collected loot
rob - Pickpocket coins from another player in group chat
bankrob - Assemble a 2-5 player crew for a vault heist
give - Transfer coins (5% tax) or items to another player
bj - Play soft-17 Blackjack against the dealer
hl - Guess higher, lower, or exact jackpot number
slots - Spin reels for 25x Pepe Jackpot
scratch - Scratch 3 mystery multiplier tiles on a lottery ticket
profile - View your level progress bar and toggle passive mode
prestige - Reset your progress for permanent prestige rank perks
```

---

## 🎮 Complete Master Command Reference

| Command | Category | Cooldown | Description |
| :--- | :--- | :--- | :--- |
| `/flow` | Grinding | Instant | Single-message grinding action bar |
| `/balance` (`/bal`) | Economy | None | Displays Wallet, Bank progress bar, Net Worth & Refresh |
| `/deposit` (`/dep`) | Economy | 5s | Deposits coins into bank vault (`/dep <amt>`, `max`, `all`) |
| `/withdraw` (`/with`) | Economy | 5s | Withdraws coins to wallet (`/with <amt>`, `max`, `all`) |
| `/daily` | Economy | 24h | Daily paycheck with streak multipliers & weekly Bank Note |
| `/work` | Economy | 45m | Career list, job applications & 3-emoji memory mini-game |
| `/leaderboard` (`/lb`) | Economy | 5s | Top 10 users with Group/Global and Coins/Level toggles |
| `/beg` | Grinding | 25s | Handouts from random NPCs with funny dialogue |
| `/search` | Grinding | 30s | 3 random locations with risk vs. reward loot |
| `/crime` | Grinding | 45s | High-stakes crime selector with large payouts & jail risks |
| `/dig` | Grinding | 35s | Requires Shovel (5% break chance) |
| `/hunt` | Grinding | 35s | Requires Rifle (5% break chance). 1% Mythic Dragon drop |
| `/fish` | Grinding | 35s | Requires Fishing Pole. Direction mini-game with 1% Kraken |
| `/postmemes` (`/pm`) | Grinding | 35s | Requires Laptop (35% rage break chance on downvote) |
| `/shop` | Items | 3s | Paginated catalog with one-click quick-buy buttons |
| `/buy` | Items | 3s | Purchase gear and consumables (`/buy <item> [qty]`) |
| `/sell` | Items | 3s | Liquidate items or run `/sell all` to sell all loot |
| `/inventory` (`/inv`) | Items | 3s | Paginated backpack with itemized resell valuations |
| `/use` | Items | 2s | Use Bank Notes, Padlocks, Landmines, Apples, or Coin Bombs |
| `/craft` | Items | 3s | Combine items into Adventure Tickets and Pepe Trophies |
| `/rob` | PvP | 2m | Rob a target's wallet (Landmine and Padlock defenses apply) |
| `/bankrob` (`/heist`)| PvP | 5m | 45-second multi-player lobby vault heist (2-5 players) |
| `/give` (`/pay`) | PvP | 5s | Send coins (5% burn tax) or gift items to other users |
| `/blackjack` (`/bj`) | Gambling | 3s | Soft-17 Blackjack with Double Down (Max bet: 100k) |
| `/highlow` (`/hl`) | Gambling | 20s | High/Low guessing game with 25,000 coin Jackpot match |
| `/slots` | Gambling | 5s | Slot machine with 25x Pepe Jackpot and 10x Diamonds |
| `/scratch` | Gambling | 5s | 3x3 Scratchcard ticket with 3 picks and Skull hazard |
| `/profile` | Progression | 3s | Full RPG card, active buffs, and Passive Mode toggle |
| `/prestige` | Progression | 10s | Reset level & coins for permanent +100k bank space |

---

## 🚀 Running the Bot

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the TeleMemer Bot
```bash
npm run bot
```

### 3. Production Deployment (e.g., Cloud Run, VPS, Docker)
```bash
npm start
```
The HTTP server automatically provides a live health check endpoint on `http://localhost:3000/api/health` displaying connected users, active groups, and economy metrics.
