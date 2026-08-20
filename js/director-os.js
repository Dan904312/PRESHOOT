/**
 * Director OS — Jarvis foundation for PreShoot.
 * Studio = action-first command bar. Global chat remains conversation-first.
 * Tools are modular. Mutations always require confirmation.
 */
(function (global) {
  'use strict';

  var TOOLS = {};
  var memory = {
    turns: [],
    lastObject: null,
    lastAction: null,
    lastIntent: null,
    lastFocus: null,
    pendingClarify: null
  };

  var TITLE_SMALL = {
    a: 1,
    an: 1,
    the: 1,
    and: 1,
    or: 1,
    of: 1,
    for: 1,
    to: 1,
    in: 1,
    on: 1,
    at: 1,
    by: 1,
    with: 1,
    from: 1,
    vs: 1,
    via: 1,
    into: 1
  };

  function registerTool(tool) {
    if (!tool || !tool.id) return;
    TOOLS[tool.id] = {
      id: tool.id,
      name: tool.name || tool.id,
      description: tool.description || '',
      surfaces: tool.surfaces || ['*'],
      actions: tool.actions || {}
    };
  }

  function listTools(surface) {
    return Object.keys(TOOLS)
      .map(function (id) {
        return TOOLS[id];
      })
      .filter(function (t) {
        if (!surface || surface === '*') return true;
        return (t.surfaces || ['*']).indexOf('*') >= 0 || (t.surfaces || []).indexOf(surface) >= 0;
      });
  }

  function getActionMeta(actionId) {
    var meta = null;
    Object.keys(TOOLS).forEach(function (tid) {
      var a = TOOLS[tid].actions[actionId];
      if (a) meta = a;
    });
    return meta;
  }

  function getSurface() {
    var S = global.S || {};
    if (S.tab === 'studio' || (S.studioView && S.studioView.mode)) {
      if (S.studioView && S.studioView.mode === 'production') return 'production';
      if (S.studioView && S.studioView.mode === 'project') return 'project';
      return 'studio';
    }
    if (S.activeProductionId) return 'production';
    if (S.tab === 'library') return 'library';
    if (S.tab === 'menu') return 'menu';
    if (S.tab === 'profile') return 'profile';
    if (S.tab === 'director') return S.activeProductionId ? 'production' : 'home';
    return S.tab || 'home';
  }

  function surfaceGuidance(surface) {
    var map = {
      home: 'Help the user decide what to create or continue next.',
      studio:
        'Studio list. Hierarchy: Workspace → Projects → Productions. Projects are campaign containers. Productions are individual content pieces.',
      project:
        'Inside a Project (campaign container). Prefer organising or creating Productions. Do not confuse Project with Production.',
      production:
        'Inside a Production workspace (a specific content piece with shot list, script, gear, references, status). Prefer production-scoped actions.',
      library: 'Help find scans and send ideas into Studio.',
      menu: 'Help with preferences and settings.',
      profile: 'Help with identity and plan context.'
    };
    return map[surface] || 'Adapt to the current PreShoot surface.';
  }

  function locationLabel(ctx) {
    if (!ctx) return 'Unknown';
    if (ctx.mode === 'production' && ctx.production) {
      return (
        'Production · ' +
        ctx.production.name +
        (ctx.section ? ' / ' + ctx.section : '') +
        (ctx.project ? ' (in project ' + ctx.project.name + ')' : '')
      );
    }
    if (ctx.mode === 'project' && ctx.project) {
      return 'Project · ' + ctx.project.name;
    }
    if (ctx.surface === 'studio') return 'Studio · Projects list';
    return 'PreShoot · ' + (ctx.surface || 'home');
  }

  function gatherContext() {
    var S = global.S || {};
    var Studio = global.PreShootStudio;
    var view = S.studioView || {};
    var surface = getSurface();
    var ctx = {
      surface: surface,
      section: view.section || null,
      mode: view.mode || null,
      page: S.tab || 'home',
      productionId: view.productionId || S.activeProductionId || null,
      projectId: view.projectId || null,
      skillLevel: null,
      platform: null,
      gear: S.gear || null,
      niche: S.niche || null,
      editingSoftware: (S.gear && S.gear.editingSoftware) || null,
      project: null,
      production: null,
      overview: null,
      shotList: [],
      script: null,
      hook: null,
      references: null,
      assets: [],
      status: null,
      hierarchy: 'Workspace → Projects → Productions → Shots/Scripts/Assets',
      availableActions: [],
      focus: null,
      location: null,
      memory: {
        lastObject: memory.lastObject,
        lastAction: memory.lastAction,
        lastIntent: memory.lastIntent,
        lastFocus: memory.lastFocus
      }
    };

    if (Studio && Studio.getSkillLevel) ctx.skillLevel = Studio.getSkillLevel();
    if (S.platformFocus)
      ctx.platform = S.platformFocus.primaryPlatform || (S.platformFocus.platforms || [])[0];

    if (Studio && ctx.productionId) {
      var found = Studio.findProduction(ctx.productionId);
      if (found) {
        ctx.projectId = found.project.id;
        ctx.project = { id: found.project.id, name: found.project.name };
        var prod = Studio.ensureWorkspace ? Studio.ensureWorkspace(found.production) : found.production;
        ctx.production = {
          id: prod.id,
          name: prod.name,
          status: prod.status,
          progress: prod.progress,
          notes: prod.notes
        };
        ctx.status = prod.status;
        ctx.overview = (prod.workspace && prod.workspace.overview) || {};
        ctx.shotList = (prod.workspace && prod.workspace.shotList) || [];
        ctx.script = (prod.workspace && prod.workspace.script) || {};
        ctx.references = (prod.workspace && prod.workspace.references) || {};
        ctx.assets = (prod.workspace && prod.workspace.assets) || [];
        if (prod.ideaSnapshot && prod.ideaSnapshot.hook) ctx.hook = prod.ideaSnapshot.hook;
        if (!ctx.platform && ctx.overview.platform) ctx.platform = ctx.overview.platform;
        ctx.focus = {
          type: 'production',
          id: prod.id,
          name: prod.name,
          parentProjectId: found.project.id,
          parentProjectName: found.project.name
        };
      }
    } else if (Studio && ctx.projectId) {
      var p = Studio.findProject(ctx.projectId);
      if (p) {
        ctx.project = { id: p.id, name: p.name };
        ctx.focus = { type: 'project', id: p.id, name: p.name };
      }
    }

    ctx.location = locationLabel(ctx);
    if (ctx.mode === 'production') {
      ctx.availableActions = [
        'rename_production',
        'update_status',
        'move_production',
        'archive_production',
        'generate_sections',
        'improve_hook',
        'improve_script',
        'add_shot'
      ];
    } else if (ctx.mode === 'project') {
      ctx.availableActions = [
        'rename_project',
        'create_production',
        'archive_project',
        'duplicate_project'
      ];
    } else if (ctx.surface === 'studio') {
      ctx.availableActions = ['create_project', 'find_projects', 'organize_projects'];
    }

    return ctx;
  }

  function buildToolManifest(surface) {
    return listTools(surface).map(function (t) {
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        actions: Object.keys(t.actions || {}).map(function (aid) {
          var a = t.actions[aid];
          return { id: aid, label: a.label || aid, mutates: !!a.mutates, description: a.description || '' };
        })
      };
    });
  }

  function buildOSContext(opts) {
    opts = opts || {};
    var surface = opts.surface || getSurface();
    var live = gatherContext();
    var lines = [];
    lines.push('DIRECTOR OS');
    lines.push('Hierarchy: ' + live.hierarchy);
    lines.push('Surface: ' + surface);
    lines.push('Location: ' + (live.location || 'n/a'));
    lines.push('Section: ' + (live.section || 'n/a'));
    lines.push(surfaceGuidance(surface));
    lines.push('Be a creative assistant. Prefer precise actions over essays.');
    lines.push('Never confuse Project (campaign container) with Production (single content piece).');
    lines.push('All names must use professional Title Case.');
    lines.push('Mutations require user Confirm / Go in the app UI.');
    if (live.project) lines.push('Current Project: ' + live.project.name + ' (' + live.project.id + ')');
    if (live.production) {
      lines.push(
        'Current Production: ' +
          live.production.name +
          ' [' +
          live.production.status +
          '] id=' +
          live.production.id
      );
    }
    if (live.focus) {
      lines.push('Focus object: ' + live.focus.type + ' · ' + (live.focus.name || live.focus.id));
    }
    if (live.hook) lines.push('Hook: ' + live.hook);
    if (live.overview && live.overview.goal) lines.push('Goal: ' + live.overview.goal);
    if (live.shotList && live.shotList.length) lines.push('Shots: ' + live.shotList.length);
    if (live.script && ((live.script.lines && live.script.lines.length) || live.script.body)) {
      lines.push('Script present');
      var scriptText = '';
      try {
        scriptText = global.PreShootStudio
          ? global.PreShootStudio.getScriptPlainText({ script: live.script })
          : '';
      } catch (e) {
        scriptText = (live.script.body || '').slice(0, 1200);
      }
      if (scriptText) {
        lines.push('CURRENT_SCRIPT:\n' + String(scriptText).slice(0, 1800));
      }
    }
    lines.push('Script actions: update_script (modes: append|patch_hook|patch_ending|replace)');
    if (live.skillLevel) lines.push('Skill: ' + live.skillLevel);
    if (live.platform) lines.push('Platform: ' + live.platform);
    if (live.availableActions && live.availableActions.length) {
      lines.push('Available here: ' + live.availableActions.join(', '));
    }
    if (memory.lastObject) {
      lines.push(
        'Session focus: ' +
          memory.lastObject.type +
          ' · ' +
          (memory.lastObject.name || memory.lastObject.id || '')
      );
    }
    var manifest = buildToolManifest(surface);
    if (manifest.length) {
      lines.push('TOOLS:');
      manifest.forEach(function (t) {
        lines.push(
          '- ' +
            t.id +
            ': ' +
            (t.actions || [])
              .map(function (a) {
                return a.id + (a.mutates ? '*' : '');
              })
              .join(', ')
        );
      });
    }
    lines.push(
      'If proposing an action in chat mode, append: [[ACTION:{"tool":"...","action":"...","payload":{...}}]]'
    );
    return lines.join('\n');
  }

  function rememberTurn(entry) {
    memory.turns.push(Object.assign({ at: Date.now() }, entry || {}));
    if (memory.turns.length > 24) memory.turns = memory.turns.slice(-24);
    if (entry && entry.object) {
      memory.lastObject = entry.object;
      memory.lastFocus = entry.object;
    }
    if (entry && entry.action) memory.lastAction = entry.action;
    if (entry && entry.intent) memory.lastIntent = entry.intent;
  }

  function extractQuotedOrTail(text, words) {
    var raw = String(text || '').trim();
    var q = raw.match(/[“"]([^”"]+)[”"]/);
    if (q) return q[1].trim();
    var makeCalled = raw.match(
      /\bmake\s+(?:this|the|it)(?:\s+(?:project|production|video|reel|thing))?\s+(?:called|named)\s+(.+?)\s*$/i
    );
    if (makeCalled) return makeCalled[1].replace(/[?.!]+$/, '').trim();
    var call = raw.match(
      /\b(?:can we call|call(?:ed)?|rename|name)\s+(?:this|it|the\s+(?:project|production|campaign|title|video)?)\s+(?:to\s+|as\s+)?(.+?)\s*$/i
    );
    if (call) return call[1].replace(/[?.!]+$/, '').trim();
    var changeThis = raw.match(
      /\b(?:yo\s+)?(?:can you\s+)?(?:please\s+)?(?:change|set|update)\s+this(?:\s+thing)?(?:'?s?\s+name)?\s+(?:to|as)\s+(.+?)\s*$/i
    );
    if (changeThis) return changeThis[1].replace(/[?.!]+$/, '').trim();
    var changeTo = raw.match(
      /\b(?:change|set|update)\s+(?:the\s+)?(?:name|title|campaign(?:\s+name)?)\s+(?:to|as)\s+(.+?)\s*$/i
    );
    if (changeTo) return changeTo[1].replace(/[?.!]+$/, '').trim();
    var re = new RegExp('(?:' + words + ')\\s+[\'\"]?(.+?)[\'\"]?\\s*$', 'i');
    var m = raw.match(re);
    if (m) return m[1].replace(/[?.!]+$/, '').trim();
    var parts = raw.split(/\b(?:to|as|called|named)\b/i);
    if (parts.length > 1) return parts[parts.length - 1].replace(/[?.!]+$/, '').trim();
    return '';
  }

  function toTitleCase(str) {
    var raw = String(str || '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) return '';
    var words = raw.split(' ');
    return words
      .map(function (w, i) {
        if (!w) return w;
        /* Keep short ALL-CAPS brands (BMW, NYC, POV) */
        if (/^[A-Z0-9]{2,5}$/.test(w) && w === w.toUpperCase()) return w;
        var parts = w.split('-');
        return parts
          .map(function (part, pi) {
            var lower = part.toLowerCase();
            if (!lower) return part;
            if (i > 0 && i < words.length - 1 && pi === 0 && TITLE_SMALL[lower]) return lower;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
          })
          .join('-');
      })
      .join(' ');
  }

  function cleanNameSeed(name) {
    return String(name || '')
      .replace(/\b(sucks|bad|temp|test|untitled|this name|the name|rename|call this|something better|cleaner|professional)\b/gi, '')
      .replace(/\b(video\s*\d+|content|scan|draft|new project|new production)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortenName(name) {
    var n = toTitleCase(cleanNameSeed(name));
    if (!n) return 'Untitled';
    var words = n.split(/\s+/);
    if (words.length > 4) return words.slice(0, 4).join(' ');
    if (n.length > 32) return n.slice(0, 28).replace(/\s+\S*$/, '') || n.slice(0, 28);
    return n;
  }

  function suggestProfessionalName(base, kind, ctx) {
    ctx = ctx || {};
    kind = kind || 'production';
    var seed = cleanNameSeed(base);
    if (!seed && ctx.hook) seed = String(ctx.hook).split(/[.!?]/)[0];
    if (!seed && ctx.overview && ctx.overview.summary) seed = String(ctx.overview.summary).split(/[.!?]/)[0];
    if (!seed && ctx.production && ctx.production.name) seed = ctx.production.name;
    if (!seed && ctx.project && ctx.project.name) seed = ctx.project.name;
    seed = cleanNameSeed(seed);

    var niche = '';
    if (ctx.niche) {
      niche =
        ctx.niche.contentType ||
        ctx.niche.style ||
        (typeof ctx.niche.platform === 'string' ? '' : '') ||
        '';
    }
    var plat = ctx.platform ? String(ctx.platform).split(/[\s,&/]+/)[0] : '';

    if (!seed || seed.length < 2) {
      if (kind === 'project') seed = niche ? niche + ' Campaign' : 'Creative Campaign';
      else seed = niche ? niche + ' Reel' : 'Cinematic Reel';
    }

    var titled = toTitleCase(seed);
    var lower = titled.toLowerCase();

    /* Avoid generic leftovers */
    if (/^(videos?|content|scan|untitled|project|production)$/i.test(titled)) {
      titled = kind === 'project' ? 'Creative Campaign' : 'Signature Reel';
    }

    if (kind === 'project') {
      if (!/\b(campaign|series|brand|studio|launch|growth)\b/i.test(lower)) {
        if (/\b(cafe|coffee|restaurant|shop)\b/i.test(lower)) titled += ' Launch Campaign';
        else if (/\b(car|auto|bmw|porsche|mercedes|audi)\b/i.test(lower)) titled += ' Content Campaign';
        else titled += ' Campaign';
      }
    } else {
      if (!/\b(reel|video|film|spot|advert|ad|showcase|bts|behind|opening|launch)\b/i.test(lower)) {
        if (/\b(cafe|coffee|restaurant)\b/i.test(lower)) titled += ' Launch Reel';
        else if (/\b(product|bmw|porsche|car)\b/i.test(lower)) titled += ' Cinematic Showcase';
        else if (/\b(behind|bts)\b/i.test(lower)) titled += ' Production';
        else titled += ' Reel';
      }
    }

    titled = toTitleCase(titled.replace(/\s+/g, ' ').trim());
    /* Soft platform hint only when short */
    if (plat && titled.split(/\s+/).length < 3 && !new RegExp(plat, 'i').test(titled)) {
      titled = toTitleCase(titled + ' ' + plat);
    }
    return titled;
  }

  function improveName(name, ctx, kind) {
    return suggestProfessionalName(name, kind || 'production', ctx || {});
  }

  /**
   * Resolve whether the user means Project vs Production.
   * Returns { type, id, name } or { ambiguous: true, candidates: [...] }
   */
  function resolveFocusObject(ctx, text) {
    ctx = ctx || gatherContext();
    var lower = String(text || '').toLowerCase();
    var mentionsProject = /\b(project|campaign|folder|series)\b/.test(lower);
    var mentionsProduction = /\b(production|reel|video|piece|spot|advert|ad|film|title)\b/.test(lower);
    /* "campaign name" → project; bare "title" inside production → production */
    if (/\bcampaign\b/.test(lower)) mentionsProject = true;
    if (/\b(production name|reel name|video name|this reel|this video)\b/.test(lower)) {
      mentionsProduction = true;
      mentionsProject = false;
    }
    if (/\b(project name|campaign name|this project|this campaign)\b/.test(lower)) {
      mentionsProject = true;
      mentionsProduction = false;
    }

    var prodObj =
      ctx.productionId && ctx.production
        ? {
            type: 'production',
            id: ctx.productionId,
            name: ctx.production.name,
            parentProjectId: ctx.projectId,
            parentProjectName: ctx.project && ctx.project.name
          }
        : null;
    var projObj =
      ctx.projectId && ctx.project
        ? { type: 'project', id: ctx.projectId, name: ctx.project.name }
        : null;

    if (mentionsProject && !mentionsProduction && projObj) return projObj;
    if (mentionsProduction && !mentionsProject && prodObj) return prodObj;

    if (mentionsProject && mentionsProduction && projObj && prodObj) {
      return { ambiguous: true, candidates: [prodObj, projObj] };
    }

    /* Location wins for “this / title / rename” */
    if (ctx.mode === 'production' && prodObj) return prodObj;
    if (ctx.mode === 'project' && projObj) return projObj;

    if (memory.lastFocus && memory.lastFocus.type === 'production' && prodObj && memory.lastFocus.id === prodObj.id) {
      return prodObj;
    }
    if (memory.lastFocus && memory.lastFocus.type === 'project' && projObj && memory.lastFocus.id === projObj.id) {
      return projObj;
    }
    if (memory.lastObject && memory.lastObject.type === 'production' && prodObj) return prodObj;
    if (memory.lastObject && memory.lastObject.type === 'project' && projObj) return projObj;

    if (prodObj) return prodObj;
    if (projObj) return projObj;
    return null;
  }

  function classifyIntent(text, ctx) {
    var lower = String(text || '').toLowerCase().trim();
    if (!lower) return { kind: 'none', confidence: 0 };

    /* Follow-ups using memory */
    if (
      memory.lastObject &&
      /^(?:(?:actually|instead|wait|no,)\s+)?(?:make it|make this|call it|rename it|shorter|better|longer|cleaner|more professional)\b/i.test(
        lower
      )
    ) {
      if (/short/i.test(lower)) return { kind: 'improve', target: memory.lastObject.type, mode: 'shorter', confidence: 0.88 };
      if (/better|stronger|cinematic|fix|improve|sound|professional|cleaner/i.test(lower))
        return { kind: 'improve', target: memory.lastObject.type, mode: 'better', confidence: 0.86 };
      if (/call it|rename|name it/i.test(lower))
        return { kind: 'rename', confidence: 0.84, followUp: true };
    }

    if (
      /\b(find|show|get|give)\b.+\b(reference|references|youtube|capcut|cinematic example|template)\b/i.test(
        lower
      ) ||
      /\breferences?\s+(for|on)\s+this\b/i.test(lower) ||
      /\bwhat references\b|\breferences do i\b/i.test(lower)
    ) {
      if (/\bwhat references|do i (currently )?have|list\b/i.test(lower)) {
        return { kind: 'list_refs', confidence: 0.9 };
      }
      var plat = /\bcapcut\b/i.test(lower) ? 'capcut' : 'youtube';
      return { kind: 'find_refs', platform: plat, confidence: 0.9 };
    }

    if (
      /\b(add|save)\b.+\b(reference|youtube|video|this)\b/i.test(lower) ||
      /\badd this (youtube )?video\b/i.test(lower)
    ) {
      return { kind: 'add_ref', confidence: 0.85 };
    }

    if (/\b(remove|delete)\b.+\b(reference|that)\b/i.test(lower)) {
      return { kind: 'remove_ref', confidence: 0.85 };
    }

    if (/\b(why|how should|what.?s a better|explain|help me understand)\b/i.test(lower)) {
      /* Script edit verbs override pure Q&A */
      if (
        !/\b(finish|continue|rewrite|update|change|make|add|ending|hook|cta)\b/i.test(lower)
      ) {
        return { kind: 'explain', confidence: 0.8 };
      }
    }

    /* Script AI — must mutate editor state via update_script, never advice-only "Done" */
    if (
      /\b(finish|continue|complete)\b.+\b(script|this|it|what i)\b/i.test(lower) ||
      /\b(finish|continue|complete)\s+this\b/i.test(lower) ||
      /\byo\b.+\b(finish|continue)\b/i.test(lower) ||
      /\b(better|stronger)\s+ending\b|\badd (a )?(stronger )?ending\b|\bneeds? a better ending\b/i.test(
        lower
      ) ||
      /\brewrite\b.+\bscript\b|\breplace (the |this |our )?script\b|\b(modify|change|update|edit)\b.+\bscript\b/i.test(
        lower
      ) ||
      /\bmake (the )?hook stronger\b|\bstronger hook\b|\bless (scripted|robotic)\b|\bmore natural\b/i.test(
        lower
      ) ||
      /\bmake this\s+\d+\s*(sec|second|seconds)\b|\b30 seconds\b|\bstronger cta\b|\bgive me a (stronger )?cta\b/i.test(
        lower
      ) ||
      /\bcontinue from where\b|\bbased on what i('?ve| have) (already )?written\b/i.test(lower)
    ) {
      var scriptMode = 'append';
      if (
        /\brewrite\b.+\bscript\b|\breplace (the |this |our )?script\b|\bentire script\b|\bwhole script\b|\bfull script\b/i.test(
          lower
        )
      ) {
        scriptMode = 'replace';
      } else if (/\bhook\b/i.test(lower) && !/\bending\b|\bfinish\b|\bcontinue\b/i.test(lower)) {
        scriptMode = 'patch_hook';
      } else if (/\bending\b|\bcta\b|\bend\b/i.test(lower) && !/\bfinish\b|\bcontinue\b/i.test(lower)) {
        scriptMode = 'patch_ending';
      } else if (
        /\bless (scripted|robotic)\b|\bmore natural\b|\b\d+\s*sec/i.test(lower) ||
        /\b(modify|change|update|edit)\b.+\bscript\b/i.test(lower)
      ) {
        scriptMode = 'replace_soft'; /* confirm-gated rewrite preserving intent */
      }
      return { kind: 'script_ai', mode: scriptMode, confidence: 0.92 };
    }

    if (
      (ctx && ctx.section === 'script') &&
      /\b(finish|continue|complete|ending|rewrite|stronger|natural|robotic|seconds|cta|hook|script)\b/i.test(
        lower
      )
    ) {
      var sm = 'append';
      if (/\brewrite|replace|entire|whole\b/i.test(lower)) sm = 'replace';
      else if (/\bhook\b/i.test(lower)) sm = 'patch_hook';
      else if (/\bending\b|\bcta\b/i.test(lower)) sm = 'patch_ending';
      return { kind: 'script_ai', mode: sm, confidence: 0.88 };
    }

    if (
      /\b(rename|call (this|it)|change (the )?(name|title)|campaign name|project name|production name|name sucks|yo change|can we call|let'?s rename|call this something|something better|title cleaner|cleaner title)\b/i.test(
        lower
      ) ||
      /\b(this name sucks|make this sound better|make the title cleaner|change this campaign name)\b/i.test(lower) ||
      /\bmake (this|the) (project|production|video|reel|thing)?\s*(called|named)\b/i.test(lower) ||
      /\bchange this( thing)?('?s name)? to\b/i.test(lower) ||
      /\b(bro|yo|actually).{0,24}\b(change|rename|call)\b/i.test(lower)
    ) {
      return { kind: 'rename', confidence: 0.9 };
    }

    if (/\b(make this look more professional|more professional)\b/i.test(lower)) {
      /* Name polish when user is on project/production chrome; content polish in script/shots */
      if (ctx && (ctx.section === 'script' || ctx.section === 'shots')) {
        return { kind: 'improve', confidence: 0.8, mode: 'better' };
      }
      return { kind: 'rename', confidence: 0.82, mode: 'better' };
    }

    if (/\b(move|put this in|send (this )?to)\b/i.test(lower)) return { kind: 'move', confidence: 0.82 };
    if (/\b(archive)\b/i.test(lower)) return { kind: 'archive', confidence: 0.88 };
    if (/\b(delete|remove this production)\b/i.test(lower)) return { kind: 'delete', confidence: 0.85 };
    if (/\b(create|new)\b.+\bproject\b/i.test(lower)) return { kind: 'create_project', confidence: 0.84 };
    if (/\b(create|new)\b.+\bproduction\b/i.test(lower)) return { kind: 'create_production', confidence: 0.84 };

    if (
      /\b(redo|rebuild|regenerate|remake|refresh)\b.+\b(shot\s*list|shots|shotlist)\b/i.test(lower) ||
      /\b(shot\s*list|shots)\b.+\b(redo|rebuild|regenerate|remake|again)\b/i.test(lower) ||
      /\bnew shot list\b|\brebuild (the )?shots\b/i.test(lower)
    ) {
      return { kind: 'generate', target: 'shotlist', confidence: 0.92 };
    }

    if (
      /\b(generate|build|make|give me)\b.+\b(script|shot|hook|section|workspace)\b/i.test(lower) ||
      /\b(another|more|new)\b.+\b(shot|hook|line)\b/i.test(lower) ||
      /\badd (another |a )?(close-?up|shot|line)\b/i.test(lower)
    ) {
      return { kind: 'generate', confidence: 0.84 };
    }

    if (
      /\b(shorter|tighten|trim|improve|stronger|cinematic|better hook|fix (this|the)|i don'?t (really )?like|this sucks)\b/i.test(
        lower
      )
    ) {
      return { kind: 'improve', confidence: 0.83 };
    }

    if (/\b(find|open|show|search)\b/i.test(lower)) return { kind: 'search', confidence: 0.78 };
    if (/\b(status|ready to film|mark as|set to)\b/i.test(lower)) return { kind: 'status', confidence: 0.8 };
    if (/\b(organise|organize|what (should|next)|continue)\b/i.test(lower))
      return { kind: 'organise', confidence: 0.7 };

    /* Section-aware defaults */
    if (ctx.section === 'script' && /\b(short|long|better|rewrite)\b/i.test(lower)) {
      return { kind: 'improve', target: 'script', confidence: 0.75 };
    }
    if (ctx.section === 'shots' && /\b(add|another|close)\b/i.test(lower)) {
      return { kind: 'generate', target: 'shot', confidence: 0.78 };
    }
    if (ctx.section === 'overview' && /\b(hook)\b/i.test(lower)) {
      return { kind: 'improve', target: 'hook', confidence: 0.76 };
    }

    return { kind: 'explain', confidence: 0.55 };
  }

  function buildRenameProposal(focus, newName) {
    newName = toTitleCase(newName);
    if (focus.type === 'project') {
      return {
        kind: 'action',
        proposal: {
          tool: 'project',
          action: 'rename_project',
          payload: { projectId: focus.id, name: newName }
        },
        object: { type: 'project', id: focus.id, name: newName },
        confidence: 0.93
      };
    }
    return {
      kind: 'action',
      proposal: {
        tool: 'production',
        action: 'rename_production',
        payload: { productionId: focus.id, name: newName }
      },
      object: { type: 'production', id: focus.id, name: newName },
      confidence: 0.93
    };
  }

  function resolveIntent(message, opts) {
    opts = opts || {};
    var text = String(message || '').trim();
    var ctx = gatherContext();
    var classified = classifyIntent(text, ctx);
    var lower = text.toLowerCase();

    /* Ambiguous search hits */
    if (classified.kind === 'search' || /\b(find|open)\b/i.test(lower)) {
      var q = text
        .replace(/^(find|open|show|search for)\s+(my\s+)?/i, '')
        .replace(/\b(project|production|the)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (q && global.PreShootStudio && global.PreShootStudio.globalSearch) {
        var results = global.PreShootStudio.globalSearch(q);
        var prods = results.productions || [];
        var projects = results.projects || [];
        if (prods.length + projects.length > 1) {
          var options = [];
          prods.slice(0, 5).forEach(function (p) {
            options.push({
              label: 'Production · ' + p.name + (p.projectName ? ' · ' + p.projectName : ''),
              value: { type: 'production', id: p.id }
            });
          });
          projects.slice(0, 5).forEach(function (p) {
            options.push({ label: 'Project · ' + p.name, value: { type: 'project', id: p.id } });
          });
          return {
            kind: 'clarify',
            question: 'I found a few matches for “' + q + '”. Which one?',
            options: options,
            confidence: 0.9
          };
        }
        if (prods.length === 1) {
          return {
            kind: 'action',
            proposal: {
              tool: 'production',
              action: 'open_production',
              payload: { productionId: prods[0].id },
              mutates: false
            },
            confidence: 0.9
          };
        }
        if (projects.length === 1) {
          return {
            kind: 'navigate',
            target: { type: 'project', id: projects[0].id },
            confidence: 0.9
          };
        }
      }
    }

    if (classified.kind === 'rename') {
      var focus = resolveFocusObject(ctx, text);
      var newName = extractQuotedOrTail(text, 'to|as|called|named');
      var wantsSuggestion =
        !newName &&
        (/sucks|better|sound|fix|improve|don'?t like|change (this|it)|yo change|something better|cleaner|professional|look more/i.test(
          lower
        ) ||
          classified.followUp ||
          classified.mode === 'better' ||
          classified.mode === 'shorter');

      if (focus && focus.ambiguous && focus.candidates && focus.candidates.length) {
        if (!newName && wantsSuggestion) {
          newName = suggestProfessionalName(
            focus.candidates[0].name,
            focus.candidates[0].type,
            ctx
          );
        }
        if (!newName) {
          return {
            kind: 'clarify',
            question: 'Rename the project or the production? Then tell me the new name.',
            options: focus.candidates.map(function (c) {
              return {
                label: (c.type === 'project' ? 'Project · ' : 'Production · ') + c.name,
                value: {
                  type: 'rename_pick',
                  objectType: c.type,
                  id: c.id,
                  currentName: c.name
                }
              };
            }),
            freeText: false,
            confidence: 0.88
          };
        }
        return {
          kind: 'clarify',
          question: 'Rename which one to “' + toTitleCase(newName) + '”?',
          options: focus.candidates.map(function (c) {
            return {
              label: (c.type === 'project' ? 'Project · ' : 'Production · ') + c.name,
              value: {
                type: 'rename_target',
                objectType: c.type,
                id: c.id,
                name: toTitleCase(newName)
              }
            };
          }),
          confidence: 0.92
        };
      }

      if (!focus) {
        return {
          kind: 'clarify',
          question: 'Open a project or production first, then I can rename it.',
          options: [],
          confidence: 0.7
        };
      }

      var baseName = focus.name || '';
      if (wantsSuggestion) {
        if (classified.mode === 'shorter' || /short/i.test(lower)) {
          newName = shortenName(baseName);
        } else {
          newName = suggestProfessionalName(baseName, focus.type, ctx);
        }
      }

      if (!newName) {
        return {
          kind: 'clarify',
          question:
            'What should I rename this ' +
            (focus.type === 'project' ? 'project' : 'production') +
            ' to?',
          options: [],
          freeText: true,
          pending: { kind: 'rename', objectType: focus.type, id: focus.id },
          confidence: 0.75
        };
      }

      return buildRenameProposal(focus, newName);
    }

    if (classified.kind === 'archive' && ctx.productionId) {
      return {
        kind: 'action',
        proposal: {
          tool: 'production',
          action: 'archive_production',
          payload: { productionId: ctx.productionId }
        },
        object: { type: 'production', id: ctx.productionId, name: ctx.production && ctx.production.name },
        confidence: 0.9
      };
    }

    if (classified.kind === 'delete' && ctx.productionId) {
      return {
        kind: 'action',
        proposal: {
          tool: 'production',
          action: 'delete_production',
          payload: { productionId: ctx.productionId }
        },
        object: { type: 'production', id: ctx.productionId, name: ctx.production && ctx.production.name },
        confidence: 0.88
      };
    }

    if (classified.kind === 'move' && ctx.productionId && global.PreShootStudio) {
      var projects = global.PreShootStudio.listProjects().filter(function (p) {
        return p.id !== ctx.projectId;
      });
      if (!projects.length) {
        return { kind: 'reply', text: 'There isn’t another project to move this into yet.', confidence: 1 };
      }
      if (projects.length === 1) {
        return {
          kind: 'action',
          proposal: {
            tool: 'production',
            action: 'move_production',
            payload: { productionId: ctx.productionId, toProjectId: projects[0].id }
          },
          confidence: 0.9
        };
      }
      return {
        kind: 'clarify',
        question: 'Move this production into which project?',
        options: projects.slice(0, 6).map(function (p) {
          return {
            label: p.name,
            value: { type: 'move', productionId: ctx.productionId, toProjectId: p.id }
          };
        }),
        confidence: 0.9
      };
    }

    if (classified.kind === 'create_project') {
      var cn =
        toTitleCase(extractQuotedOrTail(text, 'called|named')) ||
        suggestProfessionalName('', 'project', ctx);
      return {
        kind: 'action',
        proposal: { tool: 'project', action: 'create_project', payload: { name: cn } },
        object: { type: 'project', name: cn },
        confidence: 0.86
      };
    }

    if (classified.kind === 'create_production' && ctx.projectId) {
      var cnp =
        toTitleCase(extractQuotedOrTail(text, 'called|named')) ||
        suggestProfessionalName('', 'production', ctx);
      return {
        kind: 'action',
        proposal: {
          tool: 'production',
          action: 'create_production',
          payload: { projectId: ctx.projectId, name: cnp }
        },
        object: { type: 'production', name: cnp },
        confidence: 0.86
      };
    }

    if (classified.kind === 'status' && ctx.productionId) {
      var status = null;
      if (/ready to film|ready\b/i.test(lower)) status = 'ready';
      else if (/filming/i.test(lower)) status = 'filming';
      else if (/editing/i.test(lower)) status = 'editing';
      else if (/ready to post/i.test(lower)) status = 'ready_to_post';
      else if (/posted/i.test(lower)) status = 'posted';
      else if (/planning/i.test(lower)) status = 'planning';
      if (status) {
        return {
          kind: 'action',
          proposal: {
            tool: 'production',
            action: 'update_status',
            payload: { productionId: ctx.productionId, status: status }
          },
          confidence: 0.88
        };
      }
    }

    if (classified.kind === 'list_refs') {
      if (!ctx.productionId) {
        return { kind: 'reply', text: 'Open a production first to see its references.', confidence: 1 };
      }
      return {
        kind: 'action',
        proposal: {
          tool: 'reference',
          action: 'list_references',
          payload: { productionId: ctx.productionId },
          mutates: false
        },
        confidence: 0.95
      };
    }

    if (classified.kind === 'find_refs') {
      if (!ctx.productionId) {
        return { kind: 'reply', text: 'Open a production first.', confidence: 1 };
      }
      return {
        kind: 'find_refs',
        platform: classified.platform || 'youtube',
        productionId: ctx.productionId,
        confidence: classified.confidence
      };
    }

    if (classified.kind === 'add_ref') {
      if (!ctx.productionId) {
        return { kind: 'reply', text: 'Open a production first.', confidence: 1 };
      }
      var urlMatch = text.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        return {
          kind: 'action',
          proposal: {
            tool: 'reference',
            action: 'add_reference',
            payload: {
              productionId: ctx.productionId,
              url: urlMatch[0],
              title: 'Saved reference',
              platform: /capcut/i.test(urlMatch[0])
                ? 'capcut'
                : /youtu/i.test(urlMatch[0])
                  ? 'youtube'
                  : 'other'
            }
          },
          confidence: 0.92
        };
      }
      return {
        kind: 'reply',
        text: 'Open Assets & Refs, tap Find, then Save on a result — or paste a YouTube/CapCut link.',
        confidence: 1
      };
    }

    if (classified.kind === 'remove_ref') {
      if (!ctx.productionId) {
        return { kind: 'reply', text: 'Open a production first.', confidence: 1 };
      }
      var refsList =
        global.PreShootStudio && global.PreShootStudio.listReferences
          ? global.PreShootStudio.listReferences(ctx.productionId)
          : [];
      if (!refsList.length) {
        return { kind: 'reply', text: 'There are no saved references to remove.', confidence: 1 };
      }
      if (refsList.length === 1) {
        return {
          kind: 'action',
          proposal: {
            tool: 'reference',
            action: 'remove_reference',
            payload: { productionId: ctx.productionId, refId: refsList[0].id }
          },
          confidence: 0.9
        };
      }
      return {
        kind: 'clarify',
        question: 'Remove which reference?',
        options: refsList.slice(0, 6).map(function (r) {
          return {
            label: (r.platform || 'ref') + ' · ' + (r.title || r.url || r.id),
            value: { type: 'remove_ref', productionId: ctx.productionId, refId: r.id }
          };
        }),
        confidence: 0.9
      };
    }

    if (classified.kind === 'generate' && ctx.productionId) {
      var target = classified.target || null;
      if (!target) {
        if (/\b(shot\s*list|shotlist)\b/i.test(lower) || /\b(redo|rebuild|regenerate)\b.+\bshots?\b/i.test(lower))
          target = 'shotlist';
        else if (/\bshot\b|close-?up/i.test(lower)) target = 'shot';
        else if (/\bhook\b/i.test(lower)) target = 'hook';
        else if (/\bscript\b|line\b/i.test(lower)) target = 'script';
        else if (ctx.section === 'shots') target = 'shot';
        else if (ctx.section === 'script') target = 'script';
        else target = 'sections';
      }
      /* Script generate/finish must go through AI → update_script verify path */
      if (target === 'script' || target === 'hook') {
        return {
          kind: 'script_ai',
          mode: target === 'hook' ? 'patch_hook' : classified.mode === 'shorter' ? 'replace_soft' : 'append',
          productionId: ctx.productionId,
          message: text,
          confidence: classified.confidence
        };
      }
      /* Destructive shot-list rebuild — confirm via Studio action */
      if (target === 'shotlist') {
        return {
          kind: 'action',
          proposal: {
            tool: 'shotlist',
            action: 'rebuild_shot_list',
            payload: { productionId: ctx.productionId },
            mutates: true
          },
          object: { type: 'shotlist', id: ctx.productionId, name: 'Shot list' },
          confidence: classified.confidence
        };
      }
      return {
        kind: 'generate',
        target: target,
        productionId: ctx.productionId,
        message: text,
        confidence: classified.confidence
      };
    }

    if (classified.kind === 'script_ai') {
      if (!ctx.productionId) {
        return {
          kind: 'reply',
          text: 'Open a production script first, then I can finish or rewrite it.',
          confidence: 1
        };
      }
      var scriptWs = { script: ctx.script || { body: '', lines: [] } };
      return {
        kind: 'script_ai',
        mode: classified.mode || 'append',
        productionId: ctx.productionId,
        message: text,
        confidence: classified.confidence,
        scriptPreview: global.PreShootStudio
          ? global.PreShootStudio.getScriptPlainText(scriptWs)
          : ''
      };
    }

    if (classified.kind === 'improve') {
      var itarget = classified.target || null;
      if (!itarget) {
        if (/\bhook\b/i.test(lower)) itarget = 'hook';
        else if (/\bscript\b/i.test(lower) || ctx.section === 'script') itarget = 'script';
        else if (ctx.section === 'shots' || /\bshot\b/i.test(lower)) itarget = 'shot';
        else if (/name|title|call|professional|cleaner/i.test(lower)) itarget = 'name';
        else if (memory.lastObject && memory.lastObject.type) itarget = memory.lastObject.type;
        else itarget = ctx.section === 'overview' ? 'hook' : 'script';
      }
      if (itarget === 'production' || itarget === 'project' || itarget === 'name') {
        var focusImp = resolveFocusObject(ctx, text);
        if (focusImp && focusImp.ambiguous) {
          return {
            kind: 'clarify',
            question: 'Polish the project name or the production name?',
            options: focusImp.candidates.map(function (c) {
              var suggestion = suggestProfessionalName(c.name, c.type, ctx);
              return {
                label: (c.type === 'project' ? 'Project · ' : 'Production · ') + c.name + ' → ' + suggestion,
                value: {
                  type: 'rename_target',
                  objectType: c.type,
                  id: c.id,
                  name: suggestion
                }
              };
            }),
            confidence: 0.9
          };
        }
        if (!focusImp) {
          return { kind: 'reply', text: 'Open a project or production first.', confidence: 1 };
        }
        var improved =
          classified.mode === 'shorter' || /short/i.test(lower)
            ? shortenName(focusImp.name)
            : suggestProfessionalName(focusImp.name, focusImp.type, ctx);
        return buildRenameProposal(focusImp, improved);
      }
      if (!ctx.productionId) {
        return { kind: 'reply', text: 'Open a production to improve that section.', confidence: 1 };
      }
      if (itarget === 'script' || itarget === 'hook') {
        return {
          kind: 'script_ai',
          mode: itarget === 'hook' ? 'patch_hook' : classified.mode === 'shorter' ? 'replace_soft' : 'append',
          productionId: ctx.productionId,
          message: text,
          confidence: classified.confidence
        };
      }
      return {
        kind: 'generate',
        target: itarget,
        mode: classified.mode || (/short/i.test(lower) ? 'shorter' : 'better'),
        productionId: ctx.productionId,
        message: text,
        confidence: classified.confidence
      };
    }

    if (classified.kind === 'organise') {
      return {
        kind: 'action',
        proposal: { tool: 'studio', action: 'organize_projects', payload: {}, mutates: false },
        confidence: 0.7
      };
    }

    /* Fallback explain / Q&A */
    return {
      kind: 'explain',
      message: text,
      context: ctx,
      confidence: classified.confidence || 0.55
    };
  }

  function applyGeneration(target, mode, productionId, userMessage) {
    var Studio = global.PreShootStudio;
    if (!Studio) return { ok: false, error: 'studio_unavailable' };
    var found = Studio.findProduction(productionId);
    if (!found) return { ok: false, error: 'not_found' };
    var prod = Studio.ensureWorkspace(found.production);
    var ws = prod.workspace;
    var idea = prod.ideaSnapshot || {};
    var ov = ws.overview || {};

    if (target === 'sections') {
      var built = Studio.buildWorkspaceFromIdea(productionId);
      return { ok: !!built, message: 'Production sections generated', refresh: true };
    }

    if (target === 'shotlist' || target === 'shotlist_rebuild') {
      if (Studio.buildShotListFromScript) {
        var rebuilt = Studio.buildShotListFromScript(productionId, {
          allowStarter: !(Studio.hasRealScript && Studio.hasRealScript(ws, idea))
        });
        rememberTurn({
          intent: 'generate',
          action: 'rebuild_shot_list',
          object: { type: 'shotlist', id: productionId, name: 'Shot list' }
        });
        return {
          ok: !!(rebuilt && rebuilt.ok),
          message:
            rebuilt && rebuilt.ok
              ? rebuilt.message || 'Shot list rebuilt from the script'
              : (rebuilt && rebuilt.message) || 'Could not rebuild shot list',
          refresh: !!(rebuilt && rebuilt.ok),
          section: 'shots'
        };
      }
      if (!Studio.seedWorkspaceFromIdea) return { ok: false, error: 'seed_unavailable' };
      var seededShots = Studio.seedWorkspaceFromIdea(idea, prod.scanRef || {}, {
        coverImage: prod.coverImage,
        includeStarterShots: true
      });
      ws.shotList = (seededShots && seededShots.shotList) || [];
      Studio.updateProduction(productionId, { workspace: ws });
      rememberTurn({
        intent: 'generate',
        action: 'rebuild_shot_list',
        object: { type: 'shotlist', id: productionId, name: 'Shot list' }
      });
      return {
        ok: true,
        message: 'Shot list rebuilt',
        refresh: true,
        section: 'shots'
      };
    }

    if (target === 'shot') {
      var order = (ws.shotList || []).length + 1;
      var shot = Studio.createShot({
        order: order,
        purpose: /close/i.test(userMessage || '') ? 'Close-up detail' : 'Supporting shot',
        durationSec: 3,
        framing: /close/i.test(userMessage || '') ? 'Tight close-up' : 'Medium shot',
        notes: 'Added by Director from your request.',
        beginnerTip: 'Lock exposure before you roll.',
        cameraMovement: 'Slow push-in'
      });
      ws.shotList = (ws.shotList || []).concat([shot]);
      Studio.updateProduction(productionId, { workspace: ws });
      rememberTurn({
        intent: 'generate',
        action: 'add_shot',
        object: { type: 'shot', id: shot.id, name: shot.purpose }
      });
      return { ok: true, message: 'Shot list updated', refresh: true, section: 'shots' };
    }

    if (target === 'script') {
      var lines = (ws.script && ws.script.lines) || [];
      var body = (ws.script && ws.script.body) || '';
      if (mode === 'shorter') {
        if (lines.length) {
          lines = lines.map(function (l) {
            var t = String(l.text || '');
            var cut = t.split(/[,—–-]/)[0].trim();
            if (cut.length > 90) cut = cut.slice(0, 86).replace(/\s+\S*$/, '') + '…';
            return Object.assign({}, l, { text: cut || t });
          });
          ws.script.lines = lines;
        } else if (body) {
          ws.script.body = body
            .split(/\n+/)
            .map(function (l) {
              return l.length > 100 ? l.slice(0, 96).replace(/\s+\S*$/, '') + '…' : l;
            })
            .join('\n');
        } else {
          var seedLine = Studio.createScriptLine({
            order: 1,
            text: (idea.hook || ov.summary || 'Open on the strongest visual.').slice(0, 90),
            shotId: (ws.shotList[0] && ws.shotList[0].id) || null
          });
          ws.script.lines = [seedLine];
        }
        Studio.updateProduction(productionId, { workspace: ws });
        rememberTurn({
          intent: 'improve',
          action: 'shorten_script',
          object: { type: 'script', id: productionId, name: 'Script' }
        });
        return { ok: true, message: 'Script tightened', refresh: true, section: 'script' };
      }
      /* better / new line */
      var nextOrder = lines.length + 1;
      var hook = idea.hook || ov.summary || 'Stop the scroll with one specific promise.';
      var newLine = Studio.createScriptLine({
        order: nextOrder,
        text: mode === 'better' ? String(hook).slice(0, 120) : 'Then pay off the promise with one clear action.',
        shotId: (ws.shotList[Math.min(nextOrder - 1, (ws.shotList || []).length - 1)] || {}).id || null
      });
      if (mode === 'better' && lines.length) {
        lines[0] = Object.assign({}, lines[0], { text: String(hook).slice(0, 120) });
        ws.script.lines = lines;
      } else {
        ws.script.lines = lines.concat([newLine]);
      }
      Studio.updateProduction(productionId, { workspace: ws });
      rememberTurn({
        intent: 'generate',
        action: 'script_line',
        object: { type: 'script', id: productionId, name: 'Script' }
      });
      return {
        ok: true,
        message: mode === 'better' ? 'Opening line updated' : 'Script line added',
        refresh: true,
        section: 'script'
      };
    }

    if (target === 'hook') {
      var current = idea.hook || '';
      var stronger =
        mode === 'shorter'
          ? shortenName(current || ov.summary || 'Watch this')
          : improveName(current || ov.summary || 'The detail nobody notices', gatherContext());
      if (!idea || typeof idea !== 'object') idea = {};
      idea.hook = stronger;
      if (/short|better|cinematic/i.test(mode || '') && stronger.length < 12) {
        stronger = 'POV: ' + stronger;
        idea.hook = stronger;
      }
      Studio.updateProduction(productionId, { ideaSnapshot: idea });
      if (ws.overview) {
        /* keep overview summary if empty */
      }
      rememberTurn({
        intent: 'improve',
        action: 'hook',
        object: { type: 'hook', id: productionId, name: stronger }
      });
      return { ok: true, message: 'Updated hook generated', refresh: true, section: 'overview' };
    }

    return { ok: false, error: 'unsupported_generate' };
  }

  function executeProposed(proposal, opts) {
    opts = opts || {};
    if (!proposal || !proposal.action) return { ok: false, error: 'no_proposal' };
    var Studio = global.PreShootStudio;
    var meta = getActionMeta(proposal.action);
    var mutates = proposal.mutates != null ? proposal.mutates : meta ? !!meta.mutates : true;

    if (meta && typeof meta.execute === 'function') {
      return meta.execute(proposal.payload || {}, { confirmed: !!opts.confirmed });
    }
    if (!Studio || !Studio.handleDirectorAction) return { ok: false, error: 'studio_unavailable' };
    if (mutates && !opts.confirmed) {
      return {
        ok: false,
        needsConfirmation: true,
        action: proposal.action,
        payload: proposal.payload || {},
        message:
          (Studio.confirmMessage && Studio.confirmMessage(proposal.action, proposal.payload || {})) ||
          'Confirm this action?'
      };
    }
    var result = Studio.handleDirectorAction(proposal.action, proposal.payload || {}, {
      confirmed: !!opts.confirmed || !mutates
    });
    if (result && result.ok) {
      rememberTurn({
        intent: proposal.action,
        action: proposal.action,
        object: proposal.object || null
      });
    }
    return result;
  }

  function proposeToUI(proposal) {
    if (!proposal) return false;
    if (global.PreShootStudioUI && typeof global.PreShootStudioUI.proposeDirectorAction === 'function') {
      global.PreShootStudioUI.proposeDirectorAction(proposal.action, proposal.payload || {});
      return true;
    }
    return false;
  }

  /**
   * Studio command-bar pipeline (action-first, no screen switch).
   * Returns a result object for the UI to render.
   */
  function processStudioCommand(message, opts) {
    opts = opts || {};
    var text = String(message || '').trim();
    if (!text) return { kind: 'error', message: 'Tell Director what you’d like to do.' };

    /* Resolve pending free-text clarify (e.g. rename target) */
    if (memory.pendingClarify && memory.pendingClarify.freeText) {
      var pending = memory.pendingClarify;
      if (/^(why|how|find|open|cancel|never\s*mind|forget)/i.test(text)) {
        memory.pendingClarify = null;
      } else {
        memory.pendingClarify = null;
        var pendingKind = (pending.pending && pending.pending.kind) || 'rename';
        if (pendingKind === 'rename' || pending.freeText) {
          if (pending.pending && pending.pending.id && pending.pending.objectType) {
            var named = buildRenameProposal(
              {
                type: pending.pending.objectType,
                id: pending.pending.id,
                name: text
              },
              text
            );
            rememberTurn({ intent: 'rename', text: text, object: named.object || null });
            var previewNamed = executeProposed(named.proposal, { confirmed: false });
            if (previewNamed && previewNamed.needsConfirmation) {
              return {
                kind: 'confirm',
                proposal: named.proposal,
                message: previewNamed.message,
                object: named.object || null
              };
            }
            return {
              kind: 'confirm',
              proposal: named.proposal,
              message: (previewNamed && previewNamed.message) || 'Confirm this rename?',
              object: named.object || null
            };
          }
          var otype = (pending.pending && pending.pending.objectType) || '';
          if (otype === 'project') text = 'Rename project to ' + text;
          else if (otype === 'production') text = 'Rename production to ' + text;
          else text = 'Rename this to ' + text;
        }
      }
    }

    var resolved = resolveIntent(text, opts);
    rememberTurn({ intent: resolved.kind, text: text, object: resolved.object || null });

    if (resolved.kind === 'clarify') {
      memory.pendingClarify = resolved;
      return resolved;
    }

    if (resolved.kind === 'action' && resolved.proposal) {
      if (resolved.object) resolved.proposal.object = resolved.object;
      var preview = executeProposed(resolved.proposal, { confirmed: false });
      if (preview && preview.needsConfirmation) {
        return {
          kind: 'confirm',
          proposal: resolved.proposal,
          message: preview.message,
          object: resolved.object || null
        };
      }
      /* Never claim Done from an unconfirmed preview — mutations must stage for GO */
      if (resolved.proposal.action === 'list_references') {
        var listed = executeProposed(resolved.proposal, { confirmed: true });
        var items = (listed && listed.result) || [];
        if (!items.length) {
          return { kind: 'reply', text: 'No references saved on this production yet.', refresh: false };
        }
        return {
          kind: 'reply',
          text:
            'You have ' +
            items.length +
            ' reference' +
            (items.length === 1 ? '' : 's') +
            ': ' +
            items
              .slice(0, 5)
              .map(function (r) {
                return r.title || r.url || 'untitled';
              })
              .join(' · '),
          refresh: false
        };
      }
      if (resolved.proposal.mutates === false || resolved.proposal.action === 'open_production') {
        var done = executeProposed(resolved.proposal, { confirmed: true });
        return {
          kind: 'done',
          message: done && done.ok ? 'Opened.' : (done && done.error) || 'Couldn’t complete that.',
          refresh: true,
          open: done && done.open,
          result: done,
          verified: !!(done && done.ok)
        };
      }
      if (resolved.proposal.action === 'organize_projects' || resolved.proposal.action === 'find_projects') {
        var insights = executeProposed(resolved.proposal, { confirmed: true });
        return {
          kind: 'reply',
          text: formatOrganiseReply(insights),
          refresh: false
        };
      }
      return {
        kind: 'confirm',
        proposal: resolved.proposal,
        message: (preview && preview.message) || 'Confirm this action?'
      };
    }

    if (resolved.kind === 'navigate' && resolved.target) {
      return { kind: 'navigate', target: resolved.target, message: 'Opening…' };
    }

    if (resolved.kind === 'script_ai') {
      return {
        kind: 'script_ai',
        mode: resolved.mode || 'append',
        productionId: resolved.productionId,
        message: resolved.message || text,
        confidence: resolved.confidence || 0.9
      };
    }

    if (resolved.kind === 'find_refs') {
      return {
        kind: 'find_refs',
        platform: resolved.platform || 'youtube',
        productionId: resolved.productionId,
        confidence: resolved.confidence || 0.9
      };
    }

    if (resolved.kind === 'generate') {
      /* Block silent script heuristics — script must use script_ai */
      if (resolved.target === 'script' || resolved.target === 'hook') {
        return {
          kind: 'script_ai',
          mode: resolved.target === 'hook' ? 'patch_hook' : 'append',
          productionId: resolved.productionId,
          message: resolved.message || text,
          confidence: resolved.confidence || 0.85
        };
      }
      var gen = applyGeneration(
        resolved.target,
        resolved.mode || 'better',
        resolved.productionId,
        resolved.message || text
      );
      if (gen.ok) {
        return {
          kind: 'done',
          message: gen.message || 'Updated.',
          refresh: true,
          section: gen.section || null,
          productionId: resolved.productionId || null,
          /* Persist must be confirmed by UI before Done — not verified yet */
          needsPersist: true
        };
      }
      return { kind: 'reply', text: 'I couldn’t update that section yet. Try opening the section and asking again.' };
    }

    if (resolved.kind === 'reply') return resolved;

    if (resolved.kind === 'explain') {
      return {
        kind: 'explain',
        message: text,
        context: gatherContext(),
        localFallback: buildLocalExplain(text, gatherContext())
      };
    }

    return { kind: 'reply', text: 'Tell me what to change — rename, move, generate, improve, or find something.' };
  }

  function formatOrganiseReply(insights) {
    var r = insights && insights.result;
    if (!r) return 'Your Studio is ready — open a recent production to keep going.';
    if (r.nextAction && r.nextAction.text) return r.nextAction.text;
    if (r.continueWorking && r.continueWorking.production) {
      return 'Continue “' + r.continueWorking.production.name + '”.';
    }
    return 'Open Studio and pick up your most recent production.';
  }

  function buildLocalExplain(text, ctx) {
    var lower = String(text || '').toLowerCase();
    if (/\bhook\b/i.test(lower)) {
      return 'Hook tip ready — make the first 5 words more specific.';
    }
    if (/\bfilm|shot|camera\b/i.test(lower)) {
      return 'Film hero → detail → payoff. Keep shots short.';
    }
    if (ctx.production) {
      return 'Ready in “' + ctx.production.name + '”. Say what to change.';
    }
    return 'Say rename, move, generate, improve, or find.';
  }

  function resolveClarifyChoice(value) {
    memory.pendingClarify = null;
    if (!value) return { kind: 'error', message: 'Cancelled.' };
    if (value.type === 'production') {
      return {
        kind: 'action',
        proposal: {
          tool: 'production',
          action: 'open_production',
          payload: { productionId: value.id },
          mutates: false
        }
      };
    }
    if (value.type === 'project') {
      return { kind: 'navigate', target: { type: 'project', id: value.id } };
    }
    if (value.type === 'move') {
      return {
        kind: 'confirm',
        proposal: {
          tool: 'production',
          action: 'move_production',
          payload: { productionId: value.productionId, toProjectId: value.toProjectId }
        },
        message: 'Move this production to the selected project?'
      };
    }
    if (value.type === 'rename_target') {
      var focus = {
        type: value.objectType === 'project' ? 'project' : 'production',
        id: value.id,
        name: value.name
      };
      return buildRenameProposal(focus, value.name || '');
    }
    if (value.type === 'rename_pick') {
      return {
        kind: 'clarify',
        question:
          'What should I rename this ' +
          (value.objectType === 'project' ? 'project' : 'production') +
          ' to?',
        options: [],
        freeText: true,
        pending: {
          kind: 'rename',
          objectType: value.objectType === 'project' ? 'project' : 'production',
          id: value.id
        },
        confidence: 0.8
      };
    }
    if (value.type === 'remove_ref') {
      return {
        kind: 'confirm',
        proposal: {
          tool: 'reference',
          action: 'remove_reference',
          payload: { productionId: value.productionId, refId: value.refId }
        },
        message: 'Remove this reference?'
      };
    }
    return { kind: 'error', message: 'Unknown choice.' };
  }

  function parseActionFromReply(reply) {
    var text = String(reply || '');
    var m = text.match(/\[\[ACTION:(\{[\s\S]*?\})\]\]/);
    if (!m) return null;
    try {
      var obj = JSON.parse(m[1]);
      if (!obj || !obj.action) return null;
      return {
        tool: obj.tool || 'production',
        action: obj.action,
        payload: obj.payload || {},
        confidence: 0.9,
        source: 'model',
        displayText: text.replace(m[0], '').trim()
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Extract a JSON object starting at idx using brace depth (handles nested strings).
   */
  function extractBalancedJsonObject(text, idx) {
    if (!text || text.charAt(idx) !== '{') return null;
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = idx; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(idx, i + 1);
      }
    }
    return null;
  }

  function scriptPatchFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var body = obj.body != null ? String(obj.body) : '';
    if (!body && obj.lines && obj.lines.length) {
      body = obj.lines
        .map(function (l) {
          return typeof l === 'string' ? l : (l && l.text) || '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
    if (!body.trim()) return null;
    return {
      mode: obj.mode || 'append',
      body: body.trim(),
      lines: obj.lines || null,
      productionId: obj.productionId || null
    };
  }

  /**
   * Parse [[SCRIPT:{"mode":"append","body":"..."}]] from model reply.
   * body may also be delivered as lines: ["…","…"]
   */
  function parseScriptPatch(reply, preferredMode) {
    var text = String(reply || '');
    var marker = text.indexOf('[[SCRIPT:');
    if (marker >= 0) {
      var braceAt = text.indexOf('{', marker);
      if (braceAt >= 0) {
        var jsonStr = extractBalancedJsonObject(text, braceAt);
        if (jsonStr) {
          try {
            var parsed = scriptPatchFromObject(JSON.parse(jsonStr));
            if (parsed) return parsed;
          } catch (e1) {
            /* fall through */
          }
        }
      }
    }
    /* Also accept ACTION update_script */
    var act = parseActionFromReply(text);
    if (act && act.action === 'update_script') {
      return scriptPatchFromObject({
        mode: (act.payload && act.payload.mode) || preferredMode || 'append',
        body: (act.payload && act.payload.body) || '',
        lines: (act.payload && act.payload.lines) || null,
        productionId: act.payload && act.payload.productionId
      });
    }
    /* Fenced JSON fallback */
    var fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (fence) {
      try {
        var fromFence = scriptPatchFromObject(JSON.parse(fence[1]));
        if (fromFence) return fromFence;
      } catch (e2) {
        /* fall through */
      }
    }
    /*
     * Last resort: model returned plain script text without markers.
     * Reject short refusals / advice so we don't overwrite the editor with chat.
     */
    var plain = text
      .replace(/\[\[(?:SCRIPT|ACTION):[\s\S]*$/, '')
      .replace(/^[\s\S]*?(?:here(?:'| i)?s (?:the |your )?(?:updated |rewritten )?script[:\s]*)/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
    if (
      plain.length >= 40 &&
      !/^(i (can'?t|cannot|unable)|sorry|unable|as an ai|i need more)/i.test(plain) &&
      !/\b(confirm|would you like|let me know)\b/i.test(plain.slice(0, 120)) &&
      (plain.indexOf('\n') >= 0 || plain.length >= 80)
    ) {
      return {
        mode: preferredMode || 'append',
        body: plain,
        lines: null,
        productionId: null
      };
    }
    return null;
  }

  function stripActionMarker(reply) {
    return String(reply || '')
      .replace(/\[\[ACTION:\{[\s\S]*?\}\]\]/g, '')
      .replace(/\[\[SCRIPT:\{[\s\S]*?\}\]\]/g, '')
      .trim();
  }

  /* Legacy matchIntent for global chat */
  function matchIntent(message, opts) {
    var resolved = resolveIntent(message, opts || {});
    if (resolved.kind === 'action' && resolved.proposal) {
      return Object.assign({ confidence: resolved.confidence || 0.8, source: 'intent' }, resolved.proposal);
    }
    return null;
  }

  /* ── Tools ── */
  registerTool({
    id: 'project',
    name: 'Project Tool',
    description: 'Create, rename, archive projects.',
    surfaces: ['*', 'studio', 'project', 'home', 'production'],
    actions: {
      create_project: { label: 'Create project', mutates: true },
      rename_project: { label: 'Rename project', mutates: true },
      archive_project: { label: 'Archive project', mutates: true }
    }
  });

  registerTool({
    id: 'production',
    name: 'Production Tool',
    description: 'Manage productions and status.',
    surfaces: ['*', 'studio', 'production', 'project', 'home'],
    actions: {
      create_production: { label: 'Create production', mutates: true },
      rename_production: { label: 'Rename production', mutates: true },
      move_production: { label: 'Move production', mutates: true },
      archive_production: { label: 'Archive production', mutates: true },
      delete_production: { label: 'Delete production', mutates: true },
      update_status: { label: 'Update status', mutates: true },
      generate_sections: { label: 'Generate sections', mutates: true },
      open_production: { label: 'Open production', mutates: false },
      link_scan: { label: 'Link scan', mutates: true },
      unlink_scan: { label: 'Unlink scan', mutates: true }
    }
  });

  registerTool({
    id: 'shotlist',
    name: 'Shot List Tool',
    description: 'Add and improve shots.',
    surfaces: ['*', 'production'],
    actions: {
      add_shot: { label: 'Add shot', mutates: true },
      rebuild_shot_list: { label: 'Rebuild shot list', mutates: true }
    }
  });

  registerTool({
    id: 'script',
    name: 'Script Tool',
    description: 'Improve and generate script lines.',
    surfaces: ['*', 'production', 'studio'],
    actions: {
      improve_script: { label: 'Improve script', mutates: true },
      update_script: { label: 'Update script', mutates: true }
    }
  });

  registerTool({
    id: 'reference',
    name: 'Reference Tool',
    description: 'Work with production references.',
    surfaces: ['*', 'production', 'studio'],
    actions: {
      add_reference: { label: 'Add reference', mutates: true },
      remove_reference: { label: 'Remove reference', mutates: true },
      list_references: { label: 'List references', mutates: false },
      find_references: { label: 'Find references', mutates: false }
    }
  });

  registerTool({
    id: 'asset',
    name: 'Asset Tool',
    description: 'Search production assets.',
    surfaces: ['*', 'production'],
    actions: {
      search_assets: { label: 'Search assets', mutates: false }
    }
  });

  registerTool({
    id: 'studio',
    name: 'Studio Tool',
    description: 'Search and organise Studio.',
    surfaces: ['*', 'studio', 'home'],
    actions: {
      find_projects: { label: 'Find projects', mutates: false },
      search_assets: { label: 'Search assets', mutates: false },
      organize_projects: { label: 'Organise projects', mutates: false }
    }
  });

  registerTool({
    id: 'library',
    name: 'Library Tool',
    description: 'Find scans and ideas.',
    surfaces: ['*', 'library', 'home'],
    actions: { search_assets: { label: 'Search library', mutates: false } }
  });

  registerTool({
    id: 'search',
    name: 'Search Tool',
    description: 'Global search across Studio.',
    surfaces: ['*'],
    actions: {
      find_projects: { label: 'Find', mutates: false },
      search_assets: { label: 'Search', mutates: false }
    }
  });

  registerTool({
    id: 'settings',
    name: 'Settings Tool',
    description: 'Update personalisation.',
    surfaces: ['*', 'menu', 'profile', 'home'],
    actions: {
      set_primary_platform: {
        label: 'Set primary platform',
        mutates: true,
        execute: function (payload, opts) {
          if (!opts || !opts.confirmed) {
            return {
              ok: false,
              needsConfirmation: true,
              action: 'set_primary_platform',
              payload: payload,
              message: 'Change primary platform to “' + (payload.platform || '') + '”?'
            };
          }
          var S = global.S || {};
          S.platformFocus = S.platformFocus || {};
          var plat = String(payload.platform || '').trim();
          if (!plat) return { ok: false, error: 'missing_platform' };
          S.platformFocus.primaryPlatform = plat;
          if (!S.platformFocus.platforms) S.platformFocus.platforms = [];
          if (S.platformFocus.platforms.indexOf(plat) < 0) S.platformFocus.platforms.unshift(plat);
          try {
            localStorage.setItem('scout_platformFocus', JSON.stringify(S.platformFocus));
          } catch (e) {}
          return { ok: true, result: S.platformFocus };
        }
      }
    }
  });

  registerTool({
    id: 'profile',
    name: 'Profile Tool',
    description: 'Profile context (read-mostly).',
    surfaces: ['*', 'profile', 'menu'],
    actions: {}
  });

  global.PreShootDirectorOS = {
    registerTool: registerTool,
    listTools: listTools,
    getSurface: getSurface,
    surfaceGuidance: surfaceGuidance,
    gatherContext: gatherContext,
    buildToolManifest: buildToolManifest,
    buildOSContext: buildOSContext,
    classifyIntent: classifyIntent,
    resolveIntent: resolveIntent,
    processStudioCommand: processStudioCommand,
    resolveClarifyChoice: resolveClarifyChoice,
    toTitleCase: toTitleCase,
    suggestProfessionalName: suggestProfessionalName,
    resolveFocusObject: resolveFocusObject,
    applyGeneration: applyGeneration,
    matchIntent: matchIntent,
    parseActionFromReply: parseActionFromReply,
    parseScriptPatch: parseScriptPatch,
    stripActionMarker: stripActionMarker,
    executeProposed: executeProposed,
    proposeToUI: proposeToUI,
    rememberTurn: rememberTurn,
    getMemory: function () {
      return memory;
    },
    TOOLS: TOOLS
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
