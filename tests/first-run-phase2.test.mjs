/**
 * First-run Phase 2: post-ideas Studio handoff + Production context.
 * Run: node tests/first-run-phase2.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const studioUi = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const calendar = fs.readFileSync(path.join(root, 'js/calendar.js'), 'utf8');
const workspaceUi = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
const land = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
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

const emptyStudio = studioUi.slice(
  studioUi.indexOf('if (!projects.length)'),
  studioUi.indexOf('All Projects')
);
const quickActions = studioUi.slice(
  studioUi.indexOf('function renderDirectorQuickActions'),
  studioUi.indexOf('function runDirectorQuick')
);
const prodDetail = studioUi.slice(
  studioUi.indexOf('function renderProductionDetail'),
  studioUi.indexOf('function setProdSection')
);
const crumbBlock = prodDetail.slice(
  prodDetail.indexOf('studioCrumbHtml(['),
  prodDetail.indexOf(']);') + 3
);
const openIdea = app.slice(app.indexOf('function openIdea('), app.indexOf('function shClose('));
const renderResults = app.slice(app.indexOf('function renderResults()'), app.indexOf('function quickSave('));
const homeHtml = app.slice(app.indexOf('id="screen-home"'), app.indexOf('id="screen-results"'));
const menuHtml = app.slice(app.indexOf('id="screen-menu"'), app.indexOf('id="screen-profile"'));

console.log('\n== First-run Phase 2 ==');

test('Hobby still has exactly 12 api functions and no new secrets', () => {
  assert.strictEqual(apiFiles.length, 12);
  assert.ok(security.includes('FREE_DAILY_SCANS'));
  assert.ok(!app.includes('ANTHROPIC_API_KEY_GUEST'));
  assert.ok(!studioUi.includes('process.env.'));
  assert.ok(!calendar.includes('process.env.'));
});

test('idea cards and sheet offer one-step Build in Studio', () => {
  assert.ok(renderResults.includes('Build in Studio'));
  assert.ok(renderResults.includes('Open best in Studio'));
  assert.ok(renderResults.includes("buildFromIdea("));
  assert.ok(renderResults.includes('event.stopPropagation()'));
  assert.ok(openIdea.includes('Build in Studio'));
  assert.ok(
    openIdea.includes("A project holds your videos; this production is the one you\\'re planning.") ||
      openIdea.includes("A project holds your videos; this production is the one you're planning.")
  );
  assert.ok(openIdea.includes('Choose destination'));
  assert.ok(openIdea.includes('openSendToStudio'));
  assert.ok(studioUi.includes('function buildFromIdea'));
  assert.ok(studioUi.includes('importIdeaIntoStudio'));
  assert.ok(studioUi.includes("toast: 'Opened in Studio'"));
  assert.ok(studioUi.includes('buildFromIdea: buildFromIdea'));
});

test('Build in Studio is skippable and does not tour', () => {
  assert.ok(renderResults.includes('or tap an idea to browse'));
  assert.ok(openIdea.includes('openIdea'));
  assert.ok(!app.includes('startProductTour'));
  assert.ok(!app.includes('product tour'));
  assert.ok(!studioUi.includes('startProductTour'));
});

test('production breadcrumb is Studio / Project / Production', () => {
  assert.ok(crumbBlock.includes("label: 'Studio'"));
  assert.ok(crumbBlock.includes('label: project.name'));
  assert.ok(crumbBlock.includes('label: prod.name'));
  assert.ok(!crumbBlock.includes('sectionNowCopy(section).t'));
  assert.ok((crumbBlock.match(/label:/g) || []).length === 3);
});

test('Production open Director has three non-render samples and names the production', () => {
  assert.ok(quickActions.includes('Write the script'));
  assert.ok(quickActions.includes('Build the shot list'));
  assert.ok(quickActions.includes('Use this production'));
  assert.ok(quickActions.includes('generateScript'));
  assert.ok(quickActions.includes('generateShotList'));
  assert.ok(!/render finished|export finished|generate final video|finish the edit/i.test(quickActions));
  assert.ok(studioUi.includes("placeholder: ph"));
  assert.ok(studioUi.includes("Commands this production: "));
  assert.ok(prodDetail.includes('renderDirectorCard(productionId)'));
});

test('empty Studio stays scan-first; Director is not peer-primary', () => {
  assert.ok(emptyStudio.includes('Start with a scan'));
  assert.ok(emptyStudio.includes('Blank project'));
  assert.ok(!emptyStudio.includes('Write the script'));
  assert.ok(!emptyStudio.includes('renderDirectorQuickActions'));
  assert.ok(!emptyStudio.includes('renderDirectorCommandBar'));
  assert.ok(emptyStudio.includes('Director unlocks after you start a project'));
  assert.ok(homeHtml.includes('Plan with AI after you scan'));
  assert.ok(homeHtml.includes('director-card'));
});

test('Calendar pre-scan leads with scan, not plan-first', () => {
  assert.ok(calendar.includes('function isPreScanEmpty'));
  assert.ok(calendar.includes('Scan to get ideas to plan'));
  assert.ok(calendar.includes("startHomeCapture(\\'cam\\')") || calendar.includes("startHomeCapture('cam')"));
  assert.ok(calendar.includes('Show calendar'));
  assert.ok(calendar.includes('Plan content later'));
  assert.ok(calendar.includes('!isPreScanEmpty()'));
  const root = { innerHTML: '' };
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Intl,
    parseInt,
    String,
    Number,
    Boolean,
    Array,
    Object,
    document: {
      getElementById: function (id) {
        if (id === 'plan-root') return root;
        return { innerHTML: '', style: {}, textContent: '' };
      },
      querySelector: function () { return null; }
    },
    S: {},
    getHistory: function () { return []; },
    getLib: function () { return []; },
    startHomeCapture: function () {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(calendar, sandbox);
  sandbox.PreShootCalendar.render();
  assert.ok(root.innerHTML.includes('Scan to get ideas to plan'));
  assert.ok(root.innerHTML.includes('Show calendar'));
  assert.ok(!root.innerHTML.includes('+ Plan Content'));
  assert.ok(!root.innerHTML.includes('plan-stats'));
});

test('Menu is grouped and scrolls above the dock', () => {
  assert.ok(menuHtml.includes('>Settings<'));
  assert.ok(menuHtml.includes('>Planning<'));
  assert.ok(menuHtml.includes('>Creator prefs<'));
  assert.ok(menuHtml.includes('>Danger zone<'));
  assert.ok(menuHtml.includes('menu-sec-defer'));
  assert.ok(app.includes('#screen-menu > .sb{padding-bottom:calc(var(--bnav-clearance) + 16px)'));
  assert.ok(app.includes('classList.toggle(\'pre-scan\''));
  assert.ok(app.includes('.appear-sheet{max-height:min(88vh, calc(100dvh - var(--bnav-clearance)))'));
  assert.ok(app.includes("id:'dark',label:'Dark'"));
  assert.ok(app.includes("id:'light',label:'Light'"));
  assert.ok(app.includes("id:'auto',label:'Auto'"));
});

test('guest workspace tap explains sign-in instead of toast-only', () => {
  assert.ok(workspaceUi.includes('function renderGuestWorkspaceNote'));
  assert.ok(workspaceUi.includes('Sign in to sync and share'));
  assert.ok(workspaceUi.includes('showGuestWorkspaceExplain'));
  assert.ok(!/function openSwitcher\(\) \{\s*if \(!global\.S \|\| !global\.S\.authUser\) \{\s*toast\('Sign in to manage workspaces'\)/.test(workspaceUi));
  assert.ok(workspaceUi.includes("goTab('profile')"));
});

test('guest scan path and Phase 1 empty states are intact', () => {
  assert.ok(app.includes('function startHomeCapture(kind)'));
  assert.ok(homeHtml.includes("onclick=\"startHomeCapture('cam')\""));
  assert.ok(!homeHtml.includes("requireAuthOrPrompt('Sign in to scan scenes')"));
  assert.ok(emptyStudio.includes('startHomeCapture'));
});

test('landing fold CTA is scan-free; sticky Open app and hero stay', () => {
  assert.ok(land.includes('class="nav-cta">Open app</a>'));
  assert.ok(land.includes('cta-kicker">Open app</div>'));
  assert.ok(land.includes('cta-label">Scan free</div>'));
  assert.ok(land.includes('id="cinematic-hero"'));
  assert.ok(land.includes('Scan <span class="anything">ANYTHING</span>'));
});

test('cache-bust marks Phase 2 scripts', () => {
  /* Version tip moves with later slices; only require it stays busted. */
  assert.ok(/studio-ui\.js\?v=[\w.-]+/.test(app));
  assert.ok(app.includes('calendar.js?v=p3'));
  assert.ok(app.includes('workspace-ui.js?v=p3'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
