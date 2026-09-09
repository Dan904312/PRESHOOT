/**
 * Semantic shot planner: beats, grouping, coverage, QA.
 * Run: node tests/shot-planner.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
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

function loadPlanner() {
  const sandbox = { console, Date, Math, JSON, RegExp, Object, Array, String, Number, Boolean, parseInt, isNaN };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/shot-planner.js'), 'utf8'), sandbox, {
    filename: 'shot-planner.js'
  });
  return sandbox.PreShootShotPlanner;
}

const P = loadPlanner();

const NOURA = {
  production: {
    name: 'Noura launch explainer',
    overview: {
      goal: 'Explain why traditional studying fails and how Noura changes learning',
      platform: 'TikTok',
      format: 'Educational short-form',
      audience: 'Students',
      tone: 'Direct, warm'
    }
  },
  project: { name: 'Noura', description: 'Educational AI learning platform for students' },
  creator: { skillLevel: 'intermediate', gear: { camera: 'iPhone 15 Pro', lighting: 'window light' } },
  script: {
    body: [
      "Most students think they're bad at studying.",
      'But the truth is, nobody ever taught them how learning actually works.',
      'We built Noura to change that.',
      'Instead of passively reading information, students actively teach it back.',
      'And that changes everything.'
    ].join('\n\n')
  }
};

function titles(res) {
  return res.shots.map((s) => s.title);
}

console.log('\n== Semantic shot planner ==');

test('Noura script is understood as educational with Noura as the subject', () => {
  const res = P.plan(NOURA);
  assert.ok(res.ok, 'plan should succeed');
  assert.strictEqual(res.subject, 'Noura', 'subject should be Noura, got ' + res.subject);
  assert.strictEqual(res.contentType, 'educational');
  assert.strictEqual(res.audience, 'students');
});

test('Noura shot titles describe content, never Beat N / Setup', () => {
  const res = P.plan(NOURA);
  titles(res).forEach((t) => {
    assert.ok(!/^(beat|setup|shot|section)\s*\d*$/i.test(t.trim()), 'generic title: ' + t);
    assert.ok(t.trim().length > 3, 'empty title');
  });
  const joined = titles(res).join(' | ').toLowerCase();
  assert.ok(joined.includes('misconception'), 'expected an opening misconception title, got ' + joined);
  assert.ok(joined.includes('noura'), 'expected Noura to appear in a title, got ' + joined);
});

test('Noura plan references the actual product, not a generic setup', () => {
  const res = P.plan(NOURA);
  const blob = res.shots
    .map((s) => [s.title, s.visual, s.subjectAction].join(' '))
    .join(' ')
    .toLowerCase();
  assert.ok(blob.includes('noura'), 'plan never mentions Noura');
  assert.ok(!blob.includes('phone review'), 'unrelated content leaked');
});

test('every script sentence is covered by at least one shot', () => {
  const res = P.plan(NOURA);
  const covered = new Set();
  res.shots.forEach((s) => (s.scriptCoverage || []).forEach((c) => covered.add(c.text.trim())));
  P.splitSentences(NOURA.script.body).forEach((sentence) => {
    assert.ok(covered.has(sentence.trim()), 'uncovered: ' + sentence);
  });
  assert.ok(
    !res.review.some((i) => i.code === 'coverage_gap'),
    'review reported a coverage gap: ' + JSON.stringify(res.review)
  );
});

test('long multi-sentence hook stays one cohesive shot', () => {
  const res = P.plan({
    ...NOURA,
    script: {
      body: [
        "You don't need to study harder.",
        "You need to understand why you're forgetting everything in the first place.",
        'Because once you understand this, learning completely changes.'
      ].join('\n')
    }
  });
  assert.ok(res.ok);
  assert.strictEqual(res.shots.length, 1, 'expected 1 shot for the hook, got ' + res.shots.length + ': ' + JSON.stringify(titles(res)));
  assert.strictEqual(res.shots[0].scriptCoverage.length, 3, 'the single shot should cover all three lines');
});

test('parallel short clauses are one beat, not four shots', () => {
  const res = P.plan({
    ...NOURA,
    script: {
      body: [
        'Everyone thinks the problem with studying is motivation.',
        "That you're lazy.",
        "That you're distracted.",
        "That you don't want it badly enough."
      ].join('\n')
    }
  });
  assert.ok(res.shots.length <= 2, 'expected 1-2 shots, got ' + res.shots.length + ': ' + JSON.stringify(titles(res)));
});

test('one sentence with several visual actions becomes several shots', () => {
  const res = P.plan({
    ...NOURA,
    script: { body: 'Open your notes, throw them into Noura, and watch it turn them into an interactive lesson.' }
  });
  assert.ok(res.shots.length >= 2, 'expected multiple shots for a multi-action line, got ' + res.shots.length);
  const types = res.shots.map((s) => s.shotType);
  assert.ok(
    types.includes('screen_recording') || types.includes('insert'),
    'expected a screen recording or insert, got ' + types.join(',')
  );
});

test('shot boundaries are justified, not driven by sentence endings', () => {
  const res = P.plan(NOURA);
  assert.ok(res.shots.length, 'no shots produced');
  /* Same count as the sentences is fine when every cut changes the visual. */
  const identicalNeighbours = res.shots.filter(
    (s, i) => i > 0 && s.shotType === res.shots[i - 1].shotType && s.framing === res.shots[i - 1].framing
  ).length;
  assert.ok(
    identicalNeighbours < res.shots.length / 2,
    'most cuts land between identical setups: ' + res.shots.map((s) => s.shotType).join(',')
  );
  assert.ok(
    !res.review.some((i) => i.code === 'over_split'),
    'review flagged over-splitting: ' + JSON.stringify(res.review)
  );
  const types = new Set(res.shots.map((s) => s.shotType));
  assert.ok(types.size >= 2, 'plan uses only one shot type: ' + [...types].join(','));
});

test('multiple script lines can map to a single shot', () => {
  const res = P.plan({
    ...NOURA,
    script: {
      body: [
        'I spent years trying to figure out how to study properly.',
        'I thought I was just bad at learning.',
        'But the real problem was that nobody had ever taught me how to learn.'
      ].join('\n')
    }
  });
  assert.ok(
    res.shots.some((s) => (s.scriptCoverage || []).length > 1),
    'no shot covers more than one line: ' + JSON.stringify(res.shots.map((s) => s.scriptCoverage.length))
  );
});

test('a reveal is treated as its own visual moment', () => {
  const res = P.plan(NOURA);
  const reveal = res.shots.find((s) => /introducing noura/i.test(s.title));
  assert.ok(reveal, 'no reveal shot: ' + JSON.stringify(titles(res)));
  assert.ok(
    ['insert', 'screen_recording'].includes(reveal.shotType) || reveal.stageCount > 1,
    'reveal should get a dedicated visual, got ' + reveal.shotType
  );
});

test('shot list is feasible for the declared gear (no gimbal moves on a phone)', () => {
  const res = P.plan(NOURA);
  res.shots.forEach((s) => {
    assert.ok(
      !/(crane|dolly|orbit|follow the hands)/i.test(s.cameraMovement),
      'shot ' + s.order + ' asks for unavailable support: ' + s.cameraMovement
    );
  });
  assert.ok(!res.review.some((i) => i.code === 'not_feasible'), 'feasibility issues survived repair');
});

test('owning a gimbal does not put it on a talking-head educational reel', () => {
  const res = P.plan({
    ...NOURA,
    creator: {
      skillLevel: 'advanced',
      gear: {
        camera: 'Sony FX3, iPhone 13 Pro Max',
        lens: 'G Master 24-105 f4',
        gimbal: 'DJI RS4 PRO, Hohem M6, tripod'
      }
    }
  });
  const gear = res.shots.map((s) => s.gear).join(' | ');
  assert.ok(/iphone/i.test(gear), 'expected the phone for this educational reel, got ' + gear);
  assert.ok(!/fx3/i.test(gear), 'FX3 used on a simple educational reel: ' + gear);
  assert.ok(!/rs4|hohem|gimbal/i.test(gear), 'gimbal used with no travel: ' + gear);
  assert.ok(!res.review.some((i) => i.code === 'excessive_gear' || i.code === 'unjustified_gimbal'));
});

test('existing assets are preferred over reshooting', () => {
  const res = P.plan({
    ...NOURA,
    assets: [{ name: 'noura-dashboard-screenshot.png', type: 'image' }]
  });
  const used = res.shots.filter((s) => s.assetSuggestion);
  assert.ok(used.length, 'no shot suggested the existing Noura screenshot');
  assert.ok(/existing asset/i.test(used[0].visual), 'asset not surfaced in the visual note');
});

test('sections come from the content, not a fixed template', () => {
  const founder = P.plan({
    production: { name: 'My founder story', overview: { format: 'Founder story', platform: 'YouTube' } },
    project: { name: 'Personal brand' },
    creator: { skillLevel: 'beginner', gear: { camera: 'iPhone' } },
    script: {
      body: [
        'Three years ago I quit my job with no plan.',
        'I had six months of savings and a laptop.',
        'Everyone told me it was a mistake.',
        'Then a stranger emailed me about the thing I built on a weekend.',
        'That email changed the next three years of my life.'
      ].join('\n')
    }
  });
  assert.strictEqual(founder.contentType, 'founder_story');
  const sections = founder.shots.map((s) => s.section);
  assert.ok(new Set(sections).size > 1, 'founder story collapsed into one section: ' + sections.join(','));
});

test('voiceover blocks are planned as B-roll, on-camera as A-roll', () => {
  const res = P.plan({
    ...NOURA,
    scriptBeats: [
      { header: 'HOOK', spokenTag: '[ON CAMERA]', spoken: 'Most students think studying is about motivation.', visual: '' },
      { header: 'CONTEXT', spokenTag: '[VOICEOVER]', spoken: 'It never was. It is about how memory works.', visual: '' }
    ],
    script: { body: 'Most students think studying is about motivation.\n\nIt never was. It is about how memory works.' }
  });
  const types = res.shots.map((s) => s.shotType);
  assert.ok(types.includes('a_roll'), 'no A-roll: ' + types.join(','));
  assert.ok(types.includes('b_roll'), 'voiceover was not planned as B-roll: ' + types.join(','));
});

test('every shot carries a purpose a real creator can act on', () => {
  const res = P.plan(NOURA);
  res.shots.forEach((s) => {
    assert.ok(s.visualPurpose && s.visualPurpose.length > 10, 'shot ' + s.order + ' has no purpose');
    assert.ok(s.visual && s.visual.length > 10, 'shot ' + s.order + ' has no visual direction');
    assert.ok(s.durationSec >= 2 && s.durationSec <= 12, 'shot ' + s.order + ' duration out of range');
    assert.ok(s.section, 'shot ' + s.order + ' has no section');
  });
});

test('empty script is refused rather than faked', () => {
  const res = P.plan({ ...NOURA, script: { body: '   ' } });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'no_script');
  assert.strictEqual(res.shots.length, 0);
});

test('review pass reports over-splitting when it happens', () => {
  const shots = P.splitSentences(NOURA.script.body).map((s, i) => ({
    order: i + 1,
    beatId: 'beat' + i,
    title: 'Beat ' + (i + 1),
    shotType: 'a_roll',
    framing: 'Medium shot',
    cameraMovement: 'Locked off',
    durationSec: 3,
    spoken: s,
    stageCount: 1,
    scriptCoverage: [{ text: s, lineId: null, start: null, end: null }]
  }));
  const ctx = P.buildContext(NOURA);
  const issues = P.reviewPlan(shots, ctx);
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('over_split'), 'over_split not detected: ' + codes.join(','));
  assert.ok(codes.includes('generic_titles'), 'generic titles not detected: ' + codes.join(','));
});

const FULL_BAG = {
  skillLevel: 'advanced',
  gear: {
    camera: 'Sony FX3, iPhone 13 Pro Max',
    lens: 'G Master 24-105 f4',
    gimbal: 'DJI RS4 PRO, Hohem M6, tripod'
  }
};

function gearBlob(res) {
  return res.shots.map((s) => s.gear).join(' | ');
}

test('Test A: casual Instagram reel uses iPhone + tripod, not the whole bag', () => {
  const res = P.plan({
    production: {
      name: 'Quick product chat',
      overview: {
        format: 'Casual Instagram Reel',
        platform: 'Instagram',
        goal: 'Explain a product directly to camera',
        audience: 'Followers'
      }
    },
    project: { name: 'Casual reels', description: 'Simple talking-head product explainers' },
    creator: FULL_BAG,
    script: {
      body: 'This thing actually saves me twenty minutes every morning.\nHere is why I keep it on my desk.\nTry it and tell me what you think.'
    }
  });
  assert.ok(res.ok);
  const gear = gearBlob(res);
  assert.ok(/iphone/i.test(gear), 'expected iPhone, got ' + gear);
  assert.ok(/tripod/i.test(gear), 'expected a tripod on a locked talking-head, got ' + gear);
  assert.ok(!/fx3/i.test(gear), 'FX3 on a casual reel: ' + gear);
  assert.ok(!/rs4|hohem|24-105/i.test(gear), 'bag dumped onto a casual reel: ' + gear);
  res.shots.forEach((s) => {
    assert.ok(!P.looksLikeInventoryDump(s.gear, P.parseInventory(FULL_BAG)));
  });
});

test('Test B: professional brand reel may use the cinema body, still not every gimbal', () => {
  const res = P.plan({
    production: {
      name: 'Brand film',
      overview: {
        format: 'Professional brand reel',
        platform: 'Instagram',
        goal: 'Polished professional commercial for the brand',
        tone: 'premium'
      }
    },
    project: { name: 'Brand' },
    creator: FULL_BAG,
    script: {
      body: 'We rebuilt the way teams start their day.\nOne workspace. Every tool.\nSee it live this week.'
    }
  });
  const gear = gearBlob(res);
  assert.ok(/fx3/i.test(gear), 'expected the FX3 on a professional brand reel, got ' + gear);
  assert.ok(!/iphone/i.test(gear), 'phone and cinema camera together: ' + gear);
  assert.ok(!/hohem/i.test(gear), 'phone gimbal on a cinema package: ' + gear);
  const gimbalShots = res.shots.filter((s) => /rs4|gimbal/i.test(s.gear));
  gimbalShots.forEach((s) => {
    assert.ok(
      /follow|track|travel/i.test(s.cameraMovement + ' ' + s.visual),
      'gimbal on a static brand shot: ' + s.gear + ' / ' + s.cameraMovement
    );
  });
});

test('Test C: cinematic tracking may use a gimbal only where the camera travels', () => {
  const res = P.plan({
    production: {
      name: 'Perth sunset drive',
      overview: {
        format: 'Cinematic automotive reel',
        platform: 'Instagram',
        goal: 'Tracking shots of a vehicle driving through Perth at sunset, plus static detail shots'
      }
    },
    project: { name: 'Auto' },
    creator: FULL_BAG,
    script: {
      body: [
        'Track alongside the car as it drives through Perth at sunset.',
        'Hold on the badge in the last gold light.',
        'The city falls away behind us.'
      ].join('\n')
    }
  });
  const traveling = res.shots.filter((s) => /rs4|gimbal|follow/i.test((s.gear || '') + ' ' + (s.cameraMovement || '')));
  assert.ok(traveling.length >= 1, 'expected a movement solution on the driving beat, got ' + gearBlob(res));
  res.shots.forEach((s) => {
    const spoken = s.spoken || '';
    if (/badge|gold light/i.test(spoken) && !/track|drive|follow|alongside/i.test(spoken)) {
      assert.ok(
        !/rs4|hohem|gimbal/i.test(s.gear || ''),
        'static detail shot still has a gimbal: ' + s.gear
      );
    }
  });
  assert.ok(!res.shots.some((s) => /hohem/i.test(s.gear || '')), 'phone gimbal leaked onto a cinema body');
});

test('Test D: authentic UGC stays on the phone', () => {
  const res = P.plan({
    production: {
      name: 'Day in my life',
      overview: { format: 'Authentic day in my life TikTok', platform: 'TikTok', goal: 'Casual UGC, creator-native' }
    },
    project: { name: 'Personal' },
    creator: FULL_BAG,
    script: { body: 'Woke up late again.\nCoffee, then the train.\nThis is the bit nobody posts.' }
  });
  const gear = gearBlob(res);
  assert.ok(/iphone/i.test(gear), gear);
  assert.ok(!/fx3/i.test(gear), gear);
  assert.ok(!/24-105/i.test(gear), gear);
});

test('Test E: explicit FX3 instruction wins over a casual default', () => {
  const res = P.plan({
    production: {
      name: 'Quick chat',
      notes: 'Shoot this entirely on the FX3.',
      overview: { format: 'Casual Instagram Reel', platform: 'Instagram', goal: 'Direct to camera' }
    },
    creator: FULL_BAG,
    script: { body: 'Here is the offer.\nIt is that simple.\nLink in bio.' }
  });
  const gear = gearBlob(res);
  assert.ok(/fx3/i.test(gear), 'explicit FX3 instruction ignored: ' + gear);
  assert.ok(!/iphone/i.test(gear), gear);
});

test('Test F: project says no gimbal even when tracking language appears', () => {
  const res = P.plan({
    production: {
      name: 'Walkthrough',
      notes: 'No gimbal.',
      overview: { format: 'Casual Instagram Reel', platform: 'Instagram', goal: 'Walk into the shop' }
    },
    creator: FULL_BAG,
    script: { body: 'Walk with me through the shop.\nThis is the corner I love.\nThat is the whole tour.' }
  });
  const blob = gearBlob(res) + ' ' + res.shots.map((s) => s.cameraMovement).join(' ');
  assert.ok(!/rs4|hohem|gimbal/i.test(blob), 'gimbal used despite no-gimbal note: ' + blob);
});

test('Test G: a tracking shot may use the gimbal when the creator has one', () => {
  const res = P.plan({
    production: {
      name: 'Arrival',
      overview: {
        format: 'Cinematic short',
        platform: 'YouTube',
        goal: 'Tracking shot following the subject walking into the location'
      }
    },
    creator: FULL_BAG,
    script: { body: 'Follow the subject walking into the hall.\nThey stop at the window.\nThat is the moment.' }
  });
  const blob = gearBlob(res) + ' ' + res.shots.map((s) => s.cameraMovement).join(' | ');
  assert.ok(/rs4|follow/i.test(blob), 'tracking shot had no movement solution: ' + blob);
});

test('Test H: never invent a camera the creator does not own', () => {
  const res = P.plan({
    ...NOURA,
    production: {
      ...NOURA.production,
      overview: { format: 'Professional brand reel', platform: 'Instagram', goal: 'Polished professional commercial' }
    },
    creator: { skillLevel: 'beginner', gear: { camera: 'iPhone 13 Pro Max' } }
  });
  const gear = gearBlob(res);
  assert.ok(/iphone/i.test(gear), gear);
  assert.ok(!/fx3|rs4|24-105/i.test(gear), 'invented gear: ' + gear);
});

test('Test I: a later phone-only plan cannot inherit FX3 from a previous cinema plan', () => {
  P.plan({
    production: { name: 'Cinema A', overview: { format: 'Cinematic automotive reel', goal: 'Tracking shots of a vehicle' } },
    creator: FULL_BAG,
    script: { body: 'Track alongside the car as it drives through Perth at sunset.' }
  });
  const b = P.plan({
    production: { name: 'Phone B', overview: { format: 'Authentic day in my life TikTok', platform: 'TikTok' } },
    creator: { skillLevel: 'beginner', gear: { camera: 'iPhone 13 Pro Max' } },
    script: { body: 'Woke up late again.\nThis is the bit nobody posts.' }
  });
  const gear = gearBlob(b);
  assert.ok(/iphone/i.test(gear), gear);
  assert.ok(!/fx3/i.test(gear), 'FX3 leaked from the previous plan: ' + gear);
});

test('inventory dump strings fail QA and get repaired to a kit', () => {
  const dumped = {
    order: 1,
    title: 'Opening misconception',
    shotType: 'a_roll',
    cameraMovement: 'Locked off on a tripod',
    gear: 'Sony FX3, iPhone 13 Pro Max · DJI RS4 PRO, Hohem M6 · G Master 24-105 f4',
    visual: 'Creator direct to camera',
    spoken: 'Most students think they are bad at studying.'
  };
  const ctx = P.buildContext({
    production: { name: 'Casual reel', overview: { format: 'Casual Instagram Reel', platform: 'Instagram' } },
    creator: FULL_BAG,
    script: { body: dumped.spoken }
  });
  assert.ok(P.looksLikeInventoryDump(dumped.gear, P.parseInventory(FULL_BAG)));
  P.fitShotEquipment(dumped, ctx);
  assert.ok(/iphone/i.test(dumped.gear), dumped.gear);
  assert.ok(!P.looksLikeInventoryDump(dumped.gear, P.parseInventory(FULL_BAG)), dumped.gear);
  assert.ok(!/rs4|hohem/i.test(dumped.gear), dumped.gear);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);

