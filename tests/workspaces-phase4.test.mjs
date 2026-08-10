/**
 * Phase 4 — Version history, conflict recovery, save-state, Director safety.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  summarizeDocumentDiff,
  VERSION_RETENTION,
  MAX_DOCUMENT_JSON
} from '../lib/workspaces.js';

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

console.log('\n== Phase 4 source invariants ==');

test('SQL migration exists and is idempotent', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase4_versions.sql'), 'utf8');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS workspace_document_versions'));
  assert.ok(sql.includes('uq_workspace_document_versions_ws_rev'));
  assert.ok(sql.includes('workspace_document_versions_select_member'));
  assert.ok(sql.includes("CHECK (reason IN ('save', 'restore'))"));
  assert.ok(sql.includes('REVOKE ALL ON TABLE workspace_document_versions'));
});

test('setup pointer mentions Phase 4 SQL', () => {
  const setup = fs.readFileSync(path.join(root, 'supabase_setup.sql'), 'utf8');
  assert.ok(setup.includes('supabase_workspaces_phase4_versions.sql'));
});

test('lib snapshots on save, retains N, restore creates new revision', () => {
  const src = fs.readFileSync(path.join(root, 'lib/workspaces.js'), 'utf8');
  assert.ok(src.includes('snapshotWorkspaceVersion'));
  assert.ok(src.includes('pruneWorkspaceVersions'));
  assert.ok(src.includes('VERSION_RETENTION'));
  assert.ok(src.includes("versionReason === 'restore'"));
  assert.ok(src.includes('restoreWorkspaceVersion'));
  assert.ok(src.includes('listWorkspaceVersions'));
  assert.ok(src.includes('getWorkspaceVersion'));
  assert.ok(src.includes('summarizeDocumentDiff'));
  assert.ok(!/CRDT|operational transform|live cursor|presence indicator/i.test(src));
});

test('API extends workspaces.js — no new top-level function files', () => {
  const api = fs.readFileSync(path.join(root, 'api/workspaces.js'), 'utf8');
  assert.ok(api.includes('listWorkspaceVersions'));
  assert.ok(api.includes('getWorkspaceVersion'));
  assert.ok(api.includes('restoreWorkspaceVersion'));
  assert.ok(api.includes("parts[1] === 'versions'"));
  assert.ok(api.includes("parts[3] === 'restore'"));
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

test('personal /api/sync untouched by Phase 4 version routes', () => {
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(!sync.includes('workspace_document_versions'));
  assert.ok(!sync.includes('listWorkspaceVersions'));
});

test('client sync exposes versions + save error mapping', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-sync.js'), 'utf8');
  assert.ok(src.includes('listVersions'));
  assert.ok(src.includes('getVersion'));
  assert.ok(src.includes('restoreVersion'));
  assert.ok(src.includes('summarizeDocumentDiff'));
  assert.ok(src.includes('rate_limited'));
  assert.ok(src.includes('network_error'));
});

test('context has saveStatus, recovery, version view/restore', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes("saveStatus: 'saved'"));
  assert.ok(src.includes('ws_recovery_'));
  assert.ok(src.includes('recoverPendingDraft'));
  assert.ok(src.includes('discardPendingRecovery'));
  assert.ok(src.includes('viewVersion'));
  assert.ok(src.includes('restoreVersion'));
  assert.ok(src.includes("setSaveStatus('conflict')"));
  assert.ok(src.includes("setSaveStatus('offline')"));
  assert.ok(src.includes('Never auto-apply recovery') || src.includes('checkPendingRecovery'));
});

test('UI has history, conflict compare, recovery, save indicator', () => {
  const ui = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(ui.includes('openHistory'));
  assert.ok(ui.includes('showVersionPreview'));
  assert.ok(ui.includes('showRecoveryPrompt'));
  assert.ok(ui.includes('saveStatusIndicatorHtml'));
  assert.ok(ui.includes('This workspace changed while you were editing'));
  assert.ok(html.includes('ws-history-modal'));
  assert.ok(html.includes('ws-version-preview-modal'));
  assert.ok(html.includes('ws-recovery-banner'));
  assert.ok(html.includes('Review Latest'));
  assert.ok(html.includes('Keep My Changes'));
  assert.ok(ui.includes('Viewing an older version. Your current workspace has not been changed.'));
});

test('Director awaits shared save before Done', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes('Saving workspace…'));
  assert.ok(src.includes('Another collaborator changed this workspace'));
  assert.ok(src.includes('finishDirectorSuccess'));
  assert.ok(src.includes('Workspace save failed'));
});

console.log('\n== Phase 4 pure helpers ==');

test('VERSION_RETENTION is sensible for ~450KB docs', () => {
  assert.ok(VERSION_RETENTION >= 8 && VERSION_RETENTION <= 20);
  assert.ok(MAX_DOCUMENT_JSON >= 100_000);
  /* 12 * 450KB ≈ 5.4MB worst-case per workspace — acceptable for recovery */
});

test('summarizeDocumentDiff reports structural changes', () => {
  const local = {
    projects: [
      {
        id: 'p1',
        name: 'A',
        productions: [{ id: 'x', name: 'Prod', shots: [1, 2], script: 'hello' }]
      },
      { id: 'p2', name: 'New', productions: [] }
    ]
  };
  const server = {
    projects: [
      {
        id: 'p1',
        name: 'A',
        productions: [{ id: 'x', name: 'Prod', shots: [1], script: 'hello' }]
      },
      { id: 'p3', name: 'ServerOnly', productions: [] }
    ]
  };
  const diff = summarizeDocumentDiff(local, server);
  assert.ok(diff.added.some((a) => a.id === 'p2'));
  assert.ok(diff.removed.some((a) => a.id === 'p3'));
  assert.ok(diff.changed.some((a) => a.id === 'x'));
  assert.ok(typeof diff.summary === 'string' && diff.summary.length > 0);
});

test('summarizeDocumentDiff handles empty docs', () => {
  const diff = summarizeDocumentDiff(null, null);
  assert.strictEqual(diff.localProjects, 0);
  assert.strictEqual(diff.serverProjects, 0);
});

console.log(`\nPhase 4: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
