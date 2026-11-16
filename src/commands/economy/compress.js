import { InlineKeyboard } from 'grammy';
import userRepo, { OVERFLOW_BASE, SHARD_RATE } from '../../database/userRepo.js';
import { formatCoins } from '../../utils/formatters.js';

const MAX_SHARDS_PER_OP = 100; // Safety guard per single UI confirmation (100 * 100T = 10Q > wallet cap)

export const compress = {
  name: 'compress',
  aliases: ['shard', 'ascend', 'decompress'],
  description: 'Compress 100T coins into 💠 Sovereign Shards (or /decompress back to wallet)',
  cooldown: 3,

  async execute(ctx) {
    const userId = ctx.from.id;
    const user = await userRepo.getOrInitUser(userId, ctx.from.username, ctx.from.first_name);

    const rawText = (ctx.message?.text || '').trim();
    const invokedCmd = (rawText.split(/\s+/)[0] || '').toLowerCase().replace(/^\/|@.*$/g, '');
    let argsStr = (typeof ctx.match === 'string' && ctx.match.trim())
      ? ctx.match.trim()
      : rawText.split(/\s+/).slice(1).join(' ').trim();

    let mode = invokedCmd === 'decompress' ? 'decompress' : 'compress';
    const tokens = argsStr ? argsStr.split(/\s+/) : [];
    if (tokens[0]?.toLowerCase() === 'decompress') {
      mode = 'decompress';
      tokens.shift();
    } else if (tokens[0]?.toLowerCase() === 'compress') {
      mode = 'compress';
      tokens.shift();
    }

    const arg = tokens[0]?.toLowerCase() || '';
    const currentWallet = Math.max(0, Math.floor(Number(user.wallet || 0)));
    const currentShards = Math.max(0, Math.floor(Number(user.sovereign_shards || 0)));

    if (!arg) {
      const maxCompressible = Math.floor(currentWallet / SHARD_RATE);
      const maxDecompressible = currentWallet <= OVERFLOW_BASE
        ? Math.min(currentShards, Math.floor((OVERFLOW_BASE - currentWallet) / SHARD_RATE))
        : 0;

      return ctx.reply(
        `💠 <b>Sovereign Shard Forge</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `💱 <b>Exchange Rate:</b> <code>1 💠 Sovereign Shard</code> = <b>${formatCoins(SHARD_RATE)}</b> (100 Trillion)\n` +
        `👛 <b>Your Wallet:</b> ${formatCoins(currentWallet)}\n` +
        `💠 <b>Your Shards:</b> <b>${currentShards.toLocaleString('en-US')} 💠</b>\n\n` +
        `<b>Commands:</b>\n` +
        `• <code>/compress &lt;shards | all&gt;</code> — Forge wallet coins into Shards (Max right now: <b>${maxCompressible.toLocaleString('en-US')}</b>)\n` +
        `• <code>/decompress &lt;shards&gt;</code> — Melt Shards back into coins (Max wallet 900T; max right now: <b>${maxDecompressible.toLocaleString('en-US')}</b>)\n` +
        `• Spend Shards in the VIP <code>/blackmarket</code>!`,
        { parse_mode: 'HTML' }
      );
    }

    if (mode === 'compress') {
      let shardsCount = 0;
      if (arg === 'all' || arg === 'max') {
        shardsCount = Math.floor(currentWallet / SHARD_RATE);
        if (shardsCount <= 0) {
          return ctx.reply(
            `❌ You need at least <b>${formatCoins(SHARD_RATE)}</b> (100 Trillion) in your wallet to compress <b>1 💠 Sovereign Shard</b>!\n` +
            `👛 Your Wallet: <b>${formatCoins(currentWallet)}</b>`,
            { parse_mode: 'HTML' }
          );
        }
      } else {
        if (!/^\d+$/.test(arg)) {
          return ctx.reply('❌ Please provide a valid positive shard count or <code>all</code>. Example: <code>/compress 2</code>', { parse_mode: 'HTML' });
        }
        const parsedBig = BigInt(arg);
        if (parsedBig <= 0n) {
          return ctx.reply('❌ Shard amount must be at least 1.', { parse_mode: 'HTML' });
        }
        if (parsedBig > BigInt(MAX_SHARDS_PER_OP)) {
          return ctx.reply(`❌ You can compress at most <b>${MAX_SHARDS_PER_OP} 💠 Shards</b> at once.`, { parse_mode: 'HTML' });
        }
        shardsCount = Number(parsedBig);
      }

      const requiredCoinsBig = BigInt(shardsCount) * BigInt(SHARD_RATE);
      if (requiredCoinsBig > BigInt(currentWallet)) {
        return ctx.reply(
          `❌ <b>Insufficient Wallet Funds!</b>\n` +
          `Forging <b>${shardsCount.toLocaleString('en-US')} 💠 Sovereign Shards</b> costs <b>${formatCoins(Number(requiredCoinsBig <= BigInt(Number.MAX_SAFE_INTEGER) ? requiredCoinsBig : Number.MAX_SAFE_INTEGER))}</b>.\n` +
          `👛 Your Wallet: <b>${formatCoins(currentWallet)}</b>`,
          { parse_mode: 'HTML' }
        );
      }

      const totalCoins = Number(requiredCoinsBig);
      const keyboard = new InlineKeyboard()
        .text('❌ Cancel', `compress:no:${userId}`)
        .text('✅ Confirm', `compress:comp:${shardsCount}:${userId}`);

      return ctx.reply(
        `💠 <b>Confirm Shard Compression</b>\n\n` +
        `• <b>Spending:</b> ${formatCoins(totalCoins)}\n` +
        `• <b>Receiving:</b> <b>+${shardsCount.toLocaleString('en-US')} 💠 Sovereign Shards</b>\n` +
        `• <b>Wallet After:</b> ${formatCoins(currentWallet - totalCoins)}\n\n` +
        `<i>Proceed with forging Sovereign Shards?</i>`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    // Decompress mode
    if (!/^\d+$/.test(arg)) {
      return ctx.reply('❌ Please provide a valid positive number of shards to decompress. Example: <code>/decompress 1</code>', { parse_mode: 'HTML' });
    }

    const reqBig = BigInt(arg);
    if (reqBig <= 0n) {
      return ctx.reply('❌ Shard amount must be at least 1.', { parse_mode: 'HTML' });
    }
    if (reqBig > 9n) {
      return ctx.reply(
        `❌ Decompressing <b>${reqBig.toString()} 💠 Shards</b> would exceed the <b>🪙 900,000,000,000,000 (900T)</b> wallet safety ceiling!`,
        { parse_mode: 'HTML' }
      );
    }

    const shardsCount = Number(reqBig);
    if (currentShards < shardsCount) {
      return ctx.reply(
        `❌ You only have <b>${currentShards.toLocaleString('en-US')} 💠 Sovereign Shards</b>!`,
        { parse_mode: 'HTML' }
      );
    }

    const coinsGain = shardsCount * SHARD_RATE;
    if (currentWallet + coinsGain > OVERFLOW_BASE) {
      return ctx.reply(
        `❌ <b>Decompression Blocked!</b>\n` +
        `Your resulting wallet (<b>${formatCoins(currentWallet + coinsGain)}</b>) cannot exceed <b>${formatCoins(OVERFLOW_BASE)} (900T)</b> so you don't trigger immediate auto-overflow!\n` +
        `Spend or burn coins at <code>/frenzy</code> first.`,
        { parse_mode: 'HTML' }
      );
    }

    const keyboard = new InlineKeyboard()
      .text('❌ Cancel', `compress:no:${userId}`)
      .text('✅ Confirm', `compress:decomp:${shardsCount}:${userId}`);

    return ctx.reply(
      `💠 <b>Confirm Shard Decompression</b>\n\n` +
      `• <b>Melting:</b> ${shardsCount.toLocaleString('en-US')} 💠 Sovereign Shards\n` +
      `• <b>Receiving:</b> <b>+${formatCoins(coinsGain)}</b>\n` +
      `• <b>Wallet After:</b> ${formatCoins(currentWallet + coinsGain)}\n\n` +
      `<i>Proceed with melting Sovereign Shards into wallet coins?</i>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  },

  async handleCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1];
    const targetUserId = Number(parts[parts.length - 1]);

    if (ctx.from.id !== targetUserId) {
      return ctx.answerCallbackQuery({
        text: "🚫 This isn't your shard forge session!",
        show_alert: true
      });
    }

    if (action === 'no') {
      await ctx.answerCallbackQuery({ text: 'Shard transaction cancelled.' });
      return ctx.editMessageText('❌ Shard transaction cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    }

    if (action === 'comp') {
      const shardsCount = Number(parts[2]);
      const res = await userRepo.compressShardsAtomic(targetUserId, shardsCount);
      if (!res.success) {
        await ctx.answerCallbackQuery({ text: 'Insufficient wallet funds!', show_alert: true });
        return ctx.editMessageText('❌ <b>Compression Failed:</b> Insufficient wallet funds or invalid amount.', { parse_mode: 'HTML' }).catch(() => {});
      }

      await ctx.answerCallbackQuery({ text: `Forged +${res.shardsAdded} 💠 Sovereign Shards!` });
      return ctx.editMessageText(
        `💠 <b>Compression Complete!</b>\n` +
        `Converted <b>${formatCoins(res.coinsSpent)}</b> into <b>+${res.shardsAdded.toLocaleString('en-US')} 💠 Sovereign Shards</b>!\n\n` +
        `💠 <b>Total Shards:</b> <b>${res.newShards.toLocaleString('en-US')} 💠</b>\n` +
        `👛 <b>Remaining Wallet:</b> ${formatCoins(res.newWallet)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    if (action === 'decomp') {
      const shardsCount = Number(parts[2]);
      const res = await userRepo.decompressShardsAtomic(targetUserId, shardsCount);
      if (!res.success) {
        const msg = res.reason === 'EXCEEDS_WALLET_CAP'
          ? 'Resulting wallet cannot exceed 900T!'
          : 'Insufficient Sovereign Shards!';
        await ctx.answerCallbackQuery({ text: msg, show_alert: true });
        return ctx.editMessageText(`❌ <b>Decompression Failed:</b> ${msg}`, { parse_mode: 'HTML' }).catch(() => {});
      }

      await ctx.answerCallbackQuery({ text: `Melted ${res.shardsConverted} 💠 into coins!` });
      return ctx.editMessageText(
        `💠 <b>Decompression Complete!</b>\n` +
        `Melted <b>${res.shardsConverted.toLocaleString('en-US')} 💠 Sovereign Shards</b> into <b>+${formatCoins(res.coinsAdded)}</b>!\n\n` +
        `👛 <b>New Wallet:</b> ${formatCoins(res.newWallet)}\n` +
        `💠 <b>Remaining Shards:</b> <b>${res.newShards.toLocaleString('en-US')} 💠</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
};

export default compress;
