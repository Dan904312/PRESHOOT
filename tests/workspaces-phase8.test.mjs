/**
 * Workspace UX overhaul — switch guards, join codes, accent theming.
 * Run: node tests/workspaces-phase8.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  hashJoinCode,
  isJoinCode,
  normalizeJoinCode,
  generateJoinCode,
  isUuid,
  JOIN_CODE_DEFAULT_ROLE,
  JOIN_CODE_ROLES
} from '../lib/workspaces.js';

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

const ctxSrc = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'js/workspace-ui.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(root, 'api/workspaces.js'), 'utf8');
const libSrc = fs.readFileSync(path.join(root, 'lib/workspaces.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const orbSrc = fs.readFileSync(path.join(root, 'js/orb.js'), 'utf8');
const sqlSrc = fs.readFileSync(
  path.join(root, 'supabase_workspaces_phase8_join_codes.sql'),
  'utf8'
);

console.log('\n== Phase 8 workspace UX / join codes / theme ==');

await test('join codes are 6 digits and never equal their hash', () => {
  const code = generateJoinCode();
  assert.ok(/^\d{6}$/.test(code));
  const hash = hashJoinCode(code, 'test-pepper');
  assert.notStrictEqual(hash, code);
  assert.ok(!hash.includes(code));
  assert.strictEqual(hash.length, 64);
  assert.notStrictEqual(hashJoinCode(code, 'a'), hashJoinCode(code, 'b'));
  assert.strictEqual(hashJoinCode('123456', 'p'), hashJoinCode('123 456', 'p'));
});

await test('UUID is not accepted as a join code', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  assert.strictEqual(isUuid(uuid), true);
  assert.strictEqual(isJoinCode(uuid), false);
  assert.strictEqual(isJoinCode('12'), false);
  assert.strictEqual(isJoinCode(normalizeJoinCode('98 7654')), true);
});

await test('default join role is editor, never owner', () => {
  assert.strictEqual(JOIN_CODE_DEFAULT_ROLE, 'editor');
  assert.ok(JOIN_CODE_ROLES.includes('editor'));
  assert.ok(JOIN_CODE_ROLES.includes('viewer'));
  assert.ok(!JOIN_CODE_ROLES.includes('owner'));
  assert.ok(libSrc.includes("error: 'invalid_join_code'"));
  assert.ok(libSrc.includes('not a workspace id'));
  assert.ok(libSrc.includes('already_member'));
  assert.ok(libSrc.includes('workspace_archived'));
});

await test('SQL stores hashed join codes only', () => {
  assert.ok(sqlSrc.includes('join_code_hash'));
  assert.ok(sqlSrc.includes('join_code_role'));
  assert.ok(!/plaintext|join_code text/i.test(sqlSrc.split('hash')[0] || ''));
  assert.ok(sqlSrc.includes("CHECK (join_code_role IN ('editor', 'commenter', 'viewer'))"));
});

await test('join routes live on existing workspaces function', () => {
  assert.ok(apiSrc.includes("parts[0] === 'join'"));
  assert.ok(apiSrc.includes("parts[1] === 'join-code'"));
  assert.ok(apiSrc.includes('joinWorkspaceByCode'));
  assert.ok(apiSrc.includes("route: 'workspace-join'"));
  const apiDir = fs.readdirSync(path.join(root, 'api')).filter((n) => /\.(js|mjs|cjs|ts)$/.test(n));
  assert.ok(!apiDir.includes('join.js'));
  assert.ok(!apiDir.includes('workspace-join.js'));
});

await test('switchTo lets later selection win and hides old Studio immediately', () => {
  assert.ok(!ctxSrc.includes("if (state.switching) return Promise.resolve({ ok: false, error: 'busy' })"));
  assert.ok(ctxSrc.includes('beginSwitchTransition'));
  assert.ok(ctxSrc.includes('AbortController'));
  assert.ok(ctxSrc.includes('stale_save'));
  assert.ok(ctxSrc.includes('failSwitch'));
  assert.ok(ctxSrc.includes('flush_failed'));
  assert.ok(ctxSrc.includes('Could not save before switching'));
  assert.ok(!ctxSrc.includes('loadPersonalIntoStudio();\n            refreshStudioUI();\n            toast((loaded'));
  assert.ok(uiSrc.includes('showSwitchOverlay'));
  assert.ok(uiSrc.includes('is-ws-switching'));
  assert.ok(appSrc.includes('ws-switch-overlay'));
  assert.ok(ctxSrc.includes('Do not refreshStudioUI'));
  const complete = ctxSrc.slice(ctxSrc.indexOf('function completeSwitch'), ctxSrc.indexOf('function failSwitch'));
  assert.ok(complete.indexOf('refreshStudioUI()') < complete.indexOf('hideSwitchOverlay'));
  assert.ok(uiSrc.includes("root.innerHTML = ''"));
});

await test('load failures stay on overlay instead of showing the previous Studio', () => {
  assert.ok(ctxSrc.includes('showSwitchError'));
  assert.ok(uiSrc.includes('Try again'));
  assert.ok(ctxSrc.includes("status === 401") || ctxSrc.includes('auth_required'));
  assert.ok(ctxSrc.includes('No access') || ctxSrc.includes('forbidden'));
});

await test('shared switch does not force-refresh the workspace list', () => {
  const switchFn = ctxSrc.slice(ctxSrc.indexOf('function switchTo'), ctxSrc.indexOf('function retryLastSwitch'));
  assert.ok(!switchFn.includes('refreshList(true)'));
  assert.ok(switchFn.includes('loadSharedWorkspace(target'));
});

await test('accent CSS variables and primary buttons follow the user colour', () => {
  assert.ok(appSrc.includes('--accent-hover'));
  assert.ok(appSrc.includes('--accent-soft'));
  assert.ok(appSrc.includes('--accent-border'));
  assert.ok(appSrc.includes('--accent-glow'));
  assert.ok(appSrc.includes('--accent-contrast'));
  assert.ok(appSrc.includes('.studio-btn.primary{background:var(--accent)'));
  assert.ok(appSrc.includes('color:#e5484d') || appSrc.includes('#e5484d'));
  assert.ok(appSrc.includes("r.style.setProperty('--accent-text'"));
  assert.ok(appSrc.includes('studio-more-btn'));
  assert.ok(appSrc.includes('--accent-text'));
});

await test('scan orb uses accent RGB uniforms instead of hardcoded cyan/green', () => {
  assert.ok(orbSrc.includes('uColor1'));
  assert.ok(orbSrc.includes('colorsFromAccent'));
  assert.ok(orbSrc.includes('window.S'));
  assert.ok(orbSrc.includes('hslToRgb'));
  assert.ok(orbSrc.includes('v1 * color1'));
  assert.ok(!orbSrc.includes('0.298039'));
  assert.ok(!orbSrc.includes('0.760784'));
  assert.ok(!orbSrc.includes('vec3(0.611765'));
});

await test('no CRDT / OT / extra serverless files in this overhaul', () => {
  assert.ok(!ctxSrc.includes('Yjs') && !ctxSrc.includes('automerge'));
  assert.ok(!libSrc.includes('operational transform') && !apiSrc.includes('CRDT'));
  const apiFiles = fs
    .readdirSync(path.join(root, 'api'))
    .filter((n) => /\.(js|mjs|cjs|ts)$/.test(n));
  assert.strictEqual(apiFiles.length, 12, 'Hobby budget is 12 functions, found ' + apiFiles.length);
});

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
