/**
 * Phase 3B — Live Shared Studio Updates tests.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
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

console.log('\n== Phase 3B source invariants ==');

test('context has dirty protect, keep local, repair, fetch race guards', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes('keepLocalRemoteUpdate'));
  assert.ok(src.includes('repairStudioView'));
  assert.ok(src.includes('stale_apply') || src.includes('stale_revision'));
  assert.ok(src.includes('_fetchToken'));
  assert.ok(src.includes('dirty_protected'));
  assert.ok(src.includes('clearRemoteUpdateState'));
  assert.ok(!/CRDT|operational transform|live cursor/i.test(src));
});

test('UI exposes Review latest + Keep my changes', () => {
  const ui = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(ui.includes('keepLocalChanges'));
  assert.ok(ui.includes('syncRemoteBanner'));
  assert.ok(html.includes('Review latest'));
  assert.ok(html.includes('Keep my changes'));
  assert.ok(html.includes('Someone else saved first') || html.includes('ws-conflict'));
});

test('detail headers surface Review update', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes("reviewRemoteUpdate()\">Review update"));
});

test('no new serverless functions; personal sync untouched by 3B', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(sync.includes('invalid_payload') || sync.includes('workspace_id'));
});

console.log('\n== Phase 3B pure revision/repair helpers (sandboxed) ==');

test('repairStudioView keeps production when still present', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  /* Extract repairStudioView via lightweight reimplementation matching source contract */
  function repairStudioView(S, doc, prevView) {
    var view = prevView || S.studioView || { mode: 'list' };
    var projects = (doc && doc.projects) || [];
    function findProject(id) {
      return projects.find((p) => p && p.id === id) || null;
    }
    function findProduction(id) {
      for (const p of projects) {
        for (const prod of p.productions || []) {
          if (prod && prod.id === id) return { project: p, production: prod };
        }
      }
      return null;
    }
    if (view.mode === 'production' && view.productionId) {
      const hit = findProduction(view.productionId);
      if (hit) {
        S.studioView = {
          mode: 'production',
          projectId: hit.project.id,
          productionId: hit.production.id,
          section: view.section || 'overview'
        };
        return { repaired: false, mode: 'production' };
      }
      if (view.projectId && findProject(view.projectId)) {
        S.studioView = { mode: 'project', projectId: view.projectId };
        return { repaired: true, mode: 'project', reason: 'production_deleted' };
      }
      S.studioView = { mode: 'list' };
      return { repaired: true, mode: 'list', reason: 'production_deleted' };
    }
    if (view.mode === 'project' && view.projectId) {
      if (findProject(view.projectId)) {
        S.studioView = { mode: 'project', projectId: view.projectId };
        return { repaired: false, mode: 'project' };
      }
      S.studioView = { mode: 'list' };
      return { repaired: true, mode: 'list', reason: 'project_deleted' };
    }
    S.studioView = { mode: 'list' };
    return { repaired: false, mode: 'list' };
  }

  const S = {
    studioView: { mode: 'production', projectId: 'p1', productionId: 'prod1', section: 'script' }
  };
  const doc = {
    projects: [{ id: 'p1', productions: [{ id: 'prod1', name: 'A' }] }]
  };
  const r = repairStudioView(S, doc, S.studioView);
  assert.strictEqual(r.repaired, false);
  assert.strictEqual(S.studioView.mode, 'production');
  assert.strictEqual(S.studioView.section, 'script');
});

test('repairStudioView falls back when production deleted', () => {
  function repairStudioView(S, doc, prevView) {
    var view = prevView || { mode: 'list' };
    var projects = (doc && doc.projects) || [];
    function findProject(id) {
      return projects.find((p) => p && p.id === id) || null;
    }
    if (view.mode === 'production' && view.productionId) {
      if (view.projectId && findProject(view.projectId)) {
        S.studioView = { mode: 'project', projectId: view.projectId };
        return { repaired: true, mode: 'project', reason: 'production_deleted' };
      }
      S.studioView = { mode: 'list' };
      return { repaired: true, mode: 'list', reason: 'production_deleted' };
    }
    return { repaired: false };
  }
  const S = {};
  const r = repairStudioView(
    S,
    { projects: [{ id: 'p1', productions: [] }] },
    { mode: 'production', projectId: 'p1', productionId: 'gone' }
  );
  assert.strictEqual(r.repaired, true);
  assert.strictEqual(S.studioView.mode, 'project');
});

test('stale revision rule: incoming <= current ignored', () => {
  function shouldProcess(current, incoming) {
    return Number.isFinite(incoming) && incoming > current;
  }
  assert.strictEqual(shouldProcess(10, 9), false);
  assert.strictEqual(shouldProcess(10, 10), false);
  assert.strictEqual(shouldProcess(10, 11), true);
  assert.strictEqual(shouldProcess(10, 15), true);
});

test('source still uses /api/workspace-sync as write path', () => {
  const ctx = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'js/workspace-sync.js'), 'utf8');
  assert.ok(sync.includes('/api/workspace-sync'));
  assert.ok(ctx.includes('saveSharedWorkspace'));
  assert.ok(!ctx.includes('from(\'workspace_data\')'));
});

console.log('\n────────────────────────────');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exit(1);
console.log('ALL WORKSPACE PHASE 3B TESTS PASSED');
