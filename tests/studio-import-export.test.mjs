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
  const gen = ui.slice(ui.indexOf('function generateScript'), ui.indexOf('function generateShotList'));
  assert.ok(ui.includes('function generateScript'));
  assert.ok(ui.includes('Do NOT copy the idea description'));
  assert.ok(ui.includes('requestScriptAiEdit'));
  assert.ok(ui.includes('Replace the current script'));
  assert.ok(gen.includes('spoken'));
  assert.ok(!/\[VISUAL\]\\nWhat we see/.test(gen), 'Generate Script prompt must not ask for [VISUAL] blocks');
  assert.ok(/Forbidden[\s\S]*\[VISUAL\]/.test(gen));
  assert.ok(ui.includes('function generateShotList'));
});

test('source: Director system prompt separates script from shot list', () => {
  const director = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
  assert.ok(director.includes('SCRIPT VS SHOT LIST'));
  assert.ok(director.includes('NEVER include [VISUAL]'));
  const os = fs.readFileSync(path.join(root, 'js/director-os.js'), 'utf8');
  assert.ok(os.includes('SCRIPT vs SHOT LIST'));
  assert.ok(os.includes('An idea description is not a script'));
});

const MIXED_HOOK =
  'HOOK\n[ON CAMERA]\n"You don\'t learn faster by studying more. You learn faster by teaching."\n[VISUAL]\nExtreme close-up on phone screen showing app UI. Sony FX3 on DJI RS4 PRO. Slow push-in from 30cm to 15cm. Shallow depth of field, background dissolves into bokeh. Hold on screen for one beat after line lands.';

test('separateScriptFromProduction keeps spoken lines and extracts visuals', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const sep = St.separateScriptFromProduction(MIXED_HOOK);
  assert.ok(/learn faster by studying/.test(sep.scriptBody));
  assert.ok(/learn faster by teaching/.test(sep.scriptBody));
  assert.ok(!/\[VISUAL\]/.test(sep.scriptBody));
  assert.ok(!/Sony FX3/i.test(sep.scriptBody));
  assert.ok(!/DJI/i.test(sep.scriptBody));
  assert.ok(!/push-in/i.test(sep.scriptBody));
  assert.ok(!/depth of field/i.test(sep.scriptBody));
  assert.ok(sep.hadProductionLeak);
  assert.ok(sep.extractedShotCount >= 1);
  const visual = (sep.beats || []).map((b) => b.visual).join(' ');
  assert.ok(/Extreme close-up/i.test(visual));
  assert.ok(/Sony FX3/i.test(visual));
});

test('AI update_script sanitizes mixed output into script + shot list', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const project = St.createProject({ name: 'Teach AI' });
  const created = St.createProduction(project.id, {
    name: 'Student film',
    source: 'idea',
    ideaSnapshot: { title: 'Teaching AI helps students learn better.', hook: 'Teaching AI helps students learn better.' }
  });
  const pid = created.production.id;
  assert.strictEqual(St.getScriptPlainText(created.production.workspace), '');
  const applied = St.handleDirectorAction(
    'update_script',
    { productionId: pid, mode: 'replace', body: MIXED_HOOK },
    { confirmed: true }
  );
  assert.ok(applied.ok, applied.message || applied.error);
  const found = St.findProduction(pid);
  const script = St.getScriptPlainText(found.production.workspace);
  assert.ok(/learn faster by studying/.test(script));
  assert.ok(/learn faster by teaching/.test(script));
  assert.ok(!/\[VISUAL\]/.test(script));
  assert.ok(!/Sony FX3/i.test(script));
  assert.ok(!/DJI/i.test(script));
  assert.ok(!/push-in/i.test(script));
  const shots = found.production.workspace.shotList || [];
  assert.ok(shots.length >= 1, 'extracted visuals must become shots, not disappear');
  const blob = JSON.stringify(shots);
  assert.ok(/Extreme close-up|close-up/i.test(blob));
  assert.ok(/Sony FX3|FX3/i.test(blob));
  assert.ok(/DJI|RS/i.test(blob));
  assert.ok(/push-in/i.test(blob));
  assert.ok(shots[0].scriptLineId);
  assert.ok(/learn faster/.test(shots[0].audio || shots[0].notes || ''));
});

test('Generate Shot List does not overwrite the script', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const project = St.createProject({ name: 'P' });
  const created = St.createProduction(project.id, { name: 'Prod', source: 'blank' });
  const pid = created.production.id;
  St.handleDirectorAction(
    'update_script',
    {
      productionId: pid,
      mode: 'replace',
      body: 'HOOK\n[ON CAMERA]\nYou don\'t learn faster by studying more.\nYou learn faster by teaching.'
    },
    { confirmed: true }
  );
  const before = St.getScriptPlainText(St.findProduction(pid).production.workspace);
  const built = St.buildShotListFromScript(pid, { allowStarter: false });
  assert.ok(built.ok, built.message || built.error);
  const found = St.findProduction(pid);
  assert.strictEqual(St.getScriptPlainText(found.production.workspace), before);
  assert.ok((found.production.workspace.shotList || []).length >= 1);
  assert.ok(!/\[VISUAL\]/.test(before));
});

test('manual applyScriptPlainText does not rewrite existing mixed user scripts', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const ws = St.defaultWorkspace();
  const dirty = MIXED_HOOK;
  const applied = St.applyScriptPlainText(ws, dirty, 'replace');
  assert.ok(applied.next.indexOf('[VISUAL]') >= 0);
  assert.ok(St.scriptContainsProductionLeak(applied.next));
});

test('ensureWorkspace does not rewrite a stored mixed script', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const project = St.createProject({ name: 'Legacy' });
  const created = St.createProduction(project.id, { name: 'Old cut', source: 'blank' });
  created.production.workspace.script = {
    body: MIXED_HOOK,
    lines: [{ id: 'legacy_line', text: MIXED_HOOK, shotId: null, shotOrder: 1 }]
  };
  St.updateProduction(created.production.id, { workspace: created.production.workspace });
  const found = St.findProduction(created.production.id);
  St.ensureWorkspace(found.production);
  assert.ok(found.production.workspace.script.body.indexOf('[VISUAL]') >= 0);
  assert.strictEqual(found.production.workspace.script.lines[0].id, 'legacy_line');
});

test('imported idea still does not become a fake script after sanitizer exists', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const result = St.importIdeaIntoStudio({
    newProjectName: 'Concept Project',
    newProductionName: 'Teaching AI',
    idea: {
      title: 'Teaching AI helps students learn better.',
      hook: 'Teaching AI helps students learn better.',
      whyItWorks: 'Students remember more when they explain ideas out loud.'
    },
    sceneInfo: { label: 'Desk' },
    meta: { source: 'idea' }
  });
  assert.ok(result.ok);
  assert.strictEqual(St.getScriptPlainText(result.production.workspace), '');
  assert.strictEqual((result.production.workspace.shotList || []).length, 0);
  assert.strictEqual(result.production.ideaSnapshot.title, 'Teaching AI helps students learn better.');
});

test('no new serverless functions', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

console.log('\nStudio import/export results:', passed, 'passed,', failed, 'failed\n');
if (failed) process.exit(1);
