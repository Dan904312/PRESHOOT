/**
 * Structured Director context builder.
 * Isolates production / project as the subject. PreShoot product copy stays
 * server-side for identity questions only.
 *
 * Priority: production > project > assets > references > creator > performance > trends
 */
(function (global) {
  'use strict';

  /* The script gets its own generous budget: truncating it is what made
   * Director plan shots from a fragment of the story. */
  var MAX_SCRIPT_CHARS = 6000;

  function str(v) {
    return String(v == null ? '' : v);
  }

  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '...' : s;
  }

  /** Like clip, but keeps line breaks so script structure survives. */
  function clipBlock(s, n) {
    s = str(s).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (s.length <= n) return s;
    return s.slice(0, n) + '\n[script truncated at ' + n + ' characters]';
  }

  function push(lines, label, value) {
    var v = clip(value, 400);
    if (v) lines.push(label + ': ' + v);
  }

  function listAssets(refs, assets) {
    var out = [];
    (Array.isArray(assets) ? assets : []).slice(0, 16).forEach(function (a) {
      if (!a) return;
      out.push(
        clip(
          (a.name || a.filename || a.type || 'asset') +
            (a.kind ? ' (' + a.kind + ')' : '') +
            (a.note ? ': ' + a.note : ''),
          160
        )
      );
    });
    return out;
  }

  function flattenReferences(refs) {
    var out = [];
    if (!refs || typeof refs !== 'object') return out;
    ['youtube', 'capcut', 'uploads', 'other', 'pinterest', 'trending', 'tiktok', 'instagram'].forEach(function (k) {
      var arr = refs[k];
      if (!Array.isArray(arr)) return;
      arr.slice(0, 8).forEach(function (r) {
        if (!r) return;
        out.push({
          platform: k,
          title: r.title || r.name || '',
          url: r.url || '',
          creator: r.channel || r.creator || '',
          note: r.note || r.why || ''
        });
      });
    });
    return out;
  }

  function assessSufficiency(pack) {
    var prod = pack.production;
    var hasName = !!(prod && prod.name);
    var hasBrief = !!(
      prod &&
      (prod.overview && (prod.overview.summary || prod.overview.goal)) ||
      (prod.ideaSnapshot && (prod.ideaSnapshot.title || prod.ideaSnapshot.hook)) ||
      (prod.notes && String(prod.notes).trim())
    );
    if (prod && hasName && hasBrief) return 'enough';
    if (prod && hasName) return 'partial';
    if (pack.idea && pack.idea.title) return 'partial';
    return 'insufficient';
  }

  function productionBelongsToProject(productionId, projectId) {
    if (!productionId || !global.PreShootStudio) return false;
    try {
      var found = PreShootStudio.findProduction(productionId);
      if (!found || !found.project) return false;
      if (!projectId) return true;
      return String(found.project.id) === String(projectId);
    } catch (e) {
      return false;
    }
  }

  /**
   * Live Studio focus only. Does not invent records. Never returns a production
   * from a different project than the open project view.
   */
  function resolveLiveStudioFocus() {
    var S = global.S || {};
    var view = S.studioView || {};
    var productionId = null;
    var projectId = null;

    if (view.mode === 'production' && view.productionId) {
      productionId = view.productionId;
      projectId = view.projectId || null;
    } else if (view.mode === 'project' && view.projectId) {
      projectId = view.projectId;
      var candidate = view.productionId || null;
      if (candidate && productionBelongsToProject(candidate, projectId)) {
        productionId = candidate;
      }
    }

    if (productionId && global.PreShootStudio) {
      try {
        var found = PreShootStudio.findProduction(productionId);
        if (found && found.project) {
          projectId = found.project.id;
        } else {
          productionId = null;
        }
      } catch (e) {
        productionId = null;
      }
    } else if (projectId && global.PreShootStudio && PreShootStudio.findProject) {
      try {
        if (!PreShootStudio.findProject(projectId)) projectId = null;
      } catch (e) {
        projectId = null;
      }
    }

    return { productionId: productionId || null, projectId: projectId || null };
  }

  /**
   * @param {object} [opts]
   * @param {object} [opts.bound] conversation-bound ids
   */
  function resolveFocus(opts) {
    opts = opts || {};
    var S = global.S || {};
    var bound = opts.bound || null;
    var tab = S.tab || '';
    var fromBound = !!opts.fromBound;

    if (bound && (bound.productionId || bound.projectId)) {
      var bProd = bound.productionId || null;
      var bProj = bound.projectId || null;
      if (bProd && !productionBelongsToProject(bProd, bProj)) {
        bProd = null;
      }
      if (bProd && global.PreShootStudio) {
        try {
          var bf = PreShootStudio.findProduction(bProd);
          if (bf && bf.project) bProj = bf.project.id;
          else bProd = null;
        } catch (e) {
          bProd = null;
        }
      }
      if (bProd || bProj) return { productionId: bProd, projectId: bProj };
      if (fromBound || tab === 'director') return { productionId: null, projectId: null };
    }

    if (tab === 'studio') return resolveLiveStudioFocus();

    if (tab === 'director') {
      var session = S.dirSessionFocus || null;
      if (!fromBound && session && (session.productionId || session.projectId)) {
        return resolveFocus({ bound: session, fromBound: true });
      }
      return { productionId: null, projectId: null };
    }

    return { productionId: null, projectId: null };
  }

  /**
   * @param {object} opts
   * @param {string} [opts.task] script | shots | ideas | trends | general
   * @param {object} [opts.bound]
   */
  function build(opts) {
    opts = opts || {};
    var S = global.S || {};
    var task = opts.task || 'general';
    var n = S.niche || {};
    var pf = S.platformFocus || {};
    var ae = S.aesthetic || {};
    var gr = S.gear || {};
    var lines = [];

    lines.push('CONTEXT CONTRACT');
    lines.push('Task: ' + task);
    lines.push('Use sections below in this order of authority. Never treat PreShoot (the app) as the subject of a script, advert, or idea unless the current production is actually about PreShoot.');

    var focus = resolveFocus({ bound: opts.bound || null });
    var pctx = null;
    if (global.PreShootStudio && focus.productionId) {
      try {
        pctx = PreShootStudio.getDirectorContext(focus.productionId);
      } catch (e) {
        pctx = null;
      }
    }
    if ((!pctx || !pctx.project) && focus.projectId && global.PreShootStudio && PreShootStudio.findProject) {
      try {
        var pj = PreShootStudio.findProject(focus.projectId);
        if (pj) {
          pctx = pctx || { project: null, production: null };
          pctx.project = { id: pj.id, name: pj.name, description: pj.notes || pj.description || '' };
        }
      } catch (e) {}
    }
    global.__preshootDirectorProduction = pctx;
    global.__preshootDirectorFocus = focus;

    var production = pctx && pctx.production;
    var project = pctx && pctx.project;
    var pack = {
      production: production,
      project: project,
      idea: S.dirActiveIdea || (production && production.ideaSnapshot) || null
    };
    var sufficiency = assessSufficiency(pack);

    lines.push('');
    lines.push('=== CURRENT PRODUCTION (highest priority) ===');
    if (production) {
      lines.push('PRODUCTION_ID: ' + (production.id || ''));
      push(lines, 'Production name', production.name);
      push(lines, 'Status', production.status);
      if (production.progress != null) lines.push('Progress: ' + production.progress + '%');
      var ov = production.overview || {};
      push(lines, 'Goal', ov.goal);
      push(lines, 'Summary', ov.summary);
      push(lines, 'Platform', ov.platform);
      push(lines, 'Format', ov.format);
      push(lines, 'Audience', ov.audience);
      push(lines, 'Tone', ov.tone);
      push(lines, 'Notes', production.notes);
      if (production.ideaSnapshot) {
        push(lines, 'Selected concept', production.ideaSnapshot.title);
        push(lines, 'Selected hook', production.ideaSnapshot.hook);
        if (production.ideaSnapshot.selectedHookIndexes && production.ideaSnapshot.selectedHookIndexes.length) {
          lines.push('Selected hook indexes: ' + production.ideaSnapshot.selectedHookIndexes.join(', '));
        }
        if (production.ideaSnapshot.altHooks && production.ideaSnapshot.altHooks.length) {
          lines.push('Other hooks: ' + production.ideaSnapshot.altHooks.filter(Boolean).join(' | '));
        }
      }
      if (production.scanRef && (production.scanRef.mainSubject || production.scanRef.sceneLabel)) {
        push(lines, 'Scan subject', production.scanRef.mainSubject || production.scanRef.sceneLabel);
      }
      if (task !== 'trends') {
        if (production.shotList && production.shotList.length) {
          lines.push('SHOT LIST (' + production.shotList.length + '):');
          production.shotList.slice(0, 24).forEach(function (sh) {
            var covers = (sh.scriptCoverage || [])
              .map(function (c) {
                return clip(c && c.text, 90);
              })
              .filter(Boolean);
            lines.push(
              'Shot ' +
                (sh.order || '') +
                ' [' +
                (sh.section || sh.shotTypeLabel || '') +
                ' / ' +
                (sh.durationSec || '?') +
                's] ' +
                clip(sh.title || sh.purpose || '', 80) +
                ': ' +
                clip(sh.visual || sh.framing || sh.notes || sh.cameraMovement || '', 160) +
                (covers.length ? ' | covers: ' + covers.join(' + ') : '')
            );
          });
          if (production.shotList.length > 24) {
            lines.push('(' + (production.shotList.length - 24) + ' more shots not listed)');
          }
        }
        /* The full script, verbatim and unsplit. Shot planning is only
         * possible when the whole thing is readable in one place. */
        var fullScript = str(production.scriptBody);
        if (fullScript) {
          lines.push('');
          lines.push('=== FULL SCRIPT (read all of it before planning anything) ===');
          lines.push(clipBlock(fullScript, MAX_SCRIPT_CHARS));
          lines.push('=== END OF SCRIPT ===');
        } else if (production.scriptLines && production.scriptLines.length) {
          lines.push('SCRIPT LINES:');
          production.scriptLines.forEach(function (ln) {
            lines.push((ln.shotOrder ? 'Shot ' + ln.shotOrder + ': ' : '') + '"' + clip(ln.text, 400) + '"');
          });
        } else {
          lines.push('SCRIPT: none written yet.');
        }
      }
    } else {
      lines.push('No active production is selected.');
    }

    lines.push('');
    lines.push('=== CURRENT PROJECT ===');
    if (project) {
      lines.push('PROJECT_ID: ' + (project.id || ''));
      push(lines, 'Project name', project.name);
      push(lines, 'Project description', project.description);
      push(lines, 'Project goal', project.goal);
      push(lines, 'Project type', project.type);
      if (project.productionCount) lines.push('Productions in this project: ' + project.productionCount);
      lines.push(
        'ISOLATION RULE: this project and production are the only subject. Never carry a subject, brand, product, or audience over from another project.'
      );
    } else {
      lines.push('No project bound.');
    }

    /* Compact internal brief so the model does not have to re-derive the
     * basics from prose on every turn. Not shown to the user. */
    var brief = synthesizeBrief(pack, S);
    lines.push('');
    lines.push('=== PRODUCTION BRIEF (internal synthesis, do not quote back) ===');
    lines.push(JSON.stringify(brief));

    lines.push('');
    lines.push('=== PRODUCTION CONSTRAINTS (shot lists must be filmable with these) ===');
    var constraintBits = [];
    if (brief.productionConstraints.gear) constraintBits.push('Gear: ' + brief.productionConstraints.gear);
    if (brief.productionConstraints.skillLevel) constraintBits.push('Skill: ' + brief.productionConstraints.skillLevel);
    if (brief.productionConstraints.crew) constraintBits.push('Crew: ' + brief.productionConstraints.crew);
    if (brief.productionConstraints.locations) constraintBits.push('Locations: ' + brief.productionConstraints.locations);
    if (constraintBits.length) lines.push(constraintBits.join(' | '));
    else lines.push('No gear or crew declared. Assume a phone, no crew, one location, available light.');
    lines.push(
      'Do not propose cranes, dollies, drones, extra actors, or lighting the creator has not listed. If a shot needs gear they do not have, choose an achievable alternative.'
    );

    if (task !== 'trends') {
      lines.push('');
      lines.push('=== ASSETS ===');
      var assetLines = listAssets(null, production && production.assets);
      if (assetLines.length) assetLines.forEach(function (a) { lines.push('- ' + a); });
      else if (production) lines.push('Asset count: ' + (production.assetCount || 0) + '. No filenames available.');
      else lines.push('None.');

      lines.push('');
      lines.push('=== REFERENCES ===');
      var refs = flattenReferences(production && production.references);
      if (refs.length) {
        refs.forEach(function (r) {
          lines.push(
            '- [' +
              r.platform +
              '] ' +
              clip(r.title, 120) +
              (r.creator ? ' · ' + clip(r.creator, 60) : '') +
              (r.url ? ' · ' + clip(r.url, 120) : '') +
              (r.note ? ' · ' + clip(r.note, 100) : '')
          );
        });
      } else {
        lines.push('None saved on this production.');
      }
    }

    lines.push('');
    lines.push('=== CREATOR PROFILE ===');
    var niche = n.primaryNiche || n.contentType;
    push(lines, 'Niche', niche);
    if (n.secondaryNiche) push(lines, 'Also shoots', n.secondaryNiche);
    var plat = pf.primaryPlatform || (pf.platforms && pf.platforms[0]) || n.platform;
    push(lines, 'Primary platform', plat);
    if (pf.platforms && pf.platforms.length) lines.push('Platforms: ' + pf.platforms.join(', '));
    if (pf.contentStyles && pf.contentStyles.length) lines.push('Content styles: ' + pf.contentStyles.join(', '));
    push(lines, 'Skill level', n.experienceLevel || n.skillLevel);
    var goals = Array.isArray(n.goals) ? n.goals.join(', ') : n.goals || '';
    push(lines, 'Goals', goals);
    if (ae.aesthetics && ae.aesthetics.length) lines.push('Visual aesthetic: ' + ae.aesthetics.join(', '));
    if (ae.colorPalette && ae.colorPalette.length) lines.push('Preferred colour palette: ' + ae.colorPalette.join(', '));
    push(lines, 'Lighting preference', ae.lighting);
    if (ae.cameraMovements && ae.cameraMovements.length) lines.push('Camera movement: ' + ae.cameraMovements.join(', '));
    if (ae.shotStyles && ae.shotStyles.length) lines.push('Shot styles: ' + ae.shotStyles.join(', '));
    push(lines, 'Pacing', ae.pacing);
    var gearBits = [];
    ['camera', 'lens', 'drone', 'microphone', 'lighting', 'gimbal'].forEach(function (k) {
      if (gr[k]) gearBits.push(k + ': ' + gr[k]);
    });
    if (gr.editingSoftware && gr.editingSoftware.length) gearBits.push('Edit: ' + gr.editingSoftware.join(', '));
    if (gearBits.length) lines.push('Gear: ' + gearBits.join(' | '));
    else if (n.gear) push(lines, 'Gear', n.gear);
    if (n.style) push(lines, 'Style notes', n.style);
    if (n.extraContext) push(lines, 'Extra context', n.extraContext);

    if (S.dirActiveIdea && task !== 'trends') {
      var di = S.dirActiveIdea;
      lines.push('');
      lines.push('=== CURRENT IDEA ===');
      push(lines, 'Idea title', di.title);
      push(lines, 'Format', di.category);
      var hookList =
        global.PreShootHooks && PreShootHooks.allHooks
          ? PreShootHooks.allHooks(di)
          : [di.primaryHook || di.hook].concat(di.altHooks || []).filter(Boolean);
      var selected = di.selectedHookIndexes || [];
      hookList.forEach(function (hk, i) {
        var mark = selected.indexOf(i) >= 0 ? ' (selected)' : '';
        push(lines, 'Hook ' + (i + 1) + mark, hk);
      });
      if (di.hook) push(lines, 'Active spoken hook', di.hook);
      if (di.hookWhy) push(lines, 'Why hook works', di.hookWhy);
      if (di.shotAngle || di.shot) push(lines, 'Shot approach', di.shotAngle || di.shot);
      if (di.editingStyle) push(lines, 'Edit style', di.editingStyle);
      if (di.audio) push(lines, 'Audio', di.audio);
      if (di.sceneLabel) push(lines, 'Scene', di.sceneLabel);
    }

    if (task === 'script' || task === 'general' || task === 'shots') {
      var perf = (production && production.performance) || {};
      var perfBits = [];
      ['views', 'likes', 'comments', 'shares', 'saves', 'watchTime', 'ctr', 'url', 'platform'].forEach(function (k) {
        if (perf[k]) perfBits.push(k + ': ' + perf[k]);
      });
      if (perf.notes) perfBits.push('Notes: ' + clip(perf.notes, 200));
      lines.push('');
      lines.push('=== PERFORMANCE HISTORY ===');
      if (perfBits.length) lines.push(perfBits.join(' | '));
      else lines.push('No performance records on this production.');
      var histPerf = [];
      try {
        histPerf = (global.S && S.prefs && Array.isArray(S.prefs.performanceHistory) && S.prefs.performanceHistory) || [];
      } catch (e) {
        histPerf = [];
      }
      if (histPerf.length) {
        lines.push('Imported video records (signals, not certainties):');
        histPerf.slice(0, 6).forEach(function (r) {
          lines.push(
            '- ' +
              clip(r.title || r.url || 'video', 80) +
              ' [' +
              (r.platform || '') +
              '] views=' +
              (r.views || '-') +
              ' likes=' +
              (r.likes || '-')
          );
        });
      }
    }

    if (task === 'ideas' || task === 'trends' || task === 'general') {
      lines.push('');
      lines.push('=== TRENDS (optional, relevance-gated) ===');
      var trendItems = [];
      if (global.PreShootTrending) {
        try {
          var peekFn = PreShootTrending.peekRelevant || PreShootTrending.peek;
          trendItems = peekFn.call(PreShootTrending, {
            niche: (global.S && S.niche && (S.niche.primaryNiche || S.niche.contentType)) || '',
            subject: (production && production.name) || '',
            scene: task
          }) || [];
        } catch (e) {
          trendItems = [];
        }
      }
      if (trendItems.length) {
        lines.push('Only use a trend if it fits this production, niche, and subject. Do not force unrelated news or celebrity trends.');
        trendItems.slice(0, 8).forEach(function (it) {
          lines.push(
            '- ' +
              clip(it.title, 100) +
              ' [' +
              (it.platform || '') +
              (it.region ? ' · ' + it.region : '') +
              ']'
          );
        });
      } else {
        lines.push('No live trend cache loaded. Do not invent trending topics.');
      }
    }

    lines.push('');
    lines.push('=== CONTEXT SUFFICIENCY: ' + sufficiency.toUpperCase() + ' ===');
    if (sufficiency === 'insufficient' && (task === 'script' || task === 'shots')) {
      lines.push(
        'If you cannot identify what this production is about from CURRENT PRODUCTION / PROJECT / IDEA, do not invent a brand or product. Tell the user you need a brief, reference, or description first.'
      );
    } else if (sufficiency === 'partial') {
      lines.push('Some production details are missing. Use what is present. Ask at most one clarifying question if a missing fact would change the output.');
    }

    if (pctx && pctx.home && !production) {
      var g = pctx.home;
      lines.push('');
      lines.push('=== HOME WORKSPACE (no production selected) ===');
      if (g.continueWorking) {
        var cw = g.continueWorking;
        lines.push(
          'Continue working: ' +
            ((cw.production && cw.production.name) || '') +
            ' in ' +
            ((cw.project && cw.project.name) || '')
        );
      }
      if (g.nextAction && g.nextAction.text) lines.push('Suggested next: ' + g.nextAction.text);
    }

    if (global.PreShootWorkspace && PreShootWorkspace.isShared && PreShootWorkspace.isShared()) {
      try {
        var wctx = PreShootWorkspace.getContext();
        lines.push('');
        lines.push(
          'SHARED WORKSPACE: ' +
            (wctx.activeWorkspaceName || 'Workspace') +
            ' (role: ' +
            (wctx.activeWorkspaceRole || '') +
            ')'
        );
        if (wctx.activeWorkspaceRevision != null) {
          lines.push('Workspace revision: ' + wctx.activeWorkspaceRevision);
        }
        var peers = (wctx.presence || []).filter(function (p) {
          return p && p.userId && !(S.authUser && p.userId === S.authUser.id);
        });
        if (peers.length) {
          lines.push(
            'People here: ' +
              peers
                .map(function (p) {
                  return (
                    (p.displayName || 'Collaborator') +
                    (p.editing ? ' (editing)' : '') +
                    (p.activeProductionId ? ' on a production' : '')
                  );
                })
                .join(', ')
          );
        }
        var acts = (wctx.recentActivity || []).slice(0, 6);
        if (acts.length) {
          lines.push('Recent workspace activity:');
          acts.forEach(function (a) {
            var who = a.name || 'Collaborator';
            var typ = a.type_label || a.activity_label || (a.change && a.change.type) || 'updated';
            var ent = a.entity_label || (a.change && a.change.entityLabel) || '';
            lines.push('- ' + who + ': ' + typ + (ent ? ' "' + ent + '"' : ''));
          });
        }
        var feedback = (wctx.commentFeedback || []).slice(0, 8);
        if (feedback.length) {
          lines.push('Unresolved collaborative feedback (workspace comments only):');
          feedback.forEach(function (f) {
            lines.push(
              '- ' +
                (f.author_name || 'Collaborator') +
                ' on ' +
                (f.target_type || 'item') +
                ': ' +
                String(f.body || '').slice(0, 120)
            );
          });
        }
        lines.push(
          'COLLAB RULE: Describe known activity and authorized workspace comments only. Never invent edits. Never use private personal Director history from other users.'
        );
        lines.push(
          'MUTATION RULE: Only owner/editor may mutate Studio. Commenter/viewer may summarize feedback and suggest changes but must not claim Studio was updated.'
        );
        if (wctx.activeWorkspaceRole === 'commenter' || wctx.activeWorkspaceRole === 'viewer') {
          lines.push(
            'CURRENT ROLE IS READ-ONLY FOR MUTATIONS: Do not emit Studio mutation tools. Summarize and suggest only.'
          );
        }
      } catch (e) {}
    }

    if (global.PreShootHooks && PreShootHooks.buildDirectorPromptSection) {
      lines.push(PreShootHooks.buildDirectorPromptSection());
    }

    if (task !== 'trends') {
      try {
        var hist = typeof global.getHistory === 'function' ? global.getHistory().slice(0, 5) : [];
        var lib = typeof global.getLib === 'function' ? global.getLib().slice(0, 5) : [];
        if (hist.length) {
          lines.push(
            'Recent scan locations: ' +
              hist.map(function (h) { return h.sceneLabel || h.sceneType; }).join(', ')
          );
        }
        if (lib.length) {
          lines.push('Saved ideas: ' + lib.map(function (i) { return i.title; }).join(', '));
        }
      } catch (e) {}
    }

    if (global.PreShootDirectorOS && PreShootDirectorOS.buildOSContext) {
      try {
        lines.push(PreShootDirectorOS.buildOSContext({ surface: PreShootDirectorOS.getSurface() }));
      } catch (e) {}
    }

    lines.push('');
    lines.push('SUBJECT RULE: The current production name and brief are the subject. Do not write scripts, ads, or hooks about PreShoot unless PRODUCTION name/brief is PreShoot.');
    lines.push('ACTION RULE: Propose data-changing actions for confirmation only.');

    return {
      text: lines.join('\n'),
      sufficiency: sufficiency,
      stages: stagesFor(pack, task)
    };
  }

  /**
   * The structured understanding Director should hold before generating:
   * what this video is, who it is for, and what it can realistically be.
   * Project and production values win over the creator's global profile.
   */
  function synthesizeBrief(pack, S) {
    S = S || {};
    var production = pack.production || null;
    var project = pack.project || null;
    var ov = (production && production.overview) || {};
    var idea = pack.idea || {};
    var n = S.niche || {};
    var pf = S.platformFocus || {};
    var ae = S.aesthetic || {};
    var gr = S.gear || {};

    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var v = clip(arguments[i], 240);
        if (v) return v;
      }
      return '';
    }

    var gearBits = [];
    ['camera', 'lens', 'gimbal', 'drone', 'microphone', 'lighting'].forEach(function (k) {
      if (gr[k]) gearBits.push(k + ': ' + gr[k]);
    });

    return {
      subject: pick(production && production.name, idea.title, project && project.name),
      audience: pick(ov.audience, idea.audience, n.audience, pf.audience),
      purpose: pick(ov.goal, project && project.goal, idea.whyItWorks),
      platform: pick(ov.platform, pf.primaryPlatform, (pf.platforms || [])[0], n.platform),
      format: pick(ov.format, idea.category),
      tone: pick(ov.tone, ae.tone, n.style),
      coreMessage: pick(ov.summary, idea.hook, production && production.notes),
      /* Left blank on purpose: the model derives these from the full script
       * rather than being handed a template to fill. */
      narrativeStructure: '',
      visualStyle: pick((ae.aesthetics || []).join(', '), ae.lighting, n.style),
      availableAssets: (production && production.assetCount) || 0,
      hasScript: !!(production && (production.scriptBody || (production.scriptLines || []).length)),
      hasShotList: !!(production && (production.shotList || []).length),
      productionConstraints: {
        gear: gearBits.join(' | ') || clip(n.gear, 160),
        skillLevel: clip(n.experienceLevel || n.skillLevel, 40),
        crew: clip(n.crew || n.team, 80),
        locations: clip(ov.locations || n.locations, 120)
      }
    };
  }

  function stagesFor(pack, task) {
    var stages = [];
    if (pack.production) stages.push('Reviewing production context');
    else stages.push('Reviewing workspace');
    if (pack.production && (pack.production.assetCount || (pack.production.assets && pack.production.assets.length))) {
      stages.push('Reviewing uploaded assets');
    }
    if (pack.production && pack.production.references) stages.push('Reviewing references');
    if (task === 'ideas' || task === 'trends' || task === 'general') stages.push('Checking current trends');
    stages.push('Reviewing creator profile');
    if (pack.production && pack.production.performance) stages.push('Checking performance notes');
    if (task === 'script') stages.push('Generating script');
    else if (task === 'shots') {
      /* Real stages of the planning pipeline, in the order they happen. */
      stages.push('Reading the full script');
      stages.push('Mapping narrative beats');
      stages.push('Planning visual coverage');
      stages.push('Checking shot continuity');
      stages.push('Finalising shot list');
    } else stages.push('Preparing reply');
    return stages;
  }

  function inferTask(message) {
    var m = String(message || '').toLowerCase();
    if (/\bscript\b|\bvoiceover\b|\bnarration\b|\bdialogue\b/.test(m)) return 'script';
    if (/\bshot list\b|\bshotlist\b|\bcamera\b|\bframing\b/.test(m)) return 'shots';
    if (/\btrend/.test(m)) return 'trends';
    if (/\bidea|\bhook|\bconcept/.test(m)) return 'ideas';
    return 'general';
  }

  global.PreShootDirectorContext = {
    build: build,
    inferTask: inferTask,
    flattenReferences: flattenReferences,
    resolveFocus: resolveFocus,
    resolveLiveStudioFocus: resolveLiveStudioFocus,
    synthesizeBrief: synthesizeBrief,
    MAX_SCRIPT_CHARS: MAX_SCRIPT_CHARS
  };
})(typeof window !== 'undefined' ? window : this);
