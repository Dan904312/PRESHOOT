/**
 * First-run Phase 3: progressive unlocks (A + sparse B + light D).
 * Run: node tests/first-run-phase3.test.mjs
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
const progress = fs.readFileSync(path.join(root, 'js/first-run-progress.js'), 'utf8');
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
const projectDetail = studioUi.slice(
  studioUi.indexOf('function renderProjectDetail'),
  studioUi.indexOf('function skillLevel')
);
const prodDetail = studioUi.slice(
  studioUi.indexOf('function renderProductionDetail'),
  studioUi.indexOf('function setProdSection')
);
const quickActions = studioUi.slice(
  studioUi.indexOf('function renderDirectorQuickActions'),
  studioUi.indexOf('function runDirectorQuick')
);
const homeHtml = app.slice(app.indexOf('id="screen-home"'), app.indexOf('id="screen-results"'));
const menuHtml = app.slice(app.indexOf('id="screen-menu"'), app.indexOf('id="screen-profile"'));
const renderResults = app.slice(app.indexOf('function renderResults()'), app.indexOf('function quickSave('));
const newCopy = [
  progress,
  studioUi.slice(studioUi.indexOf('Pick a production first'), studioUi.indexOf('Pick a production first') + 80),
  studioUi.slice(studioUi.indexOf('Continue plan:'), studioUi.indexOf('Continue plan:') + 40),
  studioUi.slice(studioUi.indexOf('No productions in this project yet'), studioUi.indexOf('No productions in this project yet') + 120)
].join('\n');

function loadProgress(extra) {
  const mem = {};
  const sandbox = Object.assign(
    {
      console,
      Date,
      Math,
      JSON,
      Object,
      Array,
      String,
      Number,
      Boolean,
      parseInt,
      localStorage: {
        getItem: function (k) {
          return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
        },
        setItem: function (k, v) {
          mem[k] = String(v);
        },
        removeItem: function (k) {
          delete mem[k];
        }
      },
      S: {},
      getHistory: function () {
        return [];
      },
      getLib: function () {
        return [];
      },
      document: {
        getElementById: function () {
          return null;
        },
        querySelectorAll: function () {
          return [];
        }
      }
    },
    extra || {}
  );
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(progress, sandbox);
  return sandbox;
}

function loadCalendar(extra) {
  const rootEl = { innerHTML: '' };
  const sandbox = Object.assign(
    {
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
          if (id === 'plan-root') return rootEl;
          return { innerHTML: '', style: {}, textContent: '' };
        },
        querySelector: function () {
          return null;
        }
      },
      S: {},
      getHistory: function () {
        return [];
      },
      getLib: function () {
        return [];
      },
      startHomeCapture: function () {}
    },
    extra || {}
  );
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(progress, sandbox);
  vm.runInContext(calendar, sandbox);
  sandbox.__root = rootEl;
  return sandbox;
}

console.log('\n== First-run Phase 3 ==');

test('Hobby still has exactly 12 api functions and no new secrets', () => {
  assert.strictEqual(apiFiles.length, 12);
  assert.ok(security.includes('FREE_DAILY_SCANS'));
  assert.ok(!app.includes('ANTHROPIC_API_KEY_GUEST'));
  assert.ok(!progress.includes('process.env.'));
  assert.ok(!studioUi.includes('process.env.'));
  assert.ok(!calendar.includes('process.env.'));
  assert.ok(!workspaceUi.includes('process.env.'));
  assert.ok(!app.includes('process.env.'));
});

test('chosen unlock thresholds are G1=1 scan/idea, G2=1 project/production, G3=3 scans or 2 productions', () => {
  const sb = loadProgress();
  const T = sb.PreShootFirstRun.THRESHOLDS;
  assert.strictEqual(T.g1Scans, 1);
  assert.strictEqual(T.g1Ideas, 1);
  assert.strictEqual(T.g2Projects, 1);
  assert.strictEqual(T.g3Scans, 3);
  assert.strictEqual(T.g3Productions, 2);
  assert.strictEqual(sb.PreShootFirstRun.getActivation().gate, 0);

  sb.getHistory = function () {
    return [{}];
  };
  assert.strictEqual(sb.PreShootFirstRun.getActivation().gate, 1);

  sb.PreShootStudio = {
    listProjects: function () {
      return [{ id: 'p1', productionCount: 0, productions: [] }];
    }
  };
  assert.strictEqual(sb.PreShootFirstRun.getActivation().gate, 2);

  sb.getHistory = function () {
    return [{}, {}, {}];
  };
  assert.strictEqual(sb.PreShootFirstRun.getActivation().gate, 3);
});

test('empty Studio stays scan-first; Director is muted until a production exists', () => {
  assert.ok(emptyStudio.includes('Start with a scan'));
  assert.ok(emptyStudio.includes('Blank project'));
  assert.ok(emptyStudio.includes('Director unlocks after you start a project'));
  assert.ok(!emptyStudio.includes('Write the script'));
  assert.ok(!emptyStudio.includes('renderDirectorCommandBar'));
  assert.ok(projectDetail.includes('Pick a production first'));
  assert.ok(projectDetail.includes('No productions in this project yet'));
  assert.ok(projectDetail.includes('New production'));
  assert.ok(projectDetail.includes('if (prods.length)'));
  assert.ok(prodDetail.includes('renderDirectorCard(productionId)'));
  assert.ok(quickActions.includes('Write the script'));
  assert.ok(quickActions.includes('Build the shot list'));
  assert.ok(quickActions.includes('Use this production'));
});

test('new Director / tip copy stays FAQ no-render', () => {
  assert.ok(progress.includes('PreShoot plans; it does not render finished video.'));
  assert.ok(progress.includes('Director can write the script and shot list'));
  assert.ok(!/export finished video|CapCut timeline|finished-video|generate final video/i.test(newCopy));
  assert.ok(!/export finished video|CapCut timeline|generate final video/i.test(progress));
  assert.ok(homeHtml.includes('Plan with AI after you scan'));
  assert.ok(homeHtml.includes('id="home-dir-sub"'));
  assert.ok(progress.includes('Commands this production'));
  assert.ok(progress.includes('Plan scripts and shot lists with AI'));
});

test('Menu prefs stay grouped; G1 unmutes; G0 folds creator prefs', () => {
  assert.ok(menuHtml.includes('>Creator prefs<'));
  assert.ok(menuHtml.includes('>Danger zone<'));
  assert.ok(menuHtml.includes('menu-defer-fold'));
  assert.ok(menuHtml.includes('menu-row-advanced'));
  assert.ok(app.includes('#screen-menu > .sb{padding-bottom:calc(var(--bnav-clearance) + 16px)'));
  assert.ok(progress.includes("classList.toggle('pre-scan'"));
  assert.ok(app.includes('applyMenuGates'));
  assert.ok(app.includes('id="appear-advanced"'));
  assert.ok(app.includes("id:'dark',label:'Dark'"));
});

test('Calendar Plan Content is primary only at G2+', () => {
  assert.ok(calendar.includes('function isPlanContentPrimary'));
  assert.ok(calendar.includes('gate >= 2'));
  assert.ok(calendar.includes('!isPreScanEmpty() && isPlanContentPrimary()'));

  const g0 = loadCalendar();
  g0.PreShootCalendar.render();
  assert.ok(g0.__root.innerHTML.includes('Scan to get ideas to plan'));
  assert.ok(g0.__root.innerHTML.includes('Show calendar'));
  assert.ok(!g0.__root.innerHTML.includes('+ Plan Content'));

  const g1 = loadCalendar({
    getHistory: function () {
      return [{ ts: Date.now(), ideas: [{}], sceneLabel: 'Desk' }];
    }
  });
  g1.PreShootCalendar.render();
  assert.ok(!g1.__root.innerHTML.includes('Show calendar'));
  assert.ok(g1.__root.innerHTML.includes('Plan content later'));
  assert.ok(!g1.__root.innerHTML.includes('+ Plan Content'));

  const g2 = loadCalendar({
    getHistory: function () {
      return [{ ts: Date.now(), ideas: [{}], sceneLabel: 'Desk' }];
    },
    PreShootStudio: {
      listProjects: function () {
        return [{ id: 'p1', productionCount: 1, productions: [{ id: 'x', name: 'Vid' }] }];
      },
      listCalendarEvents: function () {
        return [];
      }
    }
  });
  g2.PreShootCalendar.render();
  assert.ok(g2.__root.innerHTML.includes('+ Plan Content'));
});

test('Production-scoped vocab and Continue plan cards', () => {
  assert.ok(studioUi.includes("This is this production's Plan") || studioUi.includes("This is this production\\'s Plan"));
  assert.ok(studioUi.includes('Shot list for '));
  assert.ok(studioUi.includes('Script for '));
  assert.ok(studioUi.includes('Inspiration and files for this production'));
  assert.ok(studioUi.includes('No uploads in this production yet'));
  assert.ok(studioUi.includes('Continue plan: '));
  assert.ok(prodDetail.includes("label: 'Studio'"));
  assert.ok(prodDetail.includes('label: project.name'));
  assert.ok(prodDetail.includes('label: prod.name'));
});

test('optional tips are skippable, max three, never a tour', () => {
  assert.ok(progress.includes("PREFIX = 'ps_fr3_'"));
  assert.ok(progress.includes("'tip_studio'"));
  assert.ok(progress.includes("'tip_director'"));
  assert.ok(progress.includes("'tip_prefs'"));
  assert.ok(progress.includes('Got it'));
  assert.ok(renderResults.includes("shouldShowTip('studio')"));
  assert.ok(prodDetail.includes("shouldShowTip('director')"));
  assert.ok(app.includes('id="fr-tip-menu"'));
  assert.ok(!app.includes('startProductTour'));
  assert.ok(!progress.includes('startProductTour'));
  assert.ok(!studioUi.includes('startProductTour'));
  assert.ok(!app.includes('3-beat'));
  const sb = loadProgress({
    S: { ideas: [{ title: 'A' }] },
    getHistory: function () {
      return [{}];
    }
  });
  assert.ok(sb.PreShootFirstRun.shouldShowTip('studio'));
  assert.ok(sb.PreShootFirstRun.shouldShowTip('prefs'));
  sb.PreShootFirstRun.dismissTip('studio');
  assert.ok(!sb.PreShootFirstRun.shouldShowTip('studio'));
});

test('signed-in workspace copy is static; guest P2 path intact', () => {
  assert.ok(workspaceUi.includes('Active workspace:'));
  assert.ok(workspaceUi.includes('Switching syncs this Studio'));
  assert.ok(workspaceUi.includes('function renderGuestWorkspaceNote'));
  assert.ok(workspaceUi.includes('Sign in to sync and share'));
  assert.ok(workspaceUi.includes('showGuestWorkspaceExplain'));
});

test('guest scan + Build in Studio + dock/theme not regressed', () => {
  assert.ok(app.includes('function startHomeCapture(kind)'));
  assert.ok(homeHtml.includes("onclick=\"startHomeCapture('cam')\""));
  assert.ok(renderResults.includes('Build in Studio'));
  assert.ok(renderResults.includes('Open best in Studio'));
  assert.ok(app.includes("id:'dark',label:'Dark'"));
  assert.ok(app.includes("id:'light',label:'Light'"));
  assert.ok(app.includes("id:'auto',label:'Auto'"));
  assert.ok(app.includes('id="nav-home"'));
  assert.ok(app.includes('id="nav-library"'));
  assert.ok(app.includes('id="nav-studio"'));
  assert.ok(app.includes("goTab('menu')"));
  assert.ok(app.includes("goTab('profile')"));
  assert.ok(!app.includes('id="nav-director"'));
  assert.ok(app.includes('first-run-progress.js?v=p3'));
  assert.ok(app.includes('studio-ui.js?v=p3'));
  assert.ok(app.includes('calendar.js?v=p3'));
  assert.ok(app.includes('workspace-ui.js?v=p3'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
