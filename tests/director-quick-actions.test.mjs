/**
 * Structured Director quick actions. No keyword hacks.
 * Run: node tests/director-quick-actions.test.mjs
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

function loadOS() {
  const sandbox = {
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
    isNaN,
    localStorage: { getItem: function () { return null; }, setItem: function () {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.S = { tab: 'studio', studioView: { productionId: 'prod_1' } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/director-os.js'), 'utf8'), sandbox, {
    filename: 'director-os.js'
  });
  return sandbox.PreShootDirectorOS;
}

const OS = loadOS();
const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const osSrc = fs.readFileSync(path.join(root, 'js/director-os.js'), 'utf8');
const directorSrc = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
const studioUiSrc = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');

console.log('\n== Director quick actions ==');

test('QUICK marker is structured, not a Would you like keyword scan', () => {
  const ask = 'I have enough information to create your script. Would you like me to generate it?';
  assert.strictEqual(OS.parseQuickActionsFromReply(ask).length, 0);
  assert.strictEqual(OS.collectQuickActions(ask, null).length, 0);
  assert.ok(!osSrc.includes('Would you like'));
  assert.ok(!appSrc.includes("indexOf('Would you like')"));
  assert.ok(!studioUiSrc.includes('Would you like'));
});

test('explicit QUICK ids become labeled buttons plus Not Now', () => {
  const reply =
    'I have enough information to create your script.\n[[QUICK:[{"id":"generate_script","label":"Generate Script"},{"id":"not_now","label":"Not Now"}]]]';
  const actions = OS.collectQuickActions(reply, null);
  assert.ok(actions.some((a) => a.id === 'generate_script' && a.label === 'Generate Script'));
  assert.ok(actions.some((a) => a.id === 'not_now' && a.kind === 'dismiss'));
  assert.ok(!OS.stripActionMarker(reply).includes('[[QUICK:'));
  assert.ok(OS.stripActionMarker(reply).includes('create your script'));
});

test('ACTION proposals infer executable buttons without inventing ids', () => {
  const script = OS.inferQuickActionsFromProposal({
    action: 'update_script',
    payload: { productionId: 'prod_1' }
  });
  assert.ok(script.some((a) => a.id === 'generate_script'));
  assert.ok(script.some((a) => a.id === 'not_now'));
  const shots = OS.inferQuickActionsFromProposal({
    action: 'rebuild_shot_list',
    payload: { productionId: 'prod_1' }
  });
  assert.ok(shots.some((a) => a.id === 'create_shot_list'));
  const none = OS.inferQuickActionsFromProposal({ action: 'rename_production', payload: {} });
  assert.strictEqual(none.length, 0);
  const bogus = OS.parseQuickActionsFromReply('[[QUICK:[{"id":"delete_everything"}]]]');
  assert.strictEqual(bogus.length, 0);
});

test('buttons hide when the action cannot execute', () => {
  const raw = OS.collectQuickActions(
    '[[QUICK:[{"id":"generate_script"},{"id":"create_shot_list"},{"id":"not_now"}]]]',
    null
  );
  const noProd = OS.filterExecutableQuickActions(raw, {});
  assert.ok(!noProd.some((a) => a.id === 'generate_script'));
  assert.ok(noProd.some((a) => a.id === 'not_now'));
  const noScript = OS.filterExecutableQuickActions(raw, { productionId: 'prod_1', hasScript: false });
  assert.ok(noScript.some((a) => a.id === 'generate_script'));
  assert.ok(!noScript.some((a) => a.id === 'create_shot_list'));
  const ready = OS.filterExecutableQuickActions(raw, { productionId: 'prod_1', hasScript: true });
  assert.ok(ready.some((a) => a.id === 'generate_script'));
  assert.ok(ready.some((a) => a.id === 'create_shot_list'));
});

test('old messages without actions stay compatible', () => {
  assert.ok(appSrc.includes('addDirMsg(m.role===\'assistant\'?\'ai\':\'user\', cleanDirectorText(m.content), false, m.actions)'));
  assert.ok(appSrc.includes('if(extras.actions&&extras.actions.length) row.actions=extras.actions'));
  assert.ok(appSrc.includes('function addDirMsg(role,text,save,actions)'));
  assert.ok(appSrc.includes('applyDirBubbleContent(bub, display, actions)'));
  assert.ok(appSrc.includes('openDirFullMessage(text, actions)'));
});

test('Director prompt and Studio bar share the same catalog', () => {
  assert.ok(directorSrc.includes('[[QUICK:'));
  assert.ok(directorSrc.includes('generate_script'));
  assert.ok(directorSrc.includes('create_shot_list'));
  assert.ok(directorSrc.includes('Only include a QUICK action when you have enough context'));
  assert.ok(studioUiSrc.includes('collectQuickActions(raw, act)'));
  assert.ok(studioUiSrc.includes('runStoredQuickAction'));
  assert.ok(studioUiSrc.includes('dir-quick-btn'));
  assert.ok(appSrc.includes('_dirQuickBusy'));
  assert.ok(appSrc.includes('dir-quick-progress'));
  assert.ok(appSrc.includes('dir-quick-error'));
});

test('generate helpers report success so the UI can retry on failure', () => {
  assert.ok(studioUiSrc.includes('return true;'));
  assert.ok(studioUiSrc.includes('return false;'));
  assert.ok(appSrc.includes('var scriptOk=PreShootStudioUI.generateScript(pid)'));
  assert.ok(appSrc.includes('var shotsOk=PreShootStudioUI.generateShotList(pid)'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
