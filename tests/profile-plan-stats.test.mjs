/**
 * Profile scan count + plan badge: history length and server entitlement.
 * Run: node tests/profile-plan-stats.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const entJs = fs.readFileSync(path.join(root, 'js/entitlements.js'), 'utf8');
const syncJs = fs.readFileSync(path.join(root, 'js/studio-sync.js'), 'utf8');
const checkPlan = fs.readFileSync(path.join(root, 'api/check-plan.js'), 'utf8');
const security = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
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

console.log('\n== Profile scans + plan chrome ==');

test('Profile Scans reads history length, not total_scans', () => {
  const start = app.indexOf('function renderProf()');
  const block = app.slice(start, start + 900);
  assert.ok(block.includes("total=(typeof getHistory==='function'?getHistory():[]).length"));
  assert.ok(!block.includes("gs('total_scans'"));
  assert.ok(app.includes("countEl.textContent=hist.length+' scans'"));
});

test('history writes go through persistHistory with the Library cap', () => {
  assert.ok(app.includes('function persistHistory(hist)'));
  assert.ok(app.includes('ss(\'total_scans\', hist.length)'));
  assert.ok(app.includes('persistHistory(hist)'));
  assert.ok(app.includes('persistHistory(uniq)'));
  assert.ok(app.includes('persistHistory([])'));
  assert.ok(syncJs.includes('global.persistHistory(d.history.slice(0, MH))'));
  assert.ok(!app.includes("var tot=gs('total_scans',0)+1"));
});

test('plan chrome does not grant Pro from localStorage', () => {
  assert.ok(app.includes("var S = { plan: 'free'"));
  assert.ok(!app.includes("plan: gs('plan'"));
  assert.ok(!app.includes("else { S.plan = 'pro'; ss('plan', 'pro'); }"));
  assert.ok(entJs.includes('Never grant from localStorage'));
  assert.ok(entJs.includes('fromServer: true'));
  assert.ok(entJs.includes('function serverEnt()'));
});

test('Profile and Home require a settled server snapshot for Pro', () => {
  const home = app.slice(app.indexOf('function renderHome()'), app.indexOf('function renderMenu()'));
  const prof = app.slice(app.indexOf('function renderProf()'), app.indexOf('function openEditProf()'));
  assert.ok(home.includes("settled=!!(e&&e.fromServer)"));
  assert.ok(home.includes("isPro=settled&&(e.plan==='pro'||e.scansUnlimited===true)"));
  assert.ok(home.includes("S.authUser&&!settled"));
  assert.ok(home.includes('Checking plan'));
  assert.ok(prof.includes("settled=!!(e&&e.fromServer)"));
  assert.ok(prof.includes("isPro=settled&&(e.plan==='pro'||e.scansUnlimited===true)"));
  assert.ok(prof.includes("settled?(isPro?'PreShoot Pro':'Free Plan'):'Checking plan'"));
});

test('apply ignores error payloads and always refreshes Profile + Home', () => {
  assert.ok(entJs.includes('function isUsableSnapshot(data)'));
  assert.ok(entJs.includes("data.status === 'error'"));
  assert.ok(entJs.includes('if (!isUsableSnapshot(data)) return'));
  assert.ok(entJs.includes('if (typeof renderHome === \'function\') renderHome()'));
  assert.ok(entJs.includes('if (typeof renderProf === \'function\') renderProf()'));
  assert.ok(!entJs.includes("S.tab === 'profile' && typeof renderProf"));
});

test('auth restore awaits check-plan before painting Pro/Free chrome', () => {
  assert.ok(app.includes('var planReady = checkPlanServerSide'));
  assert.ok(app.includes('function paintAuthedChrome()'));
  assert.ok(app.includes('Promise.resolve(planReady).then(paintAuthedChrome, paintAuthedChrome)'));
  assert.ok(app.includes('return PreShootEntitlements.refresh()'));
});

test('subscription lookup errors do not fail-open to free', () => {
  assert.ok(checkPlan.includes("res.status(503).json({ ok: false, status: 'error' })"));
  assert.ok(!checkPlan.includes("res.status(200).json({ plan: 'free', status: 'error' })"));
  assert.ok(security.includes('Do not fail-open to free'));
  assert.ok(security.includes('throw e;'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
