/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import userRepo from '../../database/userRepo.js';
import inventoryRepo from '../../database/inventoryRepo.js';
import shopStockRepo from '../../database/shopStockRepo.js';
import { buy } from './buy.js';
import { use } from './use.js';
import { sell } from './sell.js';

function createMockCtx(userId: number, text = '', callbackData = '') {
  const replies: Array<{ text: string; options?: any }> = [];
  const edits: Array<{ text: string; options?: any }> = [];
  const alerts: Array<any> = [];
  let deleted = false;

  return {
    replies,
    edits,
    alerts,
    get deleted() {
      return deleted;
    },
    from: { id: userId, username: `tester_${userId}`, first_name: `Tester ${userId}` },
    chat: { id: -100123456, type: 'supergroup' },
    match: text.split(/\s+/).slice(1).join(' '),
    message: { text },
    callbackQuery: callbackData
      ? {
          data: callbackData,
          message: { message_id: 999 }
        }
      : undefined,
    async reply(msg: string, options?: any) {
      replies.push({ text: msg, options });
      return { message_id: 1000 + replies.length };
    },
    async editMessageText(msg: string, options?: any) {
      edits.push({ text: msg, options });
      return true;
    },
    async answerCallbackQuery(payload?: any) {
      alerts.push(payload || {});
      return true;
    },
    async deleteMessage() {
      deleted = true;
      return true;
    }
  };
}

test('Bug 1: /buy banknote 1000000000000000 rejects instantaneously without stealing coins', async () => {
  const uid = 910001;
  await userRepo.upsertUser(uid, 'buyer1', 'Buyer1');
  await userRepo.setWallet(uid, 5_000_000, '/test', 'seed wallet');

  const start = Date.now();
  const ctx = createMockCtx(uid, '/buy banknote 1000000000000000');
  await buy.execute(ctx);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 100, `Expected instant rejection (<100ms), took ${elapsedMs}ms`);
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /You cannot afford/i);
  assert.match(ctx.replies[0].text, /9 Quadrillion/i);

  const after = await userRepo.getUser(uid);
  assert.equal(Number(after.wallet), 5_000_000);
  assert.equal(await inventoryRepo.getItem(uid, 'banknote'), 0);
});

test('Bug 1: /buy ducttape 1000000000000 enforces 100B MAX_SAFE_QTY stack cap', async () => {
  const uid = 910002;
  await userRepo.upsertUser(uid, 'buyer2', 'Buyer2');
  await userRepo.setWallet(uid, 1_000_000_000_000_000, '/test', 'seed huge wallet');

  // Cost of 1000000000000 * 10000 = 10 Quadrillion > MAX_SAFE_INTEGER -> caught cleanly
  const ctxOverSafe = createMockCtx(uid, '/buy ducttape 1000000000000');
  await buy.execute(ctxOverSafe);
  assert.equal(ctxOverSafe.replies.length, 1);
  assert.match(ctxOverSafe.replies[0].text, /cannot afford|exceeds the safe wallet limit/i);

  // Owned 90B + buying 20B ducttape (cost 200T <= 1Q wallet) triggers 100B stack cap
  await inventoryRepo.setItem(uid, 'ducttape', 90_000_000_000);
  const ctxOverStack = createMockCtx(uid, '/buy ducttape 20000000000');
  await buy.execute(ctxOverStack);
  assert.equal(ctxOverStack.replies.length, 1);
  assert.match(ctxOverStack.replies[0].text, /Stack Limit Exceeded/i);
  assert.equal(await inventoryRepo.getItem(uid, 'ducttape'), 90_000_000_000);
});

test('Bug 1: executeAtomicBuy supports BIGINT (>2.14B) quantities & rolls back cleanly on insufficient funds', async () => {
  const uid = 910003;
  await userRepo.upsertUser(uid, 'atomic3', 'Atomic3');
  await userRepo.setWallet(uid, 1000, '/test', 'seed low wallet');

  // Insufficient funds: wallet must stay untouched and inventory untouched
  const failRes = await inventoryRepo.executeAtomicBuy(uid, 'banknote', 5_000_000_000, 50_000, 'Should fail');
  assert.equal(failRes.success, false);
  assert.equal(failRes.reason, 'INSUFFICIENT_FUNDS');
  assert.equal(Number((await userRepo.getUser(uid)).wallet), 1000);
  assert.equal(await inventoryRepo.getItem(uid, 'banknote'), 0);

  // Sufficient funds with multi-billion (> 32-bit INT max 2,147,483,647) item stack
  await userRepo.setWallet(uid, 500_000_000_000, '/test', 'seed big wallet');
  const okRes = await inventoryRepo.executeAtomicBuy(uid, 'banknote', 5_000_000_000, 100_000_000, 'Big stack test');
  assert.equal(okRes.success, true);
  assert.equal(okRes.newQuantity, 5_000_000_000);
  assert.equal(okRes.newWallet, 499_900_000_000);
  assert.equal(await inventoryRepo.getItem(uid, 'banknote'), 5_000_000_000);
});

test('Bug 2: /use banknote 10000000000 completes in O(1) (<50ms) and caps bank_max at 9 Quadrillion', async () => {
  const uid = 910004;
  await userRepo.upsertUser(uid, 'banker4', 'Banker4');
  await inventoryRepo.setItem(uid, 'banknote', 10_000_000_000);

  const start = Date.now();
  const ctx = createMockCtx(uid, '', `use:yes:banknote:10000000000:${uid}`);
  await use.handleCallback(ctx);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 50, `Expected O(1) execution (<50ms), took ${elapsedMs}ms`);
  assert.equal(await inventoryRepo.getItem(uid, 'banknote'), 0);

  const after = await userRepo.getUser(uid);
  const expectedMin = Math.floor(10_000_000_000 * 22500 * 0.96);
  const expectedMax = Math.floor(10_000_000_000 * 22500 * 1.04) + 5000;
  assert.ok(
    Number(after.bank_max) >= expectedMin && Number(after.bank_max) <= expectedMax,
    `Expected ~225T bank_max, got ${after.bank_max}`
  );
  assert.equal(ctx.edits.length, 1);
  assert.match(ctx.edits[0].text, /10,000,000,000x Bank Note/);

  // Now push bank_max near 9 Quadrillion and use 500B worth of notes to verify 9Q cap
  await userRepo.increaseBankMax(uid, 8_700_000_000_000_000);
  await inventoryRepo.setItem(uid, 'banknote', 100_000_000_000);
  const ctxCap = createMockCtx(uid, '', `use:yes:banknote:100000000000:${uid}`);
  await use.handleCallback(ctxCap);
  const cappedAfter = await userRepo.getUser(uid);
  assert.equal(Number(cappedAfter.bank_max), 9_000_000_000_000_000);
});

test('Bug 2: /use gtkcondom 10000000 completes in O(1) single-query & caps bank_max cleanly', async () => {
  const uid = 910005;
  await userRepo.upsertUser(uid, 'gtk5', 'Gtk5');
  await inventoryRepo.setItem(uid, 'gtkcondom', 10_000_000);

  const start = Date.now();
  const ctx = createMockCtx(uid, '', `use:yes:gtkcondom:10000000:${uid}`);
  await use.handleCallback(ctx);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 50, `Expected O(1) execution (<50ms), took ${elapsedMs}ms`);
  assert.equal(await inventoryRepo.getItem(uid, 'gtkcondom'), 0);

  const after = await userRepo.getUser(uid);
  assert.equal(Number(after.level), 1 + 100_000_000);
  assert.ok(Number(after.bank_max) <= 9_000_000_000_000_000);
  assert.equal(ctx.edits.length, 1);
  assert.match(ctx.edits[0].text, /10,000,000x GTK Brand Condom/);
});

test('Bug 2: /use padlock 10000000000 clamps buff duration to 1 year (31,536,000s) without overflow', async () => {
  const uid = 910006;
  await userRepo.upsertUser(uid, 'padlock6', 'Padlock6');
  await inventoryRepo.setItem(uid, 'padlock', 10_000_000_000);

  const start = Date.now();
  const ctx = createMockCtx(uid, '', `use:yes:padlock:10000000000:${uid}`);
  await use.handleCallback(ctx);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 50, `Expected O(1) execution (<50ms), took ${elapsedMs}ms`);
  assert.equal(await inventoryRepo.getItem(uid, 'padlock'), 0);

  const remainingSec = await inventoryRepo.getBuffRemaining(uid, 'padlock');
  assert.ok(remainingSec > 31_535_900 && remainingSec <= 31_536_000, `Unexpected remainingSec=${remainingSec}`);
});

test('Bug 3: /sell returns limited exclusive stock back into Global /shop market (even from 0)', async () => {
  const uid = 910007;
  await userRepo.upsertUser(uid, 'seller7', 'Seller7');
  await userRepo.setWallet(uid, 0, '/test', 'zero wallet');

  // Claim the 1 weekly zyloveletter stock so global stock is 0
  const initialStock = await shopStockRepo.getItemStock('zyloveletter');
  assert.equal(initialStock.currentStock, 1);
  const claimed = await shopStockRepo.purchaseLimitedStock('zyloveletter', 1);
  assert.equal(claimed.success, true);
  assert.equal((await shopStockRepo.getItemStock('zyloveletter')).currentStock, 0);

  // Give user 1x zyloveletter and sell it
  await inventoryRepo.setItem(uid, 'zyloveletter', 1);
  const ctx = createMockCtx(uid, '', `sell:yes:zyloveletter:1:${uid}`);
  await sell.handleCallback(ctx);

  assert.equal(await inventoryRepo.getItem(uid, 'zyloveletter'), 0);
  const afterStock = await shopStockRepo.getItemStock('zyloveletter');
  assert.equal(afterStock.currentStock, 1, 'Selling limited item must return stock to Global shop');
  assert.equal(Number((await userRepo.getUser(uid)).wallet), 20);
  assert.equal(ctx.edits.length, 1);
  assert.match(ctx.edits[0].text, /Market Restocked/i);

  // If another copy is sold when stock is already 1, stock becomes 2 (never lost)
  await inventoryRepo.setItem(uid, 'zyloveletter', 1);
  const ctx2 = createMockCtx(uid, '', `sell:yes:zyloveletter:1:${uid}`);
  await sell.handleCallback(ctx2);
  assert.equal((await shopStockRepo.getItemStock('zyloveletter')).currentStock, 2);
});

test('Bug 3: /sell all liquidates loot atomically and credits accurate wallet payout', async () => {
  const uid = 910008;
  await userRepo.upsertUser(uid, 'seller8', 'Seller8');
  await userRepo.setWallet(uid, 100, '/test', 'seed');
  await inventoryRepo.setItem(uid, 'worm', 10); // 10 * 500 = 5,000
  await inventoryRepo.setItem(uid, 'boar', 2);  // 2 * 2500 = 5,000
  await inventoryRepo.setItem(uid, 'banknote', 1); // non-loot, must stay

  const ctx = createMockCtx(uid, '', `sell:yes:all:0:${uid}`);
  await sell.handleCallback(ctx);

  assert.equal(await inventoryRepo.getItem(uid, 'worm'), 0);
  assert.equal(await inventoryRepo.getItem(uid, 'boar'), 0);
  assert.equal(await inventoryRepo.getItem(uid, 'banknote'), 1);
  assert.equal(Number((await userRepo.getUser(uid)).wallet), 10_100);
  assert.match(ctx.edits[0].text, /Returned to Market/i);
});
