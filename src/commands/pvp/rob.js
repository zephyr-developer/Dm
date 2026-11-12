import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import { handleDeath } from '../../utils/deathEngine.js';
import { getLuckBreakdown } from '../../utils/luckEngine.js';
import { formatCoins, randomBetween, sanitizeHtml } from '../../utils/formatters.js';

export const rob = {
  name: 'rob',
  aliases: [],
  description: 'Pickpocket another user in the group chat for a percentage of their wallet',
  cooldown: 120, // 60s for Premium

  async execute(ctx) {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚔️ You can only rob other players inside a group chat!');
    }

    const callerId = ctx.from.id;
    const caller = await userRepo.getOrInitUser(callerId, ctx.from.username, ctx.from.first_name);

    // 1. Identify Target User
    let target = null;

    if (ctx.message?.reply_to_message?.from) {
      const replied = ctx.message.reply_to_message.from;
      target = await userRepo.getOrInitUser(replied.id, replied.username, replied.first_name);
    } else {
      const args = ctx.message.text.trim().split(/\s+/).slice(1);
      const usernameArg = args[0];
      if (usernameArg) {
        target = await userRepo.getUserByUsername(usernameArg);
      }
    }

    if (!target) {
      return ctx.reply(
        `🥷 <b>Robbery Attempt</b>\n` +
        `Usage: Reply to a player's message with <code>/rob</code> or type <code>/rob @username</code>.`,
        { parse_mode: 'HTML' }
      );
    }

    if (target.user_id === callerId) {
      return ctx.reply('🤡 You cannot rob yourself, silly.');
    }

    // 2. Passive Mode Checks
    if (caller.passive_mode === 1) {
      return ctx.reply('🛡️ You have <b>Passive Mode</b> enabled! You cannot rob others while protected. Disable it in <code>/profile</code>.', { parse_mode: 'HTML' });
    }
    if (target.passive_mode === 1) {
      return ctx.reply(`🛡️ <b>${sanitizeHtml(target.first_name)}</b> has <b>Passive Mode</b> enabled and is immune to robbery!`, { parse_mode: 'HTML' });
    }

    // 3. Minimum Wallet Balance Checks
    const callerWallet = Number(caller.wallet || 0);
    const targetWallet = Number(target.wallet || 0);

    if (callerWallet < 2000) {
      return ctx.reply('💸 You must have at least <b>🪙 2,000</b> in your wallet to cover legal fines if caught!', { parse_mode: 'HTML' });
    }
    if (targetWallet < 1000) {
      return ctx.reply(`🤷 <b>${sanitizeHtml(target.first_name)}</b> is too broke to rob! They have less than 🪙 1,000 in their wallet.`, { parse_mode: 'HTML' });
    }

    const callerLuck = await getLuckBreakdown(callerId);

    // 4. Check Defenses: LANDMINE (Luck helps detect & defuse)
    if (await inventoryRepo.hasBuff(target.user_id, 'landmine')) {
      await inventoryRepo.removeBuff(target.user_id, 'landmine');
      const detonateChance = Math.max(0.15, 0.50 - (callerLuck.totalBonus / 400));
      if (Math.random() < detonateChance) {
        const fine = Math.min(callerWallet, 2000);
        await userRepo.updateCoins(callerId, {
          walletDelta: -fine,
          sourceCommand: '/rob',
          details: `Detonated @${target.username || target.first_name}'s Landmine fine`
        });
        await userRepo.updateCoins(target.user_id, {
          walletDelta: fine,
          sourceCommand: '/rob',
          details: `Landmine bounty from @${caller.username || caller.first_name}`
        });

        const deathRes = await handleDeath(ctx, callerId, `stepping on a live Landmine armed by ${target.first_name}`);
        const deathNotice = deathRes.survived
          ? `🛟 <b>BOOOM!</b> You tripped ${target.first_name}'s 💣 <b>Landmine</b>, but your 🛟 <b>Life Saver</b> consumed itself to save your life! You still paid <b>${formatCoins(fine)}</b> in damages.`
          : `💥 <b>BOOOOM!</b> You crept up behind ${target.first_name} and stepped directly on their concealed 💣 <b>Landmine</b>!\n` +
            `The explosion blew you away! Paid <b>${formatCoins(fine)}</b> hazard fine.\n\n` + deathRes.message;

        return ctx.reply(deathNotice, { parse_mode: 'HTML' });
      }
    }

    // 5. Check Defenses: PADLOCK
    if (await inventoryRepo.hasBuff(target.user_id, 'padlock')) {
      await inventoryRepo.removeBuff(target.user_id, 'padlock');
      const fine = Math.min(callerWallet, 1500);
      await userRepo.updateCoins(callerId, {
        walletDelta: -fine,
        sourceCommand: '/rob',
        details: `Tripped @${target.username || target.first_name}'s Padlock fine`
      });
      await userRepo.updateCoins(target.user_id, {
        walletDelta: fine,
        sourceCommand: '/rob',
        details: `Padlock compensation from @${caller.username || caller.first_name}`
      });

      return ctx.reply(
        `🔒 <b>CLANK!</b> You reached for <b>${sanitizeHtml(target.first_name)}</b>'s wallet, but your hands hit a heavy locked <b>Padlock</b>!\n` +
        `The padlock broke, alerting the victim! You dropped <b>${formatCoins(fine)}</b> in your clumsy escape.`,
        { parse_mode: 'HTML' }
      );
    }

    // 6. Roll Robbery Probability (40% base + luck bonus)
    const successRate = Math.min(0.90, 0.40 + (callerLuck.totalBonus / 250));
    const isSuccess = Math.random() < successRate;

    if (!isSuccess) {
      // Caught! Pay 25% of wallet (max 10,000)
      const fine = Math.min(10000, Math.floor(callerWallet * 0.25));
      await userRepo.updateCoins(callerId, {
        walletDelta: -fine,
        sourceCommand: '/rob',
        details: `Caught pickpocketing @${target.username || target.first_name} fine`
      });
      await userRepo.updateCoins(target.user_id, {
        walletDelta: fine,
        sourceCommand: '/rob',
        details: `Caught pickpocket @${caller.username || caller.first_name} compensation`
      });

      return ctx.reply(
        `🚨 <b>CAUGHT RED-HANDED!</b>\n` +
        `You were spotted trying to pickpocket <b>${sanitizeHtml(target.first_name)}</b>!\n` +
        `You tripped and had to pay them <b>${formatCoins(fine)}</b> in compensation.`,
        { parse_mode: 'HTML' }
      );
    }

    // Success! Steal percentage tilted by luck
    const stealRoll = Math.random();
    let stealPercentage = 0.15;

    const jackpotChance = Math.min(0.30, 0.05 + (callerLuck.totalBonus / 500));
    const bigStealChance = Math.min(0.60, 0.25 + (callerLuck.totalBonus / 300));

    if (stealRoll < jackpotChance) {
      // Cleanout steal: 80%–100%
      stealPercentage = randomBetween(80, 100) / 100;
    } else if (stealRoll < (jackpotChance + bigStealChance)) {
      // Big steal: 26%–50%
      stealPercentage = randomBetween(26, 50) / 100;
    } else {
      // Small steal: 10%–25%
      stealPercentage = randomBetween(10, 25) / 100;
    }

    const stolenAmount = Math.max(1, Math.floor(targetWallet * stealPercentage));
    await userRepo.updateCoins(target.user_id, {
      walletDelta: -stolenAmount,
      sourceCommand: '/rob',
      details: `Robbed by @${caller.username || caller.first_name}`
    });
    const updatedCaller = await userRepo.updateCoins(callerId, {
      walletDelta: stolenAmount,
      sourceCommand: '/rob',
      details: `Robbed @${target.username || target.first_name}`
    });

    let heistFlavor = 'You slickly slid your hands into their pocket';
    if (stealPercentage >= 0.80) {
      heistFlavor = '💰 <b>JACKPOT ROBBERY!</b> You stripped their entire wallet clean';
    } else if (stealPercentage >= 0.26) {
      heistFlavor = '🏃 <b>FAT HEIST!</b> You snatched a hefty wad of cash';
    }

    let luckTag = callerLuck.customLuck > 0 ? ` <i>(🎲 +${callerLuck.customLuck}% luck active!)</i>` : '';

    return ctx.reply(
      `🥷 <b>Robbery Successful!</b>${luckTag}\n` +
      `${heistFlavor} and stole <b>${formatCoins(stolenAmount)}</b> from <b>${sanitizeHtml(target.first_name)}</b>!\n\n` +
      `👛 <b>Your Wallet:</b> ${formatCoins(updatedCaller.wallet)}`,
      { parse_mode: 'HTML' }
    );
  }
};

export default rob;
