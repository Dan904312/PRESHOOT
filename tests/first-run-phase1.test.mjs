/**
 * First-run Phase 1: guest scan path + empty-state / chip clarity.
 * Run: node tests/first-run-phase1.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const studioUi = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const workspaceUi = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
const trending = fs.readFileSync(path.join(root, 'js/trending.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
const security = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((n) => /\.(js|mjs|cjs|ts)$/.test(n));

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

const homeHtml = app.slice(app.indexOf('id="screen-home"'), app.indexOf('id="screen-results"'));
const startScanFn = app.slice(app.indexOf('function startScan(){'), app.indexOf('function startScan(){') + 900);
const renderLib = app.slice(app.indexOf('function renderLib()'), app.indexOf('function renderHome()'));
const renderHome = app.slice(app.indexOf('function renderHome()'), app.indexOf('function renderMenu()'));
const emptyStudio = studioUi.slice(
  studioUi.indexOf('if (!projects.length)'),
  studioUi.indexOf('All Projects')
);
const wizardStep1 = studioUi.slice(
  studioUi.indexOf("if (step === 1)"),
  studioUi.indexOf("} else if (step === 2)")
);

console.log('\n== First-run Phase 1 ==');

test('Hobby still has exactly 12 api functions and no new secrets', () => {
  assert.strictEqual(apiFiles.length, 12);
  assert.ok(security.includes('export async function requireGuestScanAccess'));
  assert.ok(security.includes("checkRateLimit(\n    'guest-scan:'"));
  assert.ok(security.includes('FREE_DAILY_SCANS'));
  assert.ok(!chat.includes('process.env.GUEST'));
  assert.ok(!security.includes('process.env.GUEST'));
});

test('Home photo/upload open capture without Profile dump', () => {
  assert.ok(app.includes('function startHomeCapture(kind)'));
  assert.ok(homeHtml.includes("onclick=\"startHomeCapture('cam')\""));
  assert.ok(homeHtml.includes("onclick=\"startHomeCapture('gal')\""));
  assert.ok(!homeHtml.includes("requireAuthOrPrompt('Sign in to scan scenes')"));
  assert.ok(app.includes("if(!S.authUser){ if(typeof requireAuthOrPrompt==='function') requireAuthOrPrompt('Sign in to use Director.')"));
});

test('startScan stays on Home and does not auth-wall guests', () => {
  assert.ok(!startScanFn.includes('requireAuthOrPrompt'));
  assert.ok(startScanFn.includes("apiFetch('/api/chat'"));
  assert.ok(app.includes('function scanFriendlyError(raw)'));
  assert.ok(!startScanFn.includes("goTab('profile')"));
});

test('guest /api/chat uses existing scan pipeline without new keys', () => {
  assert.ok(chat.includes('requireUser'));
  assert.ok(chat.includes('requireGuestScanAccess'));
  assert.ok(chat.includes("auth.error !== 'auth_required'"));
  assert.ok(chat.includes('if (user)'));
  assert.ok(chat.includes('if (response.ok && user)'));
  assert.ok(!chat.includes('ANTHROPIC_API_KEY_GUEST'));
});

test('Library History empty routes to the same Home capture', () => {
  assert.ok(renderLib.includes('No scans yet'));
  assert.ok(renderLib.includes('Scans and saved ideas live here.'));
  assert.ok(renderLib.includes("startHomeCapture(\\'cam\\')") || renderLib.includes("startHomeCapture('cam')"));
  assert.ok(renderLib.includes("startHomeCapture(\\'gal\\')") || renderLib.includes("startHomeCapture('gal')"));
  assert.ok(renderLib.includes('Take a photo'));
  assert.ok(renderLib.includes('>Upload</button>'));
});

test('Studio empty is scan-first with one blank create and no composer', () => {
  assert.ok(emptyStudio.includes('Start with a scan'));
  assert.ok(emptyStudio.includes('Blank project'));
  assert.ok(!emptyStudio.includes('Create Project'));
  assert.ok(!emptyStudio.includes('New Project'));
  assert.ok(!emptyStudio.includes('renderDirectorCommandBar'));
  assert.ok(emptyStudio.includes('Director unlocks after you start a project'));
  assert.ok(emptyStudio.includes('startHomeCapture'));
  assert.ok(studioUi.includes("studioHeaderActionsHtml({ emptyStudio: !projects.length })"));
  assert.ok(workspaceUi.includes('if (!opts.emptyStudio)'));
  assert.ok(studioUi.includes("placeholder: 'Tell Director what you would like to do'"));
});

test('New Project modal explains Project vs production', () => {
  assert.ok(wizardStep1.includes('Project = campaign folder'));
  assert.ok(wizardStep1.includes('productions (individual videos)'));
});

test('Home chips use readable quota and streak labels', () => {
  assert.ok(app.includes('Streak: 0 days'));
  assert.ok(renderHome.includes("'Streak: '+streak+' day'"));
  assert.ok(renderHome.includes("' left today</span>'") || renderHome.includes(' left today'));
  assert.ok(!renderHome.includes("+' left</span>'"));
  assert.ok(homeHtml.includes('scan-zone-foot'));
  assert.ok(homeHtml.includes('director-card'));
});

test('Trending empty is clear and routes to a personal scan', () => {
  assert.ok(trending.includes('No public trends right now'));
  assert.ok(trending.includes('Scan for personal ideas'));
  assert.ok(trending.includes('startHomeCapture'));
  assert.ok(!trending.includes('Waiting for public sources.'));
  assert.ok(trending.includes('No public sources available.'));
  assert.ok(trending.includes('This is not your Library'));
});

test('Empty Studio omits the footer composer so the dock stays clear', () => {
  assert.ok(app.includes('#screen-studio .studio-shell:not(:has(> .dir-cmd)) .studio-scroll'));
  assert.ok(app.includes('padding-bottom:var(--bnav-clearance)'));
  assert.ok(!emptyStudio.includes('dir-cmd-input'));
});

test('no product tour and dock/theme files stay untouched by this slice', () => {
  assert.ok(!app.includes('product tour'));
  assert.ok(!app.includes('startProductTour'));
  assert.ok(app.includes('class="bnav'));
  assert.ok(app.includes('--bnav-clearance'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
