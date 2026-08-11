/**
 * Phase 5B — Presence, activity UX, remote-change notifications.
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

console.log('\n== Phase 5B source invariants ==');

test('presence INSERT SQL is idempotent and does not allow broadcast insert', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase5b_presence.sql'), 'utf8');
  assert.ok(sql.includes('workspace_realtime_presence_insert'));
  assert.ok(sql.includes("extension = 'presence'"));
  assert.ok(sql.includes('is_workspace_member'));
  assert.ok(sql.includes('Broadcast INSERT remains denied') || sql.includes('broadcast INSERT'));
  assert.ok(!/CREATE TABLE/i.test(sql));
});

test('setup pointer mentions Phase 5B SQL', () => {
  const setup = fs.readFileSync(path.join(root, 'supabase_setup.sql'), 'utf8');
  assert.ok(setup.includes('supabase_workspaces_phase5b_presence.sql'));
});

test('realtime forwards change metadata and tracks presence', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-realtime.js'), 'utf8');
  assert.ok(src.includes("presence: { key:"));
  assert.ok(src.includes("ch.on('presence'"));
  assert.ok(src.includes('channel.track'));
  assert.ok(src.includes('untrack'));
  assert.ok(src.includes('payload.change'));
  assert.ok(src.includes('activity_label'));
  assert.ok(src.includes('clearPresenceState') || src.includes('presenceMap'));
  assert.ok(!/CRDT|operational transform|live cursor|character-level/i.test(src));
});

test('context has presence, activity refresh, notification grouping', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes('onPresenceChanged'));
  assert.ok(src.includes('refreshActivity'));
  assert.ok(src.includes('presenceOnProduction'));
  assert.ok(src.includes('queueRemoteNotification'));
  assert.ok(src.includes('flushRemoteNotifications'));
  assert.ok(src.includes('state.presence = []'));
  assert.ok(src.includes('state.recentActivity = []'));
});

test('UI has people + activity panels and presence chip', () => {
  const ui = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(ui.includes('presenceChipHtml'));
  assert.ok(ui.includes('openPeople'));
  assert.ok(ui.includes('openActivity'));
  assert.ok(ui.includes('productionPresenceHtml'));
  assert.ok(ui.includes('Review Changes') || ui.includes('Keep Editing'));
  assert.ok(html.includes('ws-people-modal'));
  assert.ok(html.includes('ws-activity-modal'));
  assert.ok(html.includes('ws-presence-chip'));
  assert.ok(html.includes('data-ws-review'));
});

test('Director gets shared collab context without personal leak markers', () => {
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(html.includes('SHARED WORKSPACE:'));
  assert.ok(html.includes('Recent workspace activity:'));
  assert.ok(html.includes('COLLAB RULE:'));
  assert.ok(html.includes('PreShootWorkspace.isShared'));
});

test('studioView sets projectId for production navigation', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes('projectId: projectId'));
  assert.ok(src.includes('scheduleTrack'));
  assert.ok(src.includes('productionPresenceHtml'));
});

test('no new serverless functions; personal sync untouched', () => {
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(!sync.includes('presence'));
  assert.ok(!sync.includes('workspacePresence'));
});

test('header distinguishes Personal vs Shared', () => {
  const ui = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  assert.ok(ui.includes("'Shared · '") || ui.includes('Shared ·'));
  assert.ok(ui.includes('Personal Studio'));
  assert.ok(ui.includes('Read only'));
});

console.log(`\nPhase 5B: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
