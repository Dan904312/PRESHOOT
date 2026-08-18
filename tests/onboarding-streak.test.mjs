/**
 * Onboarding reward + creator streak invariants.
 * Run: node tests/onboarding-streak.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyStreakTransition,
  sanitizeTimezone,
  localDateIso,
  addDaysIso,
  buildEntitlementSnapshot,
  trialActive,
  ONBOARDING_FREE_SCANS,
  STREAK_MILESTONES
} from '../lib/entitlements.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

const sql = fs.readFileSync(path.join(root, 'supabase_onboarding_streak.sql'), 'utf8');
const checkPlan = fs.readFileSync(path.join(root, 'api/check-plan.js'), 'utf8');
const security = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
const onboard = fs.readFileSync(path.join(root, 'js/onboard.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const streakJs = fs.readFileSync(path.join(root, 'js/streak.js'), 'utf8');
const entJs = fs.readFileSync(path.join(root, 'js/entitlements.js'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((f) => /\.js$/.test(f));

console.log('\n== Onboarding reward + creator streak ==');

test('first activity starts streak at 1', () => {
  const r = applyStreakTransition({ current: 0, longest: 0, lastActiveDate: null, days: [] }, '2026-08-18');
  assert.strictEqual(r.current, 1);
  assert.strictEqual(r.longest, 1);
  assert.strictEqual(r.incremented, true);
});

test('next calendar day increments once', () => {
  const d1 = applyStreakTransition({ current: 0, longest: 0, days: [] }, '2026-08-17');
  const d2 = applyStreakTransition(d1, '2026-08-18');
  const d3 = applyStreakTransition(d2, '2026-08-19');
  assert.strictEqual(d3.current, 3);
  assert.strictEqual(d3.longest, 3);
  assert.strictEqual(d3.milestone, 3);
});

test('same-day actions do not increment again', () => {
  const first = applyStreakTransition({ current: 0, longest: 0, days: [] }, '2026-08-18');
  const again = applyStreakTransition(first, '2026-08-18');
  assert.strictEqual(again.current, 1);
  assert.strictEqual(again.incremented, false);
  assert.strictEqual(again.milestone, null);
});

test('skipped day resets current streak to 1', () => {
  const mon = applyStreakTransition({ current: 0, longest: 0, days: [] }, '2026-08-17');
  const wed = applyStreakTransition(mon, '2026-08-19');
  assert.strictEqual(wed.current, 1);
  assert.strictEqual(wed.longest, 1);
  assert.strictEqual(wed.incremented, true);
});

test('longest streak is preserved across a skip', () => {
  let s = { current: 0, longest: 0, days: [] };
  s = applyStreakTransition(s, '2026-08-10');
  s = applyStreakTransition(s, '2026-08-11');
  s = applyStreakTransition(s, '2026-08-12');
  s = applyStreakTransition(s, '2026-08-14');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.longest, 3);
});

test('milestones include 3/7/14/30/60/100', () => {
  assert.deepStrictEqual(STREAK_MILESTONES, [3, 7, 14, 30, 60, 100]);
});

test('timezone sanitizer rejects injection and unknown zones', () => {
  assert.strictEqual(sanitizeTimezone('Australia/Sydney'), 'Australia/Sydney');
  assert.strictEqual(sanitizeTimezone('UTC'), 'UTC');
  assert.strictEqual(sanitizeTimezone("UTC; drop table users"), 'UTC');
  assert.strictEqual(sanitizeTimezone('../Etc/Evil'), 'UTC');
  assert.strictEqual(sanitizeTimezone('Not/AZone'), 'UTC');
});

test('localDateIso is YYYY-MM-DD in the given zone', () => {
  const iso = localDateIso(new Date('2026-08-18T02:00:00.000Z'), 'Pacific/Auckland');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(iso));
  assert.strictEqual(addDaysIso('2026-08-18', -1), '2026-08-17');
});

test('paid plan is unlimited and not a fake trial', () => {
  const snap = buildEntitlementSnapshot(
    { plan: 'pro', status: 'active' },
    {
      onboarding_reward_granted: true,
      free_scans_remaining: 3,
      director_trial_ends_at: '2099-01-01T00:00:00.000Z',
      studio_trial_ends_at: '2099-01-01T00:00:00.000Z'
    },
    new Date('2026-08-18T00:00:00.000Z'),
    0
  );
  assert.strictEqual(snap.plan, 'pro');
  assert.strictEqual(snap.scansUnlimited, true);
  assert.strictEqual(snap.director, true);
  assert.strictEqual(snap.studio, true);
});

test('onboarding overlay unlocks Director/Studio without changing paid plan', () => {
  const ends = '2026-08-19T00:00:00.000Z';
  const snap = buildEntitlementSnapshot(
    { plan: 'free', status: 'none' },
    {
      onboarding_reward_granted: true,
      free_scans_remaining: ONBOARDING_FREE_SCANS,
      director_trial_ends_at: ends,
      studio_trial_ends_at: ends
    },
    new Date('2026-08-18T00:00:00.000Z'),
    3
  );
  assert.strictEqual(snap.plan, 'free');
  assert.strictEqual(snap.director, true);
  assert.strictEqual(snap.studio, true);
  assert.strictEqual(snap.scansUnlimited, false);
  assert.strictEqual(snap.freeScansRemaining, 3);
  assert.strictEqual(snap.canScan, true);
  assert.strictEqual(trialActive(ends, new Date('2026-08-20T00:00:00.000Z')), false);
});

test('expired trial returns to free entitlements', () => {
  const snap = buildEntitlementSnapshot(
    { plan: 'free', status: 'none' },
    {
      onboarding_reward_granted: true,
      free_scans_remaining: 0,
      director_trial_ends_at: '2026-08-01T00:00:00.000Z',
      studio_trial_ends_at: '2026-08-01T00:00:00.000Z'
    },
    new Date('2026-08-18T00:00:00.000Z'),
    3
  );
  assert.strictEqual(snap.director, false);
  assert.strictEqual(snap.studio, false);
  assert.strictEqual(snap.canScan, false);
});

test('SQL grant is idempotent and does not write subscriptions', () => {
  assert.ok(sql.includes('FOR UPDATE'));
  assert.ok(sql.includes('onboarding_reward_granted IS TRUE'));
  assert.ok(sql.includes('already_granted'));
  assert.ok(sql.includes('free_scans_remaining = 3'));
  assert.ok(sql.includes("interval '24 hours'"));
  assert.ok(!/INSERT INTO subscriptions/i.test(sql));
  assert.ok(!/UPDATE subscriptions/i.test(sql));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION grant_onboarding_reward'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION grant_onboarding_reward'));
});

test('SQL scan consume is atomic and refunds are capped at 3', () => {
  assert.ok(sql.includes('free_scans_remaining = free_scans_remaining - 1'));
  assert.ok(sql.includes('AND free_scans_remaining > 0'));
  assert.ok(sql.includes('LEAST(3, free_scans_remaining + 1)'));
});

test('SQL streak uses sanitized timezone, not browser-supplied dates', () => {
  assert.ok(sql.includes('preshoot_local_date'));
  assert.ok(sql.includes('preshoot_sanitize_tz'));
  assert.ok(!sql.includes('p_today'));
});

test('reward/activity reuse check-plan — no extra serverless file', () => {
  assert.ok(checkPlan.includes("action === 'grant_onboarding_reward'"));
  assert.ok(checkPlan.includes("action === 'record_activity'"));
  assert.ok(security.includes("scanSource: 'onboarding'"));
  assert.ok(chat.includes('undoOnboardingCredit'));
  assert.ok(chat.includes('refundOnboardingScan'));
  assert.strictEqual(apiFiles.length, 12);
  assert.ok(!apiFiles.includes('onboarding.js'));
  assert.ok(!apiFiles.includes('streak.js'));
});

test('onboarding completion grants via server, not localStorage', () => {
  assert.ok(onboard.includes('completeOnboarding'));
  assert.ok(entJs.includes("grant_onboarding_reward"));
  assert.ok(!entJs.includes("ss('ob_done')"));
  assert.ok(app.includes('reward-modal'));
  assert.ok(app.includes("You're ready to create"));
  assert.ok(app.includes('Start creating'));
});

test('calendar uses accent tokens, not hardcoded green', () => {
  assert.ok(streakJs.includes('streak-cal-day'));
  assert.ok(app.includes('.streak-cal-day.is-active{background:var(--accent)'));
  assert.ok(!/is-active\{[^}]*#22c55e/i.test(app));
  assert.ok(app.includes('prof-streak-slot'));
});

test('client gates Director/Studio through overlay helpers', () => {
  assert.ok(app.includes('hasDirectorAccess'));
  assert.ok(entJs.includes('hasDirector'));
  assert.ok(entJs.includes('hasStudio'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
