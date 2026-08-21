/**
 * Landing About section + Open Graph cover (not the cafe example).
 * Run: node tests/landing-og.test.mjs
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

const land = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const cover = path.join(root, 'og', 'preshoot-cover.jpg');
const cafe = 'images.unsplash.com/photo-1501339847302-ac426a4a7cbb';
const ogUrl = 'https://preshoot.vercel.app/og/preshoot-cover.jpg';

console.log('\n== Landing About + social preview ==');

test('uploaded cover exists as a public static JPEG', () => {
  assert.ok(fs.existsSync(cover));
  const buf = fs.readFileSync(cover);
  assert.ok(buf.length > 10000);
  assert.strictEqual(buf[0], 0xff);
  assert.strictEqual(buf[1], 0xd8);
});

test('Open Graph and Twitter tags use the PreShoot cover, not the cafe example', () => {
  assert.ok(land.includes('property="og:image" content="' + ogUrl + '"'));
  assert.ok(land.includes('name="twitter:image" content="' + ogUrl + '"'));
  assert.ok(land.includes('property="og:url" content="https://preshoot.vercel.app/"'));
  assert.ok(land.includes('property="og:type" content="website"'));
  assert.ok(land.includes('name="twitter:card" content="summary_large_image"'));
  const ogBlock = land.slice(0, land.indexOf('</head>'));
  assert.ok(!ogBlock.includes(cafe));
  assert.ok(!ogBlock.includes('og:image') || !ogBlock.includes('unsplash'));
});

test('cafe Unsplash photo remains only as in-page product proof, not metadata', () => {
  assert.ok(land.includes(cafe));
  assert.ok(land.includes('Coffee shop interior used as a PreShoot scan example'));
  const head = land.slice(0, land.indexOf('</head>'));
  assert.ok(!head.includes(cafe));
});

test('About the founder sits before the footer with an external Daniel link', () => {
  const aboutIdx = land.indexOf('id="about"');
  const footerIdx = land.indexOf('<footer>');
  assert.ok(aboutIdx > 0 && footerIdx > aboutIdx);
  assert.ok(land.includes('Built by a creator, for creators.'));
  assert.ok(land.includes('https://daniel-liu.vercel.app'));
  assert.ok(land.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(land.includes('Meet Daniel'));
  assert.ok(!/about-founder[\s\S]{0,800}😀|🎉|🚀/.test(land));
});

test('catch-all SPA rewrite does not swallow /og/*', () => {
  const ogRoute = vercel.indexOf('"src": "/og/(.*)"');
  const catchAll = vercel.lastIndexOf('"src": "/(.*)"');
  assert.ok(ogRoute >= 0);
  assert.ok(catchAll > ogRoute);
  assert.ok(vercel.includes('"dest": "/og/$1"'));
  JSON.parse(vercel);
});

test('app.html share URL also points at the same cover', () => {
  assert.ok(app.includes('property="og:image" content="' + ogUrl + '"'));
  assert.ok(app.includes('name="twitter:image" content="' + ogUrl + '"'));
  assert.ok(!app.includes(cafe));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
