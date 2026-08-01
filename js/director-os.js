/**
 * Director OS — modular tool architecture (Jarvis foundation).
 * Tools are registered, not hardcoded into chat. Mutations always require confirmation.
 */
(function (global) {
  'use strict';

  var TOOLS = {};

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

  function getAction(toolId, actionId) {
    var tool = TOOLS[toolId];
    if (!tool || !tool.actions) return null;
    return tool.actions[actionId] || null;
  }

  function getSurface() {
    var S = global.S || {};
    if (S.activeProductionId || (S.studioView && S.studioView.mode === 'production')) return 'production';
    if (S.tab === 'studio' || (S.studioView && S.studioView.mode)) return 'studio';
    if (S.tab === 'library') return 'library';
    if (S.tab === 'menu') return 'menu';
    if (S.tab === 'profile') return 'profile';
    if (S.tab === 'director') {
      if (S.activeProductionId) return 'production';
      return 'home';
    }
    if (S.tab === 'home' || !S.tab) return 'home';
    return S.tab || 'home';
  }

  function surfaceGuidance(surface) {
    var map = {
      home: 'User is on Home. Help them decide what to create or continue next. Prefer Continue Working and Suggested Next.',
      studio: 'User is in Studio. Help organise projects and productions, find work, and keep momentum.',
      production:
        'User is inside a Production workspace. You already have that production loaded — never ask them to re-explain it.',
      library: 'User is in Library (scan history). Help find past scans and send ideas into Studio.',
      menu: 'User is in Menu. Help with preferences, appearance, and account settings.',
      profile: 'User is on Profile. Help with identity, plan, and personalisation.'
    };
    return map[surface] || 'Adapt to the current PreShoot surface.';
  }

  function buildToolManifest(surface) {
    return listTools(surface).map(function (t) {
      var actions = Object.keys(t.actions || {}).map(function (aid) {
        var a = t.actions[aid];
        return {
          id: aid,
          label: a.label || aid,
          mutates: !!a.mutates,
          description: a.description || ''
        };
      });
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        actions: actions
      };
    });
  }

  function buildOSContext(opts) {
    opts = opts || {};
    var surface = opts.surface || getSurface();
    var lines = [];
    lines.push('DIRECTOR OS');
    lines.push('Surface: ' + surface);
    lines.push(surfaceGuidance(surface));
    lines.push(
      'You are PreShoot’s creative operating system — not a generic chatbot. Be concise, confident, and human.'
    );
    lines.push(
      'Never ask the user to repeat context already provided. Prefer action over lectures.'
    );
    lines.push(
      'When the user wants to change data, propose an action for confirmation. Never claim you already renamed, archived, deleted, or moved something until the user confirms in the app.'
    );

    var manifest = buildToolManifest(surface);
    if (manifest.length) {
      lines.push('AVAILABLE TOOLS (propose; mutations need Confirm):');
      manifest.forEach(function (t) {
        var acts = (t.actions || [])
          .map(function (a) {
            return a.id + (a.mutates ? '*' : '');
          })
          .join(', ');
        lines.push('- ' + t.name + ' [' + t.id + ']: ' + acts);
      });
      lines.push('* = mutates user data (requires Confirm / Cancel).');
    }

    lines.push(
      'To propose an action, end your reply with a single line exactly like:'
    );
    lines.push(
      '[[ACTION:{"tool":"production","action":"rename_production","payload":{"productionId":"...","name":"..."}}]]'
    );
    lines.push('Only one ACTION block when confident. Otherwise ask a short clarifying question.');

    if (global.PreShootStudio && global.PreShootStudio.getDirectorContext) {
      try {
        var pid = (global.S && global.S.activeProductionId) || null;
        var ctx = global.PreShootStudio.getDirectorContext(pid);
        if (ctx) {
          lines.push('STUDIO SNAPSHOT phase=' + (ctx.phase || '') + ' skill=' + (ctx.skillLevel || ''));
          if (ctx.project) lines.push('Active project: ' + ctx.project.name + ' (' + ctx.project.id + ')');
          if (ctx.production) {
            lines.push(
              'Active production: ' +
                ctx.production.name +
                ' [' +
                ctx.production.status +
                '] health ' +
                (ctx.production.healthScore != null ? ctx.production.healthScore : '?') +
                '%'
            );
            if (ctx.production.suggestions && ctx.production.suggestions.length) {
              lines.push(
                'Suggestions: ' +
                  ctx.production.suggestions
                    .map(function (s) {
                      return s.text;
                    })
                    .join(' | ')
              );
            }
          } else if (ctx.home && ctx.home.nextAction) {
            lines.push('Home next: ' + (ctx.home.nextAction.text || ''));
          }
        }
      } catch (e) {}
    }

    return lines.join('\n');
  }

  /* Lightweight natural-language intent → proposed action (foundation, not exhaustive) */
  function matchIntent(message, opts) {
    opts = opts || {};
    var text = String(message || '').trim();
    if (!text) return null;
    var lower = text.toLowerCase();
    var surface = opts.surface || getSurface();
    var S = global.S || {};
    var Studio = global.PreShootStudio;
    var productionId =
      opts.productionId ||
      S.activeProductionId ||
      (S.studioView && S.studioView.productionId) ||
      null;
    var projectId =
      opts.projectId || (S.studioView && S.studioView.projectId) || null;

    function renameTarget(prefix) {
      var m = text.match(new RegExp(prefix + '\\s+[\\\'\"]?(.+?)[\\\'\"]?\\s*$', 'i'));
      return m ? m[1].replace(/[?.!]+$/, '').trim() : null;
    }

    if (/\b(rename|call)\b.+\b(production|this)\b/i.test(lower) || /^rename\b/i.test(lower)) {
      var newName = renameTarget('(?:to|as)');
      if (!newName) {
        var parts = text.split(/\bto\b/i);
        if (parts.length > 1) newName = parts[parts.length - 1].replace(/[?.!]+$/, '').trim();
      }
      if (newName && productionId) {
        return {
          tool: 'production',
          action: 'rename_production',
          payload: { productionId: productionId, name: newName },
          confidence: 0.82,
          source: 'intent'
        };
      }
    }

    if (/\b(rename|call)\b.+\bproject\b/i.test(lower)) {
      var pname = renameTarget('(?:to|as)');
      if (!pname) {
        var pp = text.split(/\bto\b/i);
        if (pp.length > 1) pname = pp[pp.length - 1].replace(/[?.!]+$/, '').trim();
      }
      if (pname && projectId) {
        return {
          tool: 'project',
          action: 'rename_project',
          payload: { projectId: projectId, name: pname },
          confidence: 0.8,
          source: 'intent'
        };
      }
    }

    if (/\b(archive)\b.+\b(production|this)\b/i.test(lower) || /\barchive this\b/i.test(lower)) {
      if (productionId) {
        return {
          tool: 'production',
          action: 'archive_production',
          payload: { productionId: productionId },
          confidence: 0.85,
          source: 'intent'
        };
      }
    }

    if (/\b(delete)\b.+\b(production|this)\b/i.test(lower)) {
      if (productionId) {
        return {
          tool: 'production',
          action: 'delete_production',
          payload: { productionId: productionId },
          confidence: 0.8,
          source: 'intent'
        };
      }
    }

    if (/\b(create|new)\b.+\bproject\b/i.test(lower)) {
      var cn = renameTarget('(?:called|named)');
      return {
        tool: 'project',
        action: 'create_project',
        payload: { name: cn || 'Untitled Project' },
        confidence: 0.75,
        source: 'intent'
      };
    }

    if (/\b(create|new)\b.+\bproduction\b/i.test(lower) && projectId) {
      var cnp = renameTarget('(?:called|named)');
      return {
        tool: 'production',
        action: 'create_production',
        payload: { projectId: projectId, name: cnp || 'Untitled Production' },
        confidence: 0.75,
        source: 'intent'
      };
    }

    if (/\b(generate|build|make)\b.+\b(script|shot\s*list|sections|workspace)\b/i.test(lower) && productionId) {
      return {
        tool: 'production',
        action: 'generate_sections',
        payload: { productionId: productionId },
        confidence: 0.78,
        source: 'intent'
      };
    }

    if (/\b(find|open|show)\b.+\b(project|production)\b/i.test(lower) || /\bfind my\b/i.test(lower)) {
      var q = text
        .replace(/^(find|open|show|search for)\s+(my\s+)?/i, '')
        .replace(/\b(project|production)\b/gi, '')
        .trim();
      if (q) {
        return {
          tool: 'studio',
          action: 'find_projects',
          payload: { query: q },
          confidence: 0.7,
          source: 'intent',
          mutates: false
        };
      }
    }

    if (/\b(instagram|tiktok|youtube|reels|shorts)\b/i.test(lower) && /\b(platform|primary|switch|change)\b/i.test(lower)) {
      var plat = (lower.match(/\b(instagram(?:\s+reels)?|tiktok|youtube(?:\s+shorts)?|reels|shorts)\b/i) || [])[0];
      return {
        tool: 'settings',
        action: 'set_primary_platform',
        payload: { platform: plat },
        confidence: 0.72,
        source: 'intent'
      };
    }

    if (surface === 'home' && /\b(what should i|what next|continue|work on)\b/i.test(lower)) {
      return {
        tool: 'studio',
        action: 'organize_projects',
        payload: {},
        confidence: 0.65,
        source: 'intent',
        mutates: false
      };
    }

    return null;
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

  function executeProposed(proposal, opts) {
    opts = opts || {};
    if (!proposal || !proposal.action) return { ok: false, error: 'no_proposal' };
    var Studio = global.PreShootStudio;
    var meta = null;
    Object.keys(TOOLS).forEach(function (tid) {
      var a = TOOLS[tid].actions[proposal.action];
      if (a) meta = a;
    });

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

    return Studio.handleDirectorAction(proposal.action, proposal.payload || {}, {
      confirmed: !!opts.confirmed || !mutates
    });
  }

  function proposeToUI(proposal) {
    if (!proposal) return false;
    if (global.PreShootStudioUI && typeof global.PreShootStudioUI.proposeDirectorAction === 'function') {
      global.PreShootStudioUI.proposeDirectorAction(proposal.action, proposal.payload || {});
      return true;
    }
    return false;
  }

  /* ── Built-in tools ── */
  registerTool({
    id: 'project',
    name: 'Project Tool',
    description: 'Create, rename, archive, and organise projects.',
    surfaces: ['*', 'studio', 'home', 'production'],
    actions: {
      create_project: {
        label: 'Create project',
        mutates: true,
        description: 'Create a new project'
      },
      rename_project: {
        label: 'Rename project',
        mutates: true,
        description: 'Rename an existing project'
      },
      archive_project: {
        label: 'Archive project',
        mutates: true,
        description: 'Archive a project'
      }
    }
  });

  registerTool({
    id: 'production',
    name: 'Production Tool',
    description: 'Manage productions, status, scripts, and scans.',
    surfaces: ['*', 'studio', 'production', 'home'],
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
    id: 'studio',
    name: 'Studio Tool',
    description: 'Search and organise the Studio workspace.',
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
    description: 'Find scans and saved ideas in Library.',
    surfaces: ['*', 'library', 'home'],
    actions: {
      search_assets: { label: 'Search library', mutates: false }
    }
  });

  registerTool({
    id: 'settings',
    name: 'Settings Tool',
    description: 'Update personalisation and preferences.',
    surfaces: ['*', 'menu', 'profile', 'home'],
    actions: {
      set_primary_platform: {
        label: 'Set primary platform',
        mutates: true,
        description: 'Update platform focus',
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
    description: 'Help with profile and plan context (read-mostly foundation).',
    surfaces: ['*', 'profile', 'menu'],
    actions: {}
  });

  global.PreShootDirectorOS = {
    registerTool: registerTool,
    listTools: listTools,
    getAction: getAction,
    getSurface: getSurface,
    surfaceGuidance: surfaceGuidance,
    buildToolManifest: buildToolManifest,
    buildOSContext: buildOSContext,
    matchIntent: matchIntent,
    parseActionFromReply: parseActionFromReply,
    stripActionMarker: stripActionMarker,
    executeProposed: executeProposed,
    proposeToUI: proposeToUI,
    TOOLS: TOOLS
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
