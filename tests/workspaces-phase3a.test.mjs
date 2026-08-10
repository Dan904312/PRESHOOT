/**
 * Phase 3A Realtime Collaboration Foundation — regression / invariant tests.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => {
          passed += 1;
          console.log('  ✓', name);
        })
        .catch((e) => {
          failed += 1;
          console.error('  ✗', name, '\n   ', e.message);
        });
    }
    passed += 1;
    console.log('  ✓', name);
    return Promise.resolve();
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
    return Promise.resolve();
  }
}

console.log('\n== Phase 3A source invariants ==');

await test('SQL private channel policies exist; no client INSERT', () => {
  const sql = fs.readFileSync(
    path.join(root, 'supabase_workspaces_phase3a_realtime.sql'),
    'utf8'
  );
  assert.ok(sql.includes('workspace_realtime_broadcast_select'));
  assert.ok(sql.includes('is_workspace_member'));
  assert.ok(sql.includes("extension = 'broadcast'"));
  assert.ok(sql.includes('workspace_id_from_realtime_topic'));
  assert.ok(sql.includes('No authenticated INSERT') || sql.includes('service_role only'));
  assert.ok(!/FOR INSERT[\s\S]*TO authenticated/i.test(sql));
  assert.ok(sql.includes("extension = 'presence'")); /* future-ready receive */
});

await test('server broadcasts metadata-only after save', () => {
  const src = fs.readFileSync(path.join(root, 'lib/workspaces.js'), 'utf8');
  assert.ok(src.includes('broadcastWorkspaceUpdated'));
  assert.ok(src.includes('realtime/v1/api/broadcast'));
  assert.ok(src.includes("type: 'workspace.updated'"));
  assert.ok(src.includes('private: true'));
  assert.ok(!src.includes('document:') || src.indexOf('broadcastWorkspaceUpdated') > 0);
  /* payload construction must not include document */
  const fnStart = src.indexOf('export async function broadcastWorkspaceUpdated');
  const fnBody = src.slice(fnStart, fnStart + 1200);
  assert.ok(fnBody.includes('workspace_id'));
  assert.ok(fnBody.includes('revision'));
  assert.ok(!fnBody.includes('document:'));
});

await test('client realtime module is private + loop-safe hooks', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-realtime.js'), 'utf8');
  assert.ok(src.includes('private: true'));
  assert.ok(src.includes('workspace.updated'));
  assert.ok(src.includes('shouldIgnoreRealtimeRevision') || src.includes('handleBroadcast'));
  assert.ok(!/cursor|CRDT|operational.?transform|typing/i.test(src));
  assert.ok(!src.includes('track(')); /* no presence track */
});

await test('workspace context protects dirty local state', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes('onRemoteWorkspaceUpdated'));
  assert.ok(src.includes('dirty_protected') || src.includes('sharedDirty'));
  assert.ok(src.includes('lastLocalSave'));
  assert.ok(src.includes('stopRealtime'));
  assert.ok(src.includes('waitForSaveIdle'));
  assert.ok(src.includes('reviewRemoteUpdate'));
});

await test('studio-sync does not push personal sync for shared dirty', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-sync.js'), 'utf8');
  assert.ok(src.includes('isSharedDirty'));
  assert.ok(src.includes('Never mix') || src.includes('workspace-sync'));
});

await test('no new serverless functions', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

await test('app.html loads workspace-realtime', () => {
  const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(src.includes('workspace-realtime.js'));
  assert.ok(src.includes('ws-remote-banner'));
});

console.log('\n== Phase 3A behavioral helpers ==');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const broadcasts = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url, opts = {}) {
  const u = String(url);
  if (u.indexOf('/realtime/v1/api/broadcast') >= 0) {
    const body = opts.body ? JSON.parse(opts.body) : {};
    broadcasts.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => ''
    };
  }
  /* minimal rest stubs for membership/save path not needed here */
  return {
    ok: false,
    status: 500,
    json: async () => ({ error: 'unexpected ' + u }),
    text: async () => 'unexpected'
  };
};

const ws = await import('../lib/workspaces.js');

await test('workspaceRealtimeTopic format', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.strictEqual(ws.workspaceRealtimeTopic(id), 'workspace:' + id);
});

await test('broadcastWorkspaceUpdated sends private metadata only', async () => {
  broadcasts.length = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  const res = await ws.broadcastWorkspaceUpdated({
    workspaceId: id,
    revision: 6,
    updatedBy: 'user-a',
    updatedAt: '2026-08-09T00:00:00.000Z'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(broadcasts.length, 1);
  const msg = broadcasts[0].messages[0];
  assert.strictEqual(msg.topic, 'workspace:' + id);
  assert.strictEqual(msg.event, 'workspace.updated');
  assert.strictEqual(msg.private, true);
  assert.strictEqual(msg.payload.workspace_id, id);
  assert.strictEqual(msg.payload.revision, 6);
  assert.strictEqual(msg.payload.updated_by, 'user-a');
  assert.ok(!('document' in msg.payload));
  assert.ok(!('prefs' in msg.payload));
  assert.ok(!('token' in msg.payload));
});

await test('broadcast rejects invalid workspace id', async () => {
  const res = await ws.broadcastWorkspaceUpdated({
    workspaceId: 'not-a-uuid',
    revision: 1,
    updatedBy: 'x'
  });
  assert.strictEqual(res.ok, false);
});

globalThis.fetch = originalFetch;

console.log('\n────────────────────────────');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exit(1);
console.log('ALL WORKSPACE PHASE 3A TESTS PASSED');
