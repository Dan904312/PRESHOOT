/**
 * Admin console 2.0 — usage ledger, account gate, messaging, hobby budget.
 * Run: node tests/admin-console.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  estimateAiCostUsd,
  estimateAiCostFromUsage,
  lookupPricing,
  formatApiCostUsd,
  parseAnthropicStreamUsage,
  USAGE_EVENT_TYPES
} from '../lib/ai-pricing.js';
import { emailProviderStatus } from '../lib/email.js';
import { recordUsageEvent } from '../lib/usage-ledger.js';
import { estimatedProfit, mergeDailySeries, buildUtcDayKeys } from '../lib/admin-console.js';
import {
  isAccountStatusSchemaError,
  getAccountStatus,
  ACCOUNT_ACTIVE,
  ACCOUNT_SUSPENDED
} from '../lib/account-status.js';
import { requireActiveUser, fetchWithTimeout } from '../lib/security.js';

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

const sql = fs.readFileSync(path.join(root, 'supabase_admin_console.sql'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'api/admin-data.js'), 'utf8');
const adminAuth = fs.readFileSync(path.join(root, 'api/admin-auth.js'), 'utf8');
const security = fs.readFileSync(path.join(root, 'lib/security.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'lib/account-status.js'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'lib/usage-ledger.js'), 'utf8');
const email = fs.readFileSync(path.join(root, 'lib/email.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
const director = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api/research.js'), 'utf8');
const envEx = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));

console.log('\n== Admin console 2.0 ==');

test('hobby stays at 12 serverless files', () => {
  assert.strictEqual(apiFiles.length, 12, 'api/*.js count=' + apiFiles.length);
});

test('SQL creates usage, audit, email, account_status', () => {
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS usage_events'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS admin_audit_log'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS admin_email_log'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS app_settings'));
  assert.ok(sql.includes("CHECK (account_status IN ('active', 'suspended'))"));
  assert.ok(sql.includes("usage_tracking_started_at"));
  assert.ok(sql.includes('ON CONFLICT (key) DO NOTHING'));
  assert.ok(sql.includes('admin_usage_rollup'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE usage_events FROM anon, authenticated'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE admin_audit_log FROM anon, authenticated'));
  assert.ok(sql.includes('GRANT ALL ON TABLE usage_events TO service_role'));
  assert.ok(sql.includes('GRANT ALL ON TABLE admin_audit_log TO service_role'));
  assert.ok(sql.includes('idx_users_account_status_at'));
  assert.ok(!sql.includes('GRANT ALL ON TABLE usage_events TO anon'));
  assert.ok(!sql.includes('GRANT ALL ON TABLE admin_audit_log TO authenticated'));
});

test('pricing is centralized and token-based', () => {
  const row = lookupPricing('claude-sonnet-4-6', 'anthropic');
  assert.strictEqual(row.input_cost_per_million, 3);
  assert.strictEqual(estimateAiCostUsd('claude-sonnet-4-6', 1e6, 1e6), 18);
  const haiku = estimateAiCostUsd('claude-haiku-4-5-20251001', 1e6, 0);
  assert.strictEqual(haiku, 0.8);
  const tiny = estimateAiCostUsd('claude-sonnet-4-6', 140, 0);
  assert.ok(tiny > 0 && tiny < 0.01);
  assert.strictEqual(formatApiCostUsd(tiny), '$' + tiny.toFixed(5));
  assert.strictEqual(formatApiCostUsd(0.00001), '$0.00001');
  assert.ok(!formatApiCostUsd(0.00042).endsWith('0.00'));
  assert.ok(formatApiCostUsd(1.24).includes('1.24000'));
  const cached = estimateAiCostFromUsage('claude-sonnet-4-6', {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1e6
  });
  assert.strictEqual(cached, 0.3);
  const streamed = parseAnthropicStreamUsage(
    'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":100}}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":8}}'
  );
  assert.strictEqual(streamed.input_tokens, 12);
  assert.strictEqual(streamed.output_tokens, 8);
  assert.strictEqual(streamed.cache_read_tokens, 100);
  assert.ok(USAGE_EVENT_TYPES.includes('scan'));
  assert.ok(USAGE_EVENT_TYPES.includes('director_request'));
  assert.ok(!chat.includes('input_cost_per_million'));
  assert.ok(!director.includes('input_cost_per_million'));
});

test('estimated profit and daily series do not invent history', () => {
  const pos = estimatedProfit(100, 10);
  assert.strictEqual(pos.profit, 90);
  assert.strictEqual(pos.margin, 90);
  const neg = estimatedProfit(0, 10);
  assert.strictEqual(neg.profit, -10);
  assert.strictEqual(neg.margin, null);
  const keys = buildUtcDayKeys(3, '2026-08-22T12:00:00.000Z');
  assert.deepStrictEqual(keys, ['2026-08-20', '2026-08-21', '2026-08-22']);
  const series = mergeDailySeries(keys, {
    scans: { '2026-08-22': 2 },
    dau: { '2026-08-22': 1 },
    signups: {},
    revenue: { '2026-08-22': 9 },
    api_cost: { '2026-08-22': 0.00042 }
  });
  assert.strictEqual(series[0].scans, 0);
  assert.strictEqual(series[2].scans, 2);
  assert.strictEqual(series[2].profit, estimatedProfit(9, 0.00042).profit);
});

test('usage ledger skips failed events and omits prompts', () => {
  assert.ok(ledger.includes("status !== 'success'"));
  assert.ok(ledger.includes('skipped: true'));
  assert.ok(ledger.includes('bump_user_scan_count'));
  assert.ok(ledger.includes('prompt|content|image'));
});

await testAsync('failed usage events are not inserted', async () => {
  const r = await recordUsageEvent({
    user_id: 'x',
    event_type: 'scan',
    status: 'failed',
    input_units: 100,
    output_units: 20
  });
  assert.strictEqual(r.skipped, true);
});

test('requireUser enforces requireActiveUser', () => {
  assert.ok(security.includes('export async function requireActiveUser'));
  assert.ok(security.includes('const access = await requireActiveUser(user.id)'));
  assert.ok(security.includes("error: 'account_suspended'"));
  assert.ok(security.includes("error: 'account_status_unconfigured'"));
  assert.ok(security.includes("error: 'account_status_unavailable'"));
  assert.ok(security.includes('fetchJsonWithTimeout'));
  ['chat', 'director', 'sync', 'workspaces', 'check-plan', 'upload', 'promo', 'billing-portal', 'research'].forEach((name) => {
    const src = fs.readFileSync(path.join(root, 'api', name + '.js'), 'utf8');
    assert.ok(src.includes('requireUser'), name + ' must call requireUser');
  });
  const webhook = fs.readFileSync(path.join(root, 'api/webhook.js'), 'utf8');
  assert.ok(!webhook.includes('requireUser'), 'Stripe webhook is not a user JWT route');
});

test('suspend bans Auth; restore does not grant Pro', () => {
  assert.ok(account.includes('ban_duration'));
  assert.ok(account.includes("scope: 'global'"));
  assert.ok(account.includes('return=representation'));
  assert.ok(account.includes('on_conflict=user_id'));
  assert.ok(account.includes('isAccountStatusSchemaError'));
  assert.ok(account.includes("error: 'schema_missing'"));
  assert.ok(account.includes('auth_ban_failed') || account.includes('banned_until'));
  assert.ok(account.includes('persisted: true'));
  assert.ok(admin.includes("case 'suspend_user'"));
  assert.ok(admin.includes("case 'restore_user'"));
  assert.ok(admin.includes('confirm_password'));
  assert.ok(admin.includes("error: 'schema_missing'"));
  assert.ok(admin.includes('partial: true'));
  const restoreBlock = admin.split("case 'restore':")[1].split("case '")[0];
  assert.ok(restoreBlock.includes("plan: 'free'"));
  assert.ok(!restoreBlock.includes("plan: 'pro'"));
  const restoreUser = admin.split("case 'restore_user':")[1].split("case '")[0];
  assert.ok(restoreUser.includes('granted_pro: false'));
  assert.ok(!restoreUser.includes("plan: 'pro'"));
  const suspendUser = admin.split("case 'suspend_user':")[1].split("case '")[0];
  assert.ok(suspendUser.includes('success: true'));
  assert.ok(suspendUser.includes('persisted'));
  const suspendAudit = suspendUser.split('writeAdminAudit')[1] || '';
  assert.ok(!suspendAudit.includes('confirm_password'));
});

test('account_status SQL exists in-repo', () => {
  const focused = fs.readFileSync(path.join(root, 'sql/users_account_status.sql'), 'utf8');
  const docs = fs.readFileSync(path.join(root, 'UPDATE-0033-admin-console.md'), 'utf8');
  assert.ok(focused.includes('ADD COLUMN IF NOT EXISTS account_status'));
  assert.ok(focused.includes('account_status_reason'));
  assert.ok(focused.includes('account_status_at'));
  assert.ok(focused.includes('account_status_by'));
  assert.ok(focused.includes("CHECK (account_status IN ('active', 'suspended'))"));
  assert.ok(focused.includes('ALTER TABLE public.users'));
  assert.ok(focused.includes('WHEN duplicate_object THEN NULL'));
  assert.ok(focused.includes('idx_users_account_status_at'));
  assert.ok(focused.includes('COMMENT ON COLUMN public.users.account_status'));
  assert.ok(docs.includes('sql/users_account_status.sql'));
  assert.ok(docs.includes('supabase_admin_console.sql'));
  assert.ok(docs.includes('Never suspend'));
  assert.ok(admin.includes('sql/users_account_status.sql (or supabase_admin_console.sql)'));
});

test('users_list does not wait on all-time usage rollup', () => {
  const usersList = admin.split("case 'users_list':")[1].split("case '")[0];
  assert.ok(!usersList.includes('fetchUsageRollup(null)'));
  assert.ok(usersList.includes('fetchUsageRollup(isoDaysAgo(1))'));
  assert.ok(!usersList.includes('select=*'));
});

test('admin UI times out hung POSTs and never treats hang as success', () => {
  assert.ok(html.includes('AbortController'));
  assert.ok(html.includes('ADMIN_FETCH_MS'));
  assert.ok(html.includes('if (d && d.success)'));
  assert.ok(html.includes('Request timed out. Try again.'));
  assert.ok(html.includes("btn.textContent = 'Suspending…'"));
});

test('admin session timeout does not clear the cookie', () => {
  const sessionJs = fs.readFileSync(path.join(root, 'lib/admin-session.js'), 'utf8');
  assert.ok(sessionJs.includes("error: 'session_lookup_timeout'"));
  assert.ok(admin.includes('session.status === 503'));
  assert.ok(adminAuth.includes('session.status === 503'));
});

test('admin notifications persist and omit secrets', () => {
  const notifSql = fs.readFileSync(path.join(root, 'supabase_admin_notifications.sql'), 'utf8');
  const notif = fs.readFileSync(path.join(root, 'lib/admin-notifications.js'), 'utf8');
  assert.ok(notifSql.includes('CREATE TABLE IF NOT EXISTS admin_notifications'));
  assert.ok(notifSql.includes('REVOKE ALL ON TABLE admin_notifications FROM anon, authenticated'));
  assert.ok(notif.includes('suspended_login'));
  assert.ok(notif.includes('notifySuspendedAuthAttempt'));
  assert.ok(notif.includes('sessionRefFromToken'));
  assert.ok(!notif.includes('access_token'));
  assert.ok(!notif.includes('refresh_token'));
  assert.ok(admin.includes("case 'notifications_list'"));
  assert.ok(admin.includes("case 'notifications_read'"));
  assert.ok(html.includes('id="notif-btn"'));
  assert.ok(html.includes('id="notif-panel"'));
  assert.ok(html.includes('Mark all read'));
});

test('admin API rejects client admin flags and legacy key header', () => {
  assert.ok(admin.includes("req.headers['x-admin-key']"));
  assert.ok(admin.includes('requireAdminSession'));
  assert.ok(!admin.includes('isAdmin'));
  assert.ok(!html.includes('localStorage') || !html.includes('isAdmin'));
});

test('admin login is separately rate-limited', () => {
  assert.ok(adminAuth.includes("route: 'admin-login'"));
  assert.ok(adminAuth.includes('max: 8'));
});

test('scan and Director success paths await usage recording', () => {
  assert.ok(chat.includes("event_type: 'scan'"));
  assert.ok(chat.includes('await recordUsageEvent'));
  assert.ok(chat.includes('scan_usage_record_failed'));
  assert.ok(director.includes("event_type: 'director_request'"));
  assert.ok(director.includes('await recordUsageEvent'));
  assert.ok(research.includes("event_type: 'research'"));
});

test('admin usage query falls back to usage_events table', () => {
  const consoleLib = fs.readFileSync(path.join(root, 'lib/admin-console.js'), 'utf8');
  assert.ok(consoleLib.includes('fetchUsageRollupFromTable'));
  assert.ok(consoleLib.includes('probeUsageLedger'));
  assert.ok(admin.includes('probeUsageLedger'));
  assert.ok(admin.includes('ledger:'));
});

test('email adapter never claims success without a provider', () => {
  assert.strictEqual(emailProviderStatus().configured, Boolean(process.env.RESEND_API_KEY));
  assert.ok(email.includes('email_not_configured'));
  assert.ok(admin.includes("status = 'failed'"));
  assert.ok(admin.includes('confirm_count_mismatch'));
  assert.ok(admin.includes('large_batch_confirmation_required'));
  assert.ok(admin.includes('no_recipients'));
});

test('admin UI is an operations console without emoji nav', () => {
  assert.ok(html.includes("showPage('overview'"));
  assert.ok(html.includes("showPage('users'"));
  assert.ok(html.includes("showPage('usage'"));
  assert.ok(html.includes("showPage('revenue'"));
  assert.ok(html.includes("showPage('security'"));
  assert.ok(html.includes("showPage('messaging'"));
  assert.ok(html.includes("showPage('system'"));
  assert.ok(html.includes('product_overview'));
  assert.ok(html.includes('ov-activated'));
  assert.ok(html.includes('Usage tracking available from'));
  assert.ok(html.includes('Historical usage was not recorded'));
  assert.ok(html.includes('function moneyApi'));
  assert.ok(html.includes('daily_analytics'));
  assert.ok(html.includes('Estimated profit'));
  assert.ok(!html.includes("set('ov-ai-cost', '—')"));
  assert.ok(!html.includes("set('us-cost', '—')"));
  assert.ok(!html.includes('nav-ico'));
  assert.ok(!/📊|👥|✨|🚪|🎟/.test(html));
  assert.ok(html.includes('Suspend account'));
  assert.ok(html.includes('Restore account'));
});

test('service-role stays server-only', () => {
  assert.ok(!envEx.includes('NEXT_PUBLIC_SUPABASE_SERVICE'));
  const pub = fs.readdirSync(path.join(root, 'js')).concat(['app.html', 'admin.html']);
  pub.forEach((f) => {
    const p = f.endsWith('.html') ? path.join(root, f) : path.join(root, 'js', f);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return;
    const txt = fs.readFileSync(p, 'utf8');
    assert.ok(!txt.includes('SERVICE_ROLE'), f + ' must not mention service role');
    assert.ok(!txt.includes('SUPABASE_SERVICE_KEY'), f + ' must not embed service key');
  });
});

test('privacy and terms mention operational tracking honestly', () => {
  const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
  const terms = fs.readFileSync(path.join(root, 'terms.html'), 'utf8');
  assert.ok(privacy.includes('Operational usage metrics'));
  assert.ok(privacy.includes('24 months'));
  assert.ok(privacy.includes('does not claim ISO'));
  assert.ok(privacy.includes('does not retrieve scan images'));
  assert.ok(terms.includes('cannot use authenticated PreShoot APIs'));
  assert.ok(terms.includes('does not, by itself, grant a paid plan'));
  assert.ok(terms.includes('do not automatically ban'));
});

test('admin APIs stay session-gated and daily analytics is server-side', () => {
  assert.ok(admin.includes("case 'daily_analytics'"));
  assert.ok(admin.includes('estimated_profit'));
  assert.ok(admin.includes("action: 'user_viewed'"));
  assert.ok(admin.includes('requireAdminSession'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE usage_events FROM anon, authenticated'));
  const analyticsSql = fs.readFileSync(path.join(root, 'supabase_admin_analytics.sql'), 'utf8');
  assert.ok(analyticsSql.includes('admin_daily_usage'));
  assert.ok(analyticsSql.includes('GRANT EXECUTE ON FUNCTION admin_daily_usage'));
});

test('schema errors are operator failures, not active', () => {
  assert.ok(isAccountStatusSchemaError(400, { code: '42703', message: 'column users.account_status does not exist' }));
  assert.ok(isAccountStatusSchemaError(400, { code: 'PGRST204' }));
  assert.ok(!isAccountStatusSchemaError(200, [{ account_status: 'active' }]));
});

await testAsync('getAccountStatus does not fail-open on missing column', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  global.fetch = async () => ({
    ok: false,
    status: 400,
    headers: { get: () => null },
    text: async () => JSON.stringify({ code: '42703', message: 'column users.account_status does not exist' })
  });
  try {
    const row = await getAccountStatus('user-1');
    assert.notStrictEqual(row.status, ACCOUNT_ACTIVE);
    assert.strictEqual(row.misconfigured, true);
    const gate = await requireActiveUser('user-1');
    assert.strictEqual(gate.error, 'account_status_unconfigured');
    assert.strictEqual(gate.status, 503);
  } finally {
    global.fetch = origFetch;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = prevKey;
  }
});

await testAsync('getAccountStatus does not fail-open on timeout', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  global.fetch = (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  try {
    const row = await getAccountStatus('user-1');
    assert.notStrictEqual(row.status, ACCOUNT_ACTIVE);
    assert.strictEqual(row.unavailable, true);
    const gate = await requireActiveUser('user-1');
    assert.strictEqual(gate.error, 'account_status_unavailable');
    assert.strictEqual(gate.status, 503);
  } finally {
    global.fetch = origFetch;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = prevKey;
  }
});

await testAsync('requireActiveUser blocks explicit suspended', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_KEY;
  const origFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify([
        {
          account_status: ACCOUNT_SUSPENDED,
          account_status_reason: 'test',
          account_status_at: '2026-09-04T00:00:00.000Z',
          account_status_by: 'admin'
        }
      ])
  });
  try {
    const row = await getAccountStatus('user-1');
    assert.strictEqual(row.status, ACCOUNT_SUSPENDED);
    const gate = await requireActiveUser('user-1');
    assert.strictEqual(gate.error, 'account_suspended');
    assert.strictEqual(gate.status, 403);
  } finally {
    global.fetch = origFetch;
    if (prevUrl == null) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = prevKey;
  }
});

await testAsync('fetchWithTimeout aborts hung outbound requests', async () => {
  const origFetch = global.fetch;
  global.fetch = (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  const started = Date.now();
  try {
    await fetchWithTimeout('https://example.invalid/slow', {}, 400);
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(/AbortError|aborted/i.test(String((e && e.name) || '') + ' ' + String((e && e.message) || e)));
    assert.ok(Date.now() - started < 2000);
  } finally {
    global.fetch = origFetch;
  }
});

console.log('\nAdmin console results:', passed, 'passed,', failed, 'failed\n');
if (failed) process.exit(1);
