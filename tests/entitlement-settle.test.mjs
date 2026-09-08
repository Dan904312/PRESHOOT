/**
 * Plan-settle: fromServer on success, Free-safe fallback on timeout/error.
 * Run: node tests/entitlement-settle.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/entitlements.js'), 'utf8');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(function () {
        passed += 1;
        console.log('  ✓', name);
      }).catch(function (e) {
        failed += 1;
        console.error('  ✗', name, '\n   ', e.message);
      });
    }
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

function loadEntitlements(opts) {
  opts = opts || {};
  const timers = [];
  const ctx = {
    console: console,
    S: {
      plan: 'free',
      entitlement: null,
      authUser: opts.authUser === undefined ? { id: 'u1', email: 'a@b.c' } : opts.authUser,
      tab: 'home'
    },
    scansToday: function () {
      return opts.scansToday || 0;
    },
    ss: function () {},
    renderHome: function () {
      ctx.homePaints = (ctx.homePaints || 0) + 1;
    },
    renderProf: function () {
      ctx.profPaints = (ctx.profPaints || 0) + 1;
    },
    handleAccountSuspended: function () {
      ctx.suspended = true;
      ctx.S.authUser = null;
      ctx.S.plan = 'free';
      ctx.S.entitlement = null;
    },
    document: {
      getElementById: function () {
        return null;
      }
    },
    setTimeout: function (fn, ms) {
      const id = timers.length + 1;
      timers.push({ id: id, fn: fn, ms: ms });
      return id;
    },
    clearTimeout: function (id) {
      const i = timers.findIndex(function (t) {
        return t.id === id;
      });
      if (i >= 0) timers.splice(i, 1);
    },
    apiFetch: opts.apiFetch || function () {
      return Promise.reject(new Error('no api'));
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx._timers = timers;
  return ctx;
}

const freeSnap = {
  plan: 'free',
  status: 'none',
  director: false,
  studio: false,
  scansUnlimited: false,
  canScan: true,
  freeScansRemaining: 0,
  dailyScansRemaining: 3
};

const proSnap = {
  plan: 'pro',
  status: 'active',
  director: true,
  studio: true,
  scansUnlimited: true,
  canScan: true,
  freeScansRemaining: 0,
  dailyScansRemaining: null
};

console.log('\n== Entitlement plan settle ==');

test('successful apply sets fromServer and paints Home + Profile', () => {
  const ctx = loadEntitlements();
  const ok = ctx.PreShootEntitlements.apply(freeSnap);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.S.entitlement.fromServer, true);
  assert.strictEqual(ctx.S.entitlement.plan, 'free');
  assert.strictEqual(ctx.S.entitlement.planConfirmFailed, undefined);
  assert.ok(ctx.homePaints >= 1);
  assert.ok(ctx.profPaints >= 1);
});

test('Pro apply never comes from empty cache and settleFallback will not downgrade it', () => {
  const ctx = loadEntitlements();
  ctx.PreShootEntitlements.apply(proSnap);
  assert.strictEqual(ctx.S.plan, 'pro');
  assert.strictEqual(ctx.S.entitlement.scansUnlimited, true);
  ctx.PreShootEntitlements.settleFallback('timeout');
  assert.strictEqual(ctx.S.plan, 'pro');
  assert.notStrictEqual(ctx.S.entitlement.planConfirmFailed, true);
});

test('error and empty payloads do not set fromServer or grant Pro', () => {
  const ctx = loadEntitlements();
  assert.strictEqual(ctx.PreShootEntitlements.apply({ ok: false, status: 'error' }), false);
  assert.ok(!ctx.S.entitlement);
  assert.strictEqual(ctx.PreShootEntitlements.apply({ plan: 'free', status: 'rate_limited' }), false);
  assert.ok(!ctx.S.entitlement);
  assert.strictEqual(ctx.PreShootEntitlements.apply(null), false);
  assert.strictEqual(ctx.S.plan, 'free');
});

test('account_suspended does not settle a plan snapshot', () => {
  const ctx = loadEntitlements();
  const ok = ctx.PreShootEntitlements.apply({
    status: 'account_suspended',
    error: 'account_suspended',
    blocked: true
  });
  assert.strictEqual(ok, 'suspended');
  assert.strictEqual(ctx.suspended, true);
  assert.ok(!ctx.S.entitlement);
});

test('timeout settle is 5-8s and leaves Checking plan with Free-safe chrome', () => {
  const ctx = loadEntitlements({
    apiFetch: function () {
      return new Promise(function () {});
    }
  });
  ctx.PreShootEntitlements.refresh();
  assert.ok(ctx._timers.length >= 1);
  assert.strictEqual(ctx._timers[0].ms, 7000);
  assert.ok(ctx.PreShootEntitlements.SETTLE_MS >= 5000);
  assert.ok(ctx.PreShootEntitlements.SETTLE_MS <= 8000);
  assert.ok(!ctx.S.entitlement);
  ctx._timers[0].fn();
  assert.strictEqual(ctx.S.entitlement.fromServer, true);
  assert.strictEqual(ctx.S.entitlement.plan, 'free');
  assert.strictEqual(ctx.S.entitlement.scansUnlimited, false);
  assert.strictEqual(ctx.S.entitlement.planConfirmFailed, true);
  assert.ok(ctx.homePaints >= 1);
  assert.ok(ctx.profPaints >= 1);
});

await test('network failure settles Free-safe without Pro', async () => {
  const ctx = loadEntitlements({
    apiFetch: function () {
      return Promise.reject(new Error('offline'));
    }
  });
  await ctx.PreShootEntitlements.refresh();
  assert.strictEqual(ctx.S.entitlement.fromServer, true);
  assert.strictEqual(ctx.S.plan, 'free');
  assert.notStrictEqual(ctx.S.entitlement.plan, 'pro');
  assert.strictEqual(ctx.S.entitlement.planConfirmFailed, true);
});

await test('unusable check-plan JSON settles instead of sticking on Checking plan', async () => {
  const ctx = loadEntitlements({
    apiFetch: function () {
      return Promise.resolve({
        json: function () {
          return Promise.resolve({ ok: false, status: 'error' });
        }
      });
    }
  });
  await ctx.PreShootEntitlements.refresh();
  assert.strictEqual(ctx.S.entitlement.fromServer, true);
  assert.strictEqual(ctx.S.entitlement.plan, 'free');
  assert.strictEqual(ctx.S.entitlement.scansUnlimited, false);
});

await test('healthy check-plan refresh applies Pro and does not keep Checking plan', async () => {
  const ctx = loadEntitlements({
    apiFetch: function () {
      return Promise.resolve({
        json: function () {
          return Promise.resolve(proSnap);
        }
      });
    }
  });
  await ctx.PreShootEntitlements.refresh();
  assert.strictEqual(ctx.S.entitlement.fromServer, true);
  assert.strictEqual(ctx.S.plan, 'pro');
  assert.notStrictEqual(ctx.S.entitlement.planConfirmFailed, true);
  assert.ok(ctx._timers.length === 0);
});

test('guest refresh does not invent a plan snapshot', () => {
  const ctx = loadEntitlements({ authUser: null });
  ctx.PreShootEntitlements.refresh();
  ctx.PreShootEntitlements.settleFallback('timeout');
  assert.ok(!ctx.S.entitlement);
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
