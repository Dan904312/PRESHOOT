/**
 * Signed-in desktop shell: width, dock clearance, toast, Appearance, Calendar.
 * Run: node tests/app-desktop-layout.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const studioUi = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const studioKb = fs.readFileSync(path.join(root, 'js/studio-keyboard.js'), 'utf8');
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

const desktopEnd = app.slice(app.lastIndexOf('Signed-in desktop shell'));

console.log('\n== Signed-in desktop layout ==');

test('dock clearance token includes space plus extra gap', () => {
  assert.ok(app.includes('--bnav-clearance:calc(var(--bnav-space) + 40px)'));
  assert.ok(app.includes('.sb{padding-bottom:var(--bnav-clearance);scroll-padding-bottom:var(--bnav-clearance)}'));
  assert.ok(app.includes('.studio-shell{padding-bottom:var(--bnav-clearance)!important}'));
  assert.ok(app.includes('padding-bottom:var(--bnav-clearance)'));
});

test('desktop Home cards match Library/Calendar column width', () => {
  assert.ok(desktopEnd.includes('--home-card-max:min(100%,var(--app-col-max))'));
  assert.ok(desktopEnd.includes('--app-col-max:920px'));
  assert.ok(desktopEnd.includes('#screen-home .home-inner'));
  assert.ok(app.includes('--home-card-max:min(100%,var(--app-col-max))'));
  assert.ok(!desktopEnd.includes('--home-card-max:min(100%,560px)'));
  assert.ok(!app.includes('--home-card-max:min(100%,640px)'));
  assert.ok(!/min-width:640px\)\{:root\{--home-card-max:360px/.test(app.replace(/\s+/g, '')));
});

test('Library / Menu / Profile use a real desktop column', () => {
  assert.ok(desktopEnd.includes('#screen-library>.sb'));
  assert.ok(desktopEnd.includes('#screen-menu>.sb'));
  assert.ok(desktopEnd.includes('#screen-profile>.sb'));
  assert.ok(desktopEnd.includes('max-width:var(--app-col-max)'));
});

test('Studio uses a scroll pane plus footer composer, not mid-list sticky', () => {
  assert.ok(app.includes('#screen-studio .studio-scroll'));
  assert.ok(app.includes('#screen-studio .studio-shell>.dir-cmd'));
  assert.ok(app.includes('padding-bottom:calc(8px + max(var(--bnav-space), var(--studio-kb, 0px)))'));
  assert.ok(!desktopEnd.includes('order:20'));
  assert.ok(!desktopEnd.includes('margin-top:auto'));
  assert.ok(!desktopEnd.includes('bottom:calc(var(--bnav-space) + 8px)'));
  assert.ok(!desktopEnd.includes('z-index:190'));
  assert.ok(studioUi.includes("h += '<div class=\"studio-scroll\">'"));
  assert.ok(studioUi.includes("placeholder: 'Tell Director what you would like to do'"));
  const listFn = studioUi.slice(
    studioUi.indexOf("h += '<div class=\"studio-shell studio-fade\">'"),
    studioUi.indexOf('function openProject')
  );
  const recentsAt = listFn.indexOf('renderStudioRecents()');
  const cmdAt = listFn.indexOf("placeholder: 'Tell Director what you would like to do'");
  const scrollCloseBeforeCmd = listFn.lastIndexOf("h += '</div>';", cmdAt);
  assert.ok(recentsAt > -1 && cmdAt > recentsAt, 'composer must render after recents');
  assert.ok(scrollCloseBeforeCmd > recentsAt && scrollCloseBeforeCmd < cmdAt, 'composer must sit after studio-scroll closes');
});

test('toast sits at the top, never over Home CTAs', () => {
  const toast = app.match(/\.toast\{[^}]+\}/);
  assert.ok(toast, 'toast rule missing');
  assert.ok(toast[0].includes('top:calc(10px + env(safe-area-inset-top,0px))'));
  assert.ok(!toast[0].includes('bottom:calc'));
  assert.ok(desktopEnd.includes('left:auto'));
  assert.ok(desktopEnd.includes('right:max(24px'));
});

test('Appearance is a centered desktop dialog, not a bottom sheet', () => {
  assert.ok(app.includes('id="appear-modal"'));
  assert.ok(desktopEnd.includes('#appear-modal.modal-ov{align-items:center;justify-content:center}'));
  assert.ok(desktopEnd.includes('border-radius:20px'));
  assert.ok(desktopEnd.includes('max-width:440px'));
});

test('Calendar stats wrap instead of clipping in the 1024px column', () => {
  assert.ok(app.includes('.plan-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr))'));
  assert.ok(app.includes('grid-template-columns:minmax(280px,1fr) minmax(280px,1.15fr)'));
  assert.ok(!app.includes('.plan-stat{flex:0 0 auto;min-width:108px'));
});

test('onboarding and Director still hide the dock', () => {
  assert.ok(app.includes('#screen-onboard.active ~ .bnav, .bnav.hidden{display:none!important}'));
  assert.ok(app.includes('html.script-fs-active .bnav{display:none!important}'));
});

test('mobile Studio keyboard overlay still keeps the composer in-flow', () => {
  const kb = app.slice(app.indexOf('Studio mobile keyboard'), app.indexOf('Hierarchy: primary'));
  assert.ok(kb.includes('#screen-studio .dir-cmd'));
  assert.ok(kb.includes('position:relative'));
  assert.ok(kb.includes('bottom:auto'));
  assert.ok(studioKb.includes('--studio-kb'));
  assert.ok(studioKb.includes('.studio-scroll'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
