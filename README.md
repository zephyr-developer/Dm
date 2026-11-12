# 🐸 TeleMemer — 24/7 Telegram RPG & Economy Bot

**TeleMemer** is a production-ready, crash-proof Telegram RPG and Economy Bot inspired by Discord's famous *Dank Memer*. Built on **Node.js (ES Modules)**, **grammY**, and **PostgreSQL (`pg.Pool`)**, it provides enterprise-grade data persistence across cloud container restarts (Neon, Supabase, Render, Railway, AWS RDS) alongside a comprehensive **Financial Audit Logging Engine** (`/currencylog`).

---

## ⚡ 24/7 Anti-Sleep & Crash-Proofing Architecture

TeleMemer is engineered from the ground up for 24/7 high-availability and zero-downtime operation on cloud hosting providers (Render, Fly.io, Railway, Heroku, VPS):

1. **Native HTTP Keep-Alive Server (`node:http` on port 3000):**
   - Spins up a lightweight native server with `/health` and `/api/health` endpoints returning uptime, memory metrics, registered users, and active groups.
2. **Automated 4-Minute Anti-Sleep Self-Pinger:**
   - Detects `KEEP_ALIVE_URL` or `RENDER_EXTERNAL_URL` in environment variables and pings its own `/health` endpoint every 240,000ms (4 minutes), preventing cloud container spin-down.
3. **Graceful Error Recovery (`bot.catch`):**
   - Intercepts all grammY update errors (expired query callbacks, duplicate edit errors, Telegram API rate limits) without interrupting the polling loop.
4. **Global Process Crash Guards:**
   - Captures `unhandledRejection` and `uncaughtException` events to ensure unexpected network drops or socket resets never kill the process.
5. **Auto-Reconnection Loop:**
   - Starts polling with `drop_pending_updates: true` and exponential backoff retry logic, ensuring seamless reconnection if Telegram's API drops momentarily.
6. **Persistent PostgreSQL with Zero-Drop Policy:**
   - Connects using `DATABASE_URL` or `POSTGRES_URL` with SSL support. All table creations enforce strict `CREATE TABLE IF NOT EXISTS` semantics with automatic migration checks and zero `DROP TABLE` statements to eliminate any risk of data loss.

---

## 👑 Bot Owner & Underground Admin System (`@tzhunyuan`)

TeleMemer features a cloaked underground administration system reserved exclusively for the Bot Owner **`@tzhunyuan`** (and optional `OWNER_ID`):

- **Cloaked & Hidden:** Owner commands are omitted from public `/help` and `/flow` menus. If unauthorized users attempt to invoke them, the bot returns `"❌ Unknown command."` to keep their existence confidential.
- **Fair Play Enforcement:** Even as the Owner, `@tzhunyuan` respects standard/premium cooldowns during gameplay to preserve game balance and authentic progression.
- **Audit Inspection:** `@tzhunyuan` can inspect any player's `/currencylog` audit trail via reply or username.

### Secret Owner Commands:
- `/incluck <amount> [username|userId]` — Inject permanent or temporary custom luck boost into a player's profile (tilts drop rates, gambling rolls, and loot tables).
- `/generatecoin <amount> [username|userId]` — Mint coins directly into any player's wallet.
- `/givepremium <days> [username|userId]` — Grant VIP Premium Membership for a specified duration.
- `/removepremium [username|userId]` — Instantly revoke VIP Premium status.

---

## 💎 VIP Premium Membership System

Players with active Premium status enjoy significant quality-of-life benefits:

| Feature | Standard Players | 💎 Premium Members |
| :--- | :--- | :--- |
| **Command Cooldowns** | 100% of base cooldown | **50% shorter cooldowns** (minimum 3s) |
| **Luck Bonus** | Item buffs only | **+10% permanent passive luck** |
| **Daily Claims** | Base payout (🪙 5,000) | **2x Daily Payout (🪙 10,000)** |
| **Weekly Crates** | Standard supply drop | **2x Weekly Payout (🪙 50,000 + 2x Crates)** |
| **Monthly Milestones** | Standard milestone | **2x Monthly Payout (🪙 250,000 + 2x Trophies)** |
| **Profile & Leaderboard** | Standard badge | **💎 VIP Badge with time remaining** |

---

## 📁 Clean Architectural Layout

```text
telememer/
├── package.json                      # Scripts & dependencies (pg, grammy, dotenv)
├── .env.example                      # Configuration template (DATABASE_URL, BOT_TOKEN)
├── README.md                         # Handbook & BotFather documentation
├── src/
│   ├── index.js                      # HTTP keep-alive, crash guards & auto-launcher
│   ├── bot.js                        # grammY instance & dynamic category loader
│   ├── database/
│   │   ├── db.js                     # PostgreSQL connection pool & zero-drop schema initialization
│   │   ├── userRepo.js               # Centralized updateCoins transaction, CRUD & prestige
│   │   ├── currencyLogRepo.js        # Automated audit logging engine (pruned to 100 max)
│   │   ├── inventoryRepo.js          # Backpack items & active buff timers
│   │   └── cooldownRepo.js           # Cooldown management with 50% Premium reduction
│   ├── config/
│   │   ├── items.js                  # 24 items, drop rates, recipes & valuations
│   │   └── jobs.js                   # 5 career paths, salaries & work shift memory games
│   ├── middlewares/
│   │   ├── registerUser.js           # Upserts users & group chat relationships
│   │   ├── cooldownGuard.js          # Atomic command rate-limiting guard
│   │   └── ownerGuard.js             # Strict @tzhunyuan authorization verification
│   ├── utils/
│   │   ├── deathEngine.js            # Life Saver sacrifice, coin penalties & Apple protection
│   │   ├── levelEngine.js            # XP curve, level-up announcements & bank bonuses
│   │   ├── luckEngine.js             # Total luck computation (Horseshoe, Clover, VIP, Owner)
│   │   └── formatters.js             # Coin formatting, progress bars & time humanizer
│   └── commands/
│       ├── owner/                    # /incluck, /generatecoin, /givepremium, /removepremium
│       ├── economy/                  # /balance, /currencylog, /deposit, /withdraw, /daily, /weekly, /monthly, /work, /leaderboard
│       ├── grind/                    # /beg, /search, /crime, /dig, /hunt, /fish, /postmemes, /flow
│       ├── items/                    # /shop, /buy, /sell, /inventory, /use, /craft
│       ├── pvp/                      # /rob, /bankrob, /give
│       ├── gambling/                 # /blackjack, /highlow, /slots, /scratch
│       └── progression/              # /profile, /prestige
```

---

## 🎮 Complete Master Command Reference (36 Commands)

### 1. Underground Owner Commands (`@tzhunyuan` only)
| Command | Usage | Description |
| :--- | :--- | :--- |
| `/incluck` | `/incluck <percentage> [user]` | Grant custom percentage luck boost to user |
| `/generatecoin` | `/generatecoin <amount> [user]` | Mint coins directly into wallet |
| `/givepremium` | `/givepremium <days> [user]` | Grant VIP Premium status for X days |
| `/removepremium` | `/removepremium [user]` | Revoke VIP Premium status immediately |

### 2. Economy Commands
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/balance` | `/bal` | Instant | View wallet, bank vault capacity & net worth |
| `/currencylog` | `/clog`, `/transactions`, `/logs` | 10s / 5s | Interactive financial audit trail (Pagination, Gains/Losses filters) |
| `/deposit` | `/dep` | 5s / 3s | Deposit coins (`/dep <amt>`, `max`, `all`) |
| `/withdraw` | `/with` | 5s / 3s | Withdraw coins (`/with <amt>`, `max`, `all`) |
| `/daily` | None | 24h | Claim 24h paycheck with streak multipliers (2x for VIP) |
| `/weekly` | None | 7d | Weekly supply drop with Bank Note & Life Saver (2x for VIP) |
| `/monthly` | None | 30d | Massive monthly milestone payout with Pepe Coin (2x for VIP) |
| `/work` | None | 45m / 22.5m | Apply for jobs & play shift memory mini-game |
| `/leaderboard` | `/lb` | 5s / 3s | Wealth and level rankings (Group vs Global toggles) |

### 3. Grinding & Exploration Commands
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/flow` | None | Instant | **Persistent Single-Message Dashboard** (prevents group spam) |
| `/beg` | None | 25s / 12s | Beg eccentric NPCs for spare coins and rare items |
| `/search` | None | 30s / 15s | Search 3 random locations (Pockets, Dumpster, Discord, Bank) |
| `/crime` | None | 45s / 22s | High-stakes criminal deeds with arrest hazards |
| `/dig` | None | 35s / 17s | Requires Shovel. Excavate worms, fossils, and treasure |
| `/hunt` | None | 35s / 17s | Requires Rifle. Hunt wildlife with 1% Mythic Dragon drop |
| `/fish` | None | 35s / 17s | Requires Fishing Pole. Directional mini-game with 1% Kraken |
| `/postmemes` | `/pm` | 35s / 17s | Requires Laptop. Post viral memes for ad revenue |

### 4. Items & Shop Commands
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/shop` | None | 3s / 3s | Interactive paginated catalog with 1-click buy buttons |
| `/buy` | None | 3s / 3s | Buy items from the shop (`/buy <item> [qty]`) |
| `/sell` | None | 3s / 3s | Sell items or liquidate all backpack loot (`/sell all`) |
| `/inventory` | `/inv` | 3s / 3s | Paginated backpack with item details and valuations |
| `/use` | None | 2s / 2s | Consume items: Bank Notes, Padlocks, Landmines, Apples |
| `/craft` | None | 3s / 3s | Forge Adventure Tickets and legendary Pepe Trophies |

### 5. PvP & Social Commands
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/rob` | None | 2m / 1m | Pickpocket coins from players (defended by Padlocks/Landmines) |
| `/bankrob` | `/heist` | 5m / 2.5m | 45-second multi-player vault heist lobby (2-5 players) |
| `/give` | `/share`, `/pay`| 5s / 3s | Gift coins (5% burn tax) or transfer items to players |

### 6. Casino & Gambling Suite
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/blackjack` | `/bj` | 15s / 8s | Soft-17 Blackjack with Double Down (Max bet: 100k) |
| `/highlow` | `/hl` | 20s / 10s | Guess Higher, Lower, or Exact for 25k Jackpot |
| `/slots` | None | 10s / 5s | Spin reels for 25x Pepe Jackpot (luck boosts odds) |
| `/scratch` | None | 15s / 8s | 3x3 Scratchcard ticket (high luck eliminates skull hazard) |

### 7. Progression Commands
| Command | Aliases | Cooldown (Std / Prem) | Description |
| :--- | :--- | :--- | :--- |
| `/profile` | None | 3s / 3s | View level progress, job stats, VIP badge & toggle Passive Mode |
| `/prestige` | None | 10s / 5s | Reset level & coins for +100k permanent Bank Vault capacity |

---

## 🤖 Telegram BotFather Setup Instructions

### 1. Create the Bot
1. Open Telegram and search for **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. Choose a display name (e.g., `TeleMemer Bot`) and a unique username ending in `bot` (e.g., `TeleMemerRPG_bot`).
4. Copy the **HTTP API Token** provided by BotFather.

### 2. Disable Group Privacy Mode (CRITICAL)
Telegram bots in groups cannot read messages that start with `/` from regular members unless group privacy is disabled:
1. In `@BotFather`, send `/setprivacy`.
2. Select your bot.
3. Click **Disable**.

### 3. Register Command Autocomplete
Send `/setcommands` to `@BotFather`, pick your bot, and paste this list:
```text
flow - Persistent single-message grinding dashboard
bal - Check wallet, bank vault, and total net worth
currencylog - View your automated financial audit logs and transactions
dep - Deposit coins into your bank vault
with - Withdraw coins from your bank vault
daily - Claim your 24h paycheck and build streak
weekly - Claim your 7-day supply crate
monthly - Claim your 30-day milestone payout
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

## 🚀 Environment Configuration (`.env`)

```env
BOT_TOKEN="your_telegram_bot_token_here"
BOT_USERNAME="TeleMemerRPG_bot"
OWNER_USERNAME="tzhunyuan"
OWNER_ID=""
DATABASE_URL="postgres://postgres:password@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require"
PORT=3000
KEEP_ALIVE_URL=""
```

---

## 🏃 Launching the Bot

```bash
# Install dependencies
npm install

# Start the Telegram Bot & Keep-Alive HTTP Server
npm run bot
```
