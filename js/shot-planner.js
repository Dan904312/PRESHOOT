/**
 * PreShoot semantic shot planner.
 *
 * Replaces the old one-script-line-per-shot transform. The pipeline is:
 *
 *   full script  ->  units (sentences, with section + delivery)
 *                ->  semantic beats   (meaning, not punctuation)
 *                ->  visual beats     (a beat may need 1..n visuals)
 *                ->  shot plan        (type, framing, movement, coverage)
 *                ->  review pass      (coverage, over/under split, repetition)
 *                ->  repair           (merge / split / retitle)
 *
 * Every shot carries scriptCoverage, so several script lines can belong to one
 * shot and one line can be covered by several shots. Nothing here calls a
 * model or the network: it is the deterministic floor that also runs for Free
 * users and offline, and the validated fallback when a Director shot plan is
 * rejected.
 */
(function (global) {
  'use strict';

  /* Spoken-word pace used to estimate shot duration. */
  var WORDS_PER_SEC = 2.6;
  var MIN_SHOT_SEC = 2;
  var MAX_SHOT_SEC = 12;
  /* A beat longer than this is asked to split at its best internal boundary. */
  var BEAT_SOFT_MAX_SEC = 10;
  /* A single shot covering more than this is flagged as under-split. */
  var SHOT_LONG_SEC = 14;

  var SECTION_RE = /^(HOOK|SETUP|CONTEXT|PROBLEM|SOLUTION|PROOF|DEMO|PAYOFF|CTA|OUTRO|INTRO|BEAT|SCENE\b.*|ACT\b.*)[:\s]*$/i;
  var DELIVERY_RE = /^\[?(ON CAMERA|TO CAMERA|VOICEOVER|VOICE OVER|VO|NARRATION|DIALOGUE)\]?[:\s]*$/i;

  var STOPWORDS = {};
  ('a an the and or but so because that this these those it its it\'s they them their there here you your yours we our ours us i me my mine he she his her him of to in on at for with from as if then than when while about into over under out up down off just really very much more most some any all no not now new only also even still be been being am is are was were do does did doing done have has had having will would can could should shall may might must get gets got go goes going went make makes made made like want wants need needs know knows think thinks thing things stuff way ways lot lots kind sort really actually basically literally simply what which who whom whose how why where')
    .split(' ')
    .forEach(function (w) {
      STOPWORDS[w] = true;
    });

  /* Words that signal the sentence continues the previous thought. */
  var COHESION_STARTERS = [
    'because', 'and', 'or', 'which', 'that', 'so that', 'plus', 'also',
    'not just', 'no', 'nothing', 'nobody', 'it', 'its', 'they', 'them',
    'this', 'that\'s', 'thats', 'those', 'these', 'he', 'she', 'we', 'you'
  ];

  /* Words that signal a genuine pivot in meaning. */
  var PIVOT_STARTERS = [
    'but', 'however', 'instead', 'then', 'so', 'meanwhile', 'suddenly',
    'until', 'after', 'before', 'today', 'yesterday', 'eventually',
    'finally', 'first', 'second', 'third', 'next', 'now', 'here\'s',
    'heres', 'that\'s why', 'thats why', 'which is why', 'the truth',
    'turns out', 'in reality', 'imagine', 'introducing'
  ];

  /* Verb stems that describe something a camera can actually watch happen. */
  var DEMO_VERBS = [
    'watch', 'look', 'see', 'open', 'tap', 'click', 'swipe', 'drag', 'drop',
    'type', 'upload', 'throw', 'paste', 'record', 'scan', 'press', 'hold',
    'show', 'try', 'test', 'build', 'draw', 'write', 'point', 'turn', 'flip',
    'pour', 'mix', 'cut', 'place', 'attach', 'install', 'set up',
    'teach', 'read', 'explain', 'practice', 'answer', 'quiz', 'recall'
  ];

  function verbPresent(text, stem) {
    return new RegExp('(^|\\W)' + stem + '(s|es|ed|ing)?(\\W|$)', 'i').test(text);
  }

  var SCREEN_WORDS = [
    'app', 'screen', 'interface', 'dashboard', 'website', 'site', 'page',
    'software', 'tool', 'platform', 'ui', 'menu', 'settings', 'notes',
    'document', 'spreadsheet', 'editor', 'timeline', 'feed', 'profile'
  ];

  var REVEAL_WORDS = [
    'we built', 'i built', 'we made', 'i made', 'we created', 'i created',
    'introducing', 'meet ', 'this is ', 'that\'s where', 'thats where',
    'enter ', 'we launched', 'i launched', 'so we', 'so i'
  ];

  var CTA_WORDS = [
    'follow', 'subscribe', 'comment', 'like this', 'share this', 'link in bio',
    'sign up', 'try it', 'download', 'check out', 'join', 'save this',
    'tap the', 'click the', 'dm me', 'let me know'
  ];

  var MISCONCEPTION_WORDS = [
    'everyone thinks', 'most people think', 'most students think',
    'you think', 'people think', 'they think', 'we\'re told', 'were told',
    'you\'ve been told', 'youve been told', 'the myth', 'common advice',
    'everybody says', 'people say', 'they say', 'you don\'t need',
    'you dont need', 'it\'s not', 'its not'
  ];

  var PROBLEM_WORDS = [
    'problem', 'struggle', 'struggling', 'fails', 'failing', 'broken',
    'doesn\'t work', 'doesnt work', 'never worked', 'hard', 'difficult',
    'frustrating', 'waste', 'wasting', 'forget', 'forgetting', 'stuck',
    'confused', 'overwhelmed', 'burnout', 'lost'
  ];

  var PAYOFF_WORDS = [
    'changes everything', 'changed everything', 'that\'s the difference',
    'thats the difference', 'the result', 'and that\'s it', 'and thats it',
    'that\'s how', 'thats how', 'now you', 'suddenly', 'the payoff',
    'everything changed', 'it works', 'that\'s why it works'
  ];

  var PROOF_WORDS = [
    'studies', 'research', 'data', 'proven', 'science', 'percent', '%',
    'students who', 'people who', 'in a study', 'evidence', 'results showed'
  ];

  function str(v) {
    return String(v == null ? '' : v);
  }

  function clean(v) {
    return str(v).replace(/\s+/g, ' ').trim();
  }

  function lower(v) {
    return clean(v).toLowerCase();
  }

  function words(text) {
    var t = clean(text);
    if (!t) return [];
    return t.split(/[^A-Za-z0-9'’]+/).filter(Boolean);
  }

  function wordCount(text) {
    return words(text).length;
  }

  function durationFor(text) {
    var n = wordCount(text);
    if (!n) return MIN_SHOT_SEC;
    var sec = Math.round(n / WORDS_PER_SEC);
    if (sec < MIN_SHOT_SEC) sec = MIN_SHOT_SEC;
    if (sec > MAX_SHOT_SEC) sec = MAX_SHOT_SEC;
    return sec;
  }

  function hasAny(text, list) {
    var t = lower(text);
    for (var i = 0; i < list.length; i++) {
      if (t.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  function startsWithAny(text, list) {
    var t = lower(text).replace(/^[^a-z0-9']+/, '');
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (t === w) return true;
      if (t.indexOf(w + ' ') === 0) return true;
      if (t.indexOf(w) === 0 && w.indexOf(' ') >= 0) return true;
    }
    return false;
  }

  function titleCase(text) {
    var t = clean(text);
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ── 1. Units ───────────────────────────────────────────────────────── */

  /**
   * Sentence split that keeps abbreviations and decimals intact and never
   * splits inside a bracketed delivery tag.
   */
  function splitSentences(text) {
    var t = clean(text);
    if (!t) return [];
    var parts = t.match(/[^.!?]+[.!?]*/g) || [t];
    var out = [];
    parts.forEach(function (piece) {
      var s = clean(piece);
      if (!s) return;
      /* Glue fragments that are only an abbreviation or a number. */
      if (out.length && (/^[a-z]/.test(s) || /^\d+([.,]\d+)?[.!?]?$/.test(s))) {
        out[out.length - 1] = out[out.length - 1] + ' ' + s;
        return;
      }
      out.push(s);
    });
    return out;
  }

  function stripDelivery(text) {
    return clean(str(text).replace(/\[[^\]]*\]/g, ' '));
  }

  /**
   * Turns the script into ordered units. Prefers structured beats from
   * PreShootStudio.separateScriptFromProduction (headers + delivery tags),
   * and falls back to parsing the raw body.
   */
  function parseUnits(input) {
    input = input || {};
    var body = str(input.body);
    var beats = Array.isArray(input.scriptBeats) ? input.scriptBeats : null;
    var lines = Array.isArray(input.lines) ? input.lines : [];
    var units = [];
    var blockIndex = 0;

    function pushBlock(spoken, section, delivery, visual, lineId) {
      var text = stripDelivery(spoken);
      if (!text) return;
      var sentences = splitSentences(text);
      if (!sentences.length) return;
      var idx = blockIndex++;
      sentences.forEach(function (sentence, si) {
        units.push({
          id: 'u' + units.length,
          text: sentence,
          section: section || '',
          delivery: delivery || '',
          visualNote: si === 0 ? clean(visual) : '',
          blockIndex: idx,
          sentenceIndex: si,
          blockSentences: sentences.length,
          lineId: lineId || null
        });
      });
    }

    if (beats && beats.length) {
      beats.forEach(function (beat, i) {
        if (!beat) return;
        var line = lines[i] || null;
        pushBlock(
          beat.spoken,
          normalizeSection(beat.header),
          normalizeDelivery(beat.spokenTag),
          beat.visual,
          line && line.id
        );
      });
    }

    if (!units.length && lines.length) {
      lines.forEach(function (line) {
        if (!line) return;
        pushBlock(line.text, '', normalizeDelivery(line.kind), line.visualNote, line.id);
      });
    }

    if (!units.length && body) {
      var section = '';
      var delivery = '';
      body
        .replace(/\r\n/g, '\n')
        .split(/\n\s*\n+/)
        .forEach(function (block) {
          var kept = [];
          clean(block) && block.split('\n').forEach(function (raw) {
            var t = clean(raw);
            if (!t) return;
            if (SECTION_RE.test(t)) {
              section = normalizeSection(t);
              return;
            }
            if (DELIVERY_RE.test(t)) {
              delivery = normalizeDelivery(t);
              return;
            }
            kept.push(t);
          });
          if (kept.length) pushBlock(kept.join(' '), section, delivery, '', null);
        });
    }

    /* Char offsets into the plain script so coverage survives edits. */
    var cursor = 0;
    var haystack = body || units.map(function (u) { return u.text; }).join('\n\n');
    units.forEach(function (u) {
      var at = haystack.indexOf(u.text, cursor);
      if (at < 0) at = haystack.indexOf(u.text);
      if (at >= 0) {
        u.start = at;
        u.end = at + u.text.length;
        cursor = u.end;
      } else {
        u.start = null;
        u.end = null;
      }
    });

    return units;
  }

  function normalizeSection(header) {
    var h = clean(header).replace(/[:]+$/, '');
    if (!h) return '';
    if (/^scene/i.test(h) || /^act/i.test(h)) return titleCase(h);
    return h.toUpperCase();
  }

  function normalizeDelivery(tag) {
    var t = lower(tag).replace(/[[\]]/g, '');
    if (!t) return '';
    if (/voice|vo\b|narration/.test(t)) return 'voiceover';
    if (/camera|dialogue/.test(t)) return 'on_camera';
    return '';
  }

  /* ── 2. Subject / content understanding ─────────────────────────────── */

  var GENERIC_ENTITY = {
    the: true, this: true, that: true, and: true, but: true, you: true,
    your: true, most: true, some: true, every: true, all: true, when: true,
    what: true, why: true, how: true, instead: true, because: true,
    because_: true, so: true, then: true, now: true, here: true, there: true,
    if: true, it: true, we: true, i: true, they: true, no: true, not: true
  };

  /**
   * Product / brand / subject names, ranked: production and project naming
   * first, then proper nouns that actually appear in the script.
   */
  function detectEntities(ctx) {
    var out = [];
    var seen = {};

    function add(name, weight) {
      var n = clean(name);
      if (!n || n.length < 2 || n.length > 40) return;
      var key = n.toLowerCase();
      if (GENERIC_ENTITY[key] || STOPWORDS[key] || seen[key]) return;
      seen[key] = true;
      out.push({ name: n, weight: weight });
    }

    var prod = ctx.production || {};
    var idea = prod.ideaSnapshot || {};
    var proj = ctx.project || {};

    /* A production named "Noura launch teaser" contributes "Noura". */
    [prod.name, proj.name, idea.title].forEach(function (source, i) {
      clean(source)
        .split(/[\s\-–—:|,]+/)
        .forEach(function (token) {
          if (/^[A-Z][A-Za-z0-9]{1,}$/.test(token)) add(token, 6 - i);
        });
    });

    var scriptText = ctx.scriptText || '';
    var sentences = splitSentences(scriptText);
    sentences.forEach(function (sentence) {
      var toks = sentence.split(/[^A-Za-z0-9'’]+/).filter(Boolean);
      toks.forEach(function (tok, i) {
        if (i === 0) return;
        if (!/^[A-Z][A-Za-z0-9]{1,}$/.test(tok)) return;
        add(tok, 3);
      });
    });

    /* Prefer names that the script actually says. */
    var lowScript = lower(scriptText);
    out.forEach(function (e) {
      if (lowScript.indexOf(e.name.toLowerCase()) >= 0) e.weight += 4;
    });
    out.sort(function (a, b) {
      return b.weight - a.weight;
    });
    return out;
  }

  function primaryEntity(entities) {
    return entities && entities.length ? entities[0].name : '';
  }

  /** The audience noun the script talks about ("students", "founders"). */
  function detectAudienceNoun(ctx) {
    var declared = lower((ctx.production && ctx.production.overview && ctx.production.overview.audience) || '');
    var m = declared.match(/([a-z]+s)\b/);
    if (m) return m[1];
    var script = lower(ctx.scriptText || '');
    var candidates = ['students', 'creators', 'founders', 'developers', 'parents', 'teachers', 'beginners', 'marketers', 'athletes', 'people'];
    for (var i = 0; i < candidates.length; i++) {
      if (script.indexOf(candidates[i]) >= 0) return candidates[i];
    }
    return '';
  }

  /**
   * Content type decides the narrative shape. Declared format wins; the
   * script's own language is the fallback. Never forces hook/setup/CTA.
   */
  function classifyContentType(ctx) {
    var declared = lower(
      (ctx.production && ctx.production.overview && ctx.production.overview.format) ||
        (ctx.production && ctx.production.ideaSnapshot && ctx.production.ideaSnapshot.category) ||
        ''
    );
    var map = [
      ['educational', /educat|explain|teach|lesson|how it works|breakdown/],
      ['tutorial', /tutorial|how-?to|step by step|walkthrough/],
      ['product_demo', /demo|product|feature|launch|saas|app/],
      ['founder_story', /founder|story|journey|behind the scenes|origin/],
      ['review', /review|comparison|versus|vs\b|unboxing/],
      ['ugc', /ugc|testimonial|creator ad|advert|ad\b|commercial/],
      ['interview', /interview|podcast|q&a/],
      ['documentary', /documentary|mini-?doc|film/],
      ['announcement', /announce|update|news/]
    ];
    for (var i = 0; i < map.length; i++) {
      if (declared && map[i][1].test(declared)) return map[i][0];
    }
    var script = lower(ctx.scriptText || '');
    if (/step (one|1)|first,|then,|next,/.test(script) && /how to|here's how|heres how/.test(script)) {
      return 'tutorial';
    }
    if (/i built|i started|i quit|years ago|when i was/.test(script)) return 'founder_story';
    if (/nobody taught|the truth is|actually works|why you/.test(script)) return 'educational';
    if (/we built|introducing|our app|our platform/.test(script)) return 'product_demo';
    return 'educational';
  }

  /* ── 3. Narrative role per unit ─────────────────────────────────────── */

  /**
   * Narrative role of one unit. `explicit` marks roles that came from the
   * language itself rather than from position, because only those are strong
   * enough to force a new shot.
   */
  function roleFor(unit, index, total, ctx) {
    var text = unit.text;
    var section = lower(unit.section);
    if (section.indexOf('cta') === 0) return { role: 'cta', explicit: true };
    if (section.indexOf('hook') === 0 && index === 0) return { role: 'opening', explicit: false };

    if (hasAny(text, CTA_WORDS) && index >= total - 3) return { role: 'cta', explicit: true };
    if (hasAny(text, REVEAL_WORDS) && primaryEntity(ctx.entities)) return { role: 'reveal', explicit: true };
    if (hasAny(text, MISCONCEPTION_WORDS)) return { role: 'misconception', explicit: true };
    if (hasAny(text, PROOF_WORDS)) return { role: 'proof', explicit: true };
    if (hasAny(text, PAYOFF_WORDS)) return { role: 'payoff', explicit: true };
    if (isDemonstration(text)) return { role: 'demo', explicit: true };
    if (hasAny(text, PROBLEM_WORDS)) return { role: 'problem', explicit: true };
    if (/^(but|however|instead|the truth|turns out|in reality)/i.test(clean(text))) {
      return { role: 'reframe', explicit: false };
    }
    if (/\bhow\b.*\bworks?\b|\bhere'?s how\b/i.test(text)) return { role: 'howto', explicit: true };
    if (index === 0) return { role: 'opening', explicit: false };
    if (index === total - 1) return { role: 'payoff', explicit: false };
    return { role: 'body', explicit: false };
  }

  function isDemonstration(text) {
    var t = lower(text);
    var verbs = 0;
    DEMO_VERBS.forEach(function (v) {
      if (verbPresent(t, v)) verbs += 1;
    });
    if (verbs && hasAny(t, SCREEN_WORDS)) return true;
    if (verbs >= 2) return true;
    return /\b(instead of|rather than)\b/.test(t) && verbs > 0;
  }

  /* ── 4. Semantic beat grouping ──────────────────────────────────────── */

  /**
   * Should a new semantic beat start at `unit`? Returns a reason string when
   * it should, or '' to keep the unit in the current beat. Punctuation and
   * line breaks are never a reason on their own.
   */
  function boundaryReason(unit, prev, beat, ctx) {
    if (!prev) return 'start';
    if (unit.section && prev.section && unit.section !== prev.section) return 'section_change';
    if (unit.delivery && prev.delivery && unit.delivery !== prev.delivery) return 'delivery_change';

    var prevRole = prev.role;
    var role = unit.role;

    /* A reveal, demonstration, CTA, evidence or stated payoff is its own
     * moment, and outranks the cohesion check below. A payoff inferred only
     * from position is not strong enough to force a cut. */
    if (unit.roleExplicit && role !== prevRole) {
      if (role === 'reveal') return 'reveal';
      if (role === 'demo') return 'demonstration';
      if (role === 'cta') return 'call_to_action';
      if (role === 'proof') return 'evidence';
      if (role === 'payoff') return 'payoff';
    }

    /* Cohesion wins over pivots: "Because ..." continues the same thought. */
    if (startsWithAny(unit.text, COHESION_STARTERS) && !startsWithAny(unit.text, PIVOT_STARTERS)) {
      /* Unless the beat is already long enough to be its own shot. */
      if (beatSeconds(beat) + durationFor(unit.text) <= BEAT_SOFT_MAX_SEC) return '';
    }

    /* Parallel short clauses ("That you're lazy. That you're distracted.")
     * are one idea, not three. */
    if (isParallelClause(unit.text, prev.text) && beatSeconds(beat) + durationFor(unit.text) <= BEAT_SOFT_MAX_SEC) {
      return '';
    }

    if (startsWithAny(unit.text, PIVOT_STARTERS)) return 'topic_pivot';

    /* A new entity entering the story is a real change of subject. */
    var newEntity = firstEntityIn(unit.text, ctx.entities);
    if (newEntity && !firstEntityIn(beatText(beat), ctx.entities)) return 'subject_change';

    if (prevRole && role && prevRole !== role && role !== 'body' && prevRole !== 'body') {
      return 'narrative_shift';
    }

    /* Length guard, so a long monologue still gets shot coverage. */
    if (beatSeconds(beat) + durationFor(unit.text) > BEAT_SOFT_MAX_SEC) return 'pacing';

    return '';
  }

  function isParallelClause(a, b) {
    var wa = words(a);
    var wb = words(b);
    if (!wa.length || !wb.length) return false;
    if (wa.length > 12 || wb.length > 12) return false;
    var firstA = wa[0].toLowerCase();
    var firstB = wb[0].toLowerCase();
    if (firstA !== firstB) return false;
    return true;
  }

  function firstEntityIn(text, entities) {
    var t = lower(text);
    for (var i = 0; i < (entities || []).length; i++) {
      if (t.indexOf(entities[i].name.toLowerCase()) >= 0) return entities[i].name;
    }
    return '';
  }

  function beatText(beat) {
    return (beat && beat.units ? beat.units : [])
      .map(function (u) {
        return u.text;
      })
      .join(' ');
  }

  function beatSeconds(beat) {
    return durationFor(beatText(beat));
  }

  function groupBeats(units, ctx) {
    var beats = [];
    var current = null;
    units.forEach(function (unit, i) {
      var prev = i ? units[i - 1] : null;
      var reason = boundaryReason(unit, prev, current, ctx);
      if (!current || reason) {
        current = {
          id: 'beat' + beats.length,
          units: [],
          section: unit.section,
          delivery: unit.delivery,
          reason: reason || 'start'
        };
        beats.push(current);
      }
      current.units.push(unit);
    });
    beats.forEach(function (beat) {
      beat.text = beatText(beat);
      beat.role = dominantRole(beat);
      beat.seconds = durationFor(beat.text);
    });
    return beats;
  }

  function dominantRole(beat) {
    var priority = ['cta', 'reveal', 'demo', 'proof', 'misconception', 'problem', 'reframe', 'howto', 'payoff', 'opening', 'body'];
    var present = {};
    (beat.units || []).forEach(function (u) {
      present[u.role] = true;
    });
    for (var i = 0; i < priority.length; i++) {
      if (present[priority[i]]) return priority[i];
    }
    return 'body';
  }

  /* ── 5. Visual beats (a beat can need several visuals) ──────────────── */

  /**
   * Splits one semantic beat into visual stages. A single sentence that
   * describes a sequence of actions ("Open your notes, throw them into
   * Noura, and watch it become a lesson") becomes several stages.
   */
  function visualStages(beat, ctx) {
    var text = beat.text;
    var stages = [];

    if (beat.role === 'demo' || isDemonstration(text)) {
      var clauses = splitActionClauses(text);
      if (clauses.length > 1) {
        clauses.forEach(function (clause, i) {
          stages.push({
            text: clause,
            kind: i === 0 ? 'action' : 'action',
            stage: i,
            of: clauses.length
          });
        });
        return stages;
      }
    }

    /* A reveal reads better as the spoken line plus the thing revealed. */
    if (beat.role === 'reveal' && firstEntityIn(text, ctx.entities) && beat.seconds >= 3) {
      return [
        { text: text, kind: 'speak', stage: 0, of: 2 },
        { text: text, kind: 'reveal', stage: 1, of: 2 }
      ];
    }

    return [{ text: text, kind: 'speak', stage: 0, of: 1 }];
  }

  /**
   * Sequential action clauses inside one sentence, in order. A contrast
   * ("Instead of reading, they teach it back") is one visual idea, not a
   * sequence, so it is never split here.
   */
  function splitActionClauses(text) {
    var t = clean(text);
    if (/^(instead of|rather than|unlike|not\b)/i.test(t)) return [t];
    var sequential = /\s+and\s+|\s+then\s+|\s+and then\s+/i.test(t);
    var imperative = DEMO_VERBS.some(function (v) {
      return new RegExp('^' + v + '(s|es|ed|ing)?\\b', 'i').test(t);
    });
    if (!sequential && !imperative) return [t];
    var parts = t
      .split(/,\s*(?:and\s+|then\s+)?|\s+and then\s+|\s+then\s+|\s+and\s+(?=[a-z]+\s)/i)
      .map(clean)
      .filter(Boolean);
    var acted = parts.filter(function (p) {
      return DEMO_VERBS.some(function (v) {
        return verbPresent(p, v);
      });
    });
    if (acted.length >= 2 && parts.length >= 2) return parts;
    return [t];
  }

  /* ── 6. Shot planning ───────────────────────────────────────────────── */

  /**
   * Inventory is a pool of options, never an instruction to use all of it.
   * Split every stored gear field so "Sony FX3, iPhone 13 Pro Max" is two
   * cameras, not one blob.
   */
  function splitGearItems(raw) {
    return String(raw || '')
      .split(/\s*(?:,|;|\+|·|\||\/|&)\s*|\s+and\s+/i)
      .map(function (s) {
        return s.replace(/\s+/g, ' ').trim();
      })
      .filter(function (s) {
        return s.length > 1 && !/^(etc\.?|and|or|only)$/i.test(s);
      });
  }

  function isPhoneName(name) {
    return /\b(iphone|pixel|galaxy\s*s?\d|android|smartphone|ipad)\b|\bphone\b/i.test(name);
  }

  function isCinemaBodyName(name) {
    if (isPhoneName(name)) return false;
    return /\b(fx\s?\d|a7|a9|r5|r6|r8|red\b|komodo|arri|bmpcc|cinema|zv-e|gh\d|a6700|a7c|canon\s*c|lumix|fx3|fx6|fx30)\b/i.test(
      name
    );
  }

  function isGimbalName(name) {
    if (/no gimbal|handheld\s*\/\s*no|tripod only/i.test(name)) return false;
    return /\b(gimbal|rs\s?\d|rs4|ronin|hohem|weebill|crane\s*\d|osmo|om\s?\d)\b/i.test(name);
  }

  function isTripodName(name) {
    return /\b(tripod|monopod)\b/i.test(name);
  }

  function parseInventory(creator) {
    creator = creator || {};
    var gear = creator.gear || {};
    var blob = [creator.gearText, gear.camera, gear.lens, gear.gimbal, gear.drone, gear.microphone, gear.lighting]
      .filter(Boolean)
      .join(', ');
    var items = splitGearItems(blob);
    var cameras = [];
    var lenses = [];
    var gimbals = [];
    var supports = [];
    var lights = [];
    var mics = [];
    splitGearItems(gear.camera).forEach(function (c) {
      if (c) cameras.push(c);
    });
    splitGearItems(gear.lens).forEach(function (l) {
      if (l && !isGimbalName(l) && !isTripodName(l) && !isPhoneName(l) && !isCinemaBodyName(l)) lenses.push(l);
    });
    splitGearItems(gear.gimbal).concat(splitGearItems(gear.lighting)).concat(items).forEach(function (n) {
      if (isGimbalName(n) && gimbals.indexOf(n) < 0) gimbals.push(n);
      if (isTripodName(n) && supports.indexOf(n) < 0) supports.push(n);
    });
    items.forEach(function (n) {
      if (isPhoneName(n) || isCinemaBodyName(n)) {
        if (cameras.indexOf(n) < 0) cameras.push(n);
      }
    });
    splitGearItems(gear.lighting).forEach(function (n) {
      if (n && !isTripodName(n) && !isGimbalName(n)) lights.push(n);
    });
    splitGearItems(gear.microphone).forEach(function (n) {
      if (n) mics.push(n);
    });
    return {
      cameras: cameras,
      phones: cameras.filter(isPhoneName),
      bodies: cameras.filter(isCinemaBodyName),
      lenses: lenses,
      gimbals: gimbals,
      supports: supports,
      lights: lights,
      mics: mics,
      drones: splitGearItems(gear.drone),
      rawText: blob
    };
  }

  function instructionBlob(ctx) {
    var ov = (ctx.production && ctx.production.overview) || {};
    var idea = (ctx.production && ctx.production.ideaSnapshot) || {};
    return lower(
      [
        ov.format,
        ov.platform,
        ov.goal,
        ov.tone,
        ov.summary,
        ov.creativeDirection,
        ov.notes,
        ctx.production && ctx.production.name,
        ctx.production && ctx.production.notes,
        ctx.project && ctx.project.name,
        ctx.project && ctx.project.description,
        ctx.contentType,
        idea.category,
        idea.title,
        ctx.creator && ctx.creator.instruction,
        ctx.constraints && (ctx.constraints.instruction || ctx.constraints.notes)
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  /**
   * Internal production-style classification. Informs kit choice; never
   * forced onto the user as a label.
   */
  function classifyProductionStyle(ctx) {
    var blob = instructionBlob(ctx);
    var type = ctx.contentType || '';
    var forcePhone = /(entirely|only|all)\s+on\s+(the\s+)?(iphone|phone)|iphone\s+only|phone only|authentic\s+(tiktok|ugc)|no cinema/.test(
      blob
    );
    var forceCinema = /(entirely|only|all)\s+on\s+(the\s+)?(fx\s?\d|a7|cinema)|shoot this (entirely )?on the fx|use the fx3/.test(
      blob
    );
    var noGimbal = /no gimbal|without (a )?gimbal|don'?t use (the )?gimbal|skip the gimbal/.test(blob);
    var wantsGimbal = /tracking shot|needs? a gimbal|use the gimbal|follow cam|gimbal for/.test(blob);

    var style = type || 'educational';
    var sophistication = 2;
    if (/ugc|day in my life|\bdiml\b|selfie|creator-?native|spontaneous/.test(blob) || type === 'ugc') {
      style = 'ugc';
      sophistication = 1;
    } else if (/casual/.test(blob) || (/reel|tiktok|instagram/.test(blob) && /direct to camera|talking.?head/.test(blob))) {
      style = 'casual';
      sophistication = 1;
    } else if (/cinematic|narrative|short film|automotive|tracking shots? of a (vehicle|car)|sunset/.test(blob)) {
      style = 'cinematic';
      sophistication = 4;
    } else if (/commercial|advert|brand film/.test(blob) && /professional|polished|premium/.test(blob)) {
      style = 'commercial';
      sophistication = 3;
    } else if (/professional|brand reel|polished/.test(blob)) {
      style = 'polished_social';
      sophistication = 3;
    } else if (type === 'product_demo' || /product demo|demonstration/.test(blob)) {
      style = 'product_demo';
      sophistication = /premium|cinematic|commercial/.test(blob) ? 3 : 2;
    } else if (type === 'interview' || type === 'documentary') {
      style = type;
      sophistication = 2;
    } else if (type === 'educational' || type === 'tutorial' || /talking.?head|explainer/.test(blob)) {
      style = type === 'tutorial' ? 'tutorial' : 'educational';
      sophistication = 1;
    }

    if (forcePhone) sophistication = Math.min(sophistication, 1);
    if (forceCinema) sophistication = Math.max(sophistication, 3);
    return {
      style: style,
      sophistication: sophistication,
      forcePhone: forcePhone,
      forceCinema: forceCinema,
      noGimbal: noGimbal,
      wantsGimbal: wantsGimbal
    };
  }

  function pickGimbalForCamera(inventory, camera) {
    var list = inventory.gimbals || [];
    if (!list.length) return '';
    if (isPhoneName(camera)) {
      var phoneG = '';
      list.forEach(function (g) {
        if (!phoneG && /hohem|om\s?\d|osmo|phone/i.test(g)) phoneG = g;
      });
      return phoneG;
    }
    var cinemaG = '';
    list.forEach(function (g) {
      if (!cinemaG && /rs\s?\d|rs4|ronin|dji/i.test(g)) cinemaG = g;
    });
    return cinemaG || list[0];
  }

  function selectProductionKit(ctx, style) {
    style = style || classifyProductionStyle(ctx);
    var inventory = parseInventory(ctx.creator || {});
    var camera = '';
    if (style.forcePhone && inventory.phones[0]) camera = inventory.phones[0];
    else if (style.forceCinema && inventory.bodies[0]) camera = inventory.bodies[0];
    else if (style.sophistication <= 1 && inventory.phones[0]) camera = inventory.phones[0];
    else if (style.sophistication <= 2 && inventory.phones[0] && style.style !== 'polished_social' && style.style !== 'commercial' && style.style !== 'cinematic') {
      camera = inventory.phones[0];
    } else if (style.sophistication >= 3 && inventory.bodies[0]) camera = inventory.bodies[0];
    else camera = inventory.bodies[0] || inventory.phones[0] || inventory.cameras[0] || '';

    var lens = '';
    if (camera && !isPhoneName(camera) && inventory.lenses[0]) lens = inventory.lenses[0];
    var hasTripod = inventory.supports.length > 0;
    var hasGimbal = inventory.gimbals.length > 0 && !style.noGimbal;
    var defaultSupport = hasTripod ? inventory.supports[0] : 'Handheld';
    if (style.style === 'ugc' && !hasTripod) defaultSupport = 'Handheld';
    return {
      inventory: inventory,
      camera: camera,
      lens: lens,
      defaultSupport: defaultSupport,
      hasTripod: hasTripod,
      hasGimbal: hasGimbal,
      hasLighting: inventory.lights.length > 0,
      hasMic: inventory.mics.length > 0,
      hasDrone: inventory.drones.length > 0,
      soloShooter: !/crew|team|second shooter|actor/.test(inventory.rawText),
      skill: str((ctx.creator && ctx.creator.skillLevel) || 'intermediate'),
      style: style
    };
  }

  function creatorCapability(ctx) {
    return selectProductionKit(ctx, ctx.productionStyle || classifyProductionStyle(ctx));
  }

  function textNeedsTravel(text) {
    return /\b(track(?:ing)?|follow(?:ing)? (?:the )?(?:subject|car|vehicle|talent|person)|walk(?:ing)? (?:into|through|across|with)|drive(?:ing)? through|alongside|gimbal|orbit the|move with)\b/i.test(
      String(text || '')
    );
  }

  function stageNeedsTravel(stage, beat, ctx, kit) {
    var style = (kit && kit.style) || ctx.productionStyle || {};
    if (style.noGimbal) return false;
    var local = (stage && (stage.text || '')) + ' ' + ((beat && beat.text) || '');
    if (textNeedsTravel(local)) return true;
    if (style.wantsGimbal && stage && (stage.kind === 'action' || /b_roll/.test((beat && beat.role) || ''))) return true;
    if (style.sophistication >= 4 && textNeedsTravel((ctx.scriptText || '') + ' ' + instructionBlob(ctx))) {
      return /drive|track|walk|follow|coast|sunset/.test(lower(local + ' ' + ((beat && beat.role) || '')));
    }
    return false;
  }

  function movementFor(stage, cap, role, beat, ctx) {
    var travel = stageNeedsTravel(stage, beat, ctx || {}, cap);
    if (travel && cap.hasGimbal) {
      var g = pickGimbalForCamera(cap.inventory, cap.camera);
      return g ? 'Smooth follow on ' + g : 'Smooth follow, handheld if you must';
    }
    if (stage.kind === 'reveal') {
      return cap.hasTripod ? 'Locked off on a tripod, let the reveal land' : 'Hold still, let the reveal land';
    }
    if (stage.kind === 'action') {
      return cap.hasTripod ? 'Locked off overhead or over-shoulder' : 'Hold over the hands, no extra movement';
    }
    if (role === 'payoff' || role === 'cta') {
      return cap.hasTripod ? 'Locked off on a tripod' : 'Hold on the last beat';
    }
    if (role === 'opening' || role === 'misconception') {
      return cap.hasTripod ? 'Locked off on a tripod' : 'Hold steady, no movement';
    }
    return cap.hasTripod ? 'Locked off on a tripod' : 'Handheld, keep it steady';
  }

  function gearForShot(shotType, stage, beat, kit, ctx) {
    if (shotType === 'screen_recording') {
      return { camera: '', lens: '', support: '', label: 'Screen recording' };
    }
    var travel = stageNeedsTravel(stage, beat, ctx, kit);
    var support = kit.defaultSupport;
    if (travel && kit.hasGimbal) {
      support = pickGimbalForCamera(kit.inventory, kit.camera) || support;
    } else if (kit.hasTripod && kit.style && kit.style.style === 'ugc' && !travel) {
      support = /talking|a_roll|opening|misconception|cta|payoff/.test((beat && beat.role) || shotType)
        ? kit.inventory.supports[0]
        : 'Handheld';
    }
    return {
      camera: kit.camera,
      lens: kit.lens,
      support: support,
      label: formatKitLabel(kit.camera, kit.lens, support)
    };
  }

  function formatKitLabel(camera, lens, support) {
    var parts = [];
    if (camera) parts.push(camera);
    if (lens && camera && !isPhoneName(camera)) parts.push(lens);
    if (support && !/^handheld$/i.test(support)) parts.push(support);
    else if (support && !camera) parts.push(support);
    else if (/^handheld$/i.test(support) && parts.length) {
      /* Handheld is the default for a phone; say it when that is the whole kit. */
      if (isPhoneName(camera) && !lens) parts.push('Handheld');
    }
    return parts.join(' · ');
  }

  function looksLikeInventoryDump(gearText, inventory) {
    var g = lower(gearText);
    if (!g) return false;
    var camerasHit = (inventory.cameras || []).filter(function (c) {
      return c && g.indexOf(lower(c)) >= 0;
    });
    var gimbalsHit = (inventory.gimbals || []).filter(function (x) {
      return x && g.indexOf(lower(x)) >= 0;
    });
    if (camerasHit.length >= 2) return true;
    if (gimbalsHit.length >= 2) return true;
    var phonesHit = camerasHit.filter(isPhoneName).length;
    var bodiesHit = camerasHit.filter(isCinemaBodyName).length;
    return phonesHit > 0 && bodiesHit > 0;
  }

  function lightingFor(kit, shotType) {
    if (shotType === 'screen_recording') return '';
    var style = kit.style || {};
    if (style.sophistication >= 3 && kit.hasLighting) return 'Key light on the subject, keep it consistent';
    if (kit.hasLighting && style.sophistication >= 2 && style.style !== 'ugc' && style.style !== 'casual') {
      return 'Simple key if the room is dark; otherwise available light';
    }
    return 'Face the softest light in the room';
  }

  /**
   * After a plan exists, keep only gear this shot can justify — and never
   * invent bodies the creator does not have.
   */
  function fitShotEquipment(shot, ctx) {
    ctx = ctx || {};
    var style = ctx.productionStyle || classifyProductionStyle(ctx);
    ctx.productionStyle = style;
    var kit = ctx.kit || selectProductionKit(ctx, style);
    ctx.kit = kit;
    var travel = textNeedsTravel(
      [
        shot.visual,
        shot.subjectAction,
        shot.cameraMovement,
        shot.title,
        shot.notes,
        shot.spoken,
        shot.audio,
        ((shot.scriptCoverage || []).map(function (c) {
          return c && c.text;
        }).join(' '))
      ].join(' ')
    );
    if (style.noGimbal) travel = false;
    var dump = looksLikeInventoryDump(shot.gear, kit.inventory);
    var fitted = gearForShot(
      shot.shotType,
      { kind: '', text: shot.visual || shot.subjectAction || '' },
      { text: shot.spoken || '', role: shot.shotPurpose || '' },
      kit,
      ctx
    );
    if (travel && kit.hasGimbal) {
      fitted.support = pickGimbalForCamera(kit.inventory, kit.camera) || fitted.support;
      fitted.label = formatKitLabel(fitted.camera, fitted.lens, fitted.support);
    }
    if (!shot.gear || dump || style.forcePhone || style.forceCinema) {
      shot.gear = fitted.label;
      shot.lens = fitted.lens || '';
    }
    if (style.forcePhone && kit.inventory.phones[0]) {
      shot.gear = formatKitLabel(
        kit.inventory.phones[0],
        '',
        travel && kit.hasGimbal ? pickGimbalForCamera(kit.inventory, kit.inventory.phones[0]) : kit.defaultSupport
      );
      shot.lens = '';
    }
    if (style.forceCinema && kit.inventory.bodies[0]) {
      var body = kit.inventory.bodies[0];
      shot.gear = formatKitLabel(
        body,
        kit.lens,
        travel && kit.hasGimbal ? pickGimbalForCamera(kit.inventory, body) : kit.defaultSupport
      );
      shot.lens = kit.lens || '';
    }
    if (!travel && /gimbal|rs\s?\d|rs4|hohem|ronin/i.test(shot.gear || '')) {
      shot.gear = formatKitLabel(kit.camera, kit.lens, kit.defaultSupport);
      if (!/locked|static|hold|tripod|handheld/i.test(shot.cameraMovement || '')) {
        shot.cameraMovement = kit.hasTripod ? 'Locked off on a tripod' : 'Handheld, keep it steady';
      }
    }
    if (shot.shotType === 'screen_recording') {
      shot.gear = 'Screen recording';
      shot.lens = '';
    }
    return shot;
  }

  /**
   * Is the thing being revealed something that lives on a screen? Checked
   * against the line and the production/project brief, so "We built Noura"
   * reveals the actual interface rather than a generic object insert.
   */
  function subjectIsScreenBased(ctx) {
    var prod = ctx.production || {};
    var ov = prod.overview || {};
    var idea = prod.ideaSnapshot || {};
    var blob = [
      prod.name, prod.notes, ov.summary, ov.goal, ov.format,
      (ctx.project || {}).name, (ctx.project || {}).description,
      idea.title
    ].join(' ');
    return hasAny(blob, SCREEN_WORDS) || /\b(saas|ai|software|web|digital)\b/i.test(blob);
  }

  function shotTypeFor(stage, beat, ctx) {
    var screenSubject = hasAny(beat.text, SCREEN_WORDS) || subjectIsScreenBased(ctx);
    if (stage.kind === 'reveal') return screenSubject ? 'screen_recording' : 'insert';
    if (stage.kind === 'action') {
      return hasAny(stage.text, SCREEN_WORDS) || screenSubject ? 'screen_recording' : 'insert';
    }
    /* A reveal that is short enough to stay one shot is still a visual
     * moment: the creator speaks over the thing being revealed. */
    if (beat.role === 'reveal') return screenSubject ? 'screen_recording' : 'insert';
    if (beat.delivery === 'voiceover') return 'b_roll';
    if (beat.role === 'proof') return 'b_roll';
    if (beat.role === 'demo') return hasAny(beat.text, SCREEN_WORDS) || screenSubject ? 'screen_recording' : 'b_roll';
    return 'a_roll';
  }

  var TYPE_LABEL = {
    a_roll: 'A-roll',
    b_roll: 'B-roll',
    insert: 'Insert',
    screen_recording: 'Screen recording'
  };

  function framingFor(shotType, role, cap) {
    if (shotType === 'screen_recording') return 'Screen capture, full frame';
    if (shotType === 'insert') return 'Close-up on the detail';
    if (shotType === 'b_roll') return 'Medium or wide, subject in context';
    if (role === 'opening' || role === 'misconception') return 'Medium close-up, eyes to lens';
    if (role === 'payoff' || role === 'cta') return 'Medium close-up';
    return cap.skill === 'beginner' ? 'Medium shot, keep it simple' : 'Medium shot';
  }

  /** Titles come from what the shot actually does, never "Beat 3". */
  function titleFor(beat, stage, ctx, index, total) {
    var entity = firstEntityIn(beat.text, ctx.entities) || primaryEntity(ctx.entities);
    var audience = ctx.audienceNoun;
    var key = keyPhrase(beat.text);

    if (stage.kind === 'reveal') return entity ? 'Introducing ' + entity : 'The reveal';
    /* Action stages are named by the action itself: "Throw them into Noura". */
    if (stage.kind === 'action') return snippet(stage.text, 5) || 'Demonstration step ' + (stage.stage + 1);

    switch (beat.role) {
      case 'misconception':
        return index === 0 ? 'Opening misconception' : 'The common misconception';
      case 'problem':
        return audience ? 'Why ' + audience + ' struggle' : key ? 'The ' + key + ' problem' : 'The real problem';
      case 'reframe':
        return 'Reframing the problem';
      case 'reveal':
        return entity ? 'Introducing ' + entity : 'The turning point';
      case 'demo':
        if (firstEntityIn(beat.text, ctx.entities)) return entity + ' in action';
        return 'Demonstration — ' + snippet(beat.text, 5);
      case 'howto':
        return key ? 'How ' + key + ' works' : 'How it works';
      case 'proof':
        return key ? 'Proof: ' + key : 'The evidence';
      case 'payoff':
        /* Only the beat that actually ends the video is the final payoff. */
        if (index === 0) return 'Opening payoff';
        if (typeof total === 'number' && index < total - 1) {
          return key ? 'Payoff — ' + titleCase(key) : 'Payoff — ' + snippet(beat.text, 4);
        }
        return 'Final payoff';
      case 'cta':
        return 'What to do next';
      case 'opening':
        return key ? titleCase(key) : 'Opening line';
      default:
        return key && words(key).length <= 3 ? titleCase(key) : snippet(beat.text, 5);
    }
  }

  /** First `n` words of the line, so a title always says something real. */
  function snippet(text, n) {
    var toks = clean(text).split(/\s+/).filter(Boolean);
    var out = toks.slice(0, n).join(' ').replace(/[,;:.!?]+$/, '');
    return titleCase(out) + (toks.length > n ? '…' : '');
  }

  /** Most meaningful 2-4 word phrase in the text. */
  function keyPhrase(text) {
    var toks = words(text);
    var best = [];
    var run = [];
    toks.forEach(function (tok) {
      var w = tok.toLowerCase();
      if (STOPWORDS[w] || w.length < 3) {
        if (run.length > best.length) best = run;
        run = [];
        return;
      }
      run.push(tok);
    });
    if (run.length > best.length) best = run;
    if (!best.length) return '';
    return best.slice(0, 4).join(' ').toLowerCase();
  }

  function visualFor(shotType, beat, stage, ctx) {
    var entity = firstEntityIn(beat.text, ctx.entities) || primaryEntity(ctx.entities);
    var asset = matchAsset(beat.text, stage.text, ctx);
    if (asset) {
      return 'Use the existing asset "' + asset.name + '" instead of reshooting this.';
    }
    if (shotType === 'screen_recording') {
      return entity
        ? 'Screen recording of ' + entity + ' doing exactly what the line describes.'
        : 'Screen recording of the interface described in the line.';
    }
    if (shotType === 'insert') {
      return 'Close insert on the object or detail the line names.';
    }
    if (shotType === 'b_roll') {
      return 'B-roll that shows the idea rather than saying it again.';
    }
    if (beat.role === 'cta') return 'Straight to camera so the ask is unmissable.';
    return 'Creator speaking direct to camera, continuous through this beat.';
  }

  function matchAsset(beatText, stageText, ctx) {
    var assets = (ctx.assets || []).filter(Boolean);
    if (!assets.length) return null;
    var hay = lower(beatText + ' ' + stageText);
    var entity = primaryEntity(ctx.entities).toLowerCase();
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      var name = lower(a.name || a.filename || '');
      if (!name) continue;
      var stem = name.replace(/\.[a-z0-9]+$/, '');
      var tokens = stem.split(/[^a-z0-9]+/).filter(function (t) {
        return t.length > 2 && !STOPWORDS[t];
      });
      for (var j = 0; j < tokens.length; j++) {
        if (hay.indexOf(tokens[j]) >= 0) return { name: a.name || a.filename, asset: a };
        if (entity && tokens[j] === entity && hay.indexOf(entity) >= 0) {
          return { name: a.name || a.filename, asset: a };
        }
      }
    }
    return null;
  }

  function sectionFor(beat, index, total) {
    if (beat.section) return beat.section;
    var map = {
      misconception: 'HOOK',
      opening: 'HOOK',
      problem: 'PROBLEM',
      reframe: 'CONTEXT',
      reveal: 'SOLUTION',
      demo: 'DEMO',
      howto: 'DEMO',
      proof: 'PROOF',
      payoff: 'PAYOFF',
      cta: 'CTA'
    };
    if (index === 0 && !map[beat.role]) return 'HOOK';
    return map[beat.role] || 'BODY';
  }

  function coverageFor(beat) {
    return (beat.units || []).map(function (u) {
      return {
        lineId: u.lineId || null,
        start: typeof u.start === 'number' ? u.start : null,
        end: typeof u.end === 'number' ? u.end : null,
        text: u.text
      };
    });
  }

  function planShots(beats, ctx) {
    var style = ctx.productionStyle || classifyProductionStyle(ctx);
    ctx.productionStyle = style;
    var cap = selectProductionKit(ctx, style);
    ctx.kit = cap;
    var shots = [];
    beats.forEach(function (beat, bi) {
      var stages = visualStages(beat, ctx);
      stages.forEach(function (stage, si) {
        var shotType = shotTypeFor(stage, beat, ctx);
        var role = beat.role;
        /* A stage is timed by the words it actually covers, not by dividing
         * the beat, so a two-stage beat does not collapse to 2s + 2s. */
        var seconds = stages.length > 1 ? durationFor(stage.text) : durationFor(beat.text);
        var kitSel = gearForShot(shotType, stage, beat, cap, ctx);
        shots.push({
          order: shots.length + 1,
          beatId: beat.id,
          section: sectionFor(beat, bi, beats.length),
          title: titleFor(beat, stage, ctx, bi, beats.length),
          shotType: shotType,
          shotTypeLabel: TYPE_LABEL[shotType] || 'A-roll',
          framing: framingFor(shotType, role, cap),
          cameraMovement: movementFor(stage, cap, role, beat, ctx),
          cameraAngle: bi === 0 && si === 0 ? 'Eye level' : '',
          durationSec: seconds,
          spoken: stage.kind === 'reveal' && si === 1 ? '' : beat.text,
          subjectAction: subjectActionFor(shotType, beat, stage, ctx),
          visual: visualFor(shotType, beat, stage, ctx),
          visualPurpose: purposeFor(beat, stage, shotType),
          shotPurpose: role,
          gear: kitSel.label,
          lens: kitSel.lens || '',
          lighting: lightingFor(cap, shotType),
          assetSuggestion: (matchAsset(beat.text, stage.text, ctx) || {}).name || '',
          scriptCoverage: stage.kind === 'reveal' && si === 1 ? [] : coverageFor(beat),
          continues: si > 0,
          stage: stage.stage,
          stageCount: stages.length,
          boundaryReason: beat.reason
        });
      });
    });
    return shots;
  }

  function subjectActionFor(shotType, beat, stage, ctx) {
    var entity = firstEntityIn(beat.text, ctx.entities) || primaryEntity(ctx.entities);
    if (stage.kind === 'action') return titleCase(stage.text);
    if (shotType === 'a_roll') return 'Deliver this beat in one take, no cut mid-thought.';
    if (shotType === 'screen_recording') {
      return entity ? 'Record ' + entity + ' performing the described step.' : 'Record the described step on screen.';
    }
    if (shotType === 'insert') return 'Frame only the object or detail that matters.';
    return 'Show the idea in the real world while the line plays.';
  }

  function purposeFor(beat, stage, shotType) {
    if (stage.kind === 'reveal') return 'Land the reveal visually so the claim is believable.';
    if (stage.kind === 'action') return 'Show the step happening so the viewer can copy it.';
    switch (beat.role) {
      case 'misconception':
        return 'Name the belief the viewer already holds so they stay.';
      case 'problem':
        return 'Make the problem feel real before offering a fix.';
      case 'reframe':
        return 'Shift the viewer from the wrong frame to the right one.';
      case 'demo':
        return 'Prove the claim by showing it rather than describing it.';
      case 'proof':
        return 'Back the claim with visible evidence.';
      case 'payoff':
        return 'Pay off the promise made in the hook.';
      case 'cta':
        return 'Give one clear next step.';
      default:
        return shotType === 'a_roll'
          ? 'Carry the argument forward in the creator’s voice.'
          : 'Give the eye something that advances the idea.';
    }
  }

  /* ── 7. Review pass ─────────────────────────────────────────────────── */

  /**
   * Compares the finished plan against the whole script. Returns structured
   * issues; the planner repairs what it safely can and reports the rest.
   */
  function reviewPlan(shots, ctx) {
    var issues = [];
    var scriptText = ctx.scriptText || '';
    var sentences = splitSentences(scriptText);
    var covered = {};
    shots.forEach(function (s) {
      (s.scriptCoverage || []).forEach(function (c) {
        if (c && c.text) covered[clean(c.text).toLowerCase()] = true;
      });
    });

    var missing = sentences.filter(function (s) {
      return !covered[clean(s).toLowerCase()];
    });
    if (missing.length) {
      issues.push({
        code: 'coverage_gap',
        severity: 'high',
        detail: missing.length + ' script sentence(s) have no shot',
        items: missing.slice(0, 5)
      });
    }

    /* Over-splitting means shots were cut where nothing visual changed:
     * same setup as the shot before, and only a weak reason for the cut. */
    if (sentences.length > 2 && shots.length >= sentences.length) {
      var weakCuts = 0;
      for (var w = 1; w < shots.length; w++) {
        var s = shots[w];
        var prev = shots[w - 1];
        var weakReason = !s.boundaryReason || s.boundaryReason === 'pacing' || s.boundaryReason === 'narrative_shift';
        var sameSetup = s.shotType === prev.shotType && s.framing === prev.framing && s.stageCount === 1;
        if (weakReason && sameSetup) weakCuts += 1;
      }
      if (weakCuts > shots.length / 2) {
        issues.push({
          code: 'over_split',
          severity: 'high',
          detail: 'shot count tracks sentence count without a visual reason',
          weakCuts: weakCuts
        });
      }
    }

    shots.forEach(function (s) {
      if (s.durationSec > SHOT_LONG_SEC) {
        issues.push({
          code: 'under_split',
          severity: 'medium',
          detail: 'Shot ' + s.order + ' runs ' + s.durationSec + 's with no visual change',
          order: s.order
        });
      }
    });

    var run = 0;
    for (var i = 1; i < shots.length; i++) {
      if (shots[i].shotType === shots[i - 1].shotType && shots[i].framing === shots[i - 1].framing) {
        run += 1;
        if (run >= 3) {
          issues.push({
            code: 'repetition',
            severity: 'low',
            detail: 'four or more consecutive identical setups around shot ' + (shots[i].order)
          });
          run = 0;
        }
      } else {
        run = 0;
      }
    }

    var generic = shots.filter(function (s) {
      return /^(beat|shot|setup|section)\s*\d*$/i.test(clean(s.title));
    });
    if (generic.length) {
      issues.push({
        code: 'generic_titles',
        severity: 'high',
        detail: generic.length + ' shot title(s) describe nothing',
        items: generic.map(function (s) {
          return s.order;
        })
      });
    }

    var entity = primaryEntity(ctx.entities);
    if (entity) {
      var mentions = shots.filter(function (s) {
        return lower(s.title + ' ' + s.visual + ' ' + s.subjectAction).indexOf(entity.toLowerCase()) >= 0;
      }).length;
      if (!mentions) {
        issues.push({
          code: 'not_project_specific',
          severity: 'medium',
          detail: 'no shot references ' + entity + ' — plan may be generic'
        });
      }
    }

    var cap = ctx.kit || selectProductionKit(ctx, ctx.productionStyle || classifyProductionStyle(ctx));
    var inventory = cap.inventory || parseInventory(ctx.creator || {});
    shots.forEach(function (s) {
      var move = lower(s.cameraMovement);
      var travel = textNeedsTravel([s.cameraMovement, s.visual, s.subjectAction, s.title].join(' '));
      if (!cap.hasGimbal && /(orbit|dolly|crane|glide|smooth follow)/.test(move)) {
        issues.push({
          code: 'not_feasible',
          severity: 'medium',
          detail: 'Shot ' + s.order + ' needs support the creator has not listed',
          order: s.order
        });
      }
      if (looksLikeInventoryDump(s.gear, inventory)) {
        issues.push({
          code: 'excessive_gear',
          severity: 'high',
          detail: 'Shot ' + s.order + ' lists the creator inventory instead of a kit',
          order: s.order
        });
      }
      if (!travel && /gimbal|rs\s?\d|rs4|hohem|ronin/i.test(s.gear || '')) {
        issues.push({
          code: 'unjustified_gimbal',
          severity: 'high',
          detail: 'Shot ' + s.order + ' includes a gimbal with no travel in the shot',
          order: s.order
        });
      }
      var phonesHit = (inventory.phones || []).filter(function (c) {
        return c && lower(s.gear).indexOf(lower(c)) >= 0;
      }).length;
      var bodiesHit = (inventory.bodies || []).filter(function (c) {
        return c && lower(s.gear).indexOf(lower(c)) >= 0;
      }).length;
      if (phonesHit && bodiesHit) {
        issues.push({
          code: 'multi_camera_unjustified',
          severity: 'high',
          detail: 'Shot ' + s.order + ' names two cameras without a coverage reason',
          order: s.order
        });
      }
    });

    return issues;
  }

  /** Fixes what can be fixed without inventing content. */
  function repairPlan(shots, issues, ctx) {
    var out = shots.slice();
    var cap = ctx.kit || selectProductionKit(ctx, ctx.productionStyle || classifyProductionStyle(ctx));

    issues.forEach(function (issue) {
      if (issue.code === 'not_feasible' && issue.order) {
        out.forEach(function (s) {
          if (s.order === issue.order) {
            s.cameraMovement = cap.hasTripod ? 'Locked off on a tripod' : 'Handheld, keep it steady';
          }
        });
      }
      if (
        (issue.code === 'excessive_gear' ||
          issue.code === 'unjustified_gimbal' ||
          issue.code === 'multi_camera_unjustified') &&
        issue.order
      ) {
        out.forEach(function (s) {
          if (s.order === issue.order) fitShotEquipment(s, ctx);
        });
      }
      if (issue.code === 'generic_titles') {
        out.forEach(function (s) {
          if (/^(beat|shot|setup|section)\s*\d*$/i.test(clean(s.title))) {
            var key = keyPhrase(s.spoken || s.visual);
            s.title = key ? titleCase(key) : 'Shot ' + s.order + ' — describe this';
          }
        });
      }
      if (issue.code === 'repetition') {
        for (var i = 2; i < out.length; i++) {
          if (
            out[i].shotType === out[i - 1].shotType &&
            out[i].framing === out[i - 1].framing &&
            out[i].shotType === 'a_roll'
          ) {
            out[i].framing = out[i].framing.indexOf('Medium close-up') === 0 ? 'Medium shot' : 'Medium close-up';
          }
        }
      }
    });

    /* Merge an over-split plan: fold neighbours that share a beat and have no
     * visual reason to be separate. */
    if (
      issues.some(function (i) {
        return i.code === 'over_split';
      })
    ) {
      var merged = [];
      out.forEach(function (s) {
        var last = merged[merged.length - 1];
        var mergeable =
          last &&
          last.beatId === s.beatId &&
          last.shotType === s.shotType &&
          s.stageCount === 1 &&
          last.durationSec + s.durationSec <= BEAT_SOFT_MAX_SEC;
        if (mergeable) {
          last.durationSec = Math.min(MAX_SHOT_SEC, last.durationSec + s.durationSec);
          last.spoken = clean(last.spoken + ' ' + s.spoken);
          last.scriptCoverage = (last.scriptCoverage || []).concat(s.scriptCoverage || []);
          return;
        }
        merged.push(s);
      });
      out = merged;
    }

    /* Two shots with the same title are unreadable on a call sheet. */
    var titleSeen = {};
    out.forEach(function (s) {
      var key = lower(s.title);
      if (!titleSeen[key]) {
        titleSeen[key] = 1;
        return;
      }
      titleSeen[key] += 1;
      s.title = s.title + ' — ' + snippet(s.spoken || s.visual, 4);
    });

    out.forEach(function (s, i) {
      s.order = i + 1;
    });
    return out;
  }

  /* ── 8. Public entry point ──────────────────────────────────────────── */

  function buildContext(input) {
    input = input || {};
    var script = input.script || {};
    var scriptText = str(input.scriptText || script.body || '');
    var ctx = {
      production: input.production || {},
      project: input.project || {},
      assets: input.assets || [],
      creator: input.creator || {},
      scriptText: scriptText,
      constraints: input.constraints || {}
    };
    ctx.entities = detectEntities(ctx);
    ctx.audienceNoun = detectAudienceNoun(ctx);
    ctx.contentType = input.contentType || classifyContentType(ctx);
    return ctx;
  }

  /**
   * @param {object} input
   *   script: { body, lines }
   *   scriptBeats: output of separateScriptFromProduction (optional)
   *   production, project, assets, creator
   * @returns {{ok:boolean, shots:Array, beats:Array, review:Array, contentType:string, subject:string}}
   */
  function plan(input) {
    input = input || {};
    var ctx = buildContext(input);
    if (!clean(ctx.scriptText)) {
      return { ok: false, error: 'no_script', shots: [], beats: [], review: [], contentType: ctx.contentType, subject: '' };
    }

    var units = parseUnits({
      body: ctx.scriptText,
      lines: (input.script && input.script.lines) || [],
      scriptBeats: input.scriptBeats || null
    });
    if (!units.length) {
      return { ok: false, error: 'no_units', shots: [], beats: [], review: [], contentType: ctx.contentType, subject: '' };
    }

    units.forEach(function (u, i) {
      var r = roleFor(u, i, units.length, ctx);
      u.role = r.role;
      u.roleExplicit = r.explicit;
    });

    var beats = groupBeats(units, ctx);
    ctx.productionStyle = classifyProductionStyle(ctx);
    ctx.kit = selectProductionKit(ctx, ctx.productionStyle);
    var shots = planShots(beats, ctx);
    var review = reviewPlan(shots, ctx);
    shots = repairPlan(shots, review, ctx);
    shots.forEach(function (s) {
      fitShotEquipment(s, ctx);
    });
    /* Second pass so the report reflects the repaired plan. */
    var finalReview = reviewPlan(shots, ctx);

    return {
      ok: true,
      shots: shots,
      beats: beats.map(function (b) {
        return { id: b.id, role: b.role, section: b.section, text: b.text, reason: b.reason, seconds: b.seconds };
      }),
      review: finalReview,
      contentType: ctx.contentType,
      productionStyle: ctx.productionStyle,
      kit: {
        camera: ctx.kit.camera,
        lens: ctx.kit.lens,
        support: ctx.kit.defaultSupport,
        sophistication: ctx.productionStyle.sophistication,
        style: ctx.productionStyle.style
      },
      subject: primaryEntity(ctx.entities),
      audience: ctx.audienceNoun,
      stages: [
        'Understanding this production',
        'Reading the full script',
        'Mapping narrative beats',
        'Planning visual coverage',
        'Selecting the minimum kit',
        'Checking shot continuity',
        'Finalising the shot list'
      ]
    };
  }

  global.PreShootShotPlanner = {
    plan: plan,
    /* Exposed for tests and for the Director validation path. */
    splitSentences: splitSentences,
    parseUnits: parseUnits,
    groupBeats: groupBeats,
    reviewPlan: reviewPlan,
    buildContext: buildContext,
    detectEntities: detectEntities,
    classifyContentType: classifyContentType,
    keyPhrase: keyPhrase,
    durationFor: durationFor,
    visualStages: visualStages,
    splitActionClauses: splitActionClauses,
    parseInventory: parseInventory,
    classifyProductionStyle: classifyProductionStyle,
    selectProductionKit: selectProductionKit,
    fitShotEquipment: fitShotEquipment,
    formatKitLabel: formatKitLabel,
    looksLikeInventoryDump: looksLikeInventoryDump,
    TYPE_LABEL: TYPE_LABEL,
    WORDS_PER_SEC: WORDS_PER_SEC
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
