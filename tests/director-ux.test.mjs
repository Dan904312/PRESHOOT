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

test('Take a Photo orb is the original bubbling shader', () => {
  assert.ok(orbSrc.includes('uniform float hue'));
  assert.ok(orbSrc.includes('adjustHue(baseColor1, hue)'));
  assert.ok(orbSrc.includes('const float innerRadius = 0.6'));
  assert.ok(orbSrc.includes('const float noiseScale = 0.65'));
  assert.ok(!orbSrc.includes('uColor1'));
  assert.ok(!orbSrc.includes('colorsFromAccent'));
  assert.ok(!appSrc.includes('background:radial-gradient(circle at 38% 34%,var(--accent)'));
  assert.ok(appSrc.includes('class="scan-orb"'));
  assert.ok(appSrc.includes('aria-label="Take a photo"'));
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

test('Hobby still has exactly 12 api functions', () => {
  assert.strictEqual(apiFiles.length, 12);
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
