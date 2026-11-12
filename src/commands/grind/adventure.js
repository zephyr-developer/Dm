import { InlineKeyboard } from 'grammy';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { addXp } from '../../utils/levelEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { items } from '../../config/items.js';
import { formatCoins, randomBetween, pickRandom, sanitizeHtml } from '../../utils/formatters.js';

// Predefined pool of diverse expedition encounters
export const ENCOUNTER_POOL = [
  {
    id: 'alien_cruiser',
    title: '🛸 Extraterrestrial Mothership',
    scenario: 'You beam aboard a drifting alien dreadnought in orbit. Heavy metallic footsteps echo as an armed squad of Zorgon plasma troopers marches down your corridor!',
    choices: [
      {
        text: '🔫 Blast Alien Squad',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 4000,
        maxCoins: 8500,
        dropItem: 'pepecoin',
        dropChance: 0.25,
        successText: '💥 <b>TACTICAL STRIKE!</b> You outflanked the patrol with laser fire, blew open their containment safe, and secured alien valuables!',
        failText: '💨 You fired wild shots and had to dive into a trash chute, escaping with zero loot.',
        disasterReason: 'vaporization by a Zorgon alien plasma blaster',
        disasterText: '⚡ The squad opened synchronized plasma fire and caught you dead to rights!'
      },
      {
        text: '🧪 Offer Cheesy Doritos',
        successChance: 0.80,
        disasterChance: 0.05,
        minCoins: 2500,
        maxCoins: 5500,
        dropItem: 'ducttape',
        dropChance: 0.40,
        successText: '👽 <b>CULTURAL EXCHANGE!</b> The aliens were mesmerized by your cheesy crunchy triangle crisps and traded you valuable spacecraft scrap!',
        failText: '🤢 The aliens found earth food repulsive and chased you out of the sector.',
        disasterReason: 'eating radioactive alien snacks that dissolved internal organs',
        disasterText: '☣️ They offered you an alien snack in return, but it proved fatally radioactive!'
      },
      {
        text: '🕳️ Crawl Air Vent',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1500,
        maxCoins: 3500,
        dropItem: null,
        dropChance: 0,
        successText: '🤫 <b>STEALTH INFILTRATION!</b> You quietly traversed the duct network and scavenged loose credits dropped by the maintenance staff.',
        failText: '🤧 You had an intense sneezing fit inside the dusty vent and barely scrambled back out.',
        disasterReason: 'falling through turbine blades',
        disasterText: ''
      }
    ]
  },
  {
    id: 'wild_west',
    title: '🚂 Pacific Gold Express Heist',
    scenario: 'You gallop alongside an armored train steaming through the canyon. On top of the bullion car stands a sharp-shooting sheriff twirling dual silver revolvers!',
    choices: [
      {
        text: '🤠 Quick-Draw Duel',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 4500,
        maxCoins: 9000,
        dropItem: 'pepecoin',
        dropChance: 0.25,
        successText: '🎯 <b>DEADEYE!</b> You shot the revolver right out of the sheriff\'s grip and blew open the bullion safe!',
        failText: '💨 The sheriff lassoed your rifle away and you had to bail into the river.',
        disasterReason: 'losing a high-noon duel against a legendary frontier lawman',
        disasterText: '💀 The sheriff drew like lightning and put a bullet through your chest!'
      },
      {
        text: '🧨 Dynamite The Doors',
        successChance: 0.75,
        disasterChance: 0.10,
        minCoins: 3000,
        maxCoins: 6500,
        dropItem: 'banknote',
        dropChance: 0.35,
        successText: '💥 <b>KABOOM!</b> The armored blast doors ruptured and gold dubloons showered across the carriage!',
        failText: '💨 You lit a dud fuse and the train accelerated away in a cloud of black coal smoke.',
        disasterReason: 'premature dynamite blast blowing up in face',
        disasterText: '💥 The dynamite fuse burned down instantly in your hands!'
      },
      {
        text: '🥷 Pickpocket Car 4',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1500,
        maxCoins: 3500,
        dropItem: 'apple',
        dropChance: 0.40,
        successText: '🎩 <b>SLICK FINGERS!</b> You strolled through the first-class sleeper car and relieved wealthy baron passengers of their purses.',
        failText: '👀 An alert conductor gave chase with a broom and forced you to leap off.',
        disasterReason: 'crushed under train wheels',
        disasterText: ''
      }
    ]
  },
  {
    id: 'jungle_temple',
    title: '🗿 Lost Jungle Temple of Pepe',
    scenario: 'Deep in the primeval rainforest, you step into an ancient frog temple. Mossy pressure plates litter the ground, and golden relics sparkle atop the central altar.',
    choices: [
      {
        text: '🏃 Sprint Past Darts',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 4500,
        maxCoins: 9500,
        dropItem: 'dragon',
        dropChance: 0.10,
        successText: '🤸 <b>ACROBATIC DODGE!</b> You slid beneath whizzing blowdarts like Indiana Jones and grabbed the jeweled Golden Pepe Idol!',
        failText: '💨 Stone portcullis doors slammed shut ahead, forcing a frantic retreat.',
        disasterReason: 'ancient poison dart piercing jugular vein',
        disasterText: '☠️ A barrage of curare-tipped darts struck you squarely!'
      },
      {
        text: '🧩 Solve Rune Glyph',
        successChance: 0.80,
        disasterChance: 0.05,
        minCoins: 2800,
        maxCoins: 6000,
        dropItem: 'ducttape',
        dropChance: 0.35,
        successText: '🧠 <b>PUZZLE SOLVED!</b> You matched the hieroglyphic frog runes, triggering a secret wall chamber filled with ancient wealth!',
        failText: '🧩 The puzzle locked up and reset, sealing off the chamber.',
        disasterReason: 'crushed by descending ceiling trap',
        disasterText: '🪨 You pressed the wrong glyph and the ceiling collapsed!'
      },
      {
        text: '⛏️ Dig Altar Dirt',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1600,
        maxCoins: 3500,
        dropItem: 'worm',
        dropChance: 0.40,
        successText: '🪣 <b>ARCHAEOLOGICAL DISCOVERY!</b> You scraped loose sacrificial earth and uncovered antique coin offerings.',
        failText: '🪨 You hit hard bedrock and found nothing but pebbles.',
        disasterReason: 'rockslide',
        disasterText: ''
      }
    ]
  },
  {
    id: 'sunken_galleon',
    title: '🌊 Sunken Abyssal Galleon',
    scenario: 'Diving 100 feet deep in scuba gear, you explore the rotting hull of Captain Morgan\'s flagship. Bubbles rise as a massive prehistoric tiger shark circles overhead!',
    choices: [
      {
        text: '🔱 Harpoon The Beast',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 4000,
        maxCoins: 8500,
        dropItem: 'tropicalfish',
        dropChance: 0.35,
        successText: '🎯 <b>BULLSEYE!</b> You drove off the deep predator and cracked open the sea chest resting on the deck!',
        failText: '🫧 Your harpoon glanced off coral and you had to seek shelter in the reef.',
        disasterReason: 'eaten alive by a deep sea apex predator shark',
        disasterText: '🦈 The shark charged from the blue murk and clamped its jaws around your torso!'
      },
      {
        text: '🗝️ Pick Iron Chest',
        successChance: 0.75,
        disasterChance: 0.10,
        minCoins: 3000,
        maxCoins: 6500,
        dropItem: 'ducttape',
        dropChance: 0.30,
        successText: '🔓 <b>CHEST OPENED!</b> Heavy Spanish silver reals and sunken gems poured into your collection bag!',
        failText: '🦀 The rusty padlock broke off in the keyway, keeping the chest locked.',
        disasterReason: 'oxygen tank regulator explosion underwater',
        disasterText: '🫧 Your air regulator exploded under water pressure!'
      },
      {
        text: '🦪 Harvest Pearl Bed',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1500,
        maxCoins: 3500,
        dropItem: 'commonfish',
        dropChance: 0.45,
        successText: '🦪 <b>PEARLS GALORE!</b> You pried open giant oysters and stuffed lustrous natural pearls into your pouch.',
        failText: '🫧 An oyster shell clamped your diving glove and you had to cut free without loot.',
        disasterReason: 'bends decompression sickness',
        disasterText: ''
      }
    ]
  },
  {
    id: 'cyberpunk_heist',
    title: '🌃 Megacorp Cybernet Tower',
    scenario: 'High on the 80th floor of Arasaka Tower, you jack directly into the company mainframe. Red alarm klaxons flash as lethal military Black-ICE software initializes!',
    choices: [
      {
        text: '⚡ Overclock Cyberdeck',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 5000,
        maxCoins: 10000,
        dropItem: 'laptop',
        dropChance: 0.30,
        successText: '💻 <b>BREACH SUCCESSFUL!</b> You burned through the corporation\'s firewall and downloaded thousands of encrypted bearer coin bonds!',
        failText: '🔥 Emergency security reboot kicked you out and zeroed the connection.',
        disasterReason: 'fatal Black-ICE neural overload frying brain tissue',
        disasterText: '⚡ Millisecond Black-ICE feedback surged down your jack cable and fried your brain!'
      },
      {
        text: '🔌 Cut Primary Power',
        successChance: 0.80,
        disasterChance: 0.05,
        minCoins: 3000,
        maxCoins: 6000,
        dropItem: 'banknote',
        dropChance: 0.35,
        successText: '🏢 <b>BLACKOUT!</b> The server room went pitch black. You snatched hot-swappable hard drives packed with digital currency!',
        failText: '🚨 Backup emergency diesel generators fired up immediately, thwarting your heist.',
        disasterReason: 'electrocution by 10,000 volt transformer busbar',
        disasterText: '⚡ You touched the live high-voltage busbar and got electrocuted!'
      },
      {
        text: '🧹 Bribe Night Janitor',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1800,
        maxCoins: 3800,
        dropItem: 'garbage',
        dropChance: 0.50,
        successText: '🤝 <b>INSIDER HELP!</b> The janitor happily accepted some pocket change and let you raid the executive desk drawers.',
        failText: '🗣️ The janitor pressed a hidden silent alarm and you scrambled down the fire stairs.',
        disasterReason: 'security guard gunfire',
        disasterText: ''
      }
    ]
  },
  {
    id: 'haunted_catacombs',
    title: '🕯️ Victorian Crypt Catacombs',
    scenario: 'Lit only by candle glow, you navigate labyrinthine stone tombs beneath the cathedral. A pale wraith with hollow glowing eyes descends through the ceiling!',
    choices: [
      {
        text: '✝️ Brandish Holy Relic',
        successChance: 0.65,
        disasterChance: 0.15,
        minCoins: 4500,
        maxCoins: 9000,
        dropItem: 'pepecoin',
        dropChance: 0.25,
        successText: '✨ <b>BLESSED LIGHT!</b> The wraith screamed and dissolved into ash, leaving behind cursed antique heirloom treasures!',
        failText: '💨 An icy wind blew out your candles and you tripped into the darkness.',
        disasterReason: 'soul reaped by a vengeful Victorian phantom',
        disasterText: '👻 The wraith passed through your chest and extinguished your life force!'
      },
      {
        text: '🗣️ Listen To Spirit',
        successChance: 0.75,
        disasterChance: 0.10,
        minCoins: 3000,
        maxCoins: 6500,
        dropItem: 'apple',
        dropChance: 0.35,
        successText: '📜 <b>PEACE FOUND!</b> You listened to the spirit\'s tragic tale, and he gestured toward a hollow brick hiding antique gold!',
        failText: '🥶 The spirit let out an ear-piercing shriek that paralyzed you with fear.',
        disasterReason: 'heart failure from supernatural terror',
        disasterText: '💀 The gruesome face of the specter terrified you to literal death!'
      },
      {
        text: '💀 Search Skeletons',
        successChance: 0.90,
        disasterChance: 0.00,
        minCoins: 1600,
        maxCoins: 3500,
        dropItem: 'worm',
        dropChance: 0.40,
        successText: '💍 <b>GRAVEROBBER!</b> You quietly pulled antique rings and coins from long-decayed coffins.',
        failText: '🕸️ Ancient cobwebs and dirt showered down, revealing only worthless dirt.',
        disasterReason: 'tomb collapse',
        disasterText: ''
      }
    ]
  }
];

function buildEncounterView(session) {
  const encounter = session.encounters[session.encounterIndex];
  const totalStages = session.encounters.length;

  let text = `🗺️ <b>EXPEDITION STAGE [${session.encounterIndex + 1}/${totalStages}]</b>\n` +
    `📍 <b>Encounter:</b> ${encounter.title}\n` +
    `👤 <b>Explorer:</b> ${sanitizeHtml(session.userName)}\n` +
    `💰 <b>Loot Bag:</b> ${formatCoins(session.collectedCoins)}\n\n` +
    `${encounter.scenario}\n\n` +
    `<i>What will you do? Select your move below:</i>`;

  const keyboard = new InlineKeyboard();
  encounter.choices.forEach((choice, idx) => {
    // Buttons format: adventure:choice:${choiceIndex}:${messageId}:${userId}
    keyboard.text(choice.text, `adventure:choice:${idx}:${session.messageId}:${session.userId}`);
    if (idx < encounter.choices.length - 1) {
      keyboard.row();
    }
  });

  return { text, keyboard };
}

export const adventure = {
  name: 'adventure',
  aliases: ['adv'],
  category: 'grind',
  description: 'Embark on a 3-stage interactive expedition for massive loot (Requires 1x Adventure Ticket)',
  cooldown: 300, // 5m cooldown (2.5m for Premium)

  async execute(ctx) {
    const userId = ctx.from.id;
    await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    // 1. Verify caller has at least 1x adventureticket
    const hasTicket = await inventoryRepo.hasItem(userId, 'adventureticket', 1);
    if (!hasTicket) {
      return ctx.reply(
        `🎟️ <b>You need an Adventure Ticket to embark on an expedition!</b>\n\n` +
        `Adventure expeditions are 3-stage perilous journeys with massive rewards and rare collectible drops.\n\n` +
        `🛠️ <b>How to craft an Adventure Ticket:</b>\n` +
        `• Run <code>/craft adventureticket</code> (Requires 2x 🩹 Duct Tape & 5x 🗑️ Garbage)\n` +
        `• Gather crafting materials using <code>/search</code> and <code>/dig</code>!`,
        { parse_mode: 'HTML' }
      );
    }

    // 2. Deduct 1x adventureticket
    await inventoryRepo.removeItem(userId, 'adventureticket', 1);

    // Initialize global adventure map
    if (!global.activeAdventures) {
      global.activeAdventures = new Map();
    }

    // Clean up stale sessions (> 1 hour old)
    const now = Date.now();
    for (const [k, v] of global.activeAdventures.entries()) {
      if (now - (v.createdAt || 0) > 3600000) {
        global.activeAdventures.delete(k);
      }
    }

    // 3. Pick 3 distinct encounters randomly from pool
    const shuffled = [...ENCOUNTER_POOL].sort(() => 0.5 - Math.random());
    const encounters = shuffled.slice(0, 3);

    // 4. Send initial message and register session
    const tempSession = {
      messageId: 0,
      chatId: ctx.chat.id,
      userId,
      userName: ctx.from.first_name || 'Explorer',
      encounterIndex: 0,
      encounters,
      collectedCoins: 0,
      collectedItems: {},
      processing: false,
      createdAt: now
    };

    // First send with dummy messageId in keyboard
    const initialView = buildEncounterView(tempSession);
    const sent = await ctx.reply(initialView.text, {
      parse_mode: 'HTML',
      reply_markup: initialView.keyboard
    });

    // Update real messageId in session and register in map
    tempSession.messageId = sent.message_id;
    global.activeAdventures.set(String(sent.message_id), tempSession);

    // Update buttons with real messageId so callbacks match precisely
    const updatedView = buildEncounterView(tempSession);
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, sent.message_id, {
      reply_markup: updatedView.keyboard
    }).catch(() => {});
  },

  async handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    // Format: adventure:choice:${choiceIdx}:${messageId}:${userId}
    const choiceIdx = parseInt(parts[2], 10);
    const messageId = parts[3] || String(ctx.callbackQuery.message?.message_id);
    const clickerId = ctx.from.id;

    if (!global.activeAdventures) {
      global.activeAdventures = new Map();
    }

    const session = global.activeAdventures.get(String(messageId));

    if (!session) {
      return ctx.answerCallbackQuery({
        text: '⏳ This adventure expedition has already ended or expired!',
        show_alert: true
      });
    }

    // Verify ownership
    if (session.userId !== clickerId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your adventure expedition! Craft a ticket and run /adventure.",
        show_alert: true
      });
    }

    // Prevent spam clicking while transitioning
    if (session.processing) {
      return ctx.answerCallbackQuery({ text: 'Processing stage move...' });
    }
    session.processing = true;

    await ctx.answerCallbackQuery();

    const encounter = session.encounters[session.encounterIndex];
    const choice = encounter.choices[choiceIdx];

    if (!choice) {
      session.processing = false;
      return;
    }

    const luckInfo = await getLuckBreakdown(session.userId);
    const luckBonus = luckInfo.totalBonus / 200; // E.g. +10% luck
    const roll = Math.random();

    // 1. Check for Disaster
    const effectiveDisasterChance = Math.max(0.01, choice.disasterChance - (luckBonus / 2));
    if (roll < effectiveDisasterChance) {
      // Player triggered disaster
      const deathRes = await handleDeath(ctx, session.userId, choice.disasterReason);
      global.activeAdventures.delete(String(messageId));

      const disasterMsg = `💥 <b>EXPEDITION DISASTER!</b>\n\n` +
        `${choice.disasterText}\n\n` +
        `${deathRes.message}\n\n` +
        `<i>Your expedition was cut short and your unbanked expedition loot was lost!</i>`;

      return ctx.editMessageText(disasterMsg, { parse_mode: 'HTML' }).catch(() => {});
    }

    // 2. Check for Success vs Fail
    const effectiveSuccessChance = Math.min(0.95, choice.successChance + luckBonus);
    let outcomeText = '';

    if (roll < (effectiveDisasterChance + effectiveSuccessChance)) {
      // SUCCESS!
      const baseCoins = randomBetween(choice.minCoins, choice.maxCoins);
      const coinsGained = Math.floor(baseCoins * (1 + (luckInfo.totalBonus / 250)));
      session.collectedCoins += coinsGained;

      let itemFoundNotice = '';
      if (choice.dropItem && Math.random() < (choice.dropChance + (luckBonus / 2))) {
        const itemId = choice.dropItem;
        session.collectedItems[itemId] = (session.collectedItems[itemId] || 0) + 1;
        const itm = items[itemId] || { emoji: '📦', name: itemId };
        itemFoundNotice = `\n🎁 <b>Found Item:</b> 1x ${itm.emoji} <b>${itm.name}</b>!`;
      }

      outcomeText = `${choice.successText}\n\n` +
        `🪙 <b>Stage Loot:</b> +${formatCoins(coinsGained)}` +
        itemFoundNotice;
    } else {
      // FAIL (survived but found nothing)
      outcomeText = `${choice.failText}\n\n<i>You found nothing in this stage.</i>`;
    }

    // Advance stage index
    session.encounterIndex += 1;

    // Check if more stages remain
    if (session.encounterIndex < session.encounters.length) {
      // Intermediate stage: show outcome with loading delay
      const transitionText = `🗺️ <b>EXPEDITION STAGE [${session.encounterIndex}/${session.encounters.length}] OUTCOME</b>\n\n` +
        `${outcomeText}\n\n` +
        `💰 <b>Total Loot Secured:</b> ${formatCoins(session.collectedCoins)}\n\n` +
        `⏳ <i>Catching your breath... entering the next zone in 2.5 seconds!</i>`;

      await ctx.editMessageText(transitionText, { parse_mode: 'HTML' }).catch(() => {});

      // Wait 2.5 seconds as requested
      await new Promise(r => setTimeout(r, 2500));

      // Load next encounter
      session.processing = false;
      const nextView = buildEncounterView(session);
      await ctx.editMessageText(nextView.text, {
        parse_mode: 'HTML',
        reply_markup: nextView.keyboard
      }).catch(() => {});

    } else {
      // ALL 3 STAGES COMPLETED: FINAL SUMMARY & PAYOUT!
      // Credit coins to database
      if (session.collectedCoins > 0) {
        await userRepo.updateCoins(session.userId, {
          walletDelta: session.collectedCoins,
          sourceCommand: '/adventure',
          details: 'Completed 3-stage expedition'
        });
      }

      // Credit items to database
      for (const [itemId, qty] of Object.entries(session.collectedItems)) {
        await inventoryRepo.addItem(session.userId, itemId, qty);
      }

      // Award XP
      const baseExp = 120 + Math.floor(session.collectedCoins / 80);
      const xpRes = await addXp(session.userId, baseExp);

      // Clean up session
      global.activeAdventures.delete(String(messageId));

      let summary = `🏆 <b>EXPEDITION ACCOMPLISHED!</b>\n` +
        `You survived all 3 dangerous stages and safely returned to camp!\n\n` +
        `<b>📦 Booty Secured & Added To Backpack:</b>\n` +
        `🪙 <b>Total Coins:</b> +${formatCoins(session.collectedCoins)}\n`;

      const itemEntries = Object.entries(session.collectedItems);
      if (itemEntries.length > 0) {
        summary += `🎒 <b>Treasures Recovered:</b>\n`;
        for (const [itemId, qty] of itemEntries) {
          const itm = items[itemId] || { emoji: '📦', name: itemId };
          summary += `  • ${qty}x ${itm.emoji} <b>${itm.name}</b>\n`;
        }
      } else {
        summary += `🎒 <b>Treasures:</b> No special items found\n`;
      }

      summary += `⭐ <b>XP Earned:</b> +${xpRes.earnedXp} XP` +
        (xpRes.message ? `\n${xpRes.message}` : '');

      await ctx.editMessageText(summary, { parse_mode: 'HTML' }).catch(() => {});
    }
  }
};

export default adventure;
