/**
 * Director context: full script delivery, project brief, isolation, budget.
 * Run: node tests/director-context-quality.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

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

const NOURA_SCRIPT = [
  "Most students think they're bad at studying.",
  'But the truth is, nobody ever taught them how learning actually works.',
  'We built Noura to change that.',
  'Instead of passively reading information, students actively teach it back.',
  'And that changes everything.'
].join('\n\n');

/** Boots the real studio + context builder with a personal store. */
function boot() {
  const store = Object.create(null);
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    RegExp,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: function () {
      return 0;
    },
    clearTimeout: function () {},
    localStorage: {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (k, v) {
        store[k] = String(v);
      },
      removeItem: function (k) {
        delete store[k];
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.S = { tab: 'studio', studioView: { mode: 'list' }, niche: {}, gear: {}, aesthetic: {}, platformFocus: {} };
  vm.createContext(sandbox);
  ['js/shot-planner.js', 'js/studio.js', 'js/director-context.js'].forEach((rel) => {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  });
  return sandbox;
}

function seed(sb, opts) {
  opts = opts || {};
  const Studio = sb.PreShootStudio;
  const project = Studio.createProject({
    name: opts.projectName || 'Noura',
    notes: opts.projectNotes || 'Educational AI learning platform for students'
  });
  const production = Studio.createProduction(project.id, {
    name: opts.productionName || 'Noura launch explainer'
  }).production;
  const found = Studio.findProduction(production.id);
  const prod = Studio.ensureWorkspace(found.production);
  const ws = prod.workspace;
  ws.overview = Object.assign({}, ws.overview, {
    goal: opts.goal || 'Explain why traditional studying fails and how Noura changes learning',
    platform: 'TikTok',
    format: 'Educational short-form',
    audience: 'Students'
  });
  if (opts.script !== null) {
    const applied = Studio.applyScriptPlainText(ws, opts.script || NOURA_SCRIPT, 'replace');
    Studio.updateProduction(production.id, { workspace: applied.workspace });
  } else {
    Studio.updateProduction(production.id, { workspace: ws });
  }
  return { projectId: project.id, productionId: production.id };
}

function buildContext(sb, productionId, projectId, task) {
  sb.S.tab = 'studio';
  sb.S.studioView = { mode: 'production', productionId: productionId, projectId: projectId };
  return sb.PreShootDirectorContext.build({ task: task || 'shots' });
}

console.log('\n== Director context quality ==');

test('the entire script reaches the context, not a truncated line sample', () => {
  const sb = boot();
  const ids = seed(sb);
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(ctx.text.includes('=== FULL SCRIPT'), 'no full script section');
  assert.ok(ctx.text.includes('=== END OF SCRIPT ==='), 'script section is not delimited');
  NOURA_SCRIPT.split('\n\n').forEach((line) => {
    assert.ok(ctx.text.includes(line), 'missing script line: ' + line);
  });
});

test('a long script is not silently dropped by the context builder', () => {
  const sb = boot();
  const long = Array.from({ length: 120 }, (_, i) => 'Beat ' + (i + 1) + ': this is a real sentence of spoken script copy.').join('\n\n');
  const ids = seed(sb, { script: long });
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(ctx.text.includes('Beat 1:'), 'start of a long script missing');
  assert.ok(
    ctx.text.includes('Beat 60:') || ctx.text.includes('script truncated at'),
    'a long script was cut with no marker'
  );
});

test('project description and goal reach Director when a production is open', () => {
  const sb = boot();
  const ids = seed(sb, { projectNotes: 'Educational AI learning platform for students' });
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(ctx.text.includes('Educational AI learning platform'), 'project description never reached the model');
  assert.ok(/PROJECT_ID: /.test(ctx.text));
  assert.ok(/ISOLATION RULE/.test(ctx.text), 'no isolation instruction');
});

test('the internal brief carries subject, audience, purpose and constraints', () => {
  const sb = boot();
  sb.S.gear = { camera: 'iPhone 15 Pro', lighting: 'window light' };
  sb.S.niche = { experienceLevel: 'beginner' };
  const ids = seed(sb);
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  const match = ctx.text.match(/=== PRODUCTION BRIEF[^\n]*===\n(\{[\s\S]*?\})\n/);
  assert.ok(match, 'no brief object in context');
  const brief = JSON.parse(match[1]);
  assert.ok(/Noura/.test(brief.subject), 'brief subject is wrong: ' + brief.subject);
  assert.strictEqual(brief.audience, 'Students');
  assert.ok(/studying fails/.test(brief.purpose), 'brief purpose is wrong: ' + brief.purpose);
  assert.strictEqual(brief.platform, 'TikTok');
  assert.strictEqual(brief.hasScript, true);
  assert.ok(/iPhone/.test(brief.productionConstraints.gear), 'gear constraint missing');
  assert.strictEqual(brief.productionConstraints.skillLevel, 'beginner');
  assert.strictEqual(brief.narrativeStructure, '', 'structure must be derived from the script, not pre-filled');
});

test('constraints section forbids gear the creator has not declared', () => {
  const sb = boot();
  const ids = seed(sb);
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(/PRODUCTION CONSTRAINTS/.test(ctx.text));
  assert.ok(/Do not propose cranes, dollies, drones/.test(ctx.text));
});

test('another project cannot leak into the current production context', () => {
  const sb = boot();
  const a = seed(sb, { projectName: 'Noura', productionName: 'Noura explainer' });
  const b = seed(sb, {
    projectName: 'PhoneReviews',
    productionName: 'iPhone camera review',
    projectNotes: 'Gadget review channel',
    goal: 'Review the new iPhone camera',
    script: 'Today we are testing the new iPhone camera in low light.'
  });
  const ctx = buildContext(sb, a.productionId, a.projectId);
  assert.ok(ctx.text.includes('Noura launch explainer') || ctx.text.includes('Noura explainer'));
  assert.ok(!/iPhone camera review/.test(ctx.text), 'another production leaked in');
  assert.ok(!/Gadget review channel/.test(ctx.text), "another project's brief leaked in");
  assert.ok(!/testing the new iPhone camera in low light/.test(ctx.text), "another production's script leaked in");
  assert.ok(b.productionId, 'second production should exist');
});

test('shot list context shows coverage so Director can see the grouping', () => {
  const sb = boot();
  const ids = seed(sb);
  sb.PreShootStudio.buildShotListFromScript(ids.productionId, { allowStarter: false });
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(/SHOT LIST \(\d+\)/.test(ctx.text), 'no shot list section');
  assert.ok(/covers: /.test(ctx.text), 'shot coverage is not shown to Director');
});

test('shot planning stages describe the real pipeline', () => {
  const sb = boot();
  const ids = seed(sb);
  const ctx = buildContext(sb, ids.productionId, ids.projectId, 'shots');
  const stages = ctx.stages.join(' | ');
  assert.ok(/Reading the full script/.test(stages), stages);
  assert.ok(/Mapping narrative beats/.test(stages), stages);
  assert.ok(/Planning visual coverage/.test(stages), stages);
});

test('an empty script says so rather than implying one exists', () => {
  const sb = boot();
  const ids = seed(sb, { script: null });
  const ctx = buildContext(sb, ids.productionId, ids.projectId);
  assert.ok(/SCRIPT: none written yet/.test(ctx.text), 'no honest empty-script statement');
});

/* ── Server-side guarantees ───────────────────────────────────────── */

const directorSrc = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
const securitySrc = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
const osSrc = fs.readFileSync(path.join(root, 'js/director-os.js'), 'utf8');

test('the context cap no longer cuts the script off before it is sent', () => {
  assert.ok(/sanitizeContext\(ctx, maxChars\)/.test(securitySrc), 'sanitizeContext still has a fixed cap');
  assert.ok(/sanitizeContext\(headCtx, CONTEXT_BUDGET\)/.test(directorSrc), 'director does not raise the cap');
  assert.ok(/CONTEXT_BUDGET = 2\d000/.test(directorSrc), 'context budget was not raised');
});

test('context budgeting preserves the script when trimming is needed', () => {
  const budget = extractFunction(directorSrc, 'budgetContext');
  const sandbox = { console, Math, String, Number };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const budgetConst = directorSrc.match(/const CONTEXT_BUDGET = \d+;/)[0];
  vm.runInContext(budgetConst + '\n' + budget + '\nglobalThis.__fn = budgetContext;', sandbox, { filename: 'budget' });
  const script = '=== FULL SCRIPT (read all of it) ===\n' + 'S'.repeat(4000) + '\n=== END OF SCRIPT ===';
  const head = 'A'.repeat(30000) + script + 'B'.repeat(9000);
  const out = sandbox.__fn(head, '\n\nMODE: mutate');
  assert.ok(out.length <= 26000, 'budget exceeded: ' + out.length);
  assert.ok(out.includes('S'.repeat(4000)), 'the script was trimmed away');
  assert.ok(out.includes('MODE: mutate'), 'mutation directives were dropped');
  assert.ok(out.includes('[context trimmed]'), 'trimming was silent');
});

test('the system prompt bans line-by-line shot planning and generic titles', () => {
  assert.ok(/SHOT PLANNING \(MANDATORY PIPELINE\)/.test(directorSrc));
  assert.ok(/Never turn script lines into shots one at a time/.test(directorSrc));
  assert.ok(/Sentence count does not decide shot count/.test(directorSrc));
  assert.ok(/SEMANTIC BEATS/.test(directorSrc));
  assert.ok(/Never output "Setup", "Beat 1"/.test(directorSrc));
  assert.ok(/SELF-REVIEW BEFORE ANSWERING/.test(directorSrc));
  assert.ok(/\[\[SHOTS:/.test(directorSrc), 'no structured shot plan contract');
});

test('the client parses a structured shot plan and normalizes shot types', () => {
  const sandbox = { console, Date, Math, JSON, RegExp, Object, Array, String, Number, Boolean, parseInt, isNaN };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.S = { tab: 'studio', studioView: { productionId: 'prod_1' } };
  sandbox.localStorage = { getItem: () => null, setItem: () => {} };
  vm.createContext(sandbox);
  vm.runInContext(osSrc, sandbox, { filename: 'director-os.js' });
  const OS = sandbox.PreShootDirectorOS;
  const reply =
    'Planned from the whole script.\n' +
    '[[SHOTS:{"productionId":"prod_1","contentType":"educational","subject":"Noura","shots":[' +
    '{"title":"Opening misconception","shotType":"A-Roll","durationSec":3,"scriptCoverage":[{"text":"Most students think they are bad at studying."},{"text":"Nobody taught them how learning works."}]},' +
    '{"title":"Introducing Noura","shotType":"screen recording","durationSec":2,"scriptCoverage":["We built Noura to change that."]}' +
    ']}]]';
  const plan = OS.parseShotPlan(reply);
  assert.ok(plan, 'plan did not parse');
  assert.strictEqual(plan.productionId, 'prod_1');
  assert.strictEqual(plan.shots.length, 2);
  assert.strictEqual(plan.shots[0].shotType, 'a_roll');
  assert.strictEqual(plan.shots[0].scriptCoverage.length, 2, 'multi-line coverage lost');
  assert.strictEqual(plan.shots[1].shotType, 'screen_recording');
  assert.strictEqual(plan.shots[1].scriptCoverage[0].text, 'We built Noura to change that.');
  assert.ok(!OS.stripActionMarker(reply).includes('[[SHOTS:'), 'marker leaked into the chat text');
});

test('quick action buttons can execute without the chat input being filled', () => {
  const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(
    /function sendDirector\(opts\)\{[\s\S]{0,400}typeof opts==='string'/.test(appSrc),
    'sendDirector still ignores a message passed by a quick action'
  );
  assert.ok(
    /var msg=String\(opts\.message\|\|''\)\.trim\(\)\|\|\(inp\?inp\.value\.trim\(\):''\)/.test(appSrc),
    'sendDirector does not read the passed message'
  );
});

function extractFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found');
  let depth = 0;
  let started = false;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
      started = true;
    } else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced function ' + name);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
