/**
 * Studio navigation determinism.
 *
 * Boots the real js/studio.js + js/studio-ui.js, seeds throwaway projects,
 * then drives the rendered back button (not a mock) to prove that:
 *   nested production view -> parent project -> Studio root
 * is the same every time, survives partial view writes, a reload, a
 * mid-flight workspace document swap, and a deleted production.
 *
 * Run: node tests/studio-navigation.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootStudio, seedProjects } from './helpers/studio-nav-harness.mjs';

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

function fresh() {
  const h = bootStudio();
  return { h, ids: seedProjects(h) };
}

console.log('\n== Studio navigation ==');

test('back from every production section returns to the parent project', () => {
  const { h, ids } = fresh();
  ['overview', 'shots', 'script', 'refs', 'performance'].forEach((section) => {
    h.UI.openProject(ids.p1.id);
    h.UI.openProduction(ids.a1.id);
    h.UI.setProdSection(ids.a1.id, section);
    assert.strictEqual(h.S.studioView.mode, 'production', section);
    h.clickBack();
    assert.strictEqual(h.S.studioView.mode, 'project', section);
    assert.strictEqual(h.S.studioView.projectId, ids.p1.id, section);
  });
});

test('the same back action is deterministic across repeats', () => {
  const { h, ids } = fresh();
  const landings = [];
  for (let i = 0; i < 5; i += 1) {
    h.UI.openProduction(ids.a1.id);
    h.UI.setProdSection(ids.a1.id, 'shots');
    h.UI.addShot(ids.a1.id);
    h.clickBack();
    landings.push(h.S.studioView.mode + ':' + h.S.studioView.projectId);
  }
  assert.strictEqual(new Set(landings).size, 1, 'landed in different places: ' + landings.join(' / '));
  assert.strictEqual(landings[0], 'project:' + ids.p1.id);
});

test('back from a project goes to Studio root', () => {
  const { h, ids } = fresh();
  h.UI.openProject(ids.p1.id);
  h.clickBack();
  assert.strictEqual(h.S.studioView.mode, 'list');
  assert.strictEqual(h.S.activeProductionId, null);
});

test('workspace mutations keep the parent project link', () => {
  const { h, ids } = fresh();
  h.UI.openProduction(ids.b1.id);
  h.UI.openProject(ids.p1.id);
  h.UI.openProduction(ids.a1.id);
  const shotId = h.Studio.findProduction(ids.a1.id).production.workspace.shotList[0];
  h.UI.addShot(ids.a1.id);
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'addShot');
  h.UI.addScriptLine(ids.a1.id);
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'addScriptLine');
  if (shotId && shotId.id) {
    h.UI.toggleShot(ids.a1.id, shotId.id);
    assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'toggleShot');
  }
  h.UI.seedFromIdea(ids.a1.id);
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'seedFromIdea');
  h.UI.onPerformancePdf(ids.a1.id, { files: [{ name: 'notes.pdf' }] });
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'onPerformancePdf');
  h.UI.openDirectorForProduction(ids.a1.id);
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id, 'openDirectorForProduction');
  h.clickBack();
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
  assert.strictEqual(h.S.studioView.mode, 'project');
});

test('a projectId from another project can never become the parent', () => {
  const { h, ids } = fresh();
  h.UI.setStudioView({
    mode: 'production',
    projectId: ids.p2.id,
    productionId: ids.a1.id,
    section: 'shots'
  });
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
  assert.strictEqual(h.UI.backTarget().projectId, ids.p1.id);
});

test('switching projects re-points back at the project actually open', () => {
  const { h, ids } = fresh();
  h.UI.openProject(ids.p1.id);
  h.UI.openProduction(ids.a1.id);
  h.clickBack();
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
  h.UI.openProject(ids.p2.id);
  h.UI.openProduction(ids.b1.id);
  h.UI.setProdSection(ids.b1.id, 'script');
  h.clickBack();
  assert.strictEqual(h.S.studioView.projectId, ids.p2.id);
});

test('closing the fullscreen script editor stays on the production', () => {
  const h = bootStudio({ allElements: true });
  const ids = seedProjects(h);
  h.UI.openProduction(ids.a1.id);
  h.UI.openScriptFullscreen(ids.a1.id);
  assert.strictEqual(h.UI.backTarget().kind, 'section');
  assert.strictEqual(h.UI.studioBack(), 'section');
  assert.strictEqual(h.S.studioView.mode, 'production');
  assert.strictEqual(h.S.studioView.section, 'script');
  /* Only the next back leaves the production. */
  assert.strictEqual(h.UI.studioBack(), 'project');
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
});

test('a reload rebuilds the production and its parent chain', () => {
  const { h, ids } = fresh();
  h.UI.openProduction(ids.a1.id);
  h.UI.setProdSection(ids.a1.id, 'script');

  const reopened = bootStudio();
  reopened.sandbox.localStorage.setItem(
    'scout_studio',
    h.sandbox.localStorage.getItem('scout_studio')
  );
  reopened.sandbox.localStorage.setItem(
    'scout_studio_nav',
    h.sandbox.localStorage.getItem('scout_studio_nav')
  );
  reopened.UI.renderStudio();
  assert.strictEqual(reopened.S.studioView.mode, 'production');
  assert.strictEqual(reopened.S.studioView.productionId, ids.a1.id);
  assert.strictEqual(reopened.S.studioView.section, 'script');
  reopened.clickBack();
  assert.strictEqual(reopened.S.studioView.mode, 'project');
  assert.strictEqual(reopened.S.studioView.projectId, ids.p1.id);
});

test('a deleted production falls back to its project, not Studio root', () => {
  const { h, ids } = fresh();
  h.UI.openProduction(ids.a1.id);
  h.UI.setProdSection(ids.a1.id, 'shots');
  h.Studio.deleteProduction(ids.a1.id);
  h.UI.renderStudio();
  assert.strictEqual(h.S.studioView.mode, 'project');
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
});

test('a mid-flight shared document swap does not reset the view', () => {
  const { h, ids } = fresh();
  h.UI.openProduction(ids.a1.id);
  h.UI.setProdSection(ids.a1.id, 'shots');
  const before = JSON.stringify(h.S.studioView);
  /* Simulate a shared workspace whose document has not landed yet: the
   * store answers with nothing, which used to dump the user on root. */
  h.sandbox.PreShootWorkspace = {
    getContext: function () {
      return { isShared: true, switching: false, activeWorkspaceId: 'ws_1' };
    },
    getSharedDocument: function () {
      return null;
    },
    isShared: function () {
      return true;
    },
    canEdit: function () {
      return true;
    }
  };
  h.UI.renderStudio();
  assert.strictEqual(JSON.stringify(h.S.studioView), before);
  h.UI.studioBack();
  assert.strictEqual(h.S.studioView.mode, 'project');
  assert.strictEqual(h.S.studioView.projectId, ids.p1.id);
});

test('back button labels name the real destination', () => {
  const { h, ids } = fresh();
  h.UI.openProject(ids.p1.id);
  const projectBack = h.backButtonHtml();
  assert.ok(projectBack.includes('PreShootStudioUI.studioBack()'), projectBack);
  assert.ok(projectBack.includes('Back to Studio'), projectBack);
  h.UI.openProduction(ids.a1.id);
  const prodBack = h.backButtonHtml();
  assert.ok(prodBack.includes('PreShootStudioUI.studioBack()'), prodBack);
  assert.ok(prodBack.includes('Back to Throwaway Campaign A'), prodBack);
  assert.ok(!prodBack.includes('aria-label="Back"'), 'generic Back label still rendered');
});

test('breadcrumb still exposes Studio and the project as explicit jumps', () => {
  const { h, ids } = fresh();
  h.UI.openProduction(ids.a1.id);
  const crumb = h.crumbHtml();
  assert.ok(crumb.includes('PreShootStudioUI.backToList()'), crumb);
  assert.ok(crumb.includes("PreShootStudioUI.openProject('" + ids.p1.id + "')"), crumb);
});

console.log('\n== Source guarantees ==');

const studioUiSrc = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const wsCtxSrc = fs.readFileSync(path.join(root, 'js/workspace-context.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

test('S.studioView is only assigned by the navigation writer', () => {
  const writes = studioUiSrc
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter((row) => /(global\.)?S\.studioView(\.[a-zA-Z]+)?\s*=/.test(row.line));
  const offenders = writes.filter((row) => !/global\.S\.studioView = view;/.test(row.line));
  assert.strictEqual(
    offenders.length,
    0,
    'direct studioView writes outside setStudioView: ' +
      offenders.map((o) => o.n + ': ' + o.line).join(' | ')
  );
});

test('render fallbacks are hierarchical and skip transient stores', () => {
  assert.ok(studioUiSrc.includes('function studioDataTransient'));
  assert.ok(studioUiSrc.includes('if (studioDataTransient()) return;'));
  assert.ok(studioUiSrc.includes('function parentProjectIdFor'));
  assert.ok(studioUiSrc.includes('function studioBack'));
  assert.ok(studioUiSrc.includes('function backTarget'));
});

test('remote document repair recovers the parent project before root', () => {
  assert.ok(wsCtxSrc.includes('PreShootStudioUI.parentProjectIdFor'));
  assert.ok(wsCtxSrc.includes('suspendNavRestore'));
});

test('Director returns to the screen it was opened from', () => {
  assert.ok(appSrc.includes('S.dirOriginTab'));
  assert.ok(appSrc.includes("var _back = S.dirOriginTab === 'studio' ? 'studio' : 'home';"));
});

test('touched Studio assets are cache-busted', () => {
  assert.ok(/\/js\/studio-ui\.js\?v=[a-z0-9]+/.test(appSrc));
  assert.ok(/\/js\/workspace-context\.js\?v=[a-z0-9]+/.test(appSrc));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
