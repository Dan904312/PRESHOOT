/**
 * Landing hero visual contracts (Pixel HIGH): readable headline, unclipped CTA, no empty panel.
 * Run: node tests/landing-hero-visual.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const land = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const heroJs = fs.readFileSync(path.join(root, 'js/cinematic-hero.js'), 'utf8');
const gridJs = fs.readFileSync(path.join(root, 'js/kinetic-grid.js'), 'utf8');
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

function cssBlock(src, selector) {
  const needle = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(needle + '\\{([^}]*)\\}');
  const m = src.match(re);
  return m ? m[1] : '';
}

console.log('\n== Landing hero visual ==');

test('CTA boots sharp; headline blur is only the slide-1 exit dissolve', () => {
  assert.ok(!heroJs.includes("filter: 'blur(30px)'"));
  assert.ok(heroJs.includes("gsap.set('.cta-wrapper', { autoAlpha: 0, scale: 1, filter: 'none' })"));
  assert.ok(
    heroJs.includes("['.hero-text-wrapper', '.bg-grid-theme']"),
    'slide 1 must dissolve with the card rise, not stay fully opaque'
  );
  assert.ok(heroJs.includes("filter: 'blur(20px)'"));
  assert.ok(
    !heroJs.includes("{ scale: 1, filter: 'none', opacity: 1, ease: 'none', duration: 0.01 }"),
    'regression: headline locked at full opacity while slide 2 rises'
  );
});

test('slides are sequential: 1 dissolves at t=0, 2 holds, 3 swaps with 2', () => {
  const dissolveAt = heroJs.indexOf("['.hero-text-wrapper', '.bg-grid-theme']");
  const mockupAt = heroJs.indexOf(".fromTo(\n            '.mockup-scroll-wrapper'");
  const holdAt = heroJs.indexOf('.to({}, { duration: 2.5 })');
  const slide3 = heroJs.indexOf("'slide3'");
  const mockupOut = heroJs.indexOf(
    "['.mockup-scroll-wrapper', '.card-left-text', '.card-right-text']"
  );
  const ctaIn = heroJs.indexOf(
    "'.cta-wrapper',\n            { autoAlpha: 1, scale: 1, filter: 'none'"
  );
  assert.ok(dissolveAt > 0 && dissolveAt < mockupAt, 'headline must start exiting before mockup lands');
  assert.ok(holdAt > mockupAt, 'slide 2 must hold after mockup is on');
  assert.ok(slide3 > holdAt, 'slide 3 swap must follow the slide 2 hold');
  assert.ok(mockupOut > 0 && ctaIn > 0);
  assert.ok(heroJs.includes("'slide3'"), 'slide 2 exit and CTA enter share one label');
  assert.ok(
    !heroJs.includes("ease: 'power2.out', duration: 0.7 })\n          .to("),
    'regression: CTA fade must not start before the slide-2 hold ends'
  );
});

test('reduced-motion fades the headline from the start of scroll', () => {
  assert.ok(heroJs.includes('autoAlpha: Math.max(0, 1 - p * 1.35)'));
  assert.ok(!heroJs.includes('Keep the value prop until card copy/mockup is actually readable'));
});

test('wordmark is a single flex item; Open app sits outside the collapsible link list', () => {
  assert.ok(land.includes('class="nav-wordmark"'));
  assert.ok(land.includes('nav-wordmark">Pre<span>Shoot</span>'));
  assert.ok(land.includes('aria-label="PreShoot"'));
  const linksStart = land.indexOf('id="nav-links"');
  const linksEnd = land.indexOf('</div>', linksStart);
  const linksBlock = land.slice(linksStart, linksEnd);
  assert.ok(linksBlock.includes('#how'));
  assert.ok(linksBlock.includes('#pricing'));
  assert.ok(linksBlock.includes('#faq'));
  assert.ok(!linksBlock.includes('Open app'));
  assert.ok(land.includes('class="nav-cta">Open app</a>'));
  assert.ok(land.includes('class="nav-end"'));
});

test('compact nav uses a hamburger instead of dropping links with no menu', () => {
  assert.ok(!land.includes('.nav-links a:not(.nav-cta){display:none}'));
  assert.ok(land.includes('id="nav-menu"'));
  assert.ok(land.includes('aria-controls="nav-links"'));
  assert.ok(land.includes('aria-expanded="false"'));
  assert.ok(land.includes('initLandingNav'));
  assert.ok(land.includes('max-width:1024px'));
});

test('film grain sits under the headline; type is not filter-blurred at rest', () => {
  assert.ok(land.includes(".film-grain{\n  position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;"));
  assert.ok(land.includes('.hero-text-wrapper{position:absolute;z-index:22;'));
  const silver = cssBlock(land, '.text-silver-matte');
  assert.ok(silver.includes('filter:none'), silver);
  assert.ok(!silver.includes('drop-shadow'), silver);
});

test('Open app cannot be clipped by 100vw layers or missing safe padding', () => {
  assert.ok(!land.includes('width:100vw;padding:0 16px;will-change:transform'));
  assert.ok(land.includes('safe-area-inset-right'));
  assert.ok(land.includes('.nav-cta{padding:8px 18px;'));
  assert.ok(land.includes('flex-shrink:0'));
  assert.ok(land.includes('.cta-wrapper{position:absolute;z-index:25;'));
});

test('scroll hint and $9/mo strike use stronger contrast', () => {
  const hint = cssBlock(land, '.scroll-hint');
  const strike = cssBlock(land, '.price-strike');
  assert.ok(hint.includes('rgba(244,244,246,.72)'), hint);
  assert.ok(strike.includes('var(--txt-2)'), strike);
  assert.ok(!strike.includes('opacity:.7'), strike);
});

test('kinetic grid stays behind type and does not CSS-blur the page', () => {
  assert.ok(gridJs.includes('filter:none'));
  assert.ok(land.includes('#kinetic-hero{position:fixed;inset:0;z-index:0'));
  assert.ok(land.includes('isolation:isolate'));
  assert.ok(gridJs.includes('if (this.reduced) this.interactive = false'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
