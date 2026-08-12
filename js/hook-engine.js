/**
 * PreShoot Hook Engine
 * Reusable, context-aware hook frameworks for scans + Director.
 * Frameworks are templates — the model fills X/Y/Z from scene + profile.
 * Does NOT hardcode finished hooks.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'scout_hook_frameworks_used';
  var SESSION_MAX = 48;

  /** @type {{id:string,name:string,trigger:string,template:string,formats?:string[]}[]} */
  var FRAMEWORKS = [
    { id: 'contradiction', name: 'Contradiction', trigger: 'Contradiction', template: 'Everyone tells you X, but nobody tells you Y.' },
    { id: 'honest_truth', name: 'Honest Truth', trigger: 'Curiosity', template: 'Let’s come clean about the reality of X.' },
    { id: 'social_realization', name: 'Social Realization', trigger: 'Social Proof', template: 'People are beginning to realize X.' },
    { id: 'stop_doing', name: 'Stop Doing This', trigger: 'Challenge', template: 'Stop doing X. Do Y instead.' },
    { id: 'testing', name: 'Testing', trigger: 'Authority', template: 'I tested X so you don’t have to.' },
    { id: 'secret', name: 'Secret', trigger: 'Curiosity', template: 'Nobody tells you this about X.' },
    { id: 'possibility', name: 'Possibility', trigger: 'Open Loop', template: 'Is it possible for X to achieve Y?' },
    { id: 'transformation', name: 'Transformation', trigger: 'Suspense', template: 'Can I completely change my life using X?' },
    { id: 'money', name: 'Money', trigger: 'FOMO', template: 'Can I make [goal amount] using X?' },
    { id: 'shock', name: 'Shock', trigger: 'Surprise', template: 'X quietly killed Y last year.' },
    { id: 'nobody_talks', name: 'Nobody Talks', trigger: 'Novelty', template: 'Nobody talks about X like this.' },
    { id: 'wish_knew', name: 'Wish I Knew', trigger: 'Regret', template: 'I wish I knew X before I started.' },
    { id: 'biggest_lie', name: 'Biggest Lie', trigger: 'Controversy', template: 'The biggest lie about X.' },
    { id: 'mistake', name: 'Mistake', trigger: 'Challenge', template: 'You’re making this X mistake.' },
    { id: 'from_zero', name: 'From Zero', trigger: 'Authority', template: 'If I had to start X from zero, here’s what I’d do.' },
    { id: 'everything_changed', name: 'Everything Changed', trigger: 'Transformation', template: 'Everything changed when I realized X.' },
    { id: 'spent_y', name: 'Spent Y', trigger: 'Social Proof', template: 'I spent Y on X. Here’s what happened.' },
    { id: 'truth_admit', name: 'Uncomfortable Truth', trigger: 'Curiosity', template: 'The truth about X nobody wants to admit.' },
    { id: 'ninety_nine', name: '99 Percent', trigger: 'Controversy', template: '99% of people get X wrong.' },
    { id: 'feels_illegal', name: 'Feels Illegal', trigger: 'Novelty', template: 'This simple X trick feels illegal.' },
    { id: 'fastest_way', name: 'Fastest Way', trigger: 'FOMO', template: 'The fastest way to improve X.' },
    { id: 'why_not_working', name: 'Why Not Working', trigger: 'Open Loop', template: 'Here’s why your X isn’t working.' },
    { id: 'copied_top', name: 'Copied Top 1%', trigger: 'Authority', template: 'I copied the top 1% at X.' },
    { id: 'hidden_psych', name: 'Hidden Psychology', trigger: 'Curiosity', template: 'The hidden psychology behind X.' },
    { id: 'suddenly_talking', name: 'Suddenly Talking', trigger: 'FOMO', template: 'Why everyone is suddenly talking about X.' },
    { id: 'need_this', name: 'Need This', trigger: 'Contradiction', template: 'You don’t need more X. You need this.' },
    { id: 'changed_forever', name: 'Changed Forever', trigger: 'Transformation', template: 'This changed how I think about X forever.' },
    { id: 'never_do', name: 'Never Do', trigger: 'Tension', template: 'The one thing I’d never do with X.' },
    { id: 'every_mistake', name: 'Every Mistake', trigger: 'Curiosity', template: 'I made every X mistake possible.' },
    { id: 'before_buy', name: 'Before You Buy', trigger: 'FOMO', template: 'Before you buy X, watch this.', formats: ['advert', 'review', 'ugc'] },
    { id: 'dont_start', name: 'Don’t Start', trigger: 'Suspense', template: 'Don’t start X until you know this.' },
    { id: 'better_way', name: 'Better Way', trigger: 'Novelty', template: 'I found a better way to X.' },
    { id: 'cant_believe', name: 'Can’t Believe', trigger: 'Surprise', template: 'I can’t believe this X actually works.' },
    { id: 'why_stuck', name: 'Why Stuck', trigger: 'Open Loop', template: 'This is why you’re stuck at X.' },
    { id: 'ten_minutes', name: 'Ten Minutes', trigger: 'Challenge', template: 'You only need 10 minutes to improve X.' },
    { id: 'shortcut', name: 'Shortcut', trigger: 'FOMO', template: 'Here’s the shortcut everyone misses about X.' },
    { id: 'if_serious', name: 'If Serious', trigger: 'Challenge', template: 'If you’re serious about X, watch this.' },
    { id: 'uncomfortable', name: 'Uncomfortable', trigger: 'Controversy', template: 'The uncomfortable truth about X.' },
    { id: 'ignored_advice', name: 'Ignored Advice', trigger: 'Suspense', template: 'I ignored this advice about X. Big mistake.' },
    { id: 'stand_out', name: 'Stand Out', trigger: 'Novelty', template: 'The easiest way to stand out with X.' },
    { id: 'they_wrong', name: 'They Were Wrong', trigger: 'Contradiction', template: 'Everyone told me X. They were wrong.' },
    { id: 'wish_warned', name: 'Wish Warned', trigger: 'Tension', template: 'I wish someone warned me about X.' },
    { id: 'reason_failing', name: 'Reason Failing', trigger: 'Open Loop', template: 'The reason you’re failing at X.' },
    { id: 'how_achieved', name: 'How I Achieved', trigger: 'Authority', template: 'How I achieved Y using X.' },
    { id: 'smart_struggle', name: 'Smart Struggle', trigger: 'Curiosity', template: 'Why smart people struggle with X.' },
    { id: 'master_faster', name: 'Master Faster', trigger: 'FOMO', template: 'You can master X faster than you think.' },
    { id: 'exact_system', name: 'Exact System', trigger: 'Authority', template: 'Here’s the exact system I use for X.' },
    { id: 'one_habit', name: 'One Habit', trigger: 'Transformation', template: 'This one habit transformed my X.' },
    { id: 'every_day', name: 'Every Day', trigger: 'Social Proof', template: 'I tried X every day for Y.' },
    { id: 'skeptical', name: 'Skeptical', trigger: 'Suspense', template: 'I was skeptical about X until this happened.' },
    { id: 'easiest_win', name: 'Easiest Win', trigger: 'FOMO', template: 'The easiest win you’re ignoring in X.' },
    { id: 'your_sign', name: 'Your Sign', trigger: 'Challenge', template: 'This is your sign to start X.' },
    { id: 'no_talent', name: 'No Talent', trigger: 'Contradiction', template: 'You don’t need talent to succeed at X.' },
    { id: 'brutal_reality', name: 'Brutal Reality', trigger: 'Controversy', template: 'The brutal reality of X.' },
    { id: 'sounds_fake', name: 'Sounds Fake', trigger: 'Surprise', template: 'This sounds fake, but X works.' },
    { id: 'biggest_opp', name: 'Biggest Opportunity', trigger: 'FOMO', template: 'The biggest opportunity in X right now.' },
    { id: 'why_quit', name: 'Why I Quit', trigger: 'Curiosity', template: 'Why I quit doing X.' },
    { id: 'one_thing', name: 'One Thing', trigger: 'Authority', template: 'If you only learn one thing about X, make it this.' },
    { id: 'framework_easy', name: 'Framework', trigger: 'Novelty', template: 'The framework that made X easy.' },
    { id: 'hack_hours', name: 'Hack Hours', trigger: 'FOMO', template: 'This X hack saves hours.' },
    { id: 'wish_understood', name: 'Wish Understood', trigger: 'Curiosity', template: 'I wish everyone understood X.' },
    { id: 'beginners_beat', name: 'Beginners Beat', trigger: 'Surprise', template: 'Here’s how beginners beat experts at X.' },
    { id: 'missing_piece', name: 'Missing Piece', trigger: 'Open Loop', template: 'I found the missing piece of X.' },
    { id: 'overcomplicating', name: 'Overcomplicating', trigger: 'Challenge', template: 'You’re overcomplicating X.' },
    { id: 'easiest_better', name: 'Easiest Better', trigger: 'Authority', template: 'The easiest way to get better at X.' },
    { id: 'nobody_expects', name: 'Nobody Expects', trigger: 'Surprise', template: 'Nobody expects this from X.' },
    { id: 'changed_everything', name: 'Changed Everything', trigger: 'Transformation', template: 'This changed everything I knew about X.' },
    { id: 'why_hard', name: 'Why Hard', trigger: 'Curiosity', template: 'The real reason X feels so hard.' },
    { id: 'lost_everything', name: 'Lost Everything', trigger: 'Tension', template: 'If I lost everything, I’d use X to recover.' },
    { id: 'mistake_keeping', name: 'Mistake Keeping', trigger: 'Open Loop', template: 'The mistake keeping you from Y using X.' },
    { id: 'success_looks', name: 'Success Looks', trigger: 'Social Proof', template: 'This is what success with X actually looks like.' },
    { id: 'regret_sooner', name: 'Regret Sooner', trigger: 'FOMO', template: 'I regret not learning X sooner.' },
    { id: 'dont_believe', name: 'Don’t Believe', trigger: 'Controversy', template: 'Don’t believe everything you hear about X.' },
    { id: 'secret_consistent', name: 'Secret Consistent', trigger: 'Curiosity', template: 'The secret behind consistent X.' },
    { id: 'one_decision', name: 'One Decision', trigger: 'Transformation', template: 'This one decision doubled my X.' },
    { id: 'what_happens', name: 'What Happens', trigger: 'Suspense', template: 'What happens if you do X for Y days?' },
    { id: 'outdated', name: 'Outdated', trigger: 'Contradiction', template: 'Most advice about X is outdated.' },
    { id: 'challenged', name: 'Challenged', trigger: 'Challenge', template: 'I challenged myself to X.' },
    { id: 'blueprint', name: 'Blueprint', trigger: 'Authority', template: 'The blueprint for mastering X.' },
    { id: 'closer_than', name: 'Closer Than', trigger: 'FOMO', template: 'You’re closer to Y than you think.' },
    { id: 'hidden_cost', name: 'Hidden Cost', trigger: 'Tension', template: 'The hidden cost of ignoring X.' },
    { id: 'compared', name: 'Compared', trigger: 'Curiosity', template: 'I compared X vs Y. Here’s the winner.', formats: ['comparison', 'review', 'educational'] },
    { id: 'finally_understand', name: 'Finally Understand', trigger: 'Transformation', template: 'I finally understand why X works.' },
    { id: 'avoid_mistakes', name: 'Avoid Mistakes', trigger: 'Authority', template: 'The easiest way to avoid X mistakes.' },
    { id: 'experts_wont', name: 'Experts Won’t', trigger: 'Controversy', template: 'This is what experts won’t tell you about X.' },
    { id: 'almost_gave_up', name: 'Almost Gave Up', trigger: 'Suspense', template: 'I almost gave up on X.' },
    { id: 'stopped_x', name: 'Stopped X', trigger: 'Curiosity', template: 'Here’s what happened after I stopped X.' },
    { id: 'one_lesson', name: 'One Lesson', trigger: 'Transformation', template: 'One lesson from X changed my life.' },
    { id: 'future_of', name: 'Future Of', trigger: 'FOMO', template: 'This is the future of X.' },
    { id: 'incomplete', name: 'Incomplete', trigger: 'Contradiction', template: 'Everything you’ve heard about X is incomplete.' },
    { id: 'smartest_way', name: 'Smartest Way', trigger: 'Authority', template: 'The smartest way to approach X.' },
    { id: 'wish_existed', name: 'Wish Existed', trigger: 'Novelty', template: 'I wish this X strategy existed years ago.' },
    { id: 'cheat_code', name: 'Cheat Code', trigger: 'FOMO', template: 'Here’s the cheat code for X.' },
    { id: 'learn_today', name: 'Learn Today', trigger: 'Authority', template: 'This is exactly how I’d learn X today.' },
    { id: 'completely_wrong', name: 'Completely Wrong', trigger: 'Surprise', template: 'I was completely wrong about X.' },
    { id: 'biggest_myth', name: 'Biggest Myth', trigger: 'Controversy', template: 'The biggest myth stopping people from X.' },
    { id: 'care_about_y', name: 'Care About Y', trigger: 'Open Loop', template: 'If you care about Y, start with X.' },
    { id: 'x_beats', name: 'X Beats', trigger: 'Challenge', template: 'This is why X beats everything else.' },
    { id: 'surprising_benefit', name: 'Surprising Benefit', trigger: 'Novelty', template: 'The surprising benefit of X.' },
    { id: 'watch_try', name: 'Watch Try', trigger: 'Suspense', template: 'Watch what happens when you try X.' },
    { id: 'only_guide', name: 'Only Guide', trigger: 'Authority', template: 'The only guide you’ll need for X.' },
    { id: 'wont_believe', name: 'Won’t Believe', trigger: 'Surprise', template: 'You won’t believe what X revealed.' },
    { id: 'three_steps', name: 'Three Steps', trigger: 'Novelty', template: 'I simplified X into three steps.' },
    { id: 'one_change', name: 'One Change', trigger: 'Transformation', template: 'This one change made X effortless.' },
    { id: 'best_investment', name: 'Best Investment', trigger: 'FOMO', template: 'The best investment you can make is X.' },
    { id: 'playbook', name: 'Playbook', trigger: 'Authority', template: 'Here’s the playbook for X.' },
    { id: 'steal_strategy', name: 'Steal Strategy', trigger: 'FOMO', template: 'Steal this X strategy before everyone else does.' }
  ];

  var PLATFORM_STYLE = {
    tiktok: 'Punchy, spoken-first, pattern interrupt in under 1.5s. Casual, scroll-stopping.',
    instagram: 'Visually implied curiosity + clean spoken hook. Aesthetic but specific.',
    'youtube shorts': 'Story spark + payoff tease. Clear who/what in first line.',
    youtube: 'Strong promise + specificity. Can be slightly longer.',
    facebook: 'Relatable, conversational, share-bait without cheap clickbait.',
    linkedin: 'Authority + insight. Professional tone, still curiosity-led.',
    threads: 'Opinionated, conversational, debate-friendly.',
    pinterest: 'Outcome-led, aspirational, clear benefit.'
  };

  var FORMAT_STYLE = {
    advert: 'Desire + tension before CTA. Never open with a hard sell.',
    ugc: 'First-person, raw, like a real person interrupting your feed.',
    educational: 'Promise a concrete outcome or mistake avoided.',
    storytelling: 'Open loop / incomplete story that demands the next beat.',
    viral: 'Maximum curiosity gap, surprise, or contradiction.',
    meme: 'Self-aware, relatable, punchline setup — still specific to the subject.',
    trialreel: 'Live test framing: “I tried / I tested / watch what happens”.',
    review: 'Before you decide / I compared / the truth after using X.',
    launch: 'FOMO + novelty without empty hype.',
    other: 'Match the creator’s custom format while staying curiosity-first.'
  };

  function loadUsed() {
    try {
      var raw = global.localStorage && localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-SESSION_MAX) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsed(arr) {
    try {
      if (global.localStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-SESSION_MAX)));
    } catch (e) {}
  }

  function markUsed(ids) {
    var used = loadUsed();
    (ids || []).forEach(function (id) {
      if (id && used.indexOf(id) === -1) used.push(id);
    });
    saveUsed(used);
    if (global.PreShootAnalytics && ids && ids.length) {
      var unique = [];
      ids.forEach(function (id) {
        if (id && unique.indexOf(id) === -1) unique.push(id);
      });
      unique.slice(0, 6).forEach(function (id) {
        PreShootAnalytics.track(
          'hook_structure_used',
          {
            hook_structure: String(id).slice(0, 40),
            platform: String((global.S && S.niche && S.niche.platform) || '').slice(0, 40),
            content_type: String((global.S && S.selectedFormat) || '').slice(0, 40)
          },
          { dedupeKey: 'hook:' + id }
        );
      });
    }
    return used;
  }

  function byFormat(format) {
    var f = (format || '').toLowerCase();
    return FRAMEWORKS.filter(function (fw) {
      if (!fw.formats || !fw.formats.length) return true;
      return fw.formats.indexOf(f) !== -1;
    });
  }

  /** Pick N diverse frameworks, prioritizing unused ones this session. */
  function pickBatchFrameworks(n, format) {
    n = n || 6;
    var pool = byFormat(format).slice();
    var used = loadUsed();
    var fresh = pool.filter(function (fw) { return used.indexOf(fw.id) === -1; });
    var stale = pool.filter(function (fw) { return used.indexOf(fw.id) !== -1; });
    // shuffle helpers
    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    shuffle(fresh);
    shuffle(stale);
    var picked = fresh.concat(stale).slice(0, n);
    // if still short, wrap
    while (picked.length < n && pool.length) {
      picked.push(pool[picked.length % pool.length]);
    }
    return picked;
  }

  function platformHint(platform) {
    var key = String(platform || '').toLowerCase();
    if (PLATFORM_STYLE[key]) return PLATFORM_STYLE[key];
    if (key.indexOf('tiktok') >= 0) return PLATFORM_STYLE.tiktok;
    if (key.indexOf('instagram') >= 0 || key.indexOf('reels') >= 0) return PLATFORM_STYLE.instagram;
    if (key.indexOf('short') >= 0) return PLATFORM_STYLE['youtube shorts'];
    if (key.indexOf('youtube') >= 0) return PLATFORM_STYLE.youtube;
    if (key.indexOf('linkedin') >= 0) return PLATFORM_STYLE.linkedin;
    return 'Short-form scroll-stop: curiosity in the first sentence.';
  }

  function formatHint(format) {
    var key = String(format || 'viral').toLowerCase();
    return FORMAT_STYLE[key] || FORMAT_STYLE.viral;
  }

  /**
   * Build the scan-prompt HOOK ENGINE block.
   * @param {{platform?:string,format?:string,niche?:string,goals?:string,batchSize?:number}} ctx
   */
  function buildScanPromptSection(ctx) {
    ctx = ctx || {};
    var batch = pickBatchFrameworks(ctx.batchSize || 6, ctx.format);
    var lines = batch.map(function (fw, i) {
      return (i + 1) + ') [' + fw.id + '] ' + fw.name + ' (' + fw.trigger + '): "' + fw.template + '"';
    });

    return [
      'HOOK ENGINE (mandatory — PreShoot differentiator):',
      'People stop scrolling because the FIRST SENTENCE creates curiosity, not because of editing.',
      'Every idea MUST open with a powerful, custom-written hook that creates at least one of: curiosity, surprise, tension, controversy, FOMO, suspense, novelty, contradiction, challenge, open loop, social proof, authority.',
      'Treat frameworks as VARIABLE TEMPLATES. Replace X/Y/Z/[goal amount] using THIS photo, the business/subject, niche, audience, goals, and platform. Never paste templates literally. Never reuse generic AI filler like "Are you ready to..." or "In this video...".',
      'Platform hook style: ' + platformHint(ctx.platform),
      'Format hook style: ' + formatHint(ctx.format),
      ctx.niche ? ('Niche focus for X/Y: ' + ctx.niche) : '',
      ctx.goals ? ('Goal signal for money/outcome hooks: ' + ctx.goals) : '',
      'Assign each of the 6 ideas a DIFFERENT framework from this prioritized batch (rotation — avoid repeating openings):',
      lines.join('\n'),
      'For EACH idea return:',
      '- hook: Primary Hook (word-for-word spoken / on-screen first line, 3 seconds or less when possible)',
      '- altHooks: exactly 3 alternative hooks (different frameworks or angles, same subject)',
      '- hookFramework: framework id used for the primary hook',
      '- hookWhy: 1–2 concise sentences on the psychological trigger (curiosity gap, contradiction, etc.)',
      'QUALITY FILTER before you finalize each hook — if any answer is no, rewrite:',
      '1) Would this stop a scroll?',
      '2) Genuine curiosity (not vague hype)?',
      '3) Specific to the photo/subject (not generic)?',
      '4) Fits niche + format?',
      '5) Sounds human, not AI-generic?',
      '6) Can the video actually deliver the promise (no empty clickbait)?'
    ].filter(Boolean).join('\n');
  }

  function buildDirectorPromptSection() {
    return [
      'HOOK ENGINE RULES FOR DIRECTOR:',
      'When writing scripts, shotlists, adverts, UGC, educational, storytelling, reviews, launches, or regenerating ideas:',
      '- Always open with a strong primary hook, plus 3 alternatives when proposing ideas.',
      '- Build the ENTIRE script around the selected hook: setup → payoff must match the opening promise.',
      '- Prefer unused framework styles vs repeating the same opening pattern in one conversation.',
      '- Fill X/Y/Z from creator profile, scan context, niche, platform, and the active idea.',
      '- If the user provides a hook, lock it as primary and structure the piece around it.',
      '- Reject weak openings; rewrite until scroll-stopping and deliverable.'
    ].join('\n');
  }

  function ensureArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  }

  function normalizeIdea(idea) {
    if (!idea || typeof idea !== 'object') return idea;
    var primary = (idea.primaryHook || idea.hook || '').trim();
    var alts = ensureArray(idea.altHooks).map(function (h) { return String(h || '').trim(); }).filter(Boolean).slice(0, 3);
    while (alts.length < 3 && primary) {
      // leave short; UI handles missing slots — do not invent client-side copy
      break;
    }
    var idx = typeof idea.selectedHookIndex === 'number' ? idea.selectedHookIndex : 0;
    if (idx < 0) idx = 0;
    if (idx > alts.length) idx = 0;
    idea.primaryHook = primary;
    idea.altHooks = alts;
    idea.hookWhy = idea.hookWhy || idea.hookReason || '';
    idea.hookFramework = idea.hookFramework || '';
    idea.selectedHookIndex = idx;
    idea.hook = idx === 0 ? primary : (alts[idx - 1] || primary);
    return idea;
  }

  function normalizeIdeas(ideas) {
    var list = Array.isArray(ideas) ? ideas : [];
    var frameworks = [];
    list.forEach(function (idea) {
      normalizeIdea(idea);
      if (idea && idea.hookFramework) frameworks.push(idea.hookFramework);
    });
    if (frameworks.length) markUsed(frameworks);
    return list;
  }

  function selectHook(idea, index) {
    if (!idea) return null;
    normalizeIdea(idea);
    var idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    var max = 1 + (idea.altHooks ? idea.altHooks.length : 0);
    if (idx >= max) idx = 0;
    idea.selectedHookIndex = idx;
    idea.hook = idx === 0 ? idea.primaryHook : idea.altHooks[idx - 1];
    return idea.hook;
  }

  function allHooks(idea) {
    normalizeIdea(idea);
    return [idea.primaryHook].concat(idea.altHooks || []).filter(Boolean);
  }

  global.PreShootHooks = {
    FRAMEWORKS: FRAMEWORKS,
    buildScanPromptSection: buildScanPromptSection,
    buildDirectorPromptSection: buildDirectorPromptSection,
    pickBatchFrameworks: pickBatchFrameworks,
    normalizeIdea: normalizeIdea,
    normalizeIdeas: normalizeIdeas,
    selectHook: selectHook,
    allHooks: allHooks,
    markUsed: markUsed,
    platformHint: platformHint,
    formatHint: formatHint
  };
})(typeof window !== 'undefined' ? window : this);
