/**
 * Phase 5A — Granular change awareness (no CRDT/OT/relational rewrite).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectDocumentChanges,
  primaryChange,
  reconcileClientChangeHint,
  changeActivityLabel,
  changeTypeLabel,
  isSameEntityConflict,
  CHANGE_TYPES
} from '../lib/workspace-changes.js';

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

function emptyDoc() {
  return {
    version: 3,
    projects: [],
    continueProductionId: null,
    updatedAt: 0,
    deletedProjects: {},
    deletedProductions: {}
  };
}

function prod(id, name, ws) {
  return {
    id,
    name,
    workspace: ws || {
      overview: {},
      shotList: [],
      script: { body: '', lines: [] },
      references: {},
      assets: []
    }
  };
}

console.log('\n== Phase 5A source invariants ==');

test('SQL migration is additive and idempotent', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase5a_changes.sql'), 'utf8');
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS change_type'));
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS changes'));
  assert.ok(!/CREATE TABLE.*projects/i.test(sql));
  assert.ok(!/DROP TABLE workspace_data/i.test(sql));
});

test('setup pointer mentions Phase 5A SQL', () => {
  const setup = fs.readFileSync(path.join(root, 'supabase_setup.sql'), 'utf8');
  assert.ok(setup.includes('supabase_workspaces_phase5a_changes.sql'));
});

test('no new serverless functions; personal sync untouched', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(!sync.includes('detectDocumentChanges'));
  assert.ok(!sync.includes('change_type'));
});

test('save pipeline wires change metadata + realtime', () => {
  const lib = fs.readFileSync(path.join(root, 'lib/workspaces.js'), 'utf8');
  assert.ok(lib.includes('detectDocumentChanges'));
  assert.ok(lib.includes('reconcileClientChangeHint'));
  assert.ok(lib.includes('change_type'));
  assert.ok(lib.includes('client_revision'));
  assert.ok(lib.includes('activity_label'));
});

test('client has change helpers, editing context, same-entity banner', () => {
  const ctx = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(html.includes('workspace-changes.js'));
  assert.ok(ctx.includes('same_entity_dirty') || ctx.includes('sameEntity'));
  assert.ok(ctx.includes('pendingChangeHint'));
  assert.ok(ctx.includes('getEditingContext'));
  assert.ok(ui.includes('Another collaborator changed this production'));
  assert.ok(ui.includes('Your revision:'));
  assert.ok(!/CRDT|operational transform|live cursor|character-level/i.test(ctx));
});

test('Director sets accurate change hints before shared save', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes("type: 'script.updated'"));
  assert.ok(src.includes("type: 'shotlist.updated'"));
  assert.ok(src.includes('setPendingChangeHint'));
});

console.log('\n== Phase 5A change detection ==');

test('CHANGE_TYPES cover supported grains only', () => {
  assert.ok(CHANGE_TYPES.includes('script.updated'));
  assert.ok(CHANGE_TYPES.includes('assets.updated'));
  assert.ok(!CHANGE_TYPES.includes('shot.updated'));
  assert.ok(!CHANGE_TYPES.includes('line.updated'));
});

test('detects production.updated / script.updated', () => {
  const before = emptyDoc();
  before.projects = [
    {
      id: 'proj_1',
      name: 'A',
      productions: [prod('prod_1', 'Launch', { script: { body: 'old', lines: [] }, shotList: [], references: {}, assets: [] })]
    }
  ];
  const after = emptyDoc();
  after.projects = [
    {
      id: 'proj_1',
      name: 'A',
      productions: [prod('prod_1', 'Launch', { script: { body: 'new', lines: [] }, shotList: [], references: {}, assets: [] })]
    }
  ];
  const changes = detectDocumentChanges(before, after);
  assert.ok(changes.some((c) => c.type === 'script.updated' && c.productionId === 'prod_1'));
  const primary = primaryChange(changes);
  assert.strictEqual(primary.type, 'script.updated');
});

test('detects project.created and production.deleted', () => {
  const before = emptyDoc();
  before.projects = [
    {
      id: 'proj_1',
      name: 'A',
      productions: [prod('prod_1', 'One'), prod('prod_2', 'Two')]
    }
  ];
  const after = emptyDoc();
  after.projects = [
    {
      id: 'proj_1',
      name: 'A',
      productions: [prod('prod_1', 'One')]
    },
    { id: 'proj_2', name: 'New', productions: [] }
  ];
  const changes = detectDocumentChanges(before, after);
  assert.ok(changes.some((c) => c.type === 'production.deleted' && c.productionId === 'prod_2'));
  assert.ok(changes.some((c) => c.type === 'project.created' && c.projectId === 'proj_2'));
});

test('detects shotlist and assets updates', () => {
  const before = emptyDoc();
  before.projects = [
    {
      id: 'p',
      name: 'P',
      productions: [
        prod('x', 'X', {
          script: { body: '', lines: [] },
          shotList: [{ id: 's1' }],
          references: {},
          assets: []
        })
      ]
    }
  ];
  const afterShots = JSON.parse(JSON.stringify(before));
  afterShots.projects[0].productions[0].workspace.shotList = [{ id: 's1' }, { id: 's2' }];
  assert.ok(detectDocumentChanges(before, afterShots).some((c) => c.type === 'shotlist.updated'));

  const afterAssets = JSON.parse(JSON.stringify(before));
  afterAssets.projects[0].productions[0].workspace.assets = [
    { id: 'a1', name: 'clip', storagePath: 'workspaces/w/x/a1.mp4' }
  ];
  assert.ok(detectDocumentChanges(before, afterAssets).some((c) => c.type === 'assets.updated'));
});

test('client hint is verified against document', () => {
  const before = emptyDoc();
  before.projects = [{ id: 'p', name: 'P', productions: [prod('x', 'X')] }];
  const after = JSON.parse(JSON.stringify(before));
  after.projects[0].productions[0].workspace.script = { body: 'hi', lines: [] };
  const detected = detectDocumentChanges(before, after);
  const ok = reconcileClientChangeHint(
    { type: 'script.updated', productionId: 'x' },
    before,
    after,
    detected
  );
  assert.strictEqual(ok.type, 'script.updated');
  const bad = reconcileClientChangeHint(
    { type: 'script.updated', productionId: 'not-real' },
    before,
    after,
    detected
  );
  assert.strictEqual(bad.type, 'script.updated'); /* server detection wins */
  assert.strictEqual(bad.productionId, 'x');
});

test('same-entity conflict detection', () => {
  assert.ok(
    isSameEntityConflict(
      { activeProductionId: 'prod_1', activeProjectId: 'p' },
      { type: 'script.updated', productionId: 'prod_1' }
    )
  );
  assert.ok(
    !isSameEntityConflict(
      { activeProductionId: 'prod_1', activeProjectId: 'p' },
      { type: 'script.updated', productionId: 'prod_2' }
    )
  );
});

test('activity labels are human-readable', () => {
  assert.ok(changeActivityLabel({ type: 'script.updated', entityLabel: 'Launch' }).includes('script'));
  assert.strictEqual(changeTypeLabel('shotlist.updated'), 'Shot list updated');
});

test('no relational Studio rewrite in lib', () => {
  const lib = fs.readFileSync(path.join(root, 'lib/workspaces.js'), 'utf8');
  assert.ok(lib.includes('workspace_data'));
  assert.ok(!/CREATE TABLE.*productions/i.test(lib));
});

console.log(`\nPhase 5A: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
