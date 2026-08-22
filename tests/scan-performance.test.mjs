/**
 * Scan pipeline + mobile/theme hardening contracts.
 * Run: node tests/scan-performance.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSafeChatBody, publicScanErrorMessage, SCAN_DEFAULT_MAX_TOKENS } from '../lib/scan-request.js';

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

const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const chatSrc = fs.readFileSync(path.join(root, 'api/chat.js'), 'utf8');
const orbSrc = fs.readFileSync(path.join(root, 'js/orb.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
const ctxSrc = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((n) => /\.(js|mjs|cjs|ts)$/.test(n));

console.log('\n== Scan performance / mobile UX / accent ==');

test('Hobby still has exactly 12 api functions', () => {
  assert.strictEqual(apiFiles.length, 12);
  assert.ok(!apiFiles.includes('scan-request.js'));
});

test('scan sanitizer caches system prompt and defaults 2400 tokens', () => {
  assert.strictEqual(SCAN_DEFAULT_MAX_TOKENS, 2400);
  const safe = buildSafeChatBody(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2400,
      stream: true,
      system: [{ type: 'text', text: 'You are PreShoot Director. '.repeat(40) }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'CREATOR: cars' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' }
            }
          ]
        }
      ]
    },
    function () {
      return { data: 'abc', mime: 'image/jpeg' };
    }
  );
  assert.ok(!safe.error);
  assert.ok(Array.isArray(safe.system));
  assert.strictEqual(safe.system[safe.system.length - 1].cache_control.type, 'ephemeral');
  assert.strictEqual(safe.max_tokens, 2400);
});

test('chat route instruments timings and unblocks the client before ledger writes', () => {
  assert.ok(chatSrc.includes('logScanTiming'));
  assert.ok(chatSrc.includes('X-Scan-Prep-Ms'));
  assert.ok(chatSrc.includes('prompt-caching-2024-07-31'));
  const streamStart = chatSrc.indexOf('if (safe.stream)');
  const streamEnd = chatSrc.indexOf('const data = await response.json()');
  const streamFn = chatSrc.slice(streamStart, streamEnd);
  assert.ok(streamFn.indexOf('res.end()') < streamFn.indexOf('persistScanSuccess'));
  assert.ok(chatSrc.includes('publicScanErrorMessage'));
});

test('public scan errors never include internals', () => {
  const msg = publicScanErrorMessage(500, 'ECONNRESET');
  assert.ok(/analyzing your image/i.test(msg));
  assert.ok(!/ECONNRESET|stack|supabase/i.test(msg));
});

test('frontend uses one in-flight lock, real stages, and cached system prompt', () => {
  assert.ok(appSrc.includes('var _scanInFlight=false'));
  assert.ok(appSrc.includes("setLoadStep('Analyzing image')"));
  assert.ok(appSrc.includes("setLoadStep('Understanding context')"));
  assert.ok(appSrc.includes("setLoadStep('Building ideas')"));
  assert.ok(appSrc.includes("setLoadStep('Almost there')"));
  assert.ok(appSrc.includes('cache_control:{type:\'ephemeral\'}'));
  assert.ok(appSrc.includes('max_tokens:2400'));
  assert.ok(!appSrc.includes('max_tokens:3200'));
  assert.ok(!appSrc.includes("setTimeout(function() { startScan(); }, 400)"));
  assert.ok(appSrc.includes('scan_client_timing'));
  assert.ok(appSrc.includes('if(_scanInFlight) return'));
});

test('primary CTAs and Director Go follow accent, not hardcoded green/black', () => {
  assert.ok(appSrc.includes('.rescan-btn,.fmt-go-btn,.gen-shotlist-btn,.pw-cta,.ob-btn-primary,.ob-nav-next,.auth-btn.primary,.btn-primary{'));
  assert.ok(appSrc.includes('background:var(--accent)!important'));
  assert.ok(!appSrc.includes('.dir-cmd-go.ready{background:#1f9d5a'));
  assert.ok(appSrc.includes('.dir-cmd-go.ready{background:var(--accent)'));
  assert.ok(!appSrc.includes('html.theme-light .rescan-btn,html.theme-light .fmt-go-btn,html.theme-light .gen-shotlist-btn,html.theme-light .ob-btn-primary,html.theme-light .ob-nav-next{\n  background:#000!important'));
});

test('orb derives accent variations and reads window.S', () => {
  assert.ok(orbSrc.includes('colorsFromAccent'));
  assert.ok(orbSrc.includes('window.S'));
  assert.ok(orbSrc.includes('hslToRgb'));
  assert.ok(!orbSrc.includes('#1f9d5a'));
});

test('mobile Studio hamburger and overflow rules exist', () => {
  assert.ok(uiSrc.includes('studio-more-btn'));
  assert.ok(uiSrc.includes('toggleStudioMenu'));
  assert.ok(appSrc.includes('@media (max-width:768px)'));
  assert.ok(appSrc.includes('@media (max-width:375px)'));
  assert.ok(appSrc.includes('@media (max-width:320px)'));
  assert.ok(appSrc.includes('overflow-x:hidden'));
});

test('workspace switch still uses one context object and existing sync routes', () => {
  assert.ok(ctxSrc.includes('activeWorkspaceId: state.activeWorkspaceId'));
  assert.ok(ctxSrc.includes('activeWorkspaceKind: state.activeWorkspaceKind'));
  assert.ok(ctxSrc.includes('activeWorkspaceRole: state.activeWorkspaceRole'));
  const syncSrc = fs.readFileSync(path.join(root, 'js/studio-sync.js'), 'utf8');
  const wsSyncSrc = fs.readFileSync(path.join(root, 'js/workspace-sync.js'), 'utf8');
  assert.ok(syncSrc.includes('/api/sync'));
  assert.ok(wsSyncSrc.includes('/api/workspace-sync'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
