/**
 * Shot-list planning integration + bulk select/delete.
 * Boots the real js/shot-planner.js, js/studio.js and js/studio-ui.js.
 * Run: node tests/shotlist-bulk.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bootStudio } from './helpers/studio-nav-harness.mjs';

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

/* Ten deliberately distinct beats, so the planner has a real reason to keep
   them apart and the list is long enough to exercise bulk selection. */
const TEN_BEATS = [
  'Most students think they are bad at studying.',
  'But nobody ever taught them how memory actually works.',
  'We built Noura to fix that.',
  'Open your notes and drop them straight into Noura.',
  'Watch it turn a wall of text into questions.',
  'Research shows active recall beats rereading every time.',
  'Students who teach the material back remember far more of it.',
  'And that changes how revision feels.',
  'Suddenly studying is fifteen focused minutes, not three lost hours.',
  'Try it free and tell me what you think.'
].join('\n\n');

const NOURA_SCRIPT = [
  "Most students think they're bad at studying.",
  'But the truth is, nobody ever taught them how learning actually works.',
  'We built Noura to change that.',
  'Instead of passively reading information, students actively teach it back.',
  'And that changes everything.'
].join('\n\n');

/** A production with a real script, ready to plan. */
function seedProduction(h, opts) {
  opts = opts || {};
  const project = h.Studio.createProject({ name: opts.projectName || 'Noura' });
  const production = h.Studio.createProduction(project.id, {
    name: opts.productionName || 'Noura launch explainer'
  }).production;
  const found = h.Studio.findProduction(production.id);
  const prod = h.Studio.ensureWorkspace(found.production);
  const ws = prod.workspace;
  ws.overview = Object.assign({}, ws.overview, {
    goal: 'Explain why studying fails and how Noura changes learning',
    platform: 'TikTok',
    format: 'Educational short-form',
    audience: 'Students'
  });
  const applied = h.Studio.applyScriptPlainText(ws, opts.script || NOURA_SCRIPT, 'replace');
  h.Studio.updateProduction(production.id, { workspace: applied.workspace });
  return { projectId: project.id, productionId: production.id };
}

function shotsOf(h, productionId) {
  const found = h.Studio.findProduction(productionId);
  return h.Studio.ensureWorkspace(found.production).workspace.shotList || [];
}

function linesOf(h, productionId) {
  const found = h.Studio.findProduction(productionId);
  const ws = h.Studio.ensureWorkspace(found.production).workspace;
  return (ws.script && ws.script.lines) || [];
}

function openShots(h, productionId) {
  h.UI.setStudioView({ mode: 'production', productionId: productionId, section: 'shots' });
  h.UI.renderStudio();
}

console.log('\n== Shot list planning + bulk management ==');

/* ── Planning integration ─────────────────────────────────────────── */

test('generated shot list carries coverage, sections and real titles', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  const result = h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  assert.ok(result.ok, result.message);
  const shots = shotsOf(h, productionId);
  assert.ok(shots.length >= 3, 'expected several shots, got ' + shots.length);
  shots.forEach((s) => {
    assert.ok(s.scriptCoverage.length >= 0, 'coverage missing');
    assert.ok(s.section, 'shot ' + s.order + ' has no section');
    assert.ok(!/^(beat|setup|shot)\s*\d*$/i.test(s.purpose.trim()), 'generic title: ' + s.purpose);
  });
  assert.strictEqual(result.result.subject, 'Noura');
  assert.strictEqual(result.result.source, 'planner');
});

test('Test J: the UI shows the selected kit, not the whole inventory', () => {
  const h = bootStudio();
  h.S.gear = {
    camera: 'Sony FX3, iPhone 13 Pro Max',
    lens: 'G Master 24-105 f4',
    gimbal: 'DJI RS4 PRO, Hohem M6, tripod'
  };
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shots = shotsOf(h, productionId);
  const dump = 'Sony FX3, iPhone 13 Pro Max · DJI RS4 PRO, Hohem M6 · G Master 24-105 f4';
  shots.forEach((s) => {
    assert.ok(s.gear !== dump, 'shot ' + s.order + ' stored the inventory dump');
    assert.ok(!/fx3/i.test(s.gear) || !/iphone/i.test(s.gear), 'two cameras on shot ' + s.order + ': ' + s.gear);
    assert.ok(!/rs4/i.test(s.gear) || !/hohem/i.test(s.gear), 'two gimbals on shot ' + s.order + ': ' + s.gear);
  });
  openShots(h, productionId);
  h.UI.toggleShot(productionId, shots[0].id);
  const html = h.studioHtml();
  assert.ok(!html.includes(dump), 'the rendered shot list expanded into the full inventory');
  assert.ok(/iphone/i.test(shots.map((s) => s.gear).join(' ')), 'expected the phone kit on this educational reel');
});

test('a shot can cover several script lines and the lines link back to it', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h, {
    script: [
      'I spent years trying to figure out how to study properly.',
      'I thought I was just bad at learning.',
      'But the real problem was that nobody had ever taught me how to learn.'
    ].join('\n\n')
  });
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shots = shotsOf(h, productionId);
  const multi = shots.filter((s) => s.scriptCoverage.length > 1);
  assert.ok(multi.length, 'no shot covers several lines');
  const lines = linesOf(h, productionId);
  const covered = multi[0].scriptCoverage.map((c) => c.lineId).filter(Boolean);
  assert.ok(covered.length > 1, 'coverage did not resolve to script line ids');
  covered.forEach((lineId) => {
    const line = lines.find((l) => l.id === lineId);
    assert.ok(line, 'coverage points at a missing line');
    assert.strictEqual(line.shotId, multi[0].id, 'line was not linked back to its shot');
  });
});

test('replanning keeps hand-edited shot fields and the shot id', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const before = shotsOf(h, productionId)[0];
  h.UI.updateShotField(productionId, before.id, 'notes', 'Shoot this at the desk by the window');
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const after = shotsOf(h, productionId)[0];
  assert.strictEqual(after.id, before.id, 'shot id changed, expand state and comments would be lost');
  assert.strictEqual(after.notes, 'Shoot this at the desk by the window', 'user edit was overwritten');
});

test('the stored plan records the script it was planned from', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const found = h.Studio.findProduction(productionId);
  const plan = h.Studio.ensureWorkspace(found.production).workspace.shotPlan;
  assert.ok(plan, 'no shotPlan stored');
  assert.strictEqual(plan.scriptSignature, h.Studio.scriptSignature(productionId));
  const ws = h.Studio.ensureWorkspace(found.production).workspace;
  const changed = h.Studio.applyScriptPlainText(ws, NOURA_SCRIPT + '\n\nOne more line here.', 'replace');
  h.Studio.updateProduction(productionId, { workspace: changed.workspace });
  assert.notStrictEqual(
    plan.scriptSignature,
    h.Studio.scriptSignature(productionId),
    'signature did not change when the script changed'
  );
});

/* ── Director plan validation ─────────────────────────────────────── */

test('a Director plan for another production is rejected', () => {
  const h = bootStudio();
  const a = seedProduction(h, { projectName: 'Noura', productionName: 'Noura explainer' });
  const b = seedProduction(h, { projectName: 'Other Brand', productionName: 'Other video' });
  const check = h.Studio.validateShotPlan(
    {
      productionId: b.productionId,
      shots: [{ title: 'Opening misconception', scriptCoverage: [{ text: "Most students think they're bad at studying." }] }]
    },
    a.productionId
  );
  assert.strictEqual(check.ok, false);
  assert.ok(check.errors.includes('wrong_production'), check.errors.join(','));
});

test('a Director plan quoting script the production does not have is rejected', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  const check = h.Studio.validateShotPlan(
    {
      shots: [
        { title: 'Phone unboxing', scriptCoverage: [{ text: 'Today we are reviewing the new iPhone camera system.' }] }
      ]
    },
    productionId
  );
  assert.strictEqual(check.ok, false);
  assert.ok(
    check.errors.some((e) => /coverage_not_in_script|no_valid_shots/.test(e)),
    check.errors.join(',')
  );
});

test('a Director plan with generic titles is rejected', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  const check = h.Studio.validateShotPlan(
    {
      shots: [
        { title: 'Beat 1', scriptCoverage: [{ text: "Most students think they're bad at studying." }] },
        { title: 'Beat 2', scriptCoverage: [{ text: 'We built Noura to change that.' }] }
      ]
    },
    productionId
  );
  assert.strictEqual(check.ok, false);
  assert.ok(check.errors.some((e) => /generic_title/.test(e)), check.errors.join(','));
});

test('a valid Director plan is applied and marked as its source', () => {
  const h = bootStudio();
  const { productionId, projectId } = seedProduction(h);
  const applied = h.Studio.applyShotPlan(productionId, {
    productionId: productionId,
    projectId: projectId,
    contentType: 'educational',
    subject: 'Noura',
    shots: [
      {
        title: 'Opening misconception',
        section: 'HOOK',
        shotType: 'a_roll',
        durationSec: 4,
        visual: 'Creator direct to camera',
        scriptCoverage: [
          { text: "Most students think they're bad at studying." },
          { text: 'But the truth is, nobody ever taught them how learning actually works.' }
        ]
      },
      {
        title: 'Introducing Noura',
        section: 'SOLUTION',
        shotType: 'screen_recording',
        durationSec: 3,
        visual: 'Noura interface reveal',
        scriptCoverage: [{ text: 'We built Noura to change that.' }]
      }
    ]
  });
  assert.ok(applied.ok, applied.message);
  const shots = shotsOf(h, productionId);
  assert.strictEqual(shots.length, 2);
  assert.strictEqual(shots[0].scriptCoverage.length, 2, 'multi-line coverage was lost');
  assert.strictEqual(applied.result.source, 'director');
  assert.ok(!applied.result.rejectedDirectorPlan, 'valid plan was rejected');
});

test('a rejected Director plan falls back to the local planner instead of failing', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  const applied = h.Studio.applyShotPlan(productionId, { shots: [{ title: 'Beat 1' }] });
  assert.ok(applied.ok, 'fallback did not produce a shot list');
  assert.ok(applied.result.rejectedDirectorPlan, 'rejection was not reported');
  assert.strictEqual(applied.result.source, 'planner');
  assert.ok(shotsOf(h, productionId).length >= 3, 'fallback produced no shots');
});

/* ── Bulk selection UI ────────────────────────────────────────────── */

function enterSelectMode(h, productionId) {
  openShots(h, productionId);
  h.UI.toggleSelectMode(productionId, 'shots');
  return h.studioHtml();
}

test('Select mode renders selectable rows without opening any shot', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const html = enterSelectMode(h, productionId);
  assert.ok(html.includes('pw-selectable'), 'no selectable rows');
  assert.ok(html.includes('role="checkbox"'), 'rows are not exposed as checkboxes');
  assert.ok(!html.includes('pw-shot-body'), 'a shot was expanded in select mode');
  assert.ok(!html.includes('Remove shot'), 'per-shot delete is still rendered in select mode');
  assert.strictEqual(h.selectableIds().length, shotsOf(h, productionId).length);
});

test('clicking a row selects it, clicking again deselects, without navigating', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  enterSelectMode(h, productionId);
  const ids = h.selectableIds();
  const before = JSON.stringify(h.S.studioView);
  h.clickSelectable(ids[1]);
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), 1);
  assert.strictEqual(JSON.stringify(h.S.studioView), before, 'selecting changed the view');
  h.clickSelectable(ids[1]);
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), 0, 'clicking again did not deselect');
});

test('non-contiguous selection, select all and clear all work', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h, {
    script: TEN_BEATS
  });
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  enterSelectMode(h, productionId);
  const ids = h.selectableIds();
  assert.ok(ids.length >= 5, 'need at least 5 shots, got ' + ids.length);
  [1, 3, 5].forEach((i) => h.clickSelectable(ids[i]));
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), 3);
  h.UI.selectAllItems(productionId, 'shots');
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), ids.length, 'select all missed rows');
  h.UI.clearSelection(productionId, 'shots');
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), 0);
});

test('bulk delete removes exactly the selected shots and renumbers the rest', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h, {
    script: TEN_BEATS
  });
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  enterSelectMode(h, productionId);
  const ids = h.selectableIds();
  const target = [1, 3, 5, 7, 9].map((i) => ids[i]).filter(Boolean);
  target.forEach((id) => h.clickSelectable(id));
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), target.length);

  h.UI.bulkDelete(productionId, 'shots');

  const after = shotsOf(h, productionId);
  assert.strictEqual(after.length, ids.length - target.length, 'wrong number of shots left');
  target.forEach((id) => {
    assert.ok(!after.some((s) => s.id === id), 'a selected shot survived');
  });
  ids
    .filter((id) => target.indexOf(id) < 0)
    .forEach((id) => {
      assert.ok(after.some((s) => s.id === id), 'an unselected shot was deleted');
    });
  after.forEach((s, i) => assert.strictEqual(s.order, i + 1, 'order was not renumbered'));
  assert.strictEqual(h.UI.selectionCount(productionId, 'shots'), 0, 'selection was not cleared');
  assert.ok(
    h.toasts.some((t) => /deleted/i.test(t)),
    'no confirmation feedback: ' + h.toasts.join(' | ')
  );
});

test('deleting shots unlinks the script lines that pointed at them', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shots = shotsOf(h, productionId);
  const victim = shots[0];
  const linkedBefore = linesOf(h, productionId).filter((l) => l.shotId === victim.id);
  assert.ok(linkedBefore.length, 'no script line was linked to the first shot');
  const res = h.Studio.deleteShots(productionId, [victim.id]);
  assert.ok(res.ok);
  linesOf(h, productionId).forEach((l) => {
    assert.notStrictEqual(l.shotId, victim.id, 'a script line still points at a deleted shot');
  });
});

test('partial failures are reported honestly and nothing extra is removed', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shots = shotsOf(h, productionId);
  const res = h.Studio.deleteShots(productionId, [shots[0].id, 'shot_does_not_exist']);
  assert.ok(res.ok, 'valid ids should still be deleted');
  assert.strictEqual(res.deleted.join(','), shots[0].id);
  assert.strictEqual(res.failed.join(','), 'shot_does_not_exist');
  assert.ok(/could not be deleted/i.test(res.message), res.message);
  assert.strictEqual(shotsOf(h, productionId).length, shots.length - 1);
});

test('a delete where nothing matches reports failure and deletes nothing', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const before = shotsOf(h, productionId).length;
  const res = h.Studio.deleteShots(productionId, ['nope_1', 'nope_2']);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.deleted.length, 0);
  assert.strictEqual(shotsOf(h, productionId).length, before);
});

test('bulk delete cannot touch a different production', () => {
  const h = bootStudio();
  const a = seedProduction(h, { productionName: 'A video' });
  const b = seedProduction(h, { productionName: 'B video' });
  h.Studio.buildShotListFromScript(a.productionId, { allowStarter: false });
  h.Studio.buildShotListFromScript(b.productionId, { allowStarter: false });
  const bShots = shotsOf(h, b.productionId);
  const res = h.Studio.deleteShots(a.productionId, [bShots[0].id]);
  assert.strictEqual(res.ok, false, "a shot from another production must not be deletable here");
  assert.strictEqual(shotsOf(h, b.productionId).length, bShots.length, 'the other production lost a shot');
});

test('selection does not leak across productions or projects', () => {
  const h = bootStudio();
  const a = seedProduction(h, { projectName: 'Project A', productionName: 'A video' });
  const b = seedProduction(h, { projectName: 'Project B', productionName: 'B video' });
  h.Studio.buildShotListFromScript(a.productionId, { allowStarter: false });
  h.Studio.buildShotListFromScript(b.productionId, { allowStarter: false });
  enterSelectMode(h, a.productionId);
  h.selectableIds().slice(0, 3).forEach((id) => h.clickSelectable(id));
  assert.strictEqual(h.UI.selectionCount(a.productionId, 'shots'), 3);
  assert.strictEqual(h.UI.selectionCount(b.productionId, 'shots'), 0, 'selection leaked into another project');
  assert.strictEqual(h.UI.isSelectMode(b.productionId, 'shots'), false, 'select mode leaked');
  /* Going back to A starts clean rather than resurrecting stale ids. */
  assert.strictEqual(h.UI.selectionCount(a.productionId, 'shots'), 0);
});

test('a regenerated shot list drops stale selection ids', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  enterSelectMode(h, productionId);
  h.selectableIds().forEach((id) => h.clickSelectable(id));
  const selected = h.UI.selectionCount(productionId, 'shots');
  assert.ok(selected > 0);
  /* Director regenerates with different shots. */
  h.Studio.applyShotPlan(productionId, {
    productionId: productionId,
    shots: [
      {
        title: 'A completely new opening',
        shotType: 'a_roll',
        durationSec: 3,
        scriptCoverage: [{ text: "Most students think they're bad at studying." }]
      }
    ]
  });
  openShots(h, productionId);
  const remaining = h.UI.selectionIds(productionId, 'shots');
  shotsOf(h, productionId).forEach(() => {});
  remaining.forEach((id) => {
    assert.ok(
      shotsOf(h, productionId).some((s) => s.id === id),
      'selection kept an id that no longer exists'
    );
  });
});

test('single shot delete still works outside select mode', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shots = shotsOf(h, productionId);
  h.UI.deleteShot(productionId, shots[0].id);
  const after = shotsOf(h, productionId);
  assert.strictEqual(after.length, shots.length - 1);
  assert.ok(!after.some((s) => s.id === shots[0].id));
  after.forEach((s, i) => assert.strictEqual(s.order, i + 1));
});

test('normal shot list rendering is unchanged when select mode is off', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  openShots(h, productionId);
  const html = h.studioHtml();
  assert.ok(!html.includes('pw-selectable'), 'checkboxes are showing in normal mode');
  assert.ok(!html.includes('pw-bulk-bar'), 'the bulk bar is showing in normal mode');
  assert.ok(html.includes('pw-shot-head'), 'normal shot cards are gone');
  assert.ok(html.includes('>Select</button>'), 'no way to enter select mode');
  assert.ok(html.includes('Add shot'), 'Add shot went missing');
});

test('script lines get the same select mode and bulk delete', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.UI.setStudioView({ mode: 'production', productionId: productionId, section: 'script' });
  h.UI.renderStudio();
  assert.ok(h.studioHtml().includes('>Select</button>'), 'script section has no Select control');
  h.UI.toggleSelectMode(productionId, 'script');
  const ids = h.selectableIds();
  const before = linesOf(h, productionId).length;
  assert.strictEqual(ids.length, before);
  h.clickSelectable(ids[0]);
  h.clickSelectable(ids[2]);
  assert.strictEqual(h.UI.selectionCount(productionId, 'script'), 2);
  h.UI.bulkDelete(productionId, 'script');
  const after = linesOf(h, productionId);
  assert.strictEqual(after.length, before - 2);
  assert.ok(!after.some((l) => l.id === ids[0] || l.id === ids[2]));
});

test('deleting script lines drops their coverage but keeps the shots', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  const shotCount = shotsOf(h, productionId).length;
  const lines = linesOf(h, productionId);
  const res = h.Studio.deleteScriptLines(productionId, [lines[0].id]);
  assert.ok(res.ok, res.message);
  assert.strictEqual(shotsOf(h, productionId).length, shotCount, 'deleting a line deleted shots too');
  shotsOf(h, productionId).forEach((s) => {
    (s.scriptCoverage || []).forEach((c) => {
      assert.notStrictEqual(c.lineId, lines[0].id, 'coverage still points at a deleted line');
    });
  });
});

test('a read-only workspace cannot bulk delete', () => {
  const h = bootStudio();
  const { productionId } = seedProduction(h);
  h.Studio.buildShotListFromScript(productionId, { allowStarter: false });
  enterSelectMode(h, productionId);
  h.selectableIds().slice(0, 2).forEach((id) => h.clickSelectable(id));
  const before = shotsOf(h, productionId);
  /* Only the permission check is stubbed; the store stays personal so the
     assertion is about the guard, not about which store is active. */
  h.sandbox.PreShootWorkspace = {
    isShared: function () {
      return true;
    },
    canEdit: function () {
      return false;
    },
    getActiveStore: function () {
      return null;
    }
  };
  h.UI.bulkDelete(productionId, 'shots');
  delete h.sandbox.PreShootWorkspace;
  const after = shotsOf(h, productionId);
  assert.strictEqual(after.length, before.length, 'a viewer deleted shots');
  assert.ok(
    h.toasts.some((t) => /permission|read-only/i.test(t)),
    'no permission feedback: ' + h.toasts.join(' | ')
  );
});

/* ── Source-level guarantees ──────────────────────────────────────── */

const uiSrc = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
const studioSrc = fs.readFileSync(path.join(root, 'js/studio.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

test('there is one deletion mechanism, not two', () => {
  assert.ok(/deleteShots: deleteShots/.test(studioSrc), 'no shared bulk deletion in the data layer');
  assert.ok(
    /function deleteShot\(productionId, shotId\)[\s\S]{0,400}Studio\(\)\.deleteShots/.test(uiSrc),
    'single delete does not reuse the shared deletion routine'
  );
});

test('the bulk bar states the exact count and confirmation names the scope', () => {
  assert.ok(/pw-bulk-count/.test(uiSrc));
  assert.ok(/' selected'/.test(uiSrc), 'no visible selection count');
  assert.ok(/permanently remove the selected/.test(uiSrc), 'confirmation does not state the scope');
  assert.ok(/Deleting ' \+ ids\.length/.test(uiSrc), 'no in-progress state');
});

test('duplicate bulk deletes are prevented', () => {
  assert.ok(/_bulkBusy/.test(uiSrc), 'no busy guard on bulk delete');
});

test('selection styles and mobile touch targets exist', () => {
  assert.ok(/\.pw-selectable/.test(appSrc), 'no selectable styles');
  assert.ok(/\.pw-bulk-bar/.test(appSrc), 'no bulk bar styles');
  assert.ok(/prefers-reduced-motion/.test(appSrc), 'reduced motion not respected');
  assert.ok(/@media \(max-width:430px\)\{\s*\n?\s*\.pw-selectable/.test(appSrc), 'no mobile sizing for select rows');
  assert.ok(
    /\.pw-bulk-actions \.studio-btn\{[^}]*min-height:44px/.test(appSrc),
    'bulk bar buttons are below a comfortable touch target on mobile'
  );
});

test('the bulk bar clears the bottom navigation and the last row', () => {
  assert.ok(
    /\.pw-bulk-bar\{position:sticky;bottom:var\(--bnav-space\)/.test(appSrc),
    'the bulk bar would sit on top of the bottom navigation'
  );
  assert.ok(/\.pw-bulk-spacer\{height:var\(--bnav-space\)\}/.test(appSrc), 'no space reserved below the list');
  assert.ok(/pw-bulk-spacer/.test(uiSrc), 'the spacer is never rendered');
});

test('selection state is not persisted to storage', () => {
  assert.ok(!/scout_.*select/i.test(uiSrc), 'selection is being persisted');
  assert.ok(/var _sel = \{ scope: ''/.test(uiSrc), 'selection is not in-memory UI state');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
