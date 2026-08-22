/**
 * Take a Photo orb restore + zero-emoji UI + Director execution / full-message contracts.
 * Run: node tests/director-ux.test.mjs
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

const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const orbSrc = fs.readFileSync(path.join(root, 'js/orb.js'), 'utf8');
const directorSrc = fs.readFileSync(path.join(root, 'api/director.js'), 'utf8');
const studioUiSrc = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const streakSrc = fs.readFileSync(path.join(root, 'js/streak.js'), 'utf8');
const calendarSrc = fs.readFileSync(path.join(root, 'js/calendar.js'), 'utf8');
const trendingSrc = fs.readFileSync(path.join(root, 'js/trending.js'), 'utf8');
const commentsSrc = fs.readFileSync(path.join(root, 'js/workspace-comments.js'), 'utf8');
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((n) => /\.(js|mjs|cjs|ts)$/.test(n));

const emojiRe =
  /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}\u{1F1E0}-\u{1F1FF}\u2728\u2B50\u274C\u2713\u2714\u2726]/u;

console.log('\n== Director UX / scan bubble / emoji ==');

test('Take a Photo orb keeps bubbling animation and follows the user accent', () => {
  assert.ok(orbSrc.includes('const float innerRadius = 0.6'));
  assert.ok(orbSrc.includes('const float noiseScale = 0.65'));
  assert.ok(orbSrc.includes('col = (col + v1) * v2 * v3'));
  assert.ok(orbSrc.includes('snoise3'));
  assert.ok(orbSrc.includes('uniform vec3 uColor1'));
  assert.ok(orbSrc.includes('function colorsFromAccent'));
  assert.ok(orbSrc.includes('window.S'));
  assert.ok(orbSrc.includes('setAccent'));
  assert.ok(!orbSrc.includes('adjustHue(baseColor1'));
  assert.ok(!orbSrc.includes('v1 * color1'));
  assert.ok(!appSrc.includes('background:radial-gradient(circle at 38% 34%,var(--accent)'));
  assert.ok(appSrc.includes('--accent-light'));
  assert.ok(appSrc.includes("setProperty('--accent-light'"));
  assert.ok(appSrc.includes("setProperty('--accent-dark'"));
  assert.ok(appSrc.includes('class="scan-orb"'));
  assert.ok(appSrc.includes('aria-label="Take a photo"'));
  const start = orbSrc.indexOf('function clamp01');
  const end = orbSrc.indexOf('function currentAccentHex');
  assert.ok(start > 0 && end > start);
  const colorsFromAccent = new Function(orbSrc.slice(start, end) + 'return colorsFromAccent;')();
  const pink = colorsFromAccent('#FF2D78');
  assert.ok(pink.c1[0] > pink.c1[1] + 0.15, 'pink orb core must be red/magenta, not green');
  assert.ok(pink.c1[0] > pink.c1[2], 'pink orb core must not be cyan');
  const blue = colorsFromAccent('#4A9EFF');
  assert.ok(blue.c1[2] > blue.c1[0] && blue.c1[2] > blue.c1[1] * 0.85, 'blue orb core must be blue');
  const purple = colorsFromAccent('#7C4DFF');
  assert.ok(purple.c1[2] > purple.c1[1], 'purple orb core must be violet, not green');
  const green = colorsFromAccent('#34F5C5');
  assert.ok(green.c1[1] > green.c1[0] && green.c1[1] > green.c1[2] * 0.7, 'mint orb core must be green/teal');
});

test('Director is execution-first without a tiny global token cap', () => {
  assert.ok(directorSrc.includes('EXECUTION MODE'));
  assert.ok(directorSrc.includes('understand intent'));
  assert.ok(directorSrc.includes('emit [[ACTION:...]] immediately'));
  assert.ok(directorSrc.includes('Never say “Done”') || directorSrc.includes('Never say "Done"'));
  assert.ok(directorSrc.includes('needsLongOutput ? 2800 : 1200'));
  assert.ok(directorSrc.includes('safeImage ? 1600 : 1000'));
  assert.ok(!/max_tokens:\s*[1-9]{1,2}\b/.test(directorSrc));
});

test('Director chat keeps full text and offers View full message', () => {
  assert.ok(appSrc.includes('View full message'));
  assert.ok(appSrc.includes('function applyDirBubbleContent'));
  assert.ok(appSrc.includes('function openDirFullMessage'));
  assert.ok(appSrc.includes('id="dir-full-msg-modal"'));
  assert.ok(appSrc.includes('id="dir-full-msg-body"'));
  assert.ok(appSrc.includes('dir-bubble-body'));
  assert.ok(appSrc.includes('is-compact'));
  assert.ok(studioUiSrc.includes('viewDirectorFullMessage'));
  assert.ok(studioUiSrc.includes('directorExpandableHtml'));
  assert.ok(studioUiSrc.includes('conciseDoneMessage'));
  assert.ok(!studioUiSrc.includes('t.slice(0, 87)'));
  assert.ok(!studioUiSrc.includes('previewBody.slice(0, 500)'));
});

test('streak / calendar / trending / comments use SVG instead of emoji', () => {
  assert.ok(streakSrc.includes("ICO.html('flame'"));
  assert.ok(!streakSrc.includes('🔥'));
  assert.ok(calendarSrc.includes("ico('flame'"));
  assert.ok(calendarSrc.includes("ico('target'"));
  assert.ok(!calendarSrc.includes('🔥'));
  assert.ok(!calendarSrc.includes('🎯'));
  assert.ok(trendingSrc.includes("ico('flame'"));
  assert.ok(!trendingSrc.includes('🔥 Trending now'));
  assert.ok(commentsSrc.includes("ico('chat'"));
  assert.ok(!commentsSrc.includes('💬'));
  assert.ok(studioUiSrc.includes("ico('sparkles'"));
});

test('application HTML/JS UI has no literal emoji characters', () => {
  const files = [
    'app.html',
    'admin.html',
    'js/streak.js',
    'js/calendar.js',
    'js/trending.js',
    'js/studio-ui.js',
    'js/workspace-ui.js',
    'js/workspace-comments.js',
    'js/onboard.js'
  ];
  files.forEach(function (rel) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const hit = src.match(emojiRe);
    assert.ok(!hit, rel + ' contains emoji ' + (hit && hit[0]));
  });
});

test('Studio Director submit is exported and failures are visible', () => {
  assert.ok(studioUiSrc.includes('submitDirectorCommand: submitDirectorCommand'));
  assert.ok(studioUiSrc.includes("onclick=\"PreShootStudioUI.submitDirectorCommand()\""));
  assert.ok(studioUiSrc.includes('Director couldn’t respond. Please try again.'));
  assert.ok(studioUiSrc.includes('function directorReplyText'));
  assert.ok(studioUiSrc.includes('function readDirectorResponse'));
  assert.ok(studioUiSrc.includes("setDirectorStatus('thinking', 'Director is still working…')"));
});

test('Home scan stack is centered, not pinned to the foot', () => {
  assert.ok(appSrc.includes('#screen-home .scan-zone-main{'));
  const start = appSrc.indexOf('#screen-home .scan-zone-main{');
  const block = appSrc.slice(start, start + 220);
  assert.ok(block.includes('justify-content:center'));
  assert.ok(!block.includes('justify-content:flex-end'));
  assert.ok(appSrc.includes('class="scan-orb"'));
  assert.ok(orbSrc.includes('col = (col + v1) * v2 * v3'));
});

test('Full Director chat resets streaming and shows a friendly empty/error reply', () => {
  assert.ok(appSrc.includes('Director is still responding'));
  assert.ok(appSrc.includes('if(!String(fullText||\'\').trim())'));
  assert.ok(appSrc.includes("applyDirBubbleContent(bub, 'Director couldn’t respond. Please try again.')"));
  assert.ok(appSrc.includes('workspaceIdForDirector'));
  assert.ok(appSrc.includes('stream: true'));
});

test('Hobby still has exactly 12 api functions', () => {
  assert.strictEqual(apiFiles.length, 12);
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
