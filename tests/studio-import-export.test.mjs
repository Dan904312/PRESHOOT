/**
 * Studio import + script/shot-list/export workflow.
 * Executable against js/studio.js + js/studio-export.js with a localStorage mock.
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

function loadStudio() {
  const mem = {};
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
    encodeURIComponent,
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
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/studio.js'), 'utf8'), sandbox, {
    filename: 'studio.js'
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/studio-export.js'), 'utf8'), sandbox, {
    filename: 'studio-export.js'
  });
  sandbox.__mem = mem;
  return sandbox;
}

console.log('\n== Studio import / script / export ==');

test('import into an existing production keeps the same production id', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const project = St.createProject({ name: 'My Marketing Campaign' });
  const created = St.createProduction(project.id, { name: 'Product Launch Video', source: 'blank' });
  const productionId = created.production.id;
  const beforeCount = St.findProject(project.id).productions.length;
  const result = St.importIdeaIntoStudio({
    projectId: project.id,
    productionId: productionId,
    idea: { title: 'The New Product', hook: 'Stop doing X', whyItWorks: 'This is strategy copy, not a script.' },
    sceneInfo: { label: 'Studio desk' },
    meta: { source: 'idea' }
  });
  assert.ok(result.ok);
  assert.strictEqual(result.createdProduction, false);
  assert.strictEqual(result.production.id, productionId);
  assert.strictEqual(St.findProject(project.id).productions.length, beforeCount);
  assert.strictEqual(result.production.ideaSnapshot.title, 'The New Product');
  assert.ok(result.production.ideaSnapshot.whyItWorks);
  const scriptText = St.getScriptPlainText(result.production.workspace);
  assert.ok(!scriptText, 'existing production script must stay empty, not idea copy');
});

test('new project + production nests the idea under those ids', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const result = St.importIdeaIntoStudio({
    newProjectName: 'Campaign Two',
    newProductionName: 'Launch Cutdown',
    idea: { title: 'Wrong name if ignored', hook: 'Hook line', whyItWorks: 'Strategy.' },
    sceneInfo: { label: 'Warehouse' },
    meta: { source: 'idea' }
  });
  assert.ok(result.ok);
  assert.strictEqual(result.createdProject, true);
  assert.strictEqual(result.createdProduction, true);
  assert.strictEqual(result.project.name, 'Campaign Two');
  assert.strictEqual(result.production.name, 'Launch Cutdown');
  assert.strictEqual(result.production.ideaSnapshot.hook, 'Hook line');
  const found = St.findProduction(result.production.id);
  assert.ok(found);
  assert.strictEqual(found.project.id, result.project.id);
  assert.strictEqual(found.production.workspace.script.body, '');
  assert.strictEqual((found.production.workspace.script.lines || []).length, 0);
  assert.strictEqual((found.production.workspace.shotList || []).length, 0);
});

test('seedWorkspaceFromIdea never copies idea description into script', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const ws = St.seedWorkspaceFromIdea(
    { title: 'Idea', hook: 'A hook', whyItWorks: 'This must not become the script.' },
    { label: 'Cafe' },
    {}
  );
  assert.strictEqual(ws.script.body, '');
  assert.strictEqual((ws.script.lines || []).length, 0);
  const text = St.getScriptPlainText(ws);
  assert.ok(!text);
  assert.ok(!/This must not become the script/.test(JSON.stringify(ws.script)));
});

test('hasRealScript rejects placeholder / idea-description scripts', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const idea = { whyItWorks: 'Here is a strategy paragraph about contrast.' };
  assert.strictEqual(St.hasRealScript({ script: { body: '', lines: [] } }, idea), false);
  assert.strictEqual(
    St.hasRealScript({ script: { body: "Here's why this works…", lines: [] } }, idea),
    false
  );
  assert.ok(
    St.hasRealScript(
      {
        script: {
          body: '',
          lines: [{ id: 'l1', text: 'HOOK\n[ON CAMERA]\n"If you still do X, stop."' }]
        }
      },
      idea
    )
  );
});

test('shot list from script links each shot to a script line id', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const project = St.createProject({ name: 'P' });
  const created = St.createProduction(project.id, { name: 'Prod', source: 'blank' });
  const pid = created.production.id;
  St.applyScriptPlainText(created.production.workspace, 'HOOK\n"Problem."\n\nSETUP\n"How."\n\nCTA\n"Follow."', 'replace');
  St.updateProduction(pid, { workspace: created.production.workspace });
  const built = St.buildShotListFromScript(pid, { allowStarter: false });
  assert.ok(built.ok, built.message || built.error);
  const found = St.findProduction(pid);
  const lines = found.production.workspace.script.lines;
  const shots = found.production.workspace.shotList;
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(shots.length, 3);
  shots.forEach(function (shot, i) {
    assert.strictEqual(shot.scriptLineId, lines[i].id);
    assert.strictEqual(lines[i].shotId, shot.id);
    assert.strictEqual(lines[i].shotOrder, shot.order);
  });
});

test('copy formatters emit production names, not JSON', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const Ex = g.PreShootStudioExport;
  const project = St.createProject({ name: 'Product Launch' });
  const created = St.createProduction(project.id, { name: 'Launch Video', source: 'blank' });
  St.applyScriptPlainText(created.production.workspace, 'HOOK\n"If you\'re still doing X, you\'re missing this."', 'replace');
  St.updateProduction(created.production.id, {
    workspace: created.production.workspace,
    ideaSnapshot: { title: 'The New Product', hook: 'concept only' }
  });
  St.buildShotListFromScript(created.production.id, { allowStarter: false });
  const bundle = Ex.findBundle(created.production.id);
  const script = Ex.formatScriptText(bundle);
  const shots = Ex.formatShotListText(bundle);
  assert.ok(script.indexOf('PROJECT: Product Launch') >= 0);
  assert.ok(script.indexOf('PRODUCTION: Launch Video') >= 0);
  assert.ok(script.indexOf('TITLE: The New Product') >= 0);
  assert.ok(script.indexOf('"If you\'re still doing X') >= 0);
  assert.ok(!script.trim().startsWith('{'));
  assert.ok(shots.indexOf('SHOT LIST') >= 0);
  assert.ok(shots.indexOf('SHOT 01') >= 0);
  assert.ok(shots.indexOf('SCRIPT: Scene 01') >= 0);
});

test('PDF builder is deterministic and contains the script text', () => {
  const g = loadStudio();
  const Ex = g.PreShootStudioExport;
  const doc = new Ex.PdfDoc('Launch Video — Script');
  doc.fromPlainText('PROJECT: Product Launch\nPRODUCTION: Launch Video\n\nSCENE 01 — HOOK\n[DIALOGUE]\n"If you\'re still doing X, you\'re missing this."\n');
  const pdf = doc.build();
  assert.ok(pdf.indexOf('%PDF-1.4') === 0);
  assert.ok(pdf.indexOf('%%EOF') >= 0);
  assert.ok(pdf.indexOf('Launch Video') >= 0);
  assert.ok(pdf.indexOf('still doing X') >= 0);
  assert.ok(pdf.indexOf('xref') >= 0);
});

test('mismatched production/project is rejected', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const a = St.createProject({ name: 'A' });
  const b = St.createProject({ name: 'B' });
  const prod = St.createProduction(a.id, { name: 'Only in A' });
  const result = St.importIdeaIntoStudio({
    projectId: b.id,
    productionId: prod.production.id,
    idea: { title: 'Nope' },
    sceneInfo: {},
    meta: {}
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'production_not_in_project');
});

test('source: confirmSend no longer blindly createProduction', () => {
  const ui = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  const send = ui.slice(ui.indexOf('function confirmSend'), ui.indexOf('function renameProjectPrompt'));
  assert.ok(send.includes('importIdeaIntoStudio'));
  assert.ok(!send.includes('createProduction('));
});

test('source: generate script uses Director, not idea copy', () => {
  const ui = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(ui.includes('function generateScript'));
  assert.ok(ui.includes('Do NOT copy the idea description'));
  assert.ok(ui.includes('requestScriptAiEdit'));
  assert.ok(ui.includes('Replace the current script'));
});

test('no new serverless functions', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

console.log('\nStudio import/export results:', passed, 'passed,', failed, 'failed\n');
if (failed) process.exit(1);
