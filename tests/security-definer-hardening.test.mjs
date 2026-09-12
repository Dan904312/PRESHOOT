/**
 * Security Advisor remediation invariants (privilege + RLS helpers).
 * Does not connect to production. Run: node tests/security-definer-hardening.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(
  path.join(root, 'sql/20260911_security_definer_hardening.sql'),
  'utf8'
);
const phase1 = fs.readFileSync(path.join(root, 'supabase_workspaces_phase1.sql'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'supabase_setup.sql'), 'utf8');
const phase3a = fs.readFileSync(
  path.join(root, 'supabase_workspaces_phase3a_realtime.sql'),
  'utf8'
);

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

console.log('\n== Security definer hardening ==');

test('creates private schema and does not expose it as a table dump', () => {
  assert.ok(sql.includes('CREATE SCHEMA IF NOT EXISTS private'));
  assert.ok(sql.includes('REVOKE ALL ON SCHEMA private FROM PUBLIC'));
  assert.ok(!/GRANT USAGE ON SCHEMA private TO anon/.test(sql));
});

test('RLS helpers live in private and bind authenticated probes to auth.uid()', () => {
  assert.ok(sql.includes('FUNCTION private.is_workspace_member'));
  assert.ok(sql.includes("auth.role(), '') = 'authenticated'"));
  assert.ok(sql.includes('p_user_id IS DISTINCT FROM auth.uid()::text'));
  assert.ok(sql.includes('DROP FUNCTION IF EXISTS public.is_workspace_member'));
  assert.ok(sql.includes('DROP FUNCTION IF EXISTS public.workspace_id_from_realtime_topic'));
});

test('workspace_members TTL leak is replaced by membership policy', () => {
  assert.ok(sql.includes('Policy to implement Time To Live (TTL)'));
  assert.ok(sql.includes('workspace_members_select_member'));
  assert.ok(sql.includes('private.is_workspace_member(workspace_id, auth.uid()::text)'));
});

test('backend RPCs require service_role and revoke anon/authenticated', () => {
  assert.ok(sql.includes('PERFORM private.require_service_role()'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.redeem_promo_code(text, text, text) FROM PUBLIC, anon, authenticated'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.admin_daily_usage(timestamptz) FROM PUBLIC, anon, authenticated'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text) FROM PUBLIC, anon, authenticated'));
  assert.ok(!/GRANT EXECUTE ON FUNCTION public.redeem_promo_code[\s\S]*TO authenticated/.test(sql));
});

test('search_path is pinned empty on helpers and triggers', () => {
  assert.ok(sql.includes('SET search_path = \'\'') || sql.includes("SET search_path = ''"));
  assert.ok(sql.includes('FUNCTION public.preshoot_sanitize_tz'));
  assert.ok(sql.includes('FUNCTION public.update_updated_at'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated'));
});

test('no fake USING (true) policies and no destructive data ops', () => {
  assert.ok(!/USING\s*\(\s*true\s*\)/i.test(sql));
  assert.ok(!/^\s*DROP TABLE\b/im.test(sql));
  assert.ok(!/^\s*TRUNCATE\b/im.test(sql));
  assert.ok(!/^\s*DELETE FROM\b/im.test(sql));
});

test('phase1/3a SQL no longer recreates public membership RPCs', () => {
  assert.ok(phase1.includes('FUNCTION private.is_workspace_member'));
  assert.ok(phase1.includes('DROP FUNCTION IF EXISTS public.is_workspace_member'));
  assert.ok(phase1.includes('USING (private.is_workspace_member(id, auth.uid()::text))'));
  assert.ok(phase3a.includes('FUNCTION private.workspace_id_from_realtime_topic'));
  assert.ok(phase3a.includes('private.is_workspace_member'));
  assert.ok(setup.includes('sql/20260911_security_definer_hardening.sql'));
});

test('legacy SQL re-pastes cannot restore public search_path on backend RPCs', () => {
  const files = [
    'supabase_setup.sql',
    'supabase_onboarding_streak.sql',
    'supabase_admin_console.sql',
    'supabase_admin_analytics.sql',
    'supabase_streak_activity.sql',
    'supabase_workspaces_phase1.sql',
    'supabase_admin_notifications.sql'
  ];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(
      !txt.includes('SET search_path = public'),
      f + ' still has SET search_path = public'
    );
    assert.ok(
      txt.includes('sql/20260911_security_definer_hardening.sql LAST') ||
        txt.includes('ALWAYS re-run sql/20260911_security_definer_hardening.sql LAST'),
      f + ' missing LAST-paste operator comment'
    );
  }
});

test('legacy backend DEFINER CREATE blocks include empty search_path + require_service_role', () => {
  const checks = [
    ['supabase_setup.sql', 'redeem_promo_code'],
    ['supabase_setup.sql', 'claim_stripe_event'],
    ['supabase_setup.sql', 'bump_usage_daily'],
    ['supabase_setup.sql', 'check_rate_limit'],
    ['supabase_onboarding_streak.sql', 'grant_onboarding_reward'],
    ['supabase_onboarding_streak.sql', 'consume_onboarding_scan'],
    ['supabase_onboarding_streak.sql', 'refund_onboarding_scan'],
    ['supabase_onboarding_streak.sql', 'record_creation_activity'],
    ['supabase_streak_activity.sql', 'record_creation_activity'],
    ['supabase_admin_console.sql', 'bump_user_scan_count'],
    ['supabase_admin_console.sql', 'admin_usage_rollup'],
    ['supabase_admin_analytics.sql', 'admin_daily_usage'],
    ['supabase_workspaces_phase1.sql', 'ensure_personal_workspace']
  ];
  for (const [f, name] of checks) {
    const txt = fs.readFileSync(path.join(root, f), 'utf8');
    const idx = txt.indexOf('CREATE OR REPLACE FUNCTION ' + name);
    assert.ok(idx >= 0, f + ' missing ' + name);
    const block = txt.slice(idx, idx + 900);
    assert.ok(/SET search_path = ''/.test(block), f + ' ' + name + ' missing empty search_path');
    assert.ok(
      block.includes('PERFORM private.require_service_role()'),
      f + ' ' + name + ' missing require_service_role'
    );
    assert.ok(
      !/GRANT EXECUTE ON FUNCTION[\s\S]{0,80}TO authenticated/.test(block),
      f + ' ' + name + ' must not grant authenticated in CREATE window'
    );
  }
});

test('Auth hooks are pinned without require_service_role', () => {
  const notes = fs.readFileSync(path.join(root, 'supabase_admin_notifications.sql'), 'utf8');
  const hard = fs.readFileSync(
    path.join(root, 'sql/20260911_security_definer_hardening.sql'),
    'utf8'
  );
  for (const [label, txt] of [
    ['notifications', notes],
    ['hardening', hard]
  ]) {
    const gate = txt.indexOf('CREATE OR REPLACE FUNCTION public.preshoot_gate_suspended_jwt');
    assert.ok(gate >= 0, label + ' missing gate hook');
    const gateBlock = txt.slice(gate, txt.indexOf('CREATE OR REPLACE FUNCTION public.preshoot_custom_access_token_hook'));
    assert.ok(/SET search_path = ''/.test(gateBlock), label + ' gate search_path');
    assert.ok(!gateBlock.includes('PERFORM private.require_service_role()'), label + ' gate must not require service_role');
    const wrap = txt.indexOf('CREATE OR REPLACE FUNCTION public.preshoot_custom_access_token_hook');
    const wrapBlock = txt.slice(wrap, wrap + 400);
    assert.ok(/SET search_path = ''/.test(wrapBlock), label + ' wrapper search_path');
    assert.ok(txt.includes('GRANT EXECUTE ON FUNCTION public.preshoot_gate_suspended_jwt(jsonb) TO postgres, service_role, supabase_auth_admin'));
    assert.ok(txt.includes('REVOKE ALL ON FUNCTION public.preshoot_gate_suspended_jwt(jsonb) FROM PUBLIC, anon, authenticated'));
  }
  assert.ok(sql.includes('paste this file LAST') || sql.includes('OPERATOR: paste this file LAST'));
});

test('server callers still use service-role PostgREST RPC paths', () => {
  const files = [
    'api/webhook.js',
    'api/promo.js',
    'lib/security.js',
    'lib/entitlements.js',
    'lib/admin-console.js',
    'lib/usage-ledger.js'
  ];
  const joined = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  assert.ok(joined.includes('/rpc/claim_stripe_event'));
  assert.ok(joined.includes('/rpc/redeem_promo_code'));
  assert.ok(joined.includes('/rpc/bump_usage_daily'));
  assert.ok(joined.includes('/rpc/check_rate_limit'));
  assert.ok(joined.includes("rpc('grant_onboarding_reward'") || joined.includes('grant_onboarding_reward'));
  assert.ok(joined.includes('serviceHeaders') || joined.includes('SUPABASE_SERVICE_KEY'));
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed) process.exit(1);
console.log('ALL SECURITY DEFINER HARDENING TESTS PASSED');
