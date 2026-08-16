/**
 * Phase 6 — Production hardening invariants.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectDirectorMutationIntent } from '../lib/workspaces.js';
import { supabaseAuthApiKey } from '../lib/security.js';

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

console.log('\n== Phase 6 source invariants ==');

test('Director prompt never teaches past-tense Done for proposals', () => {
  const src = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
  assert.ok(src.includes('Confirm in Studio to apply'));
  assert.ok(src.includes('Never say “Done”') || src.includes('Never say "Done"') || src.includes('never claim'));
  assert.ok(!/Ideal shape:\s*\nDone\./.test(src));
});

test('Director mutation detector catches natural-language mutates', () => {
  assert.strictEqual(
    detectDirectorMutationIntent({}, '', [
      { role: 'user', content: 'Please rename this production to Launch' }
    ]),
    true
  );
  assert.strictEqual(
    detectDirectorMutationIntent({}, '', [
      { role: 'user', content: 'What makes a good hook?' }
    ]),
    false
  );
  assert.strictEqual(
    detectDirectorMutationIntent({}, '', [
      { role: 'user', content: 'How should I rewrite the script for better retention?' }
    ]),
    false
  );
});

test('studio-ui awaits personal flush and requires shared saveRes.ok', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(src.includes('persistDirectorLocalMutation'));
  assert.ok(src.includes('saveRes.ok === true'));
  assert.ok(src.includes('failDirectorPersist'));
  assert.ok(src.includes('Could not verify this change'));
  assert.ok(!src.includes("saveRes.ok || saveRes.skipped"));
  assert.ok(!/flush\(\{ pushFirst: true \}\)\.catch\(function \(\) \{\}\);\s*\n\s*finishDirectorSuccess/.test(src));
});

test('workspace switch aborts on flush failure', () => {
  const src = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
  assert.ok(src.includes('flush_failed'));
  assert.ok(src.includes('Could not save before switching'));
  assert.ok(src.includes('writeRecoveryDraft(state.conflict.localDraft)'));
});

test('studio-sync focus skips personal flush in shared mode', () => {
  const src = fs.readFileSync(path.join(root, 'js/studio-sync.js'), 'utf8');
  assert.ok(src.includes("PreShootWorkspace.isShared()"));
  assert.ok(src.includes("addEventListener('focus'"));
});

test('voice fails closed on getUserMedia errors', () => {
  const src = fs.readFileSync(path.join(root, 'js/director-voice.js'), 'utf8');
  assert.ok(src.includes('Microphone unavailable'));
  assert.ok(!/soft-fail into a fake Listening|startRecognition\(SR, opts\.lang \|\| 'en-US'\);\s*\n\s*\}\);\s*\n\s*\}/.test(src) || src.includes('failAndClose'));
  /* Ensure catch path uses failAndClose, not listening soft-start */
  const catchIdx = src.indexOf('.catch(function (err)');
  const after = src.slice(catchIdx, catchIdx + 900);
  assert.ok(after.includes('failAndClose'));
  assert.ok(!after.includes("setHint('Speak naturally. Director is listening')"));
});

test('subscription no email Pro grant when userId present; portal locked', () => {
  const sec = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
  const portal = fs.readFileSync(path.join(root, 'api/billing-portal.js'), 'utf8');
  assert.ok(sec.includes('never grant Pro via email-only fallback'));
  assert.ok(!portal.includes('customers.list'));
  assert.ok(portal.includes('VERCEL_ENV'));
  assert.ok(portal.includes('stripe_customer_id'));
});

test('requireUser fails closed without URL or any server API key', () => {
  const sec = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
  assert.ok(sec.includes("error: 'server_misconfigured'"));
  assert.ok(sec.includes('function supabaseAuthApiKey'));
  assert.ok(sec.includes('logSupabaseConfigPresence'));
  assert.ok(sec.includes('SUPABASE_ANON_KEY'));
  assert.ok(sec.includes('SUPABASE_SERVICE_KEY'));
});

test('upload signed URLs are short-lived', () => {
  const src = fs.readFileSync(path.join(root, 'api/upload.js'), 'utf8');
  assert.ok(!src.includes('60 * 60 * 24 * 7'));
  assert.ok(src.includes('expiresIn: 60 * 60'));
});

test('analytics client + SQL exist; no new serverless file', () => {
  const js = fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8');
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase6_hardening.sql'), 'utf8');
  const plan = fs.readFileSync(path.join(root, 'api/check-plan.js'), 'utf8');
  assert.ok(js.includes('director_action_success'));
  assert.ok(js.includes('comment_created'));
  assert.ok(sql.includes('product_events'));
  assert.ok(sql.includes('RESTRICTIVE'));
  assert.ok(plan.includes("body.action === 'events'"));
  const files = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12);
});

test('chat scrubber removes false Done claims when ACTION present', () => {
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(html.includes('scrubDirectorMutationClaims'));
  assert.ok(html.includes('analytics.js'));
});

test('CapCut does not fake OAuth success', () => {
  const src = fs.readFileSync(path.join(root, 'js/creative-research.js'), 'utf8');
  assert.ok(src.includes('no public login API'));
  assert.ok(!src.includes('CapCut connected — template research unlocked'));
});

test('no CRDT/OT/cursors introduced', () => {
  ['js/studio-ui.js', 'js/workspace-context.js', 'api/director.js', 'js/analytics.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/CRDT|operational transform|Yjs|Automerge|live cursor/i.test(src));
  });
});

test('personal sync untouched by Phase 6 analytics routes', () => {
  const sync = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(!sync.includes('product_events'));
  assert.ok(!sync.includes('director_action'));
});

test('Auth apikey prefers anon then service key (names only)', () => {
  const prev = {
    anon: process.env.SUPABASE_ANON_KEY,
    pub: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    svc: process.env.SUPABASE_SERVICE_KEY
  };
  try {
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_KEY = 'test-service-placeholder';
    assert.strictEqual(supabaseAuthApiKey(), 'test-service-placeholder');
    process.env.SUPABASE_ANON_KEY = 'test-anon-placeholder';
    assert.strictEqual(supabaseAuthApiKey(), 'test-anon-placeholder');
  } finally {
    if (prev.anon == null) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = prev.anon;
    if (prev.pub == null) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prev.pub;
    if (prev.svc == null) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = prev.svc;
  }
});

console.log(`\nPhase 6: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
