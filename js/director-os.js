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
    pendingClarify: null
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
      studio: 'Help organise projects and productions. Prefer actions over chat.',
      project: 'User is inside a project. Prefer production organisation actions.',
      production: 'User is inside a production workspace. Never ask them to re-explain it.',
      library: 'Help find scans and send ideas into Studio.',
      menu: 'Help with preferences and settings.',
      profile: 'Help with identity and plan context.'
    };
    return map[surface] || 'Adapt to the current PreShoot surface.';
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
      memory: {
        lastObject: memory.lastObject,
        lastAction: memory.lastAction,
        lastIntent: memory.lastIntent
      }
    };

    if (Studio && Studio.getSkillLevel) ctx.skillLevel = Studio.getSkillLevel();
    if (S.platformFocus) ctx.platform = S.platformFocus.primaryPlatform || (S.platformFocus.platforms || [])[0];

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
      }
    } else if (Studio && ctx.projectId) {
      var p = Studio.findProject(ctx.projectId);
      if (p) ctx.project = { id: p.id, name: p.name };
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
    lines.push('Surface: ' + surface);
    lines.push('Section: ' + (live.section || 'n/a'));
    lines.push(surfaceGuidance(surface));
    lines.push('Be concise. Prefer actions. Never require chatbot UX inside Studio.');
    lines.push('Mutations require user Confirm in the app UI.');
    if (live.project) lines.push('Project: ' + live.project.name + ' (' + live.project.id + ')');
    if (live.production) {
      lines.push(
        'Production: ' +
          live.production.name +
          ' [' +
          live.production.status +
          '] id=' +
          live.production.id
      );
    }
    if (live.hook) lines.push('Hook: ' + live.hook);
    if (live.overview && live.overview.goal) lines.push('Goal: ' + live.overview.goal);
    if (live.shotList && live.shotList.length) lines.push('Shots: ' + live.shotList.length);
    if (live.script && ((live.script.lines && live.script.lines.length) || live.script.body)) {
      lines.push('Script present');
    }
    if (live.skillLevel) lines.push('Skill: ' + live.skillLevel);
    if (live.platform) lines.push('Platform: ' + live.platform);
    if (memory.lastObject) {
      lines.push(
        'Conversation focus: ' +
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
    if (entry && entry.object) memory.lastObject = entry.object;
    if (entry && entry.action) memory.lastAction = entry.action;
    if (entry && entry.intent) memory.lastIntent = entry.intent;
  }

  function extractQuotedOrTail(text, words) {
    var raw = String(text || '').trim();
    var q = raw.match(/[“"]([^”"]+)[”"]/);
    if (q) return q[1].trim();
    var call = raw.match(
      /\b(?:can we call|call(?:ed)?|rename|name)\s+(?:this|it)\s+(?:to\s+|as\s+)?(.+?)\s*$/i
    );
    if (call) return call[1].replace(/[?.!]+$/, '').trim();
    var re = new RegExp('(?:' + words + ')\\s+[\'\"]?(.+?)[\'\"]?\\s*$', 'i');
    var m = raw.match(re);
    if (m) return m[1].replace(/[?.!]+$/, '').trim();
    var parts = raw.split(/\b(?:to|as|called|named)\b/i);
    if (parts.length > 1) return parts[parts.length - 1].replace(/[?.!]+$/, '').trim();
    return '';
  }

  function shortenName(name) {
    var n = String(name || '').trim();
    if (!n) return 'Untitled';
    var words = n.split(/\s+/);
    if (words.length > 3) return words.slice(0, 3).join(' ');
    if (n.length > 28) return n.slice(0, 24).replace(/\s+\S*$/, '') || n.slice(0, 24);
    return n.replace(/\b(the|a|an|campaign|launch|advert|video|final|v\d+)\b/gi, '').replace(/\s+/g, ' ').trim() || n;
  }

  function improveName(name, ctx) {
    var base = String(name || '').trim();
    if (!base && ctx.hook) base = String(ctx.hook).split(/[.!?]/)[0];
    if (!base && ctx.overview && ctx.overview.summary) base = ctx.overview.summary.split(/[.!?]/)[0];
    base = base || 'Untitled Production';
    base = base
      .replace(/\b(sucks|bad|temp|test|untitled|this name|the name)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (base.length < 3) base = 'Campaign';
    var plat = ctx.platform ? String(ctx.platform).split(/\s+/)[0] : '';
    if (plat && !new RegExp(plat, 'i').test(base) && base.split(/\s+/).length < 4) {
      return base + ' ' + (plat.charAt(0).toUpperCase() + plat.slice(1));
    }
    return base
      .split(/\s+/)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  function classifyIntent(text, ctx) {
    var lower = String(text || '').toLowerCase().trim();
    if (!lower) return { kind: 'none', confidence: 0 };

    /* Follow-ups using memory */
    if (
      memory.lastObject &&
      /^(?:(?:actually|instead|wait|no,)\s+)?(?:make it|make this|call it|rename it|shorter|better|longer)\b/i.test(
        lower
      )
    ) {
      if (/short/i.test(lower)) return { kind: 'improve', target: memory.lastObject.type, mode: 'shorter', confidence: 0.88 };
      if (/better|stronger|cinematic|fix|improve|sound/i.test(lower))
        return { kind: 'improve', target: memory.lastObject.type, mode: 'better', confidence: 0.86 };
      if (/call it|rename|name it/i.test(lower))
        return { kind: 'rename', confidence: 0.84, followUp: true };
    }

    if (/\b(why|how should|what.?s a better|explain|help me understand)\b/i.test(lower)) {
      return { kind: 'explain', confidence: 0.8 };
    }

    if (/\b(rename|call (this|it)|change (the )?name|name sucks|yo change|can we call|let'?s rename)\b/i.test(lower) ||
        /\b(this name sucks|make this sound better)\b/i.test(lower)) {
      return { kind: 'rename', confidence: 0.86 };
    }

    if (/\b(move|put this in|send (this )?to)\b/i.test(lower)) return { kind: 'move', confidence: 0.82 };
    if (/\b(archive)\b/i.test(lower)) return { kind: 'archive', confidence: 0.88 };
    if (/\b(delete|remove this production)\b/i.test(lower)) return { kind: 'delete', confidence: 0.85 };
    if (/\b(create|new)\b.+\bproject\b/i.test(lower)) return { kind: 'create_project', confidence: 0.84 };
    if (/\b(create|new)\b.+\bproduction\b/i.test(lower)) return { kind: 'create_production', confidence: 0.84 };

    if (/\b(generate|build|make|give me)\b.+\b(script|shot|hook|section|workspace)\b/i.test(lower) ||
        /\b(another|more|new)\b.+\b(shot|hook|line)\b/i.test(lower) ||
        /\badd (another |a )?(close-?up|shot|line)\b/i.test(lower)) {
      return { kind: 'generate', confidence: 0.84 };
    }

    if (/\b(shorter|tighten|trim|improve|stronger|cinematic|better hook|fix (this|the)|i don'?t (really )?like|this sucks)\b/i.test(lower)) {
      return { kind: 'improve', confidence: 0.83 };
    }

    if (/\b(find|open|show|search)\b/i.test(lower)) return { kind: 'search', confidence: 0.78 };
    if (/\b(status|ready to film|mark as|set to)\b/i.test(lower)) return { kind: 'status', confidence: 0.8 };
    if (/\b(organise|organize|what (should|next)|continue)\b/i.test(lower)) return { kind: 'organise', confidence: 0.7 };

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
              label: p.name + (p.projectName ? ' · ' + p.projectName : ''),
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
      var focusProd = ctx.productionId;
      var focusProj = ctx.projectId;
      var wantProject = /\bproject\b/i.test(lower) && !/\bproduction\b/i.test(lower);
      var newName = extractQuotedOrTail(text, 'to|as|called|named');
      var baseName =
        (memory.lastObject && memory.lastObject.name) ||
        (wantProject ? ctx.project && ctx.project.name : null) ||
        (ctx.production && ctx.production.name) ||
        (ctx.project && ctx.project.name) ||
        '';
      if (!newName && (/sucks|better|sound|fix|improve|don'?t like|change (this|it)|yo change/i.test(lower) || classified.followUp)) {
        if (classified.mode === 'shorter' || /short/i.test(lower)) {
          newName = shortenName(baseName);
        } else {
          newName = improveName(baseName, ctx);
        }
      }
      if (!newName) {
        return {
          kind: 'clarify',
          question: 'What should I rename it to?',
          options: [],
          freeText: true,
          pending: { kind: 'rename', wantProject: wantProject },
          confidence: 0.7
        };
      }
      if (wantProject && focusProj) {
        return {
          kind: 'action',
          proposal: {
            tool: 'project',
            action: 'rename_project',
            payload: { projectId: focusProj, name: newName }
          },
          object: { type: 'project', id: focusProj, name: newName },
          confidence: 0.9
        };
      }
      if (focusProd) {
        return {
          kind: 'action',
          proposal: {
            tool: 'production',
            action: 'rename_production',
            payload: { productionId: focusProd, name: newName }
          },
          object: { type: 'production', id: focusProd, name: newName },
          confidence: 0.92
        };
      }
      if (focusProj) {
        return {
          kind: 'action',
          proposal: {
            tool: 'project',
            action: 'rename_project',
            payload: { projectId: focusProj, name: newName }
          },
          object: { type: 'project', id: focusProj, name: newName },
          confidence: 0.85
        };
      }
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
      var cn = extractQuotedOrTail(text, 'called|named') || 'Untitled Project';
      return {
        kind: 'action',
        proposal: { tool: 'project', action: 'create_project', payload: { name: cn } },
        confidence: 0.86
      };
    }

    if (classified.kind === 'create_production' && ctx.projectId) {
      var cnp = extractQuotedOrTail(text, 'called|named') || 'Untitled Production';
      return {
        kind: 'action',
        proposal: {
          tool: 'production',
          action: 'create_production',
          payload: { projectId: ctx.projectId, name: cnp }
        },
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

    if (classified.kind === 'generate' && ctx.productionId) {
      var target = classified.target || null;
      if (!target) {
        if (/\bshot\b|close-?up/i.test(lower)) target = 'shot';
        else if (/\bhook\b/i.test(lower)) target = 'hook';
        else if (/\bscript\b|line\b/i.test(lower)) target = 'script';
        else if (ctx.section === 'shots') target = 'shot';
        else if (ctx.section === 'script') target = 'script';
        else target = 'sections';
      }
      return {
        kind: 'generate',
        target: target,
        productionId: ctx.productionId,
        message: text,
        confidence: classified.confidence
      };
    }

    if (classified.kind === 'improve' && ctx.productionId) {
      var itarget = classified.target || null;
      if (!itarget) {
        if (/\bhook\b/i.test(lower)) itarget = 'hook';
        else if (/\bscript\b/i.test(lower) || ctx.section === 'script') itarget = 'script';
        else if (ctx.section === 'shots' || /\bshot\b/i.test(lower)) itarget = 'shot';
        else if (/name|title|call/i.test(lower)) itarget = 'production';
        else if (memory.lastObject && memory.lastObject.type) itarget = memory.lastObject.type;
        else itarget = ctx.section === 'overview' ? 'hook' : 'script';
      }
      if (itarget === 'production' || itarget === 'project' || itarget === 'name') {
        var improved = /short/i.test(lower)
          ? shortenName(ctx.production && ctx.production.name)
          : improveName(ctx.production && ctx.production.name, ctx);
        return {
          kind: 'action',
          proposal: {
            tool: 'production',
            action: 'rename_production',
            payload: { productionId: ctx.productionId, name: improved }
          },
          object: { type: 'production', id: ctx.productionId, name: improved },
          confidence: 0.84
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
      return { ok: !!built, message: 'Generated missing production sections.', refresh: true };
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
      return { ok: true, message: 'Added a new shot to the list.', refresh: true, section: 'shots' };
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
        return { ok: true, message: 'Tightened the script for short-form pacing.', refresh: true, section: 'script' };
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
        message: mode === 'better' ? 'Strengthened the opening line.' : 'Added a script line.',
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
      return { ok: true, message: 'Updated the hook.', refresh: true, section: 'overview' };
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
          text = 'Rename this to ' + text;
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
      if (preview && preview.ok) {
        return { kind: 'done', message: 'Done.', refresh: true, result: preview };
      }
      /* non-mutating immediate */
      if (resolved.proposal.mutates === false || resolved.proposal.action === 'open_production') {
        var done = executeProposed(resolved.proposal, { confirmed: true });
        return {
          kind: 'done',
          message: done && done.ok ? 'Opened.' : (done && done.error) || 'Couldn’t complete that.',
          refresh: true,
          open: done && done.open,
          result: done
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

    if (resolved.kind === 'generate') {
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
          section: gen.section || null
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
      var hook = ctx.hook || 'your opening line';
      return (
        'Your hook should create curiosity in under 2 seconds. Right now it’s “' +
        String(hook).slice(0, 80) +
        '”. Make the first 5 words more specific to the scene or payoff.'
      );
    }
    if (/\bfilm|shot|camera\b/i.test(lower)) {
      return (
        'Film the hero visual first, then one detail close-up, then a reaction/payoff. Keep each shot under ' +
        (String(ctx.platform || '').toLowerCase().indexOf('tiktok') >= 0 ? '3' : '4') +
        ' seconds if you can.'
      );
    }
    if (ctx.production) {
      return (
        'You’re in “' +
        ctx.production.name +
        '”. Tell me what to change — name, status, script, shots, or hook — and I’ll do it here.'
      );
    }
    return 'Ask me to rename, move, generate, improve, or find something in Studio.';
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

  function stripActionMarker(reply) {
    return String(reply || '')
      .replace(/\[\[ACTION:\{[\s\S]*?\}\]\]/g, '')
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
      add_shot: { label: 'Add shot', mutates: true }
    }
  });

  registerTool({
    id: 'script',
    name: 'Script Tool',
    description: 'Improve and generate script lines.',
    surfaces: ['*', 'production'],
    actions: {
      improve_script: { label: 'Improve script', mutates: true }
    }
  });

  registerTool({
    id: 'reference',
    name: 'Reference Tool',
    description: 'Work with production references.',
    surfaces: ['*', 'production'],
    actions: {}
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
    applyGeneration: applyGeneration,
    matchIntent: matchIntent,
    parseActionFromReply: parseActionFromReply,
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
