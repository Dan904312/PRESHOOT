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
