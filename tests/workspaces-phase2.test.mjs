/**
 * Phase 2 Collaborative Workspaces — UI/data-layer regression checks.
 * Run via npm test (chained) or: node tests/workspaces-phase2.test.mjs
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

console.log('\n== Phase 2 source invariants ==');

test('workspace context layer exists', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes('PreShootWorkspace'));
  assert.ok(src.includes('activeWorkspaceKind'));
  assert.ok(src.includes('activeWorkspaceRevision'));
  assert.ok(src.includes('resolveConflictReload'));
  assert.ok(src.includes('workspaceIdForUpload'));
  assert.ok(!src.includes('CRDT') && !src.includes('websocket'));
});

test('workspace UI exists without realtime', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  assert.ok(src.includes('openSwitcher'));
  assert.ok(src.includes('showConflict'));
  assert.ok(src.includes('sendInvite'));
  assert.ok(!/presence|live.?cursor|typing.?indicator/i.test(src));
});

test('studio.js keeps personal and shared stores separate', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio.js'), 'utf8');
  assert.ok(src.includes('getPersonalStore'));
  assert.ok(src.includes('exportForWorkspaceSync'));
  assert.ok(src.includes('Never write shared docs into scout_studio'));
  assert.ok(src.includes('isPersonalDirty'));
});

test('studio-sync never pushes shared document as personal studio', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-sync.js'), 'utf8');
  assert.ok(src.includes('Never put shared workspace document'));
  assert.ok(src.includes('isPersonalDirty'));
});

test('studio-ui wires switcher, uploads, director workspace_id', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes('studioHeaderActionsHtml'));
  assert.ok(src.includes('workspace_id'));
  assert.ok(src.includes('directorRequestBody'));
  assert.ok(src.includes('workspaceIdForUpload'));
});

test('app.html loads Phase 2 scripts and modals', () => {
  const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(src.includes('workspace-context.js'));
  assert.ok(src.includes('workspace-ui.js'));
  assert.ok(src.includes('ws-switcher-modal'));
  assert.ok(src.includes('ws-conflict-modal'));
  assert.ok(src.includes('ws-members-modal'));
  assert.ok(src.includes('PreShootWorkspace.bootstrap'));
});

test('API listInvites added without new serverless file', () => {
  const api = fs.readFileSync(path.join(root, 'api/workspaces.js'), 'utf8');
  assert.ok(api.includes('listInvites'));
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

test('client wraps members/invites/patch', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-sync.js'), 'utf8');
  assert.ok(src.includes('listMembers'));
  assert.ok(src.includes('listInvites'));
  assert.ok(src.includes('updateMemberRole'));
  assert.ok(src.includes('removeMember'));
  assert.ok(src.includes('patchWorkspace'));
});

console.log('\n────────────────────────────');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exit(1);
console.log('ALL WORKSPACE PHASE 2 TESTS PASSED');
