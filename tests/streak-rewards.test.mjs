/**
 * Streak reconstruction, timezone, milestone rewards, stacking.
 * Run: node tests/streak-rewards.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  addDaysIso,
  applyStreakTransition,
  buildEntitlementSnapshot,
  computeStackedExpiry,
  computeStreakFromDates,
  evaluateMilestoneGrants,
  freezeCoversDate,
  localDateIso,
  longestConsecutiveRun,
  nextRewardProgress,
  resolveRewardForPlan,
  sanitizeTimezone,
  STREAK_KINDS,
  STREAK_MILESTONES,
  STREAK_REWARD_CATALOG
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

function daysFrom(start, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDaysIso(start, i));
  return out;
}

const chat = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
const director = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
const checkPlan = fs.readFileSync(path.join(root, 'api/check-plan.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const entJs = fs.readFileSync(path.join(root, 'js/entitlements.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase_streak_activity.sql'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((f) => /\.js$/.test(f));

console.log('\n== Streak + consistency rewards ==');

test('day 1 activity → current streak 1', () => {
  const s = computeStreakFromDates(['2026-08-21'], '2026-08-21');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.longest, 1);
  assert.strictEqual(s.todayComplete, true);
});

test('consecutive Aug 21–22 → streak 2', () => {
  const s = computeStreakFromDates(['2026-08-21', '2026-08-22'], '2026-08-22');
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.longest, 2);
});

test('many actions on one local day still equal 1', () => {
  const first = applyStreakTransition({ current: 0, longest: 0, days: [] }, '2026-08-21');
  let s = first;
  for (let i = 0; i < 14; i++) s = applyStreakTransition(s, '2026-08-21');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.incremented, false);
  const fromDates = computeStreakFromDates(
    ['2026-08-21', '2026-08-21', '2026-08-21'],
    '2026-08-21'
  );
  assert.strictEqual(fromDates.current, 1);
});

test('missed day resets current and keeps best', () => {
  const s = computeStreakFromDates(['2026-08-21', '2026-08-22', '2026-08-24'], '2026-08-24');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.longest, 2);
  assert.strictEqual(s.todayComplete, true);
});

test('today inactive + yesterday active → streak remains', () => {
  const s = computeStreakFromDates(['2026-08-20', '2026-08-21'], '2026-08-22');
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.todayComplete, false);
  assert.strictEqual(s.lastActiveDate, '2026-08-21');
});

test('missed day expired → current 0 until they return', () => {
  const s = computeStreakFromDates(['2026-08-20', '2026-08-21'], '2026-08-23');
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.longest, 2);
});

test('10 consecutive local dates → streak 10 and 48h free access grant', () => {
  const dates = daysFrom('2026-08-12', 10);
  const s = computeStreakFromDates(dates, '2026-08-21');
  assert.strictEqual(s.current, 10);
  const grants = evaluateMilestoneGrants(10, new Set(), 'free');
  const ten = grants.find((g) => g.days === 10);
  assert.ok(ten);
  assert.strictEqual(ten.kind, 'access');
  assert.strictEqual(ten.hours, 48);
  assert.strictEqual(ten.director, true);
  assert.strictEqual(ten.studio, true);
  const now = new Date('2026-08-30T14:32:00.000Z');
  assert.strictEqual(computeStackedExpiry([], 48, now), '2026-09-01T14:32:00.000Z');
});

test('duplicate milestone grant is skipped', () => {
  const once = evaluateMilestoneGrants(10, new Set(), 'free');
  const twice = evaluateMilestoneGrants(10, new Set([3, 7, 10]), 'free');
  assert.ok(once.some((g) => g.days === 10));
  assert.strictEqual(twice.length, 0);
});

test('paid users get an achievement at 10 days, not a fake subscription', () => {
  const grants = evaluateMilestoneGrants(10, new Set([3, 7]), 'pro');
  const ten = grants.find((g) => g.days === 10);
  assert.ok(ten);
  assert.strictEqual(ten.kind, 'achievement');
  assert.strictEqual(ten.hours, 0);
  assert.strictEqual(ten.skippedAccess, true);
  const resolved = resolveRewardForPlan(
    STREAK_REWARD_CATALOG.find((r) => r.days === 10),
    'pro'
  );
  assert.strictEqual(resolved.kind, 'achievement');
});

test('onboarding overlay and streak access stack by expiry, not overwrite', () => {
  const now = new Date('2026-08-21T10:00:00.000Z');
  const onboardingEnds = '2026-08-22T10:00:00.000Z';
  const stacked = computeStackedExpiry([onboardingEnds], 48, now);
  assert.strictEqual(stacked, '2026-08-24T10:00:00.000Z');
  const snap = buildEntitlementSnapshot(
    { plan: 'free', status: 'none' },
    {
      director_trial_ends_at: onboardingEnds,
      studio_trial_ends_at: onboardingEnds,
      streak_director_ends_at: stacked,
      streak_studio_ends_at: stacked,
      streak_current: 10,
      streak_longest: 10,
      streak_last_active_date: '2026-08-21',
      streak_days: daysFrom('2026-08-12', 10)
    },
    now,
    0
  );
  assert.strictEqual(snap.plan, 'free');
  assert.strictEqual(snap.director, true);
  assert.strictEqual(snap.studio, true);
  assert.strictEqual(snap.directorTrialEndsAt, onboardingEnds);
  assert.strictEqual(snap.streakAccessEndsAt, stacked);
});

test('Sydney 11:59pm is not tomorrow UTC', () => {
  const before = localDateIso(new Date('2026-08-21T13:59:00.000Z'), 'Australia/Sydney');
  const after = localDateIso(new Date('2026-08-21T14:00:00.000Z'), 'Australia/Sydney');
  assert.strictEqual(before, '2026-08-21');
  assert.strictEqual(after, '2026-08-22');
  assert.strictEqual(sanitizeTimezone('Australia/Sydney'), 'Australia/Sydney');
});

test('Hawaii evening stays on the local calendar date', () => {
  const iso = localDateIso(new Date('2026-08-22T07:30:00.000Z'), 'Pacific/Honolulu');
  assert.strictEqual(iso, '2026-08-21');
});

test('catalog is configurable and next reward is 10 days from 7', () => {
  assert.deepStrictEqual(STREAK_MILESTONES, [3, 7, 10, 30, 60, 100]);
  const p = nextRewardProgress(7);
  assert.strictEqual(p.target, 10);
  assert.strictEqual(p.reward.kind, 'access');
  assert.ok(STREAK_REWARD_CATALOG.every((r) => r.title && r.kind));
});

test('freeze helper is present but unused (architecture only)', () => {
  assert.strictEqual(freezeCoversDate(null, '2026-08-21'), false);
  assert.strictEqual(freezeCoversDate('2026-08-22', '2026-08-21'), true);
  assert.strictEqual(longestConsecutiveRun(['2026-08-01', '2026-08-03']), 1);
});

test('scan/director persist is awaited — not fire-and-forget', () => {
  assert.ok(chat.includes('await recordCreationActivity'));
  assert.ok(!/recordCreationActivity\([^;]+\)\.catch/.test(chat));
  assert.ok(director.includes('await recordCreationActivity'));
  assert.ok(!/recordCreationActivity\([^;]+\)\.catch/.test(director));
  assert.strictEqual(apiFiles.length, 12);
});

test('rewards are server-side; client cannot POST a streak count', () => {
  assert.ok(checkPlan.includes("action === 'record_activity'"));
  assert.ok(!/req\.body\.(current|streak|longest)/.test(checkPlan));
  assert.ok(checkPlan.includes('getSubscription'));
  assert.ok(sql.includes('UNIQUE (user_id, milestone)'));
  assert.ok(sql.includes('activity_events_user_day_kind'));
  assert.ok(sql.includes('streak_director_ends_at'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE activity_events'));
  assert.ok(!sql.includes('INSERT INTO subscriptions'));
});

test('UI displays server streak only — no localStorage source of truth', () => {
  assert.ok(app.includes("function getStreak(){ return (S.entitlement && S.entitlement.streak && S.entitlement.streak.current) || 0; }"));
  assert.ok(!/ss\('streak'/.test(app));
  assert.ok(entJs.includes("apiPost('record_activity'"));
  assert.ok(STREAK_KINDS.indexOf('onboarding') >= 0);
  assert.ok(STREAK_KINDS.indexOf('scan') >= 0);
});

test('personal workspace vs shared: kinds are user-scoped, workspace id is optional', () => {
  assert.ok(sql.includes('workspace_id text'));
  assert.ok(sql.includes('user_id text NOT NULL'));
  assert.ok(checkPlan.includes('workspaceId'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
