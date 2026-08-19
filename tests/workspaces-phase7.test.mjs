/**
 * Phase 7 — Growth / product intelligence invariants.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PRODUCT_EVENTS,
  PRODUCT_EVENT_SET,
  sanitizeEventMeta,
  estimateAiCostUsd,
  ACTIVATION_EVENTS
} from '../lib/product-events.js';
import {
  PERFORMANCE_METRICS,
  normalizePerformanceInput
} from '../lib/content-performance.js';

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

console.log('\n== Phase 7 product intelligence ==');

test('product event allowlist covers funnel + monetization + AI', () => {
  [
    'signup',
    'onboarding_completed',
    'idea_generated',
    'production_created',
    'director_action_success',
    'director_action_failure',
    'pricing_viewed',
    'checkout_started',
    'subscription_started',
    'referral_signup',
    'hook_structure_used',
    'ai_request',
    'api_error',
    'production_performance_updated'
  ].forEach((e) => assert.ok(PRODUCT_EVENT_SET.has(e), e));
  assert.ok(PRODUCT_EVENTS.length >= 30);
});

test('activation is idea + production', () => {
  assert.deepStrictEqual(ACTIVATION_EVENTS, ['idea_generated', 'production_created']);
});

test('sanitizeEventMeta strips sensitive keys and long strings', () => {
  const safe = sanitizeEventMeta({
    prompt: 'secret',
    script: 'full script',
    endpoint: 'director',
    cost_usd: 0.012,
    body: 'nope',
    long: 'x'.repeat(200)
  });
  assert.strictEqual(safe.prompt, undefined);
  assert.strictEqual(safe.script, undefined);
  assert.strictEqual(safe.body, undefined);
  assert.strictEqual(safe.endpoint, 'director');
  assert.strictEqual(safe.cost_usd, 0.012);
  assert.strictEqual(safe.long, undefined);
});

test('estimateAiCostUsd is deterministic and positive for tokens', () => {
  const c = estimateAiCostUsd('claude-sonnet-4-6', 1e6, 1e6);
  assert.ok(c > 0);
  assert.strictEqual(estimateAiCostUsd('claude-sonnet-4-6', 0, 0), 0);
});

test('content performance normalizer accepts metrics only', () => {
  assert.ok(PERFORMANCE_METRICS.includes('views'));
  assert.ok(PERFORMANCE_METRICS.includes('retention'));
  const n = normalizePerformanceInput({
    views: '1,200',
    likes: 40,
    platform: 'tiktok',
    productionId: 'prod_1',
    script: 'should ignore'
  });
  assert.strictEqual(n.metrics.views, 1200);
  assert.strictEqual(n.metrics.likes, 40);
  assert.strictEqual(n.platform, 'tiktok');
  assert.strictEqual(n.production_id, 'prod_1');
  assert.strictEqual(n.metrics.script, undefined);
});

test('client analytics allowlist matches server events', () => {
  const js = fs.readFileSync(path.join(root, 'js/analytics.js'), 'utf8');
  assert.ok(js.includes('referralShareUrl'));
  assert.ok(js.includes('noteIdeaGenerated'));
  assert.ok(js.includes('noteProductionCreated'));
  assert.ok(js.includes('hook_structure_used'));
  assert.ok(js.includes('ai_request'));
});

test('app wires scan/idea/director/paywall/checkout events', () => {
  const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(app.includes('openPaywall'));
  assert.ok(app.includes("track('scan_started')"));
  assert.ok(app.includes("track('scan_completed'"));
  assert.ok(app.includes("track('idea_generated'"));
  assert.ok(app.includes("track('director_opened'"));
  assert.ok(app.includes("track('director_action_requested'"));
  assert.ok(app.includes("track('checkout_started'"));
  assert.ok(app.includes('copyReferralLink'));
  assert.ok(app.includes('Made with PreShoot'));
  assert.ok(!app.includes('fresh trending ideas daily'));
  assert.ok(!app.includes('Trending formats updated daily'));
});

test('studio + hooks + workspace fire activation-related events', () => {
  const studio = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(studio.includes("track('project_created'"));
  assert.ok(studio.includes("track('production_created'"));
  assert.ok(studio.includes("track('asset_uploaded'"));
  assert.ok(studio.includes("track('production_performance_updated'"));
  const hooks = fs.readFileSync(path.join(root, 'js/hook-engine.js'), 'utf8');
  assert.ok(hooks.includes("track(\n          'hook_structure_used'") || hooks.includes("track(\n          \"hook_structure_used\"") || hooks.includes("'hook_structure_used'"));
  const ws = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
  assert.ok(ws.includes("track('workspace_invited'"));
  assert.ok(ws.includes("track('workspace_joined'"));
});

test('AI endpoints log ai_request without prompt bodies', () => {
  const dir = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'api/research.js'), 'utf8');
  assert.ok(dir.includes('trackProductEventServer'));
  assert.ok(dir.includes("ai_request"));
  assert.ok(dir.includes('estimateAiCostUsd'));
  assert.ok(chat.includes("ai_request"));
  assert.ok(research.includes("ai_request"));
  assert.ok(!dir.includes('prompt:'));
});

test('admin product_overview action exists and MRR uses $9/$79', () => {
  const admin = fs.readFileSync(path.join(root, 'api/admin-data.js'), 'utf8');
  assert.ok(admin.includes("case 'product_overview'"));
  assert.ok(admin.includes('activated_users'));
  assert.ok(admin.includes('action_success_rate'));
  assert.ok(admin.includes('* 9') || admin.includes('*9'));
  assert.ok(admin.includes('79/12') || admin.includes('79 / 12'));
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  assert.ok(html.includes('product_overview'));
  assert.ok(html.includes('ov-activated'));
});

test('landing communicates Studio and honest Director context', () => {
  const land = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(land.includes('Studio + collaboration') || land.includes('Studio holds the production'));
  assert.ok(land.includes('deterministic context') || land.includes('project context'));
  assert.ok(land.includes('<sup>$</sup>9') || land.includes('$9'));
  assert.ok(land.includes('<sup>$</sup>79') || land.includes('$79') || land.includes('79/year'));
  assert.ok(land.includes('https://buy.stripe.com/28EaEXa574Y9esvaEWa7C00'));
  assert.ok(land.includes('https://buy.stripe.com/dRm5kD0ux62d2JN00ia7C01'));
  assert.ok(land.includes('href="/app.html"'));
  const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  assert.ok(app.includes("m: 'https://buy.stripe.com/28EaEXa574Y9esvaEWa7C00'"));
  assert.ok(app.includes("y: 'https://buy.stripe.com/dRm5kD0ux62d2JN00ia7C01'"));
  assert.ok(app.includes('onclick="selPlan(\'m\')"'));
  assert.ok(app.includes('onclick="selPlan(\'y\')"'));
  assert.ok(app.includes('onclick="upgradePro()"'));
});

test('phase7 SQL content_performance boundary exists', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase7_growth.sql'), 'utf8');
  assert.ok(sql.includes('content_performance'));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('No fabricated'));
});

test('still exactly 12 serverless functions', () => {
  const apiDir = path.join(root, 'api');
  const files = fs.readdirSync(apiDir).filter((f) => f.endsWith('.js'));
  assert.strictEqual(files.length, 12, 'api/*.js count=' + files.length);
});

console.log('\nPhase 7 results:', passed, 'passed,', failed, 'failed\n');
if (failed) process.exit(1);
