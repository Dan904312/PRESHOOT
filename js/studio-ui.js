/**
 * PreShoot Studio UI — Phase 2 polished workspace (builds on Phase 1 data layer).
 */
(function (global) {
  'use strict';

  var projectDraft = { step: 1, name: '', notes: '', coverImage: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function directorRequestBody(extra) {
    var body = Object.assign({}, extra || {});
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.workspaceIdForDirector
    ) {
      var wid = PreShootWorkspace.workspaceIdForDirector();
      if (wid) body.workspace_id = wid;
    }
    if (global.PreShootEntitlements && PreShootEntitlements.tz) {
      body.timezone = PreShootEntitlements.tz();
    }
    return body;
  }

  function Studio() {
    return global.PreShootStudio;
  }

  function openM(id) {
    if (typeof global.openM === 'function') global.openM(id);
  }

  function closeM(id) {
    if (typeof global.closeM === 'function') global.closeM(id);
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function noteStreak(kind) {
    if (global.PreShootEntitlements && PreShootEntitlements.recordActivity) {
      PreShootEntitlements.recordActivity(kind);
    }
  }

  function relativeTime(ts) {
    if (!ts) return 'Updated recently';
    var diff = Date.now() - Number(ts);
    if (diff < 0) diff = 0;
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'Updated just now';
    if (m < 60) return 'Updated ' + m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return 'Updated ' + h + 'h ago';
    var d = Math.floor(h / 24);
    if (d === 1) return 'Updated yesterday';
    if (d < 14) return 'Updated ' + d + ' days ago';
    var date = new Date(ts);
    return 'Updated ' + date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function statusChip(status) {
    var meta = Studio().STATUS_MAP[status] || { label: status || 'Planning', id: 'planning' };
    return (
      '<span class="st-chip st-' +
      esc(meta.id) +
      '"><span class="st-dot" aria-hidden="true"></span>' +
      esc(meta.label) +
      '</span>'
    );
  }

  function summaryPills(summary) {
    var parts = [];
    ['planning', 'ready', 'filming', 'editing', 'posted'].forEach(function (id) {
      var n = summary && summary[id] ? summary[id] : 0;
      if (!n) return;
      var label = (Studio().STATUS_MAP[id] && Studio().STATUS_MAP[id].label) || id;
      parts.push(
        '<span class="st-sum-pill st-' +
          esc(id) +
          '"><span class="st-dot"></span>' +
          esc(label) +
          ' ' +
          n +
          '</span>'
      );
    });
    return parts.length ? parts.join('') : '<span class="st-sum-empty">No productions yet</span>';
  }

  function progressBar(pct) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return (
      '<div class="st-progress" aria-label="' +
      p +
      '% complete"><div class="st-progress-fill" style="width:' +
      p +
      '%"></div></div>'
    );
  }

  /* ── Studio dashboard ── */
  function renderStudio() {
    var root = document.getElementById('studio-root');
    if (!root || !Studio()) return;
    var ctx = global.PreShootWorkspace && PreShootWorkspace.getContext
      ? PreShootWorkspace.getContext()
      : null;
    if (ctx && ctx.switching) return;

    var view = (global.S && global.S.studioView) || { mode: 'list' };
    if (view.mode === 'project' && view.projectId) {
      renderProjectDetail(root, view.projectId);
      return;
    }
    if (view.mode === 'production' && view.productionId) {
      renderProductionDetail(root, view.productionId);
      return;
    }

    var projects = Studio().listProjects();
    var h = '';
    h += '<div class="studio-shell studio-fade">';
    h += '<div class="studio-hd">';
    h += '<div class="studio-hd-text">';
    h += '<div class="studio-title">Studio</div>';
    var ctx = global.PreShootWorkspace && PreShootWorkspace.getContext ? PreShootWorkspace.getContext() : null;
    if (ctx && ctx.isShared) {
      h +=
        '<div class="studio-sub">' +
        esc(ctx.activeWorkspaceName || 'Shared workspace') +
        ' · ' +
        esc(ctx.activeWorkspaceRole || '') +
        (ctx.canEdit ? '' : ' · Read-only') +
        '</div>';
    } else {
      h += '<div class="studio-sub">Your creative workspace</div>';
    }
    h += '</div>';
    h += '<div class="studio-hd-actions">';
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.studioHeaderActionsHtml) {
      h += PreShootWorkspaceUI.studioHeaderActionsHtml();
    } else {
      h +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.openSearch()">Search</button>';
      h +=
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">New Project</button>';
    }
    h += '</div></div>';

    h += renderStudioRecents();
    h += renderDirectorCommandBar({
      placeholder: 'Tell Director what you’d like to do…',
      scope: 'studio'
    });

    if (!projects.length) {
      h +=
        '<div class="studio-empty">' +
        '<div class="studio-empty-ico" aria-hidden="true">' +
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>' +
        '</div>' +
        '<div class="studio-empty-t">No Projects Yet</div>' +
        '<div class="studio-empty-s">Start organizing your content ideas into creative projects.</div>' +
        (global.PreShootWorkspace &&
        PreShootWorkspace.isShared &&
        PreShootWorkspace.isShared() &&
        PreShootWorkspace.canEdit &&
        !PreShootWorkspace.canEdit()
          ? '<div class="ws-readonly-pill">Read-only workspace</div>'
          : '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">Create Project</button>') +
        '</div>';
      h += '</div>';
      root.innerHTML = h;
      setTimeout(function () {
        setDirectorGoState('idle');
      }, 0);
      return;
    }

    h += '<div class="studio-section-label" style="padding-left:20px;padding-right:20px">All Projects</div>';
    h += '<div class="studio-grid">';
    projects.forEach(function (p, i) {
      var cover = p.coverImage
        ? '<img class="st-cover" src="' + esc(p.coverImage) + '" alt="">'
        : '<div class="st-cover ph" aria-hidden="true"><span>' +
          esc((p.name || 'P').charAt(0).toUpperCase()) +
          '</span></div>';
      h +=
        '<article class="st-card st-project-card" style="animation-delay:' +
        i * 40 +
        'ms" onclick="PreShootStudioUI.openProject(\'' +
        esc(p.id) +
        '\')">' +
        cover +
        '<div class="st-card-body">' +
        '<div class="st-card-top">' +
        '<div class="st-card-title">' +
        esc(p.name) +
        '</div>' +
        '<div class="st-card-chev" aria-hidden="true">›</div>' +
        '</div>' +
        '<div class="st-card-meta">' +
        (p.productionCount || 0) +
        ' Production' +
        ((p.productionCount || 0) === 1 ? '' : 's') +
        '</div>' +
        '<div class="st-card-progress-row">' +
        '<span>Progress</span><strong>' +
        (p.progress || 0) +
        '%</strong></div>' +
        progressBar(p.progress || 0) +
        '<div class="st-card-sum">' +
        summaryPills(p.statusSummary) +
        '</div>' +
        '</div></article>';
    });
    h += '</div>';

    var archived = Studio().listProjects({ includeArchived: true }).filter(function (p) {
      return p.archived;
    });
    if (archived.length) {
      h += '<div class="studio-section-label">Archived</div><div class="studio-grid studio-grid-arch">';
      archived.forEach(function (p) {
        h +=
          '<article class="st-card st-project-card is-archived">' +
          '<div class="st-cover ph" aria-hidden="true"><span>' +
          esc((p.name || 'P').charAt(0).toUpperCase()) +
          '</span></div>' +
          '<div class="st-card-body">' +
          '<div class="st-card-title">' +
          esc(p.name) +
          '</div>' +
          '<div class="st-card-meta">Archived</div>' +
          '<div class="studio-inline-actions">' +
          '<button type="button" class="studio-btn ghost sm" onclick="event.stopPropagation();PreShootStudioUI.restoreProject(\'' +
          esc(p.id) +
          '\')">Restore</button>' +
          '<button type="button" class="studio-btn ghost sm danger" onclick="event.stopPropagation();PreShootStudioUI.deleteProject(\'' +
          esc(p.id) +
          '\')">Delete</button>' +
          '</div></div></article>';
      });
      h += '</div>';
    }
    h += '</div>';
    root.innerHTML = h;
    setTimeout(function () {
      setDirectorGoState('idle');
    }, 0);
  }

  function openProject(projectId) {
    if (!global.S) return;
    global.S.studioView = { mode: 'project', projectId: projectId };
    if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
      PreShootWorkspaceRealtime.scheduleTrack();
    }
    renderStudio();
  }

  function openProduction(productionId) {
    if (!global.S) return;
    Studio().setContinueWorking(productionId);
    var projectId = null;
    try {
      var found = Studio().findProduction(productionId);
      if (found && found.project) projectId = found.project.id;
    } catch (e) {}
    global.S.studioView = {
      mode: 'production',
      projectId: projectId,
      productionId: productionId,
      section: 'overview'
    };
    if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
      PreShootWorkspaceRealtime.scheduleTrack();
    }
    if (typeof global.goTab === 'function') global.goTab('studio');
    else renderStudio();
  }

  function backToList() {
    if (!global.S) return;
    global.S.studioView = { mode: 'list' };
    if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
      PreShootWorkspaceRealtime.scheduleTrack();
    }
    renderStudio();
  }

  function renderProjectDetail(root, projectId) {
    var project = Studio().findProject(projectId);
    if (!project) {
      backToList();
      return;
    }
    var enriched = Studio().listProjects({ includeArchived: true }).find(function (p) {
      return p.id === projectId;
    });
    var progress = enriched ? enriched.progress : Studio().projectProgress(project);
    var summary = enriched ? enriched.statusSummary : Studio().statusSummary(project);
    var prods = project.productions || [];

    var h = '';
    h += '<div class="studio-shell studio-fade">';
    h += '<div class="studio-detail-hd">';
    h +=
      '<button type="button" class="studio-back" onclick="PreShootStudioUI.backToList()" aria-label="Back to Studio">‹</button>';
    h += '<div class="studio-hd-text"><div class="studio-title">' + esc(project.name) + '</div>';
    h +=
      '<div class="studio-sub">' +
      prods.length +
      ' production' +
      (prods.length === 1 ? '' : 's') +
      '</div></div>';
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.workspaceSwitcherButtonHtml) {
      h += PreShootWorkspaceUI.workspaceSwitcherButtonHtml();
    }
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.getContext &&
      PreShootWorkspace.getContext().remoteUpdate
    ) {
      h +=
        '<button type="button" class="studio-btn ghost sm ws-remote-btn" onclick="PreShootWorkspaceUI.reviewRemoteUpdate()">Review update</button>';
    }
    h +=
      '<button type="button" class="studio-icon-btn" onclick="PreShootStudioUI.toggleProjectMenu(\'' +
      esc(projectId) +
      '\')" aria-label="Project options">⋯</button>';
    h += '</div>';

    h += '<div id="st-project-menu" class="st-overflow-menu" hidden>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.renameProjectPrompt(\'' +
      esc(projectId) +
      '\')">Rename</button>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.duplicateProject(\'' +
      esc(projectId) +
      '\')">Duplicate</button>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.archiveProject(\'' +
      esc(projectId) +
      '\')">Archive</button>';
    h +=
      '<button type="button" class="danger" onclick="PreShootStudioUI.deleteProject(\'' +
      esc(projectId) +
      '\')">Delete</button>';
    h += '</div>';

    if (project.coverImage) {
      h +=
        '<div class="st-project-hero"><img src="' +
        esc(project.coverImage) +
        '" alt=""></div>';
    }

    if (project.notes) {
      h += '<div class="st-project-desc">' + esc(project.notes) + '</div>';
    }

    h += '<div class="st-panel st-progress-panel">';
    h +=
      '<div class="st-card-progress-row"><span>Overall progress</span><strong>' +
      progress +
      '%</strong></div>';
    h += progressBar(progress);
    h += '<div class="st-card-sum">' + summaryPills(summary) + '</div>';
    h += '</div>';

    h += '<div class="studio-section-row">';
    h += '<div class="studio-section-label tight">Productions</div>';
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.openCreateProduction(\'' +
      esc(projectId) +
      '\')">+ New Production</button>';
    h += '</div>';

    if (!prods.length) {
      h +=
        '<div class="studio-empty compact">' +
        '<div class="studio-empty-t">No productions yet.</div>' +
        '<div class="studio-empty-s">Create a blank production or send an idea from a scan.</div>' +
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProduction(\'' +
        esc(projectId) +
        '\')">Create Production</button>' +
        '</div>';
    } else {
      h += '<div class="st-prod-list">';
      prods.forEach(function (prod, i) {
        var pct =
          typeof prod.progress === 'number'
            ? prod.progress
            : Studio().statusProgress(prod.status);
        h +=
          '<button type="button" class="st-prod-card" style="animation-delay:' +
          i * 35 +
          'ms" onclick="PreShootStudioUI.openProduction(\'' +
          esc(prod.id) +
          '\')">' +
          '<div class="st-prod-card-top">' +
          '<div class="st-prod-name">' +
          esc(prod.name) +
          '</div>' +
          statusChip(prod.status) +
          '</div>' +
          '<div class="st-prod-card-mid">' +
          '<strong>' +
          pct +
          '%</strong>' +
          '<span class="st-prod-updated">' +
          esc(relativeTime(prod.updatedAt || prod.createdAt)) +
          '</span></div>' +
          progressBar(pct) +
          '</button>';
      });
      h += '</div>';
    }

    h += renderDirectorCommandBar({
      placeholder: 'Ask Director to help with this project…',
      scope: 'project',
      projectId: projectId
    });

    h += '</div>';
    root.innerHTML = h;
    setTimeout(function () {
      setDirectorGoState('idle');
    }, 0);
  }


  function skillLevel() {
    if (Studio() && Studio().getSkillLevel) return Studio().getSkillLevel();
    var n = (global.S && global.S.niche) || {};
    return n.experienceLevel || n.skillLevel || 'intermediate';
  }

  function fmtRelative(ts) {
    if (!ts) return 'Just now';
    var d = Date.now() - ts;
    if (d < 60000) return 'Just now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  function shotFieldsForLevel(level) {
    var common = ['purpose', 'durationSec', 'framing', 'notes'];
    if (level === 'beginner') return common.concat(['beginnerTip', 'lighting', 'audio']);
    if (level === 'advanced')
      return common.concat([
        'cameraMovement',
        'lens',
        'gear',
        'lighting',
        'audio',
        'beginnerTip',
        'advancedDetail'
      ]);
    return common.concat(['cameraMovement', 'lighting', 'audio', 'gear', 'beginnerTip']);
  }

  function fieldLabel(key, level) {
    var map = {
      purpose: 'Purpose',
      durationSec: 'Estimated duration',
      framing: level === 'beginner' ? 'How to frame it' : 'Framing',
      cameraMovement: level === 'beginner' ? 'Camera move' : 'Camera movement',
      lens: 'Lens',
      gear: level === 'beginner' ? 'What you need' : 'Gear',
      lighting: 'Lighting',
      audio: 'Audio',
      notes: 'Notes',
      beginnerTip: 'Guidance',
      advancedDetail: 'Advanced detail'
    };
    return map[key] || key;
  }

  function ensureExpandedMap(productionId) {
    if (!global.__preshootShotExpanded) global.__preshootShotExpanded = {};
    if (!global.__preshootShotExpanded[productionId]) global.__preshootShotExpanded[productionId] = {};
    return global.__preshootShotExpanded[productionId];
  }


  function renderOverviewSection(prod, project, productionId, ov, pct) {
    var idea = prod.ideaSnapshot || {};
    var scan = prod.scanRef || {};
    var statusLabel = (Studio().STATUS_MAP[prod.status] || {}).label || prod.status;
    var health = Studio().computeProductionHealth
      ? Studio().computeProductionHealth(prod)
      : { score: prod.healthScore || 0, missing: [] };
    var suggestions = Studio().getProductionSuggestions
      ? Studio().getProductionSuggestions(productionId)
      : [];
    var timeline = prod.timeline || [];
    var h = '';
    h += '<div class="pw-card pw-overview-card">';
    h += '<div class="pw-card-kicker">Production Overview</div>';
    h += '<div class="pw-overview-top">';
    if (prod.coverImage) {
      h += '<img class="pw-overview-thumb" src="' + esc(prod.coverImage) + '" alt="">';
    } else {
      h += '<div class="pw-overview-thumb ph" aria-hidden="true"></div>';
    }
    h += '<div class="pw-overview-main">';
    h += '<div class="pw-overview-name">' + esc(prod.name) + '</div>';
    h += '<div class="pw-overview-meta-row">';
    h += statusChip(prod.status);
    h += '<span class="pw-meta-pill">' + pct + '%</span>';
    h += '<span class="pw-health-pill" title="Production health">Health ' + health.score + '%</span>';
    h += '<span class="pw-meta-muted">Edited ' + esc(fmtRelative(prod.updatedAt)) + '</span>';
    h += '</div>';
    h += '<div class="pw-overview-project">Project · ' + esc(project.name) + '</div>';
    h += '</div></div>';

    h += '<div class="pw-facts">';
    h += '<div class="pw-fact"><span class="pw-fact-l">Platform</span><span class="pw-fact-v">' + esc(ov.platform || 'Not set') + '</span></div>';
    h += '<div class="pw-fact"><span class="pw-fact-l">Format</span><span class="pw-fact-v">' + esc(ov.format || idea.category || 'Not set') + '</span></div>';
    h += '<div class="pw-fact"><span class="pw-fact-l">Goal</span><span class="pw-fact-v">' + esc(ov.goal || 'Not set') + '</span></div>';
    h += '<div class="pw-fact"><span class="pw-fact-l">Status</span><span class="pw-fact-v">' + esc(statusLabel) + '</span></div>';
    h += '</div>';

    if (
      global.PreShootWorkspaceComments &&
      PreShootWorkspaceComments.commentChipHtml
    ) {
      h +=
        '<div class="ws-comment-inline">' +
        PreShootWorkspaceComments.commentChipHtml(
          productionId,
          'production',
          productionId,
          'Production comments'
        ) +
        '</div>';
    }

    if (ov.summary || idea.hook || idea.title) {
      h += '<div class="pw-summary-block">';
      h += '<div class="pw-fact-l">Idea summary</div>';
      h += '<div class="pw-summary-text">' + esc(ov.summary || idea.title || '') + '</div>';
      if (idea.hook) h += '<div class="pw-summary-hook">“' + esc(idea.hook) + '”</div>';
      h += '</div>';
    }
    if (scan.sceneLabel || scan.mainSubject) {
      h += '<div class="pw-scan-line">Original scan · ' + esc(scan.mainSubject || scan.sceneLabel) + '</div>';
    }
    var realScript = Studio().hasRealScript ? Studio().hasRealScript(prod.workspace, idea) : false;
    var hasShots = !!(prod.workspace && prod.workspace.shotList && prod.workspace.shotList.length);
    if (realScript && hasShots) {
      h += '<div class="st-doc-ready">Production ready.</div>';
      h += '<div class="st-doc-actions">';
      h += '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.copyScript(\'' + esc(productionId) + '\')">Copy Script</button>';
      h += '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.copyShotList(\'' + esc(productionId) + '\')">Copy Shot List</button>';
      h += '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.exportScriptPdf(\'' + esc(productionId) + '\')">Script PDF</button>';
      h += '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.exportShotListPdf(\'' + esc(productionId) + '\')">Shot List PDF</button>';
      h += '<button type="button" class="studio-btn sm" onclick="PreShootStudioUI.exportPackagePdf(\'' + esc(productionId) + '\')">Export Production Package</button>';
      h += '</div>';
    }
    h += '</div>';

    if (suggestions.length) {
      global.__preshootOverviewSuggestions = suggestions;
      h += '<div class="pw-card">';
      h += '<div class="pw-card-kicker">Director suggestions</div>';
      suggestions.forEach(function (s, idx) {
        h += '<div class="pw-suggest-row">';
        h +=
          '<button type="button" class="pw-suggest-item" onclick="PreShootStudioUI.handleOverviewSuggestion(' +
          idx +
          ')">' +
          '<span class="pw-suggest-ico" aria-hidden="true">✦</span>' +
          '<span class="pw-suggest-text">' +
          esc(s.text) +
          '</span>' +
          '<span class="pw-chev" aria-hidden="true">›</span>' +
          '</button>';
        h += '</div>';
      });
      h += '</div>';
    } else {
      global.__preshootOverviewSuggestions = [];
    }

    if (timeline.length) {
      h += '<div class="pw-card">';
      h += '<div class="pw-card-kicker">Timeline</div>';
      h += '<div class="pw-timeline">';
      timeline
        .slice()
        .reverse()
        .slice(0, 8)
        .forEach(function (evt, i, arr) {
          h += '<div class="pw-tl-item">';
          h += '<div class="pw-tl-dot"></div>';
          h += '<div class="pw-tl-body">';
          h += '<div class="pw-tl-label">' + esc(evt.label || evt.type) + '</div>';
          h += '<div class="pw-tl-time">' + esc(fmtRelative(evt.at)) + '</div>';
          h += '</div></div>';
        });
      h += '</div></div>';
    }

    /* Editable essentials */
    h += '<div class="pw-card">';
    h += '<div class="pw-card-kicker">Details</div>';
    h += '<label class="st-label">Production name</label>';
    h +=
      '<input class="st-input" value="' +
      esc(prod.name) +
      '" onchange="PreShootStudioUI.saveProductionField(\'' +
      esc(productionId) +
      "','name',this.value)\">";
    h += '<label class="st-label">Summary</label>';
    h +=
      '<textarea class="st-input st-notes" rows="2" placeholder="What is this piece about?" onchange="PreShootStudioUI.saveWorkspaceField(\'' +
      esc(productionId) +
      "','overview','summary',this.value)\">" +
      esc(ov.summary || '') +
      '</textarea>';
    h += '<label class="st-label">Goal</label>';
    h +=
      '<input class="st-input" placeholder="e.g. Drive cafe foot traffic" value="' +
      esc(ov.goal || '') +
      '" onchange="PreShootStudioUI.saveWorkspaceField(\'' +
      esc(productionId) +
      "','overview','goal',this.value)\">";
    h += '<div class="st-two-col">';
    h += '<div><label class="st-label">Platform</label>';
    h +=
      '<input class="st-input" placeholder="TikTok / Reels / Shorts" value="' +
      esc(ov.platform || '') +
      '" onchange="PreShootStudioUI.saveWorkspaceField(\'' +
      esc(productionId) +
      "','overview','platform',this.value)\"></div>";
    h += '<div><label class="st-label">Format</label>';
    h +=
      '<input class="st-input" placeholder="Advert / UGC / BTS" value="' +
      esc(ov.format || '') +
      '" onchange="PreShootStudioUI.saveWorkspaceField(\'' +
      esc(productionId) +
      "','overview','format',this.value)\"></div>";
    h += '</div>';
    h += '<label class="st-label">Notes</label>';
    h +=
      '<textarea class="st-input st-notes" rows="2" placeholder="Tone, constraints, reminders…" onchange="PreShootStudioUI.saveProductionField(\'' +
      esc(productionId) +
      "','notes',this.value)\">" +
      esc(prod.notes || '') +
      '</textarea>';
    h += '</div>';

    if (global.PreShootWorkspaceComments && PreShootWorkspaceComments.reviewCardHtml) {
      h += PreShootWorkspaceComments.reviewCardHtml(productionId, prod);
    }

    h += '<div class="pw-card">';
    h += '<div class="pw-card-kicker">Production Tools</div>';
    h += '<div class="pw-tools">';
    [
      ['shots', 'Shot List', 'What to film'],
      ['script', 'Script', 'What to say'],
      ['refs', 'References', 'Inspiration'],
      ['trending', 'Trending', 'Public trends'],
      ['assets', 'Assets', 'Files & media'],
      ['performance', 'Performance', 'Results']
    ].forEach(function (tool) {
      h +=
        '<button type="button" class="pw-tool" onclick="PreShootStudioUI.setProdSection(\'' +
        esc(productionId) +
        "','" +
        tool[0] +
        '\')"><span class="pw-tool-t">' +
        tool[1] +
        '</span><span class="pw-tool-s">' +
        tool[2] +
        '</span></button>';
    });
    h += '</div></div>';
    if (global.PreShootCalendar && PreShootCalendar.planFromProduction) {
      h +=
        '<button type="button" class="studio-btn" style="width:100%;margin-top:10px" onclick="PreShootCalendar.planFromProduction(\'' +
        esc(productionId) +
        '\')">Plan posting date</button>';
    }
    return h;
  }

  function renderShotsSection(prod, productionId, ws) {
    var level = skillLevel();
    var shots = (ws.shotList || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    var expanded = ensureExpandedMap(productionId);
    var fields = shotFieldsForLevel(level);
    var realScript = Studio().hasRealScript ? Studio().hasRealScript(ws, prod.ideaSnapshot || {}) : false;
    var canEdit = studioCanMutate();
    var h = '';
    h += '<div class="pw-section-hd">';
    h += '<div><div class="pw-card-kicker">Shot List</div>';
    h +=
      '<div class="pw-section-sub">Adapted for <strong>' +
      esc(level) +
      '</strong> · each shot maps to a script beat</div></div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">';
    if (canEdit) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.generateShotList(\'' +
        esc(productionId) +
        '\')">Generate Shot List</button>';
    }
    if (shots.length) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.copyShotList(\'' +
        esc(productionId) +
        '\')">Copy Shot List</button>';
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.exportShotListPdf(\'' +
        esc(productionId) +
        '\')">Shot List PDF</button>';
    }
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.addShot(\'' +
      esc(productionId) +
      '\')">Add shot</button></div></div>';

    if (!shots.length) {
      h += '<div class="pw-card pw-empty-card">';
      if (realScript) {
        h += '<div class="studio-empty-t">Script ready.</div>';
        h += '<div class="studio-empty-s">Turn your script into a production-ready shot list. Shots will map to script sections.</div>';
        if (canEdit) {
          h +=
            '<button type="button" class="studio-btn" style="margin-top:12px" onclick="PreShootStudioUI.generateShotList(\'' +
            esc(productionId) +
            '\')">Generate Shot List</button>';
        }
      } else {
        h += '<div class="studio-empty-t">No shots yet</div>';
        h += '<div class="studio-empty-s">Generate a script first, then build a shot list from those beats — or add shots manually.</div>';
        h +=
          '<button type="button" class="studio-btn" style="margin-top:12px" onclick="PreShootStudioUI.setProdSection(\'' +
          esc(productionId) +
          "','script')\">Go to Script</button>";
      }
      h += '</div>';
      return h;
    }

    shots.forEach(function (shot, i) {
      var open = !!expanded[shot.id];
      var dur = typeof shot.durationSec === 'number' ? shot.durationSec + ' sec' : '—';
      h += '<div class="pw-shot-card' + (open ? ' open' : '') + '">';
      h +=
        '<button type="button" class="pw-shot-head" onclick="PreShootStudioUI.toggleShot(\'' +
        esc(productionId) +
        "','" +
        esc(shot.id) +
        '\')" aria-expanded="' +
        (open ? 'true' : 'false') +
        '">';
      h += '<div class="pw-shot-index">Shot ' + esc(String(shot.order || i + 1)) + '</div>';
      h += '<div class="pw-shot-head-main">';
      h += '<div class="pw-shot-purpose">' + esc(shot.purpose || 'Shot') + '</div>';
      if (shot.scriptLineId) {
        var scriptLines = (ws.script && ws.script.lines) || [];
        var si = -1;
        for (var li = 0; li < scriptLines.length; li++) {
          if (scriptLines[li].id === shot.scriptLineId) si = li;
        }
        if (si >= 0) {
          h += '<div class="pw-shot-dur">Script · Scene ' + (si + 1 < 10 ? '0' : '') + (si + 1) + '</div>';
        }
      }
      h += '<div class="pw-shot-dur">' + esc(dur) + '</div>';
      if (global.PreShootWorkspaceComments && PreShootWorkspaceComments.commentChipHtml) {
        h += PreShootWorkspaceComments.commentChipHtml(
          productionId,
          'shot',
          shot.id,
          'Shot comments'
        );
      }
      h += '</div>';
      h += '<span class="pw-chev" aria-hidden="true">' + (open ? '▴' : '▾') + '</span>';
      h += '</button>';
      if (open) {
        h += '<div class="pw-shot-body">';
        h += '<div class="pw-shot-field"><div class="pw-fact-l">Purpose</div>';
        h +=
          '<input class="st-input" value="' +
          esc(shot.purpose || '') +
          '" onchange="PreShootStudioUI.updateShotField(\'' +
          esc(productionId) +
          "','" +
          esc(shot.id) +
          "','purpose',this.value)\"></div>";
        h += '<div class="pw-shot-field"><div class="pw-fact-l">Estimated duration (sec)</div>';
        h +=
          '<input class="st-input" type="number" min="1" max="120" value="' +
          esc(String(shot.durationSec != null ? shot.durationSec : 3)) +
          '" onchange="PreShootStudioUI.updateShotField(\'' +
          esc(productionId) +
          "','" +
          esc(shot.id) +
          "','durationSec',parseInt(this.value,10)||3)\"></div>";
        if (level !== 'beginner') {
          ['framing', 'cameraMovement', 'lighting', 'audio', 'notes'].forEach(function (key) {
            h += '<div class="pw-shot-field"><div class="pw-fact-l">' + esc(fieldLabel(key, level)) + '</div>';
            h +=
              '<textarea class="st-input st-notes" rows="2" onchange="PreShootStudioUI.updateShotField(\'' +
              esc(productionId) +
              "','" +
              esc(shot.id) +
              "','" +
              key +
              "',this.value)\">" +
              esc(shot[key] || '') +
              '</textarea></div>';
          });
        } else {
          ['framing', 'notes', 'beginnerTip'].forEach(function (key) {
            h += '<div class="pw-shot-field"><div class="pw-fact-l">' + esc(fieldLabel(key, level)) + '</div>';
            h +=
              '<textarea class="st-input st-notes" rows="2" onchange="PreShootStudioUI.updateShotField(\'' +
              esc(productionId) +
              "','" +
              esc(shot.id) +
              "','" +
              key +
              "',this.value)\">" +
              esc(shot[key] || '') +
              '</textarea></div>';
          });
        }
        if (level === 'advanced') {
          ['lens', 'gear', 'advancedDetail'].forEach(function (key) {
            h += '<div class="pw-shot-field"><div class="pw-fact-l">' + esc(fieldLabel(key, level)) + '</div>';
            h +=
              '<textarea class="st-input st-notes" rows="2" onchange="PreShootStudioUI.updateShotField(\'' +
              esc(productionId) +
              "','" +
              esc(shot.id) +
              "','" +
              key +
              "',this.value)\">" +
              esc(shot[key] || '') +
              '</textarea></div>';
          });
        }
        h +=
          '<button type="button" class="studio-btn ghost danger sm" onclick="PreShootStudioUI.deleteShot(\'' +
          esc(productionId) +
          "','" +
          esc(shot.id) +
          '\')">Remove shot</button>';
        h += '</div>';
      }
      h += '</div>';
    });
    return h;
  }

  function renderScriptSection(prod, productionId, ws) {
    var lines = (ws.script && ws.script.lines) || [];
    var shots = ws.shotList || [];
    var realScript = Studio().hasRealScript ? Studio().hasRealScript(ws, prod.ideaSnapshot || {}) : lines.length > 0;
    var canEdit = studioCanMutate();
    var h = '';
    h += '<div class="pw-section-hd">';
    h += '<div><div class="pw-card-kicker">Script</div>';
    h += '<div class="pw-section-sub">What is said — dialogue, voiceover, narration. Not camera or visuals.</div>';
    if (global.PreShootWorkspaceComments && PreShootWorkspaceComments.commentChipHtml) {
      h += PreShootWorkspaceComments.commentChipHtml(
        productionId,
        'script',
        productionId,
        'Script comments'
      );
    }
    h += '</div>';
    h += '<div class="pw-section-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">';
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.openScriptFullscreen(\'' +
      esc(productionId) +
      '\')" title="Expand script editor" aria-label="Expand script editor">Write Script</button>';
    if (canEdit) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.generateScript(\'' +
        esc(productionId) +
        '\')">Generate Script</button>';
    }
    if (realScript) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.copyScript(\'' +
        esc(productionId) +
        '\')">Copy Script</button>';
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.exportScriptPdf(\'' +
        esc(productionId) +
        '\')">Script PDF</button>';
    }
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.addScriptLine(\'' +
      esc(productionId) +
      '\')">Add line</button></div></div>';

    if (!lines.length) {
      var body = (ws.script && ws.script.body) || '';
      if (body) {
        h += '<div class="pw-card">';
        h += '<div class="pw-section-sub" style="margin-bottom:10px">Legacy script — convert to line cards</div>';
        h +=
          '<button type="button" class="studio-btn" onclick="PreShootStudioUI.convertScriptBody(\'' +
          esc(productionId) +
          '\')">Convert to lines</button>';
        h +=
          '<textarea class="st-input st-notes st-script" style="margin-top:12px" rows="8" onchange="PreShootStudioUI.saveScript(\'' +
          esc(productionId) +
          "',this.value)\">" +
          esc(body) +
          '</textarea></div>';
      } else {
        h += '<div class="pw-card pw-empty-card">';
        h += '<div class="studio-empty-t">No script yet</div>';
        h += '<div class="studio-empty-s">Write your own or generate one from this production. The idea description is not a script.</div>';
        if (canEdit) {
          h +=
            '<button type="button" class="studio-btn" style="margin-top:12px" onclick="PreShootStudioUI.generateScript(\'' +
            esc(productionId) +
            '\')">Generate Script</button>';
          h +=
            '<button type="button" class="studio-btn ghost" style="margin-top:8px" onclick="PreShootStudioUI.openScriptFullscreen(\'' +
            esc(productionId) +
            '\')">Write Script</button>';
        }
        h += '</div>';
      }
      return h;
    }

    lines.forEach(function (line, i) {
      var shotLabel = line.shotOrder ? 'Shot ' + line.shotOrder : 'Unassigned';
      h += '<div class="pw-script-card">';
      h += '<div class="pw-script-quote">“' + esc(line.text || '') + '”</div>';
      h += '<div class="pw-script-link">↓</div>';
      h += '<div class="pw-script-shot">' + esc(shotLabel) + '</div>';
      h +=
        '<textarea class="st-input st-notes" rows="2" placeholder="Script line…" onchange="PreShootStudioUI.updateScriptLine(\'' +
        esc(productionId) +
        "','" +
        esc(line.id) +
        "',this.value)\">" +
        esc(line.text || '') +
        '</textarea>';
      h += '<label class="st-label">Linked shot</label>';
      h +=
        '<select class="st-input" onchange="PreShootStudioUI.linkScriptLine(\'' +
        esc(productionId) +
        "','" +
        esc(line.id) +
        "',this.value)\">";
      h += '<option value="">Unassigned</option>';
      shots.forEach(function (s) {
        var sel = line.shotId === s.id || line.shotOrder === s.order ? ' selected' : '';
        h +=
          '<option value="' +
          esc(s.id) +
          '"' +
          sel +
          '>Shot ' +
          esc(String(s.order)) +
          ' · ' +
          esc(s.purpose || '') +
          '</option>';
      });
      h += '</select>';
      h +=
        '<button type="button" class="studio-btn ghost danger sm" style="margin-top:8px" onclick="PreShootStudioUI.deleteScriptLine(\'' +
        esc(productionId) +
        "','" +
        esc(line.id) +
        '\')">Remove line</button>';
      h += '</div>';
    });
    return h;
  }

  function researchCacheKey(prod) {
    var idea = prod.ideaSnapshot || {};
    var ov = (prod.workspace && prod.workspace.overview) || {};
    return [
      prod.name || '',
      idea.title || '',
      idea.hook || '',
      idea.ytSearch || '',
      idea.capcutSearch || '',
      ov.summary || '',
      (global.S && global.S.niche && global.S.niche.contentType) || ''
    ].join('|').slice(0, 240);
  }

  function buildProductionResearchContext(prod) {
    var idea = prod.ideaSnapshot || {};
    var ov = (prod.workspace && prod.workspace.overview) || {};
    var base = global.PreShootResearch && PreShootResearch.buildContext
      ? PreShootResearch.buildContext(idea, global.S)
      : {};
    return Object.assign({}, base, {
      title: idea.title || prod.name || base.title || '',
      hook: idea.hook || base.hook || '',
      ytSearch: idea.ytSearch || base.ytSearch || '',
      capcutSearch: idea.capcutSearch || base.capcutSearch || '',
      editingStyle: idea.editingStyle || base.editingStyle || '',
      shotAngle: idea.shotAngle || base.shotAngle || '',
      whyItWorks: idea.whyItWorks || ov.summary || base.whyItWorks || '',
      category: idea.category || ov.format || base.category || '',
      platform: ov.platform || base.platform || ''
    });
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderRefsSection(prod, productionId, ws) {
    var refs = Studio().ensureWorkspace
      ? Studio().ensureWorkspace(prod).workspace.references
      : ws.references || {};
    refs = refs || {};
    var assets = (ws.assets || []).slice();
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">Assets &amp; References</div>';
    h +=
      '<div class="pw-section-sub">Inspiration and production files for this video</div></div></div>';

    /* ── YouTube ── */
    h += renderRefCategory({
      title: 'YouTube',
      platform: 'youtube',
      productionId: productionId,
      items: refs.youtube || [],
      empty: 'No YouTube references saved yet.',
      findLabel: 'Find YouTube references',
      broaden: true
    });

    /* ── CapCut ── */
    h += renderRefCategory({
      title: 'CapCut',
      platform: 'capcut',
      productionId: productionId,
      items: refs.capcut || [],
      empty: 'No CapCut template searches saved yet.',
      findLabel: 'Find CapCut templates',
      broaden: true
    });

    /* ── Uploaded assets ── */
    h += '<div class="pw-card ar-card" id="ar-uploads-' + esc(productionId) + '">';
    h += '<div class="ar-cat-hd"><div class="pw-card-kicker">Uploaded Assets</div>';
    var canUpload =
      !global.PreShootWorkspace ||
      !PreShootWorkspace.isShared ||
      !PreShootWorkspace.isShared() ||
      (PreShootWorkspace.canEdit && PreShootWorkspace.canEdit());
    if (canUpload) {
      h +=
        '<label class="studio-btn ghost sm ar-upload-btn">Upload<input type="file" accept="image/*,video/mp4,video/quicktime,audio/*,.pdf,.doc,.docx,.txt" hidden onchange="PreShootStudioUI.uploadProductionAsset(\'' +
        esc(productionId) +
        "',this)\"></label>";
    } else {
      h += '<span class="ws-readonly-pill">Read-only</span>';
    }
    h += '</div>';
    h += '<div class="ar-folders">';
    (Studio().ASSET_FOLDERS || ['Assets', 'Footage', 'Photos', 'Audio', 'References', 'Brand']).forEach(
      function (f) {
        h +=
          '<button type="button" class="ar-folder-chip" onclick="PreShootStudioUI.filterAssetFolder(\'' +
          esc(productionId) +
          "','" +
          esc(f) +
          '\')">' +
          esc(f) +
          '</button>';
      }
    );
    h += '</div>';
    h += '<div class="ar-status" id="ar-upload-status-' + esc(productionId) + '" hidden></div>';
    if (!assets.length && prod.coverImage) {
      assets = [
        {
          id: 'cover',
          type: 'image',
          kind: 'scan',
          name: 'Original scan',
          src: prod.coverImage,
          folder: 'Photos',
          uploadedAt: prod.createdAt || Date.now()
        }
      ];
    }
    if (!assets.length) {
      h += '<div class="pw-section-sub">No uploads yet. Add footage, photos, audio, or docs.</div>';
    } else {
      h += '<div class="ar-asset-list" id="ar-asset-list-' + esc(productionId) + '">';
      assets.forEach(function (a) {
        h += renderAssetCard(productionId, a);
      });
      h += '</div>';
    }
    h += '</div>';

    /* ── Other references ── */
    h += renderRefCategory({
      title: 'Other References',
      platform: 'other',
      productionId: productionId,
      items: (refs.other || []).concat(refs.pinterest || []),
      empty: 'No other references yet. Paste a link via Director or Save from research.',
      findLabel: null,
      broaden: false
    });

    if (
      (!(refs.youtube || []).length || !(refs.capcut || []).length) &&
      prod.ideaSnapshot &&
      (prod.ideaSnapshot.ytSearch || prod.ideaSnapshot.capcutSearch)
    ) {
      h +=
        '<button type="button" class="studio-btn" style="margin-top:8px" onclick="PreShootStudioUI.seedFromIdea(\'' +
        esc(productionId) +
        '\')">Seed from idea searches</button>';
    }

    var trendSaved = refs.trending || [];
    if (trendSaved.length) {
      h += renderRefCategory({
        title: 'Saved trend references',
        platform: 'trending',
        productionId: productionId,
        items: trendSaved,
        empty: '',
        findLabel: null,
        broaden: false
      });
    }
    return h;
  }

  function renderTrendingSection(prod, productionId) {
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">Trending</div>';
    h +=
      '<div class="pw-section-sub">Public trend cache — metadata and links only, no copyrighted media copies</div></div></div>';
    if (global.PreShootTrending && PreShootTrending.renderStudioPanel) {
      h += PreShootTrending.renderStudioPanel(productionId);
    } else {
      h += '<div class="pw-section-sub">Trending is unavailable in this session.</div>';
    }
    return h;
  }

  function renderAssetCard(productionId, a) {
    var out = '<div class="ar-asset-row" data-folder="' + esc(a.folder || 'Assets') + '">';
    if ((a.type === 'image' || (a.mime || '').indexOf('image/') === 0) && (a.src || a.url)) {
      out +=
        '<img class="ar-asset-thumb" src="' +
        esc(a.src || a.url) +
        '" alt="" loading="lazy">';
    } else {
      out +=
        '<div class="ar-asset-thumb ph">' +
        esc((a.type || 'file').slice(0, 4).toUpperCase()) +
        '</div>';
    }
    out += '<div class="ar-asset-meta">';
    out += '<div class="ar-asset-name">' + esc(a.name || 'Asset') + '</div>';
    out +=
      '<div class="ar-asset-sub">' +
      esc(a.folder || 'Assets') +
      ' · ' +
      esc(a.type || a.mime || 'file') +
      (a.sizeLabel || a.size ? ' · ' + esc(a.sizeLabel || formatBytes(a.size)) : '') +
      (a.uploadedAt
        ? ' · ' + esc(new Date(a.uploadedAt).toLocaleDateString())
        : '') +
      '</div></div>';
    out += '<div class="ar-asset-actions">';
    if (a.url || a.src) {
      out +=
        '<a class="studio-btn ghost sm" href="' +
        esc(a.url || a.src) +
        '" target="_blank" rel="noopener noreferrer">Open</a>';
    }
    if (a.id && a.id !== 'cover') {
      out +=
        '<button type="button" class="studio-btn ghost danger sm" onclick="PreShootStudioUI.removeProductionAsset(\'' +
        esc(productionId) +
        "','" +
        esc(a.id) +
        '\')">Delete</button>';
    }
    out += '</div></div>';
    return out;
  }

  function renderRefCategory(opts) {
    var h = '<div class="pw-card ar-card" id="ar-' + esc(opts.platform) + '-' + esc(opts.productionId) + '">';
    h += '<div class="ar-cat-hd"><div class="pw-card-kicker">' + esc(opts.title) + '</div>';
    if (opts.findLabel) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.findProductionReferences(\'' +
        esc(opts.productionId) +
        "','" +
        esc(opts.platform) +
        "',false)\">" +
        esc(opts.findLabel) +
        '</button>';
    }
    h += '</div>';
    h +=
      '<div class="ar-status" id="ar-status-' +
      esc(opts.platform) +
      '-' +
      esc(opts.productionId) +
      '" hidden></div>';
    h +=
      '<div class="ar-results" id="ar-results-' +
      esc(opts.platform) +
      '-' +
      esc(opts.productionId) +
      '"></div>';

    var items = opts.items || [];
    if (!items.length) {
      h += '<div class="pw-section-sub">' + esc(opts.empty) + '</div>';
    } else {
      items.forEach(function (item) {
        h += renderSavedRefCard(opts.productionId, opts.platform, item);
      });
    }
    if (opts.broaden) {
      h +=
        '<button type="button" class="studio-btn ghost sm" style="margin-top:8px" onclick="PreShootStudioUI.findProductionReferences(\'' +
        esc(opts.productionId) +
        "','" +
        esc(opts.platform) +
        "',true)\">Broaden search</button>";
    }
    h += '</div>';
    return h;
  }

  function renderSavedRefCard(productionId, platform, item) {
    var out = '<div class="ar-ref-card">';
    if (item.thumbnail) {
      out +=
        '<img class="ar-ref-thumb" src="' +
        esc(item.thumbnail) +
        '" alt="" loading="lazy">';
    } else {
      out +=
        '<div class="ar-ref-thumb ph">' +
        (platform === 'capcut' ? 'CC' : platform === 'youtube' ? 'YT' : '··') +
        '</div>';
    }
    out += '<div class="ar-ref-body">';
    out += '<div class="ar-ref-title">' + esc(item.title || item.query || 'Reference') + '</div>';
    var meta = [];
    if (item.channel) meta.push(item.channel);
    if (item.viewsLabel) meta.push(item.viewsLabel);
    if (item.publishedAt) meta.push(item.publishedAt);
    if (meta.length) out += '<div class="ar-ref-meta">' + esc(meta.join(' · ')) + '</div>';
    if (item.why || item.note) {
      out += '<div class="ar-ref-why">' + esc(item.why || item.note) + '</div>';
    }
    out += '<div class="ar-ref-actions">';
    if (item.url) {
      out +=
        '<a class="studio-btn primary sm" href="' +
        esc(item.url) +
        '" target="_blank" rel="noopener noreferrer">Open</a>';
      out +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.copyRefLink(\'' +
        esc(item.url) +
        '\')">Copy link</button>';
    }
    out +=
      '<button type="button" class="studio-btn ghost danger sm" onclick="PreShootStudioUI.removeProductionReference(\'' +
      esc(productionId) +
      "','" +
      esc(item.id) +
      '\')">Remove</button>';
    out += '</div></div></div>';
    return out;
  }

  function renderResearchResultCard(productionId, platform, item, idx) {
    var out = '<div class="ar-ref-card research">';
    if (item.thumbnail) {
      out +=
        '<img class="ar-ref-thumb" src="' +
        esc(item.thumbnail) +
        '" alt="" loading="lazy">';
    } else {
      out +=
        '<div class="ar-ref-thumb ph">' +
        (platform === 'capcut' ? 'CC' : 'YT') +
        '</div>';
    }
    out += '<div class="ar-ref-body">';
    out += '<div class="ar-ref-title">' + esc(item.title || 'Reference') + '</div>';
    var meta = [];
    if (item.channel) meta.push(item.channel);
    if (item.viewsLabel) meta.push(item.viewsLabel);
    if (item.styleTag) meta.push(item.styleTag);
    if (meta.length) out += '<div class="ar-ref-meta">' + esc(meta.join(' · ')) + '</div>';
    if (item.why) out += '<div class="ar-ref-why">' + esc(item.why) + '</div>';
    out += '<div class="ar-ref-actions">';
    if (item.url) {
      out +=
        '<a class="studio-btn primary sm" href="' +
        esc(item.url) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(item.cta || 'Open') +
        '</a>';
      out +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.saveResearchItem(\'' +
        esc(productionId) +
        "','" +
        esc(platform) +
        "'," +
        idx +
        ')">Save</button>';
    }
    out += '</div></div></div>';
    return out;
  }

  var _arResearchPayload = {};

  function setArStatus(productionId, platform, message, kind) {
    var el = document.getElementById('ar-status-' + platform + '-' + productionId);
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.className = 'ar-status' + (kind ? ' kind-' + kind : '');
    el.textContent = message;
  }

  function findProductionReferences(productionId, platform, broaden) {
    if (!Studio() || !productionId) return;
    if (global.S && typeof global.hasStudioAccess === 'function' ? !global.hasStudioAccess() : (global.S && global.S.plan !== 'pro')) {
      if (typeof global.openM === 'function') global.openM('pw-modal');
      return;
    }
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var key = researchCacheKey(prod) + (broaden ? '|broad' : '');
    var resultsEl = document.getElementById('ar-results-' + platform + '-' + productionId);

    if (!broaden) {
      var cached = Studio().getResearchCache(productionId, platform, key);
      if (cached && cached.items && cached.items.length) {
        _arResearchPayload[platform + ':' + productionId] = cached;
        setArStatus(productionId, platform, 'References loaded (cached).', 'ok');
        if (resultsEl) {
          resultsEl.innerHTML = cached.items
            .map(function (item, i) {
              return renderResearchResultCard(productionId, platform, item, i);
            })
            .join('');
        }
        return;
      }
    }

    setArStatus(productionId, platform, 'Loading references…', 'loading');
    if (resultsEl) resultsEl.innerHTML = '';

    if (platform === 'capcut' && global.PreShootResearch && !PreShootResearch.isCapCutConnected()) {
      setArStatus(
        productionId,
        platform,
        'Connect CapCut in Menu to unlock template research (preference only — no CapCut API).',
        'error'
      );
      if (typeof global.openM === 'function') global.openM('capcut-connect-modal');
      return;
    }

    var ctx = buildProductionResearchContext(prod);
    if (broaden) {
      ctx.ytSearch = (ctx.ytSearch || ctx.title || 'cinematic short form') + ' reference';
      ctx.capcutSearch = (ctx.capcutSearch || 'cinematic reel') + ' template';
    }

    if (typeof global.apiFetch !== 'function') {
      setArStatus(productionId, platform, 'Unable to load references.', 'error');
      return;
    }

    global
      .apiFetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platform, context: ctx })
      })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || data.error) {
          setArStatus(
            productionId,
            platform,
            data && data.message
              ? String(data.message).slice(0, 120)
              : 'Unable to load references. Retry.',
            'error'
          );
          if (resultsEl) {
            resultsEl.innerHTML =
              '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.findProductionReferences(\'' +
              esc(productionId) +
              "','" +
              esc(platform) +
              "'," +
              (broaden ? 'true' : 'false') +
              ')">Retry</button>';
          }
          return;
        }
        var items = data.items || [];
        Studio().setResearchCache(productionId, platform, data, key);
        _arResearchPayload[platform + ':' + productionId] = data;
        if (!items.length) {
          setArStatus(
            productionId,
            platform,
            data.emptyMessage || 'No strong references found.',
            'empty'
          );
          if (resultsEl) {
            resultsEl.innerHTML =
              '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.findProductionReferences(\'' +
              esc(productionId) +
              "','" +
              esc(platform) +
              "',true)\">Broaden search</button>";
          }
          return;
        }
        setArStatus(productionId, platform, 'References loaded.', 'ok');
        if (resultsEl) {
          resultsEl.innerHTML = items
            .map(function (item, i) {
              return renderResearchResultCard(productionId, platform, item, i);
            })
            .join('');
        }
      })
      .catch(function () {
        setArStatus(productionId, platform, 'Unable to load references. Retry.', 'error');
      });
  }

  function saveResearchItem(productionId, platform, idx) {
    var payload = _arResearchPayload[platform + ':' + productionId];
    if (!payload || !payload.items || !payload.items[idx]) {
      toast('Nothing to save');
      return;
    }
    var item = payload.items[idx];
    if (!item.url) {
      toast('No link to save');
      return;
    }
    var result = Studio().addReference(productionId, {
      title: item.title,
      url: item.url,
      thumbnail: item.thumbnail,
      channel: item.channel,
      viewsLabel: item.viewsLabel,
      why: item.why,
      note: item.why,
      query: item.keyword || item.title,
      platform: platform,
      source: 'research',
      publishedAt: item.publishedAt || ''
    });
    if (!result) {
      toast('Could not save reference');
      return;
    }
    if (global.PreShootAnalytics && !result.duplicate) {
      PreShootAnalytics.track('reference_added', { platform: String(platform || '').slice(0, 40) });
    }
    if (global.PreShootStudioSync && PreShootStudioSync.flush) {
      PreShootStudioSync.flush({ pushFirst: true }).catch(function () {});
    } else if (typeof global.scheduleCloudSync === 'function') {
      global.scheduleCloudSync();
    }
    toast(result.duplicate ? 'Already saved' : 'Reference saved');
    renderStudio();
  }

  function removeProductionReference(productionId, refId) {
    var result = Studio().removeReference(productionId, refId);
    if (!result) {
      toast('Reference not found');
      return;
    }
    if (global.PreShootStudioSync && PreShootStudioSync.flush) {
      PreShootStudioSync.flush({ pushFirst: true }).catch(function () {});
    }
    toast('Reference removed');
    renderStudio();
  }

  function copyRefLink(url) {
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () {
          toast('Link copied');
        },
        function () {
          toast(url);
        }
      );
    } else {
      prompt('Copy link', url);
    }
  }

  function filterAssetFolder(productionId, folder) {
    var list = document.getElementById('ar-asset-list-' + productionId);
    if (!list) return;
    var rows = list.querySelectorAll('.ar-asset-row');
    rows.forEach(function (row) {
      var f = row.getAttribute('data-folder') || 'Assets';
      row.style.display = !folder || folder === 'Assets' || f === folder ? '' : 'none';
    });
  }

  function guessAssetType(mime, name) {
    mime = String(mime || '').toLowerCase();
    name = String(name || '').toLowerCase();
    if (mime.indexOf('image/') === 0 || /\.(jpe?g|png|gif|webp)$/.test(name)) return 'image';
    if (mime.indexOf('video/') === 0 || /\.(mp4|mov|webm)$/.test(name)) return 'video';
    if (mime.indexOf('audio/') === 0 || /\.(mp3|wav|m4a)$/.test(name)) return 'audio';
    if (mime === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
    return 'document';
  }

  function defaultFolderForType(type) {
    if (type === 'image') return 'Photos';
    if (type === 'video') return 'Footage';
    if (type === 'audio') return 'Audio';
    return 'Assets';
  }

  function uploadProductionAsset(productionId, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var status = document.getElementById('ar-upload-status-' + productionId);
    function setStatus(msg, kind) {
      if (!status) return;
      status.hidden = !msg;
      status.className = 'ar-status' + (kind ? ' kind-' + kind : '');
      status.textContent = msg || '';
    }
    if (!global.S || !global.S.authUser) {
      setStatus('Sign in to upload assets.', 'error');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setStatus('File too large (max 12MB).', 'error');
      input.value = '';
      return;
    }
    setStatus('Uploading…', 'loading');
    var mime = file.type || 'application/octet-stream';
    var type = guessAssetType(mime, file.name);
    var folder = defaultFolderForType(type);

    function persistAsset(meta) {
      var added = Studio().addAsset(productionId, meta);
      if (!added) {
        setStatus('Could not save asset.', 'error');
        return;
      }
      if (global.PreShootAnalytics) {
        PreShootAnalytics.track('asset_uploaded', {
          type: String((meta && meta.type) || '').slice(0, 40)
        });
      }
      if (
        global.PreShootWorkspace &&
        PreShootWorkspace.isShared &&
        PreShootWorkspace.isShared()
      ) {
        if (PreShootWorkspace.saveNow) PreShootWorkspace.saveNow().catch(function () {});
      } else if (global.PreShootStudioSync && PreShootStudioSync.flush) {
        PreShootStudioSync.flush({ pushFirst: true }).catch(function () {});
      }
      setStatus('Uploaded.', 'ok');
      input.value = '';
      renderStudio();
    }

    /* Prefer server storage; fall back to compressed image data URL under 400KB */
    if (typeof global.apiFetch !== 'function') {
      setStatus('Upload API unavailable.', 'error');
      return;
    }

    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared() &&
      PreShootWorkspace.canEdit &&
      !PreShootWorkspace.canEdit()
    ) {
      setStatus('Read-only workspace — uploads require editor access.', 'error');
      input.value = '';
      return;
    }

    var uploadBody = {
      action: 'create',
      production_id: productionId,
      mime: mime,
      name: file.name,
      size: file.size
    };
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.workspaceIdForUpload
    ) {
      var wid = PreShootWorkspace.workspaceIdForUpload();
      if (wid) uploadBody.workspace_id = wid;
    }

    global
      .apiFetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uploadBody)
      })
      .then(function (r) {
        return r.json();
      })
      .then(function (created) {
        if (!created || !created.ok) {
          if (type === 'image' && file.size < 400000) {
            return readFileAsDataUrl(file).then(function (dataUrl) {
              persistAsset({
                name: file.name,
                type: type,
                kind: 'upload',
                mime: mime,
                size: file.size,
                sizeLabel: formatBytes(file.size),
                src: dataUrl,
                url: dataUrl,
                folder: folder
              });
              setStatus('Saved locally (cloud storage not configured).', 'ok');
            });
          }
          setStatus(
            (created && created.message) || 'Unable to upload. Storage may be unconfigured.',
            'error'
          );
          return;
        }
        return readFileAsDataUrl(file).then(function (dataUrl) {
          return global
            .apiFetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'put',
                path: created.path,
                mime: mime,
                data: dataUrl
              })
            })
            .then(function (r2) {
              return r2.json();
            })
            .then(function (putRes) {
              if (!putRes || !putRes.ok) {
                if (type === 'image' && file.size < 400000) {
                  persistAsset({
                    name: file.name,
                    type: type,
                    kind: 'upload',
                    mime: mime,
                    size: file.size,
                    sizeLabel: formatBytes(file.size),
                    src: dataUrl,
                    url: dataUrl,
                    folder: folder
                  });
                  setStatus('Saved (fallback).', 'ok');
                  return;
                }
                setStatus((putRes && putRes.message) || 'Upload failed.', 'error');
                return;
              }
              persistAsset({
                id: created.assetId,
                name: file.name,
                type: type,
                kind: 'upload',
                mime: mime,
                size: putRes.size || file.size,
                sizeLabel: formatBytes(putRes.size || file.size),
                storagePath: created.path,
                url: putRes.url,
                src: type === 'image' ? putRes.url : null,
                folder: folder
              });
            });
        });
      })
      .catch(function () {
        setStatus('Upload failed. Retry.', 'error');
      });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeProductionAsset(productionId, assetId) {
    var found = Studio().findProduction(productionId);
    var asset =
      found &&
      found.production &&
      (found.production.workspace.assets || []).find(function (a) {
        return a.id === assetId;
      });
    var removed = Studio().removeAsset(productionId, assetId);
    if (!removed) {
      toast('Asset not found');
      return;
    }
    if (asset && asset.storagePath && typeof global.apiFetch === 'function') {
      global
        .apiFetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', path: asset.storagePath })
        })
        .catch(function () {});
    }
    if (global.PreShootStudioSync && PreShootStudioSync.flush) {
      PreShootStudioSync.flush({ pushFirst: true }).catch(function () {});
    }
    toast('Asset deleted');
    renderStudio();
  }

  function renderAssetsSection(prod, productionId, ws) {
    /* Merged into Assets & References */
    return renderRefsSection(prod, productionId, ws);
  }


  function renderPerformanceSection(prod, productionId, ws) {
    var perf = (ws && ws.performance) || {};
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">Performance Review</div>';
    h += '<div class="pw-section-sub">Manual metrics you enter — PreShoot does not scrape social platforms. Architecture ready for future imports.</div></div></div>';
    h += '<div class="pw-card">';
    h += '<div class="pw-perf-grid">';
    [
      ['views', 'Views'],
      ['likes', 'Likes'],
      ['comments', 'Comments'],
      ['shares', 'Shares'],
      ['saves', 'Saves'],
      ['watchTime', 'Watch time'],
      ['retention', 'Retention %'],
      ['ctr', 'CTR']
    ].forEach(function (f) {
      h += '<div><label class="st-label">' + f[1] + '</label>';
      h +=
        '<input class="st-input" value="' +
        esc(perf[f[0]] || '') +
        '" placeholder="—" onchange="PreShootStudioUI.savePerformanceField(\'' +
        esc(productionId) +
        "','" +
        f[0] +
        "',this.value)\"></div>";
    });
    h += '</div>';
    h += '<label class="st-label">Notes</label>';
    h +=
      '<textarea class="st-input st-notes" rows="3" placeholder="What worked? What to change next time?" onchange="PreShootStudioUI.savePerformanceField(\'' +
      esc(productionId) +
      "','notes',this.value)\">" +
      esc(perf.notes || '') +
      '</textarea>';
    h += '<label class="st-label">PDF report (name only for now)</label>';
    h +=
      '<input class="st-input" type="file" accept="application/pdf" onchange="PreShootStudioUI.onPerformancePdf(\'' +
      esc(productionId) +
      "',this)\">";
    if (perf.pdfName) {
      h += '<div class="pw-section-sub" style="margin-top:8px">Attached · ' + esc(perf.pdfName) + '</div>';
    }
    h +=
      '<button type="button" class="studio-btn" style="margin-top:12px;width:100%" onclick="PreShootStudioUI.proposeDirectorAction(\'update_status\',' +
      JSON.stringify({ productionId: productionId, status: 'performance' }) +
      ')">Mark as Performance Review</button>';
    h += '</div>';
    return h;
  }

  function renderDirectorCommandBar(opts) {
    opts = opts || {};
    var ph = opts.placeholder || 'Tell Director what you’d like to do…';
    var scope = opts.scope || 'studio';
    return (
      '<div class="dir-cmd" data-dir-scope="' +
      esc(scope) +
      '">' +
      '<div class="dir-cmd-bar">' +
      '<span class="dir-cmd-mark" aria-hidden="true">D</span>' +
      '<input type="text" class="dir-cmd-input" id="dir-cmd-input" placeholder="' +
      esc(ph) +
      '" autocomplete="off" enterkeyhint="go" oninput="PreShootStudioUI.onDirectorInputChange()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();PreShootStudioUI.submitDirectorCommand();}">' +
      '<button type="button" class="dir-cmd-mic" id="dir-cmd-mic" onclick="PreShootStudioUI.toggleDirectorVoice()" aria-label="Voice input" title="Voice input">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>' +
      '</button>' +
      '<button type="button" class="dir-cmd-go" id="dir-cmd-go" onclick="PreShootStudioUI.submitDirectorCommand()" aria-label="Go" disabled>Go</button>' +
      '</div>' +
      '<div class="dir-cmd-panel" id="dir-cmd-panel" hidden></div>' +
      '</div>'
    );
  }

  function renderDirectorCard(productionId) {
    /* Studio stays in-place — command bar replaces chat launch card */
    return renderDirectorCommandBar({
      placeholder: 'What do you want to change?',
      scope: 'production',
      productionId: productionId
    });
  }

  function setDirectorPanel(html, opts) {
    opts = opts || {};
    function apply(panel) {
      if (!panel) return;
      if (!html) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
      }
      panel.hidden = false;
      panel.innerHTML = html;
    }
    apply(document.getElementById('dir-cmd-panel'));
    apply(document.getElementById('script-fs-dir-panel'));
    if (html && document.getElementById('script-fs-dir')) {
      document.getElementById('script-fs-dir').classList.add('open');
    }
    if (opts.scroll !== false) {
      var inp =
        document.documentElement.classList.contains('script-fs-active')
          ? document.getElementById('script-fs-dir-input')
          : document.getElementById('dir-cmd-input');
      if (
        inp &&
        global.PreShootStudioKeyboard &&
        typeof global.PreShootStudioKeyboard.ensureVisible === 'function'
      ) {
        setTimeout(function () {
          global.PreShootStudioKeyboard.ensureVisible(inp, { force: true });
        }, 40);
      }
    }
  }

  var _dirGoState = 'idle';
  function setDirectorGoState(state) {
    _dirGoState = state || 'idle';
    function paint(btn, inputId) {
      if (!btn) return;
      btn.classList.remove('ready', 'executing', 'done');
      btn.disabled = false;
      if (_dirGoState === 'ready') {
        btn.classList.add('ready');
        btn.textContent = 'Go';
        btn.disabled = false;
      } else if (_dirGoState === 'executing') {
        btn.classList.add('executing');
        btn.textContent = '…';
        btn.disabled = true;
      } else if (_dirGoState === 'done') {
        btn.classList.add('done');
        btn.textContent = 'Done';
        btn.disabled = true;
      } else {
        var inp = document.getElementById(inputId);
        var hasText = !!(inp && String(inp.value || '').trim());
        btn.textContent = 'Go';
        btn.disabled = !hasText;
      }
    }
    paint(document.getElementById('dir-cmd-go'), 'dir-cmd-input');
    paint(document.getElementById('script-fs-dir-go'), 'script-fs-dir-input');
  }

  function onDirectorInputChange() {
    if (pendingDirectorAction && _dirGoState === 'ready') {
      pendingDirectorAction = null;
      setDirectorPanel('');
    }
    if (_dirGoState !== 'executing') {
      setDirectorGoState('idle');
    }
  }

  function actionCardHtml(action, payload, message, status) {
    payload = payload || {};
    status = status || 'waiting';
    var title = actionLabel(action);
    var rows = '';
    if (action === 'rename_production' || action === 'rename_project') {
      var current = '';
      if (action === 'rename_production' && payload.productionId) {
        var found = Studio().findProduction(payload.productionId);
        current = found && found.production ? found.production.name : '';
      } else if (action === 'rename_project' && payload.projectId) {
        var proj = Studio().findProject(payload.projectId);
        current = proj ? proj.name : '';
      }
      rows +=
        '<div class="dir-action-meta">Action: <strong>' +
        esc(title) +
        '</strong></div>';
      rows +=
        '<div class="dir-action-row"><span>Current</span><strong>' +
        esc(current || '—') +
        '</strong></div>';
      rows +=
        '<div class="dir-action-arrow" aria-hidden="true">→</div>';
      rows +=
        '<div class="dir-action-row"><span>New</span><strong>' +
        esc(payload.name || '—') +
        '</strong></div>';
    } else if (action === 'update_status') {
      rows +=
        '<div class="dir-action-row"><span>Status</span><strong>' +
        esc(
          ((Studio().STATUS_MAP || {})[payload.status] || {}).label ||
            payload.status ||
            '—'
        ) +
        '</strong></div>';
    } else if (action === 'move_production') {
      var dest = Studio().findProject(payload.toProjectId);
      rows +=
        '<div class="dir-action-row"><span>Move to</span><strong>' +
        esc(dest ? dest.name : 'Selected project') +
        '</strong></div>';
    } else if (action === 'update_script') {
      rows +=
        '<div class="dir-action-meta">Action: <strong>Update current script</strong></div>';
      rows +=
        '<div class="dir-action-row"><span>Mode</span><strong>' +
        esc(payload.mode || 'append') +
        '</strong></div>';
      var previewBody = String(payload.body || '').trim();
      if (previewBody) {
        rows +=
          '<div class="dir-action-msg" style="max-height:120px;overflow:auto;white-space:pre-wrap">' +
          esc(previewBody.slice(0, 500)) +
          (previewBody.length > 500 ? '…' : '') +
          '</div>';
      } else if (message) {
        rows += '<div class="dir-action-msg">' + esc(message) + '</div>';
      }
    } else if (message) {
      rows += '<div class="dir-action-msg">' + esc(message) + '</div>';
    }
    var statusLabel =
      status === 'executing'
        ? 'Executing…'
        : status === 'done'
          ? 'Completed ✓'
          : status === 'error'
            ? 'Failed'
            : 'Waiting for confirmation';
    return (
      '<div class="dir-action-card status-' +
      esc(status) +
      '">' +
      '<div class="dir-action-title">' +
      esc(title) +
      '</div>' +
      rows +
      '<div class="dir-action-status">' +
      esc(statusLabel) +
      '</div>' +
      (status === 'waiting'
        ? '<div class="dir-action-hint">Confirm? Press Go to apply · or edit the request</div>'
        : '') +
      '</div>'
    );
  }

  function setDirectorStatus(kind, message) {
    var label = message || '';
    if (!label) {
      if (kind === 'thinking') label = 'Thinking…';
      else if (kind === 'listening') label = 'Listening…';
      else if (kind === 'executing') label = 'Updating…';
      else if (kind === 'done') label = 'Done';
      else if (kind === 'error') label = 'Something went wrong';
    }
    setDirectorPanel(
      '<div class="dir-cmd-status-card kind-' +
        esc(kind || 'thinking') +
        '">' +
        '<div class="dir-cmd-status-pulse" aria-hidden="true"></div>' +
        '<div class="dir-cmd-status-text">' +
        esc(label) +
        '</div>' +
        '</div>'
    );
  }

  function statusLabelForIntent(text) {
    var t = String(text || '').toLowerCase();
    if (/\bhook\b/.test(t)) return 'Improving hook…';
    if (/\bscript\b|\bline\b/.test(t)) return 'Updating script…';
    if (/\bshot\b|close-?up/.test(t)) return 'Updating shot list…';
    if (/\brename|call (this|it)|change (the )?name/.test(t)) return 'Preparing rename…';
    if (/\bmove\b/.test(t)) return 'Preparing move…';
    if (/\barchive\b/.test(t)) return 'Preparing archive…';
    if (/\bgenerat|improve|stronger|cinematic|shorter/.test(t)) return 'Generating…';
    if (/\bfind|open|search\b/.test(t)) return 'Searching…';
    return 'Thinking…';
  }

  function actionLabel(action) {
    var map = {
      rename_production: 'Rename Production',
      rename_project: 'Rename Project',
      move_production: 'Move Production',
      archive_production: 'Archive Production',
      archive_project: 'Archive Project',
      delete_production: 'Delete Production',
      create_project: 'Create Project',
      create_production: 'Create Production',
      update_status: 'Update Status',
      generate_sections: 'Generate Sections',
      rebuild_shot_list: 'Rebuild Shot List',
      update_script: 'Update Script',
      open_production: 'Open Production',
      set_primary_platform: 'Set Platform'
    };
    return map[action] || 'Director Action';
  }

  function stageDirectorAction(action, payload, meta) {
    meta = meta || {};
    pendingDirectorAction = {
      action: action,
      payload: payload || {},
      object: meta.object || null,
      tool: meta.tool || null,
      mutates: meta.mutates
    };
    var preview = null;
    if (global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed) {
      preview = global.PreShootDirectorOS.executeProposed(
        {
          action: action,
          payload: payload || {},
          object: pendingDirectorAction.object,
          mutates: pendingDirectorAction.mutates
        },
        { confirmed: false }
      );
    } else if (Studio() && Studio().handleDirectorAction) {
      preview = Studio().handleDirectorAction(action, payload || {}, { confirmed: false });
    }
    /* Incomplete / invalid — do not enable Go */
    if (preview && preview.error && !preview.needsConfirmation) {
      pendingDirectorAction = null;
      setDirectorPanel(
        '<div class="dir-cmd-reply">' +
          esc(preview.message || preview.error || 'I need a bit more detail.') +
          '</div>'
      );
      setDirectorGoState('idle');
      return false;
    }
    var msg =
      (preview && preview.message) ||
      (Studio().confirmMessage && Studio().confirmMessage(action, payload)) ||
      'Ready to apply.';
    setDirectorPanel(actionCardHtml(action, payload, msg, 'waiting'));
    setDirectorGoState('ready');
    return true;
  }

  function verifyDirectorMutation(action, payload) {
    payload = payload || {};
    try {
      function unwrapProduction(found) {
        if (!found) return null;
        return found.production || found;
      }
      if (action === 'rename_project' && payload.projectId) {
        var p = Studio().findProject && Studio().findProject(payload.projectId);
        if (!p) return { ok: false, message: 'Project not found after rename' };
        var want = String(payload.name || '').trim().toLowerCase();
        var got = String(p.name || '').trim().toLowerCase();
        if (want && got !== want) return { ok: false, message: 'Rename did not apply' };
        return { ok: true, label: p.name };
      }
      if (action === 'rename_production' && payload.productionId) {
        var pr = unwrapProduction(Studio().findProduction && Studio().findProduction(payload.productionId));
        if (!pr) return { ok: false, message: 'Production not found after rename' };
        var wantP = String(payload.name || '').trim().toLowerCase();
        var gotP = String(pr.name || '').trim().toLowerCase();
        if (wantP && gotP !== wantP) {
          if (gotP.replace(/\s+/g, ' ') !== wantP.replace(/\s+/g, ' ')) {
            return { ok: false, message: 'Rename did not apply' };
          }
        }
        return { ok: true, label: pr.name };
      }
      if (action === 'delete_production' && payload.productionId) {
        var gone = unwrapProduction(Studio().findProduction && Studio().findProduction(payload.productionId));
        if (gone) return { ok: false, message: 'Production still exists' };
        return { ok: true };
      }
      if (action === 'archive_project' && payload.projectId) {
        var ap = Studio().findProject && Studio().findProject(payload.projectId);
        if (!ap) return { ok: false, message: 'Project not found after archive' };
        if (!ap.archived) return { ok: false, message: 'Archive did not apply' };
        return { ok: true };
      }
      if (action === 'update_status' && payload.productionId) {
        var us = unwrapProduction(Studio().findProduction && Studio().findProduction(payload.productionId));
        if (!us || (payload.status && us.status !== payload.status)) {
          return { ok: false, message: 'Status did not update' };
        }
        return { ok: true };
      }
      if (action === 'create_project') {
        if (!payload.name) return { ok: false, message: 'Missing project name' };
        var created = (Studio().listProjects && Studio().listProjects()) || [];
        var wantC = String(payload.name || '').trim().toLowerCase();
        var foundC = created.some(function (x) {
          return String(x.name || '').trim().toLowerCase() === wantC;
        });
        if (!foundC) return { ok: false, message: 'Project was not created' };
        return { ok: true };
      }
      if (action === 'create_production') {
        if (!payload.projectId) return { ok: false, message: 'Missing project' };
        var projs = Studio().findProject && Studio().findProject(payload.projectId);
        if (!projs) return { ok: false, message: 'Project not found' };
        var wantProd = String(payload.name || 'Untitled Production').trim().toLowerCase();
        var okProd = (projs.productions || []).some(function (x) {
          return String(x.name || '').trim().toLowerCase() === wantProd;
        });
        if (!okProd && payload.name) return { ok: false, message: 'Production was not created' };
        return { ok: true };
      }
      if (action === 'move_production' && payload.productionId && payload.toProjectId) {
        var movedFound = Studio().findProduction && Studio().findProduction(payload.productionId);
        var moved = unwrapProduction(movedFound);
        if (!moved) return { ok: false, message: 'Production not found after move' };
        var dest = Studio().findProject && Studio().findProject(payload.toProjectId);
        var inDest =
          dest &&
          (dest.productions || []).some(function (x) {
            return x.id === payload.productionId;
          });
        if (!inDest) return { ok: false, message: 'Move did not apply' };
        return { ok: true };
      }
      if (action === 'update_script' && payload.productionId) {
        var foundScr = Studio().findProduction && Studio().findProduction(payload.productionId);
        var prodScr = foundScr && (foundScr.production || foundScr);
        if (!prodScr) return { ok: false, message: 'Production not found after script update' };
        var wsScr = prodScr.workspace || {};
        var plain =
          Studio().getScriptPlainText
            ? Studio().getScriptPlainText(wsScr)
            : (wsScr.script && wsScr.script.body) || '';
        var want = String(payload.body || '').trim();
        var modeV = payload.mode || 'replace';
        if (!plain) return { ok: false, message: 'Script is empty after update' };
        if (modeV === 'append' || modeV === 'patch_ending') {
          if (payload.verifySnippet && plain.indexOf(String(payload.verifySnippet).trim()) < 0) {
            return { ok: false, message: 'New script content was not saved' };
          }
          if (want && plain.indexOf(want.slice(0, Math.min(40, want.length))) < 0) {
            if (payload.previousLength != null && plain.length <= payload.previousLength) {
              return { ok: false, message: 'Script did not grow after append' };
            }
          }
        } else if (modeV === 'patch_hook') {
          if (want && plain.indexOf(want.slice(0, Math.min(24, want.length))) < 0) {
            return { ok: false, message: 'Hook update was not saved' };
          }
        } else {
          if (want && plain.replace(/\s+/g, ' ').trim() !== want.replace(/\s+/g, ' ').trim()) {
            if (plain.indexOf(want.slice(0, Math.min(48, want.length))) < 0) {
              return { ok: false, message: 'Script replace was not saved' };
            }
          }
        }
        return { ok: true, label: 'script' };
      }
      if (action === 'add_reference' && payload.productionId) {
        var refs = Studio().listReferences(payload.productionId) || [];
        var hit = refs.some(function (r) {
          return (payload.url && r.url === payload.url) || (payload.refId && r.id === payload.refId);
        });
        if (!hit && payload.url) {
          hit = refs.some(function (r) {
            return r.url === payload.url;
          });
        }
        if (!hit) return { ok: false, message: 'Reference was not saved' };
        return { ok: true };
      }
      if (action === 'remove_reference' && payload.productionId && payload.refId) {
        var still = (Studio().listReferences(payload.productionId) || []).some(function (r) {
          return r.id === payload.refId;
        });
        if (still) return { ok: false, message: 'Reference still present' };
        return { ok: true };
      }
      if (action === 'rebuild_shot_list' && payload.productionId) {
        var foundSl = Studio().findProduction && Studio().findProduction(payload.productionId);
        var prodSl = foundSl && (foundSl.production || foundSl);
        if (!prodSl) return { ok: false, message: 'Production not found after shot list rebuild' };
        var shotsAfter = (prodSl.workspace && prodSl.workspace.shotList) || [];
        if (!shotsAfter.length) return { ok: false, message: 'Shot list is empty after rebuild' };
        return { ok: true, label: shotsAfter.length + ' shots' };
      }
      if (action === 'open_production' || action === 'list_references' || action === 'find_references') {
        return { ok: true };
      }
      if (action === 'archive_production' && payload.productionId) {
        var arch = unwrapProduction(
          Studio().findProduction && Studio().findProduction(payload.productionId)
        );
        if (!arch) return { ok: false, message: 'Production not found' };
        if (arch.status !== 'archived' && !arch.archived) {
          return { ok: false, message: 'Archive did not apply' };
        }
        return { ok: true };
      }
      if (action === 'generate_sections' && payload.productionId) {
        var gs = unwrapProduction(
          Studio().findProduction && Studio().findProduction(payload.productionId)
        );
        if (!gs || !gs.workspace) return { ok: false, message: 'Sections were not generated' };
        return { ok: true };
      }
      if ((action === 'link_scan' || action === 'unlink_scan') && payload.productionId) {
        var ls = unwrapProduction(
          Studio().findProduction && Studio().findProduction(payload.productionId)
        );
        if (!ls) return { ok: false, message: 'Production not found' };
        if (action === 'link_scan' && !(ls.scanRef || ls.coverImage)) {
          return { ok: false, message: 'Scan link did not apply' };
        }
        if (action === 'unlink_scan' && ls.scanRef) {
          return { ok: false, message: 'Scan unlink did not apply' };
        }
        return { ok: true };
      }
      if (action === 'add_asset' && payload.productionId) {
        var aa = unwrapProduction(
          Studio().findProduction && Studio().findProduction(payload.productionId)
        );
        var assets = (aa && aa.workspace && aa.workspace.assets) || [];
        if (payload.assetId) {
          var hasA = assets.some(function (a) {
            return a && a.id === payload.assetId;
          });
          if (!hasA) return { ok: false, message: 'Asset was not added' };
        }
        return { ok: true };
      }
      if (action === 'remove_asset' && payload.productionId && payload.assetId) {
        var ra = unwrapProduction(
          Studio().findProduction && Studio().findProduction(payload.productionId)
        );
        var stillA = ((ra && ra.workspace && ra.workspace.assets) || []).some(function (a) {
          return a && a.id === payload.assetId;
        });
        if (stillA) return { ok: false, message: 'Asset still present' };
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, message: 'Could not verify change' };
    }
    /* Fail closed — unknown mutating actions must not claim success */
    return { ok: false, message: 'Could not verify this change' };
  }

  function executeStagedDirectorAction() {
    if (!pendingDirectorAction) return;
    if (_dirGoState === 'executing') return;
    setDirectorGoState('executing');
    var action = pendingDirectorAction.action;
    var payload = pendingDirectorAction.payload || {};
    var object = pendingDirectorAction.object || null;
    var mutates = pendingDirectorAction.mutates;
    setDirectorPanel(actionCardHtml(action, payload, 'Executing…', 'executing'));
    setDirectorStatus('executing', 'Executing…');
    pendingDirectorAction = null;
    var result = null;
    try {
      if (global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed) {
        result = global.PreShootDirectorOS.executeProposed(
          { action: action, payload: payload, object: object, mutates: mutates },
          { confirmed: true }
        );
      } else {
        result = Studio().handleDirectorAction(action, payload, { confirmed: true });
      }
    } catch (e) {
      result = { ok: false, error: 'failed' };
    }
    if (!result || !result.ok) {
      setDirectorGoState('idle');
      setDirectorPanel(actionCardHtml(action, payload, (result && (result.message || result.error)) || 'Action failed', 'error'));
      setDirectorStatus('error', (result && (result.message || result.error)) || 'Action failed');
      toast((result && (result.message || result.error)) || 'Action failed');
      return;
    }
    setDirectorStatus('executing', 'Verifying…');
    var verified = verifyDirectorMutation(action, payload);
    if (!verified.ok) {
      setDirectorGoState('idle');
      setDirectorPanel(actionCardHtml(action, payload, verified.message || 'Verification failed', 'error'));
      setDirectorStatus('error', verified.message || 'Action failed');
      toast(verified.message || 'Action failed');
      return;
    }

    function finishDirectorSuccess() {
      setDirectorGoState('done');
      setDirectorPanel(
        actionCardHtml(
          action,
          payload,
          action === 'update_script'
            ? 'Done — script updated.'
            : action === 'rebuild_shot_list'
              ? 'Done — shot list rebuilt.'
              : verified.label
                ? 'Updated to “' + verified.label + '”'
                : 'Completed',
          'done'
        )
      );
      setDirectorStatus(
        'done',
        action === 'update_script'
          ? 'Done — script updated.'
          : action === 'rebuild_shot_list'
            ? 'Done — shot list rebuilt.'
            : 'Completed'
      );
      toast(
        action === 'update_script'
          ? 'Script updated'
          : action === 'rebuild_shot_list'
            ? 'Shot list rebuilt'
            : 'Done'
      );
      if (action === 'update_script') {
        refreshScriptFullscreenIfOpen(payload.productionId);
      }
      if (action === 'rebuild_shot_list' && payload.productionId && global.S) {
        global.S.studioView = global.S.studioView || {};
        global.S.studioView.mode = 'production';
        global.S.studioView.productionId = payload.productionId;
        global.S.studioView.section = 'shots';
      }
      var openId =
        (result.open &&
          ((result.result && result.result.productionId) || payload.productionId)) ||
        null;
      setTimeout(function () {
        if (openId) {
          openProduction(openId);
          return;
        }
        renderContinueCard();
        renderStudio();
        setTimeout(function () {
          setDirectorPanel(
            '<div class="dir-cmd-status-card kind-done"><div class="dir-cmd-status-text">Completed ✓</div></div>'
          );
          setDirectorGoState('done');
          setTimeout(function () {
            setDirectorGoState('idle');
          }, 1400);
        }, 40);
      }, 420);
    }

    function failDirectorPersist(msg) {
      setDirectorGoState('idle');
      setDirectorPanel(actionCardHtml(action, payload, msg || 'Save failed', 'error'));
      setDirectorStatus('error', msg || 'Save failed');
      toast(msg || 'Save failed');
      if (global.PreShootAnalytics && PreShootAnalytics.track) {
        PreShootAnalytics.track('director_action_failure', { action: action });
      }
    }

    function afterPersistOk() {
      if (global.PreShootAnalytics && PreShootAnalytics.track) {
        PreShootAnalytics.track('director_action_success', { action: action });
      }
      finishDirectorSuccess();
    }

    /* Shared workspace: only claim Done after workspace-sync confirms */
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared()
    ) {
      if (PreShootWorkspace.canEdit && !PreShootWorkspace.canEdit()) {
        failDirectorPersist('Read-only workspace — changes were not saved');
        return;
      }
      if (PreShootWorkspace.markSharedDirty) PreShootWorkspace.markSharedDirty();
      if (PreShootWorkspace.setPendingChangeHint) {
        var hint = null;
        if (action === 'update_script' && payload.productionId) {
          hint = {
            type: 'script.updated',
            productionId: payload.productionId,
            projectId: payload.projectId || null,
            entityId: payload.productionId,
            entityLabel: null
          };
        } else if (action === 'rebuild_shot_list' && payload.productionId) {
          hint = {
            type: 'shotlist.updated',
            productionId: payload.productionId,
            projectId: payload.projectId || null,
            entityId: payload.productionId
          };
        } else if (payload.productionId) {
          hint = {
            type: 'production.updated',
            productionId: payload.productionId,
            projectId: payload.projectId || null,
            entityId: payload.productionId
          };
        } else if (payload.projectId) {
          hint = {
            type: 'project.updated',
            projectId: payload.projectId,
            entityId: payload.projectId
          };
        }
        PreShootWorkspace.setPendingChangeHint(hint);
      }
      setDirectorStatus('executing', 'Saving workspace…');
      var savePromise =
        typeof PreShootWorkspace.saveNow === 'function'
          ? PreShootWorkspace.saveNow()
          : Promise.resolve({ ok: false, error: 'no_save' });
      savePromise
        .then(function (saveRes) {
          if (saveRes && saveRes.ok === true) {
            afterPersistOk();
            return;
          }
          if (saveRes && saveRes.busy) {
            return waitMs(200).then(function () {
              return PreShootWorkspace.saveNow().then(function (retry) {
                if (retry && retry.ok === true) afterPersistOk();
                else if (retry && retry.conflict) {
                  failDirectorPersist(
                    'Another collaborator changed this workspace. Resolve the conflict, then try again.'
                  );
                } else {
                  failDirectorPersist(
                    (retry && retry.message) ||
                      'I couldn’t save this workspace. Your Studio was not updated.'
                  );
                }
              });
            });
          }
          if (saveRes && saveRes.conflict) {
            failDirectorPersist(
              'Another collaborator changed this workspace. Resolve the conflict, then try again.'
            );
            return;
          }
          failDirectorPersist(
            (saveRes && saveRes.message) ||
              'I couldn’t save this workspace. Your Studio was not updated.'
          );
        })
        .catch(function () {
          failDirectorPersist('Workspace save failed. Your existing Studio is unchanged.');
        });
      return;
    }

    /* Personal Studio: only claim Done after /api/sync confirms */
    setDirectorStatus('executing', 'Saving…');
    var flushP =
      global.PreShootStudioSync && typeof PreShootStudioSync.flush === 'function'
        ? PreShootStudioSync.flush({ pushFirst: true })
        : global.PreShootStudioSync && typeof PreShootStudioSync.pushNow === 'function'
          ? PreShootStudioSync.pushNow()
          : Promise.resolve({ ok: true, local_only: true });
    Promise.resolve(flushP)
      .then(function (flushRes) {
        if (flushRes && flushRes.ok === false) {
          failDirectorPersist(
            (flushRes && flushRes.message) ||
              'I couldn’t save your Studio. The change may not have synced.'
          );
          return;
        }
        afterPersistOk();
      })
      .catch(function () {
        failDirectorPersist('Save failed. Your Studio may be out of sync — try again.');
      });
  }

  function waitMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** Persist a local Director mutation; never claim Done without confirmation. */
  function persistDirectorLocalMutation(result) {
    var productionId =
      (result && result.productionId) ||
      (global.S && global.S.studioView && global.S.studioView.productionId) ||
      null;
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared()
    ) {
      if (PreShootWorkspace.canEdit && !PreShootWorkspace.canEdit()) {
        return Promise.resolve({
          ok: false,
          message: 'Read-only workspace — changes were not saved'
        });
      }
      if (PreShootWorkspace.markSharedDirty) {
        PreShootWorkspace.markSharedDirty(
          productionId
            ? { type: 'production.updated', productionId: productionId, entityId: productionId }
            : null
        );
      }
      return PreShootWorkspace.saveNow().then(function (saveRes) {
        if (saveRes && saveRes.ok === true) return { ok: true };
        if (saveRes && saveRes.conflict) {
          return {
            ok: false,
            message:
              'Another collaborator changed this workspace. Resolve the conflict, then try again.'
          };
        }
        return {
          ok: false,
          message: (saveRes && saveRes.message) || 'Workspace save failed'
        };
      });
    }
    if (global.PreShootStudioSync && typeof PreShootStudioSync.flush === 'function') {
      return PreShootStudioSync.flush({ pushFirst: true }).then(function (flushRes) {
        if (flushRes && flushRes.ok === false) {
          return {
            ok: false,
            message: (flushRes && flushRes.message) || 'Studio save failed'
          };
        }
        return { ok: true };
      });
    }
    return Promise.resolve({ ok: true, local_only: true });
  }

  function submitDirectorCommand(forcedText) {
    /* Ready Go = execute staged action */
    if (_dirGoState === 'ready' && pendingDirectorAction && forcedText == null) {
      executeStagedDirectorAction();
      return;
    }
    if (_dirGoState === 'executing') return;
    if (_dirGoState === 'done' && forcedText == null) return;

    var inp = document.getElementById('dir-cmd-input');
    var text =
      forcedText != null
        ? String(forcedText || '').trim()
        : inp
          ? String(inp.value || '').trim()
          : '';
    if (!text) {
      setDirectorStatus('error', 'Tell Director what you’d like to do.');
      return;
    }
    if (!Studio()) {
      setDirectorStatus('error', 'Studio isn’t ready yet.');
      return;
    }
    if (global.S && typeof global.hasStudioAccess === 'function' ? !global.hasStudioAccess() : (global.S && global.S.plan !== 'pro')) {
      if (typeof global.openM === 'function') global.openM('pw-modal');
      return;
    }
    if (!global.PreShootDirectorOS || !global.PreShootDirectorOS.processStudioCommand) {
      setDirectorStatus('error', 'Director is unavailable');
      toast('Director is unavailable');
      return;
    }
    if (inp) inp.value = '';
    pendingDirectorAction = null;
    setDirectorGoState('executing');
    setDirectorStatus('thinking', statusLabelForIntent(text));
    var result = null;
    try {
      result = global.PreShootDirectorOS.processStudioCommand(text);
    } catch (e) {
      setDirectorGoState('idle');
      setDirectorStatus('error', 'Something went wrong. Try again.');
      return;
    }
    handleDirectorCommandResult(result);
  }

  function shortActionMessage(msg, fallback) {
    var t = String(msg || '').replace(/\s+/g, ' ').trim();
    if (!t) return fallback || 'Done';
    if (t.length > 90) t = t.slice(0, 87).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  function handleDirectorCommandResult(result) {
    if (!result) {
      setDirectorStatus('error', 'No response from Director. Try again.');
      setDirectorGoState('idle');
      return;
    }
    if (result.kind === 'confirm' && result.proposal) {
      stageDirectorAction(result.proposal.action, result.proposal.payload || {}, {
        object: result.proposal.object || result.object || null,
        tool: result.proposal.tool || null,
        mutates: result.proposal.mutates
      });
      return;
    }
    if (result.kind === 'clarify') {
      _dirClarifyOptions = result.options || [];
      var h =
        '<div class="dir-cmd-status-card kind-clarify">' +
        '<div class="dir-cmd-status-text">' +
        esc(result.question || 'Which one?') +
        '</div></div><div class="dir-cmd-choices">';
      _dirClarifyOptions.forEach(function (opt, i) {
        h +=
          '<button type="button" class="dir-cmd-choice" onclick="PreShootStudioUI.chooseDirectorClarifyIndex(' +
          i +
          ')">' +
          esc(opt.label) +
          '</button>';
      });
      h += '</div>';
      if (result.freeText) {
        h +=
          '<div class="dir-cmd-hint">Type the new name in the bar and press Go.</div>';
      }
      setDirectorPanel(h);
      setDirectorGoState('idle');
      return;
    }
    if (result.kind === 'action' && result.proposal) {
      var prop = result.proposal;
      setDirectorStatus('executing', 'Preparing action…');
      var preview =
        global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed
          ? global.PreShootDirectorOS.executeProposed(prop, { confirmed: false })
          : null;
      if (preview && preview.needsConfirmation) {
        handleDirectorCommandResult({
          kind: 'confirm',
          proposal: prop,
          message: preview.message || result.message
        });
        return;
      }
      if (prop.mutates === false || prop.action === 'open_production') {
        var opened =
          global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed
            ? global.PreShootDirectorOS.executeProposed(prop, { confirmed: true })
            : null;
        if (opened && opened.open && prop.payload && prop.payload.productionId) {
          setDirectorStatus('done', 'Opening…');
          openProduction(prop.payload.productionId);
          return;
        }
        handleDirectorCommandResult({
          kind: 'done',
          message: (opened && opened.ok && 'Done') || (opened && opened.error) || 'Done',
          refresh: true
        });
        return;
      }
      handleDirectorCommandResult({
        kind: 'confirm',
        proposal: prop,
        message: (preview && preview.message) || result.message || 'Confirm this action?'
      });
      return;
    }
    if (result.kind === 'navigate' && result.target) {
      setDirectorStatus('done', 'Opening…');
      setDirectorGoState('done');
      setTimeout(function () {
        setDirectorGoState('idle');
      }, 600);
      if (result.target.type === 'project') openProject(result.target.id);
      else if (result.target.type === 'production') openProduction(result.target.id);
      return;
    }
    if (result.kind === 'done') {
      setDirectorGoState('executing');
      setDirectorStatus('executing', 'Saving…');
      var donePersist = persistDirectorLocalMutation(result);
      donePersist
        .then(function (okPack) {
          if (!okPack || !okPack.ok) {
            setDirectorGoState('idle');
            setDirectorStatus(
              'error',
              (okPack && okPack.message) ||
                'I couldn’t save that change. Your Studio is unchanged.'
            );
            toast((okPack && okPack.message) || 'Save failed');
            return;
          }
          setDirectorGoState('done');
          setDirectorStatus('done', shortActionMessage(result.message, 'Done'));
          if (result.section && global.S && global.S.studioView && global.S.studioView.productionId) {
            global.S.studioView.section = result.section;
          }
          if (
            result.open &&
            result.result &&
            result.result.result &&
            result.result.result.productionId
          ) {
            openProduction(result.result.result.productionId);
            return;
          }
          if (result.refresh !== false) {
            renderContinueCard();
            renderStudio();
            setTimeout(function () {
              setDirectorStatus('done', shortActionMessage(result.message, 'Done ✓'));
              setDirectorGoState('done');
              setTimeout(function () {
                setDirectorGoState('idle');
              }, 1400);
            }, 30);
          } else {
            setTimeout(function () {
              setDirectorGoState('idle');
            }, 1400);
          }
        })
        .catch(function () {
          setDirectorGoState('idle');
          setDirectorStatus('error', 'Save failed. Your Studio is unchanged.');
          toast('Save failed');
        });
      return;
    }
    if (result.kind === 'explain') {
      setDirectorGoState('executing');
      requestDirectorExplain(result);
      return;
    }
    if (result.kind === 'script_ai') {
      requestScriptAiEdit(result);
      return;
    }
    if (result.kind === 'find_refs') {
      var pid =
        result.productionId ||
        (global.S && global.S.studioView && global.S.studioView.productionId);
      if (!pid) {
        setDirectorStatus('error', 'Open a production first.');
        setDirectorGoState('idle');
        return;
      }
      if (global.S) {
        global.S.studioView = global.S.studioView || {};
        global.S.studioView.mode = 'production';
        global.S.studioView.productionId = pid;
        global.S.studioView.section = 'refs';
      }
      renderStudio();
      setDirectorStatus('thinking', 'Loading references…');
      setTimeout(function () {
        findProductionReferences(pid, result.platform || 'youtube', false);
        setDirectorStatus('done', 'Opened Assets & Refs');
        setDirectorGoState('done');
        setTimeout(function () {
          setDirectorGoState('idle');
        }, 1200);
      }, 80);
      return;
    }
    if (result.kind === 'reply') {
      setDirectorPanel(
        '<div class="dir-cmd-status-card kind-clarify">' +
          '<div class="dir-cmd-status-text">' +
          esc(shortActionMessage(result.text, 'OK')) +
          '</div></div>'
      );
      setDirectorGoState('idle');
      return;
    }
    if (result.kind === 'error') {
      setDirectorStatus('error', shortActionMessage(result.message, 'Something went wrong'));
      setDirectorGoState('idle');
      return;
    }
    setDirectorStatus('error', 'Director didn’t understand that. Try again.');
    setDirectorGoState('idle');
  }

  var _dirClarifyOptions = [];
  function chooseDirectorClarifyIndex(index) {
    var opt = _dirClarifyOptions[index];
    if (!opt) return;
    chooseDirectorClarify(opt.value);
  }
  function chooseDirectorClarify(value) {
    if (!global.PreShootDirectorOS || !global.PreShootDirectorOS.resolveClarifyChoice) return;
    var next = global.PreShootDirectorOS.resolveClarifyChoice(value);
    handleDirectorCommandResult(next);
  }

  function requestDirectorExplain(result) {
    var fallback = (result && result.localFallback) || 'Here’s a concise take based on your current production.';
    setDirectorStatus('thinking', statusLabelForIntent((result && result.message) || '') || 'Thinking…');
    var ctxLines = '';
    try {
      if (global.PreShootDirectorOS && global.PreShootDirectorOS.buildOSContext) {
        ctxLines = global.PreShootDirectorOS.buildOSContext();
      }
    } catch (e) {}
    var msg = String((result && result.message) || '').slice(0, 500);
    if (typeof global.apiFetch !== 'function') {
      setDirectorStatus('error', 'Director needs a connection for advice. Try again.');
      setDirectorGoState('idle');
      return;
    }
    global
      .apiFetch('/api/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          directorRequestBody({
            stream: false,
            context:
              ctxLines +
              '\n\nMODE: Studio advice only. Reply in 1 short sentence. Do NOT claim you renamed, deleted, moved, archived, or updated anything. Do NOT say Updated/Done/Completed unless you emit an ACTION block. Mutations require [[ACTION:{...}]]. No markdown.',
            messages: [
              {
                role: 'user',
                content:
                  'Advice-only Studio assistant. Never pretend a mutation happened. Question: ' +
                  msg +
                  '\nIf a rename/move/delete/create is needed, emit [[ACTION:{...}]] with ids from context. Otherwise give brief advice only.'
              }
            ]
          })
        )
      })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (pack) {
        var data = pack.data || {};
        var apiErr = directorApiErrorMessage(data, pack.status);
        if (!pack.ok) {
          var errShow = apiErr || 'Director advice failed. Try again.';
          if (isDevHost()) console.warn('[Director explain]', pack.status, data);
          setDirectorStatus('error', errShow);
          setDirectorPanel(
            '<div class="dir-cmd-status-card kind-error">' +
              '<div class="dir-cmd-status-text">' +
              esc(errShow) +
              '</div></div>'
          );
          setDirectorGoState('idle');
          return;
        }
        var block = (data.content || []).find(function (b) {
          return b.type === 'text';
        });
        var raw = (block && block.text) || fallback;
        var text = raw;
        if (global.PreShootDirectorOS && global.PreShootDirectorOS.stripActionMarker) {
          text = global.PreShootDirectorOS.stripActionMarker(text);
        }
        var act =
          global.PreShootDirectorOS && global.PreShootDirectorOS.parseActionFromReply
            ? global.PreShootDirectorOS.parseActionFromReply(raw)
            : null;
        if (act && act.action) {
          setDirectorStatus('thinking', 'Preparing action…');
          proposeDirectorAction(act.action, act.payload || {});
          return;
        }
        /* Advice only — never claim mutation success / Done */
        setDirectorPanel(
          '<div class="dir-cmd-status-card kind-clarify">' +
            '<div class="dir-cmd-status-text">' +
            esc(shortActionMessage(text, fallback)) +
            '</div></div>'
        );
        setDirectorGoState('idle');
      })
      .catch(function (err) {
        var net =
          isDevHost() && err && err.message
            ? 'Couldn’t reach Director: ' + String(err.message).slice(0, 120)
            : 'Couldn’t reach Director. Try again.';
        setDirectorStatus('error', net);
        setDirectorGoState('idle');
      });
  }

  function directorApiErrorMessage(data, status) {
    var msg =
      (data && data.error && (data.error.message || data.error)) ||
      (data && typeof data.error === 'string' ? data.error : '') ||
      '';
    msg = String(msg || '').trim();
    if (!msg && status && status >= 400) msg = 'Director request failed (' + status + ')';
    return msg.slice(0, 200);
  }

  function isDevHost() {
    try {
      var h = (global.location && global.location.hostname) || '';
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || /\.local$/i.test(h);
    } catch (e) {
      return false;
    }
  }

  function requestScriptAiEdit(result) {
    var productionId =
      (result && result.productionId) ||
      (global.S && global.S.studioView && global.S.studioView.productionId) ||
      (global.S && global.S.activeProductionId) ||
      null;
    if (!productionId || !Studio()) {
      setDirectorStatus('error', 'Open a production script first.');
      setDirectorGoState('idle');
      return;
    }
    var found = Studio().findProduction(productionId);
    if (!found || !found.production) {
      setDirectorStatus('error', 'Production not found.');
      setDirectorGoState('idle');
      return;
    }
    var prod = Studio().ensureWorkspace
      ? Studio().ensureWorkspace(found.production)
      : found.production;
    var existing = Studio().getScriptPlainText
      ? Studio().getScriptPlainText(prod.workspace || {})
      : '';
    var mode = (result && result.mode) || 'append';
    if (mode === 'replace_soft') mode = 'replace';
    var userMsg = String((result && result.message) || '').trim();
    setDirectorGoState('executing');
    setDirectorStatus('thinking', 'Thinking…');
    if (typeof global.apiFetch !== 'function') {
      setDirectorStatus('error', 'Director needs a connection to edit the script.');
      setDirectorGoState('idle');
      return;
    }
    var ctxLines = '';
    try {
      if (global.PreShootDirectorOS && global.PreShootDirectorOS.buildOSContext) {
        ctxLines = global.PreShootDirectorOS.buildOSContext();
      }
    } catch (e) {}
    setDirectorStatus('thinking', 'Preparing changes…');
    var modeHint =
      mode === 'replace'
        ? 'MODE=replace — return the FULL rewritten script. Destructive.'
        : mode === 'patch_hook'
          ? 'MODE=patch_hook — return ONLY the new opening/hook paragraph (not the whole script).'
          : mode === 'patch_ending'
            ? 'MODE=patch_ending — return ONLY the new ending/CTA lines to append (not the whole script).'
            : 'MODE=append — return ONLY the continuation to add after the existing script. Do NOT repeat or delete existing lines.';
    _lastScriptAi = {
      productionId: productionId,
      mode: mode,
      message: userMsg
    };
    global
      .apiFetch('/api/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          directorRequestBody({
            stream: false,
            max_tokens: 2800,
            context:
              ctxLines +
              '\n\nMODE: Script mutation. You MUST emit exactly one block:\n' +
              '[[SCRIPT:{"mode":"' +
              mode +
              '","body":"..."}]]\n' +
              modeHint +
              '\nSCRIPT RULES: body is spoken words only (dialogue / VO / narration). ' +
              'Section labels and [ON CAMERA] / [VOICEOVER] are allowed. ' +
              'Never put [VISUAL], [SHOT], [CAMERA], [B-ROLL], gear, framing, movement, lighting, or production notes in the script body.\n' +
              'Do NOT say Done/Updated/Finished in plain text. Do NOT claim success. The app executes the mutation.',
            messages: [
              {
                role: 'user',
                content:
                  'ProductionId: ' +
                  productionId +
                  '\nUser request: ' +
                  userMsg +
                  '\n\nEXISTING SCRIPT (preserve unless replace):\n"""\n' +
                  (existing || '(empty)') +
                  '\n"""\n\nEmit [[SCRIPT:{...}]] only. Body must be spoken script text for the chosen mode — never camera or visual directions.'
              }
            ]
          })
        )
      })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (pack) {
        var data = pack.data || {};
        var apiErr = directorApiErrorMessage(data, pack.status);
        if (!pack.ok) {
          var show =
            apiErr ||
            'Director couldn’t prepare a script change. Try again.';
          if (isDevHost() && apiErr) {
            console.warn('[Director script_ai]', pack.status, data);
          }
          setDirectorStatus('error', show);
          setDirectorPanel(
            '<div class="dir-cmd-status-card kind-error">' +
              '<div class="dir-cmd-status-text">' +
              esc(show) +
              '</div></div>' +
              '<button type="button" class="studio-btn ghost sm" style="margin-top:8px" onclick="PreShootStudioUI.retryLastScriptAi()">Retry</button>'
          );
          setDirectorGoState('idle');
          return;
        }
        var block = (data.content || []).find(function (b) {
          return b.type === 'text';
        });
        var raw = (block && block.text) || '';
        if (!raw.trim()) {
          var emptyMsg = 'Director returned an empty script draft. Try again.';
          setDirectorStatus('error', emptyMsg);
          setDirectorPanel(
            '<div class="dir-cmd-status-card kind-error">' +
              '<div class="dir-cmd-status-text">' +
              esc(emptyMsg) +
              '</div></div>' +
              '<button type="button" class="studio-btn ghost sm" style="margin-top:8px" onclick="PreShootStudioUI.retryLastScriptAi()">Retry</button>'
          );
          setDirectorGoState('idle');
          return;
        }
        var patch =
          global.PreShootDirectorOS && global.PreShootDirectorOS.parseScriptPatch
            ? global.PreShootDirectorOS.parseScriptPatch(raw, mode)
            : null;
        if (!patch || !String(patch.body || '').trim()) {
          var failMsg =
            isDevHost()
              ? 'Could not parse script patch from Director reply. Check console.'
              : 'Director couldn’t prepare a script change. Try again.';
          if (isDevHost()) console.warn('[Director script_ai parse fail]', raw.slice(0, 500));
          setDirectorStatus('error', failMsg);
          setDirectorPanel(
            '<div class="dir-cmd-status-card kind-error">' +
              '<div class="dir-cmd-status-text">' +
              esc(failMsg) +
              '</div></div>' +
              '<button type="button" class="studio-btn ghost sm" style="margin-top:8px" onclick="PreShootStudioUI.retryLastScriptAi()">Retry</button>'
          );
          setDirectorGoState('idle');
          return;
        }
        var applyMode = patch.mode || mode;
        if (applyMode === 'replace_soft') applyMode = 'replace';
        /* Safety: force append unless user asked for full rewrite */
        if (mode !== 'replace' && applyMode === 'replace') {
          applyMode = mode === 'patch_hook' || mode === 'patch_ending' ? mode : 'append';
        }
        if (mode === 'replace') applyMode = 'replace';
        var bodyIn = String(patch.body).trim();
        var visualNotes = null;
        if (Studio().separateScriptFromProduction) {
          var sep = Studio().separateScriptFromProduction(bodyIn);
          if (sep && sep.hadProductionLeak && !String(sep.scriptBody || '').trim()) {
            var leakMsg = 'Director mixed camera notes into the script. Retry generation.';
            setDirectorStatus('error', leakMsg);
            setDirectorPanel(
              '<div class="dir-cmd-status-card kind-error">' +
                '<div class="dir-cmd-status-text">' +
                esc(leakMsg) +
                '</div></div>' +
                '<button type="button" class="studio-btn ghost sm" style="margin-top:8px" onclick="PreShootStudioUI.retryLastScriptAi()">Retry</button>'
            );
            setDirectorGoState('idle');
            return;
          }
          if (sep && sep.scriptBody) {
            visualNotes = (sep.beats || [])
              .filter(function (b) {
                return b && (b.spoken || b.header);
              })
              .map(function (b) {
                return b.visual || '';
              });
            bodyIn = sep.scriptBody;
          }
        }
        setDirectorStatus('thinking', 'Ready to execute');
        _lastScriptAi = {
          productionId: productionId,
          mode: applyMode,
          message: userMsg
        };
        stageDirectorAction(
          'update_script',
          {
            productionId: productionId,
            mode: applyMode,
            body: bodyIn,
            visualNotes: visualNotes,
            verifySnippet: bodyIn.slice(0, 80),
            previousLength: existing.length
          },
          { tool: 'script', mutates: true, object: { type: 'script', id: productionId } }
        );
        noteStreak('script');
      })
      .catch(function (err) {
        var net =
          isDevHost() && err && err.message
            ? 'Couldn’t reach Director: ' + String(err.message).slice(0, 120)
            : 'Couldn’t reach Director. Try again.';
        setDirectorStatus('error', net);
        setDirectorGoState('idle');
      });
  }

  var _lastScriptAi = null;
  function retryLastScriptAi() {
    if (!_lastScriptAi) {
      setDirectorStatus('error', 'Nothing to retry.');
      return;
    }
    requestScriptAiEdit({
      kind: 'script_ai',
      productionId: _lastScriptAi.productionId,
      mode: _lastScriptAi.mode,
      message: _lastScriptAi.message
    });
  }

  function toggleDirectorVoice() {
    var Voice = global.PreShootDirectorVoice;
    var btn = document.getElementById('dir-cmd-mic');
    if (Voice && Voice.isOpen && Voice.isOpen()) {
      Voice.close({ cancel: true });
      if (btn) btn.classList.remove('listening');
      return;
    }
    if (!Voice || typeof Voice.open !== 'function') {
      setDirectorStatus('error', 'Voice mode isn’t loaded. Refresh and try again.');
      toast('Voice mode isn’t available');
      return;
    }
    if (!Voice.isSupported || !Voice.isSupported()) {
      var msg = 'Voice mode isn’t available in this browser. Type your request instead.';
      setDirectorStatus('error', msg);
      toast(msg);
      return;
    }
    /* Don't claim Listening until Voice overlay recognition starts */
    if (btn) btn.classList.add('listening');
    setDirectorStatus('thinking', 'Starting microphone…');
    Voice.open({
      onFinal: function (said) {
        if (btn) btn.classList.remove('listening');
        var text = String(said || '').trim();
        if (!text) {
          setDirectorStatus('error', 'I didn’t catch that. Try again.');
          return;
        }
        var inp = document.getElementById('dir-cmd-input');
        if (inp) inp.value = text;
        setDirectorStatus('thinking', statusLabelForIntent(text));
        submitDirectorCommand(text);
      },
      onError: function (errMsg) {
        if (btn) btn.classList.remove('listening');
        setDirectorStatus('error', errMsg || 'Microphone access failed.');
        toast(errMsg || 'Microphone access failed.');
      }
    });
  }

  function openDirectorForProduction(productionId) {
    /* Stay in Studio — focus the in-page Director command bar */
    if (global.S) global.S.activeProductionId = productionId;
    if (global.S) {
      global.S.studioView = global.S.studioView || {};
      global.S.studioView.mode = 'production';
      global.S.studioView.productionId = productionId;
    }
    renderStudio();
    setTimeout(function () {
      var inp = document.getElementById('dir-cmd-input');
      if (inp) inp.focus();
    }, 40);
  }

  function directorPlaceholder() {
    var inp = document.getElementById('dir-cmd-input');
    if (inp) {
      inp.focus();
      return;
    }
    toast('Use the Director bar at the bottom of Studio');
  }

  function renderProductionDetail(root, productionId) {
    var found = Studio().findProduction(productionId);
    if (!found) {
      backToList();
      return;
    }
    var prod = Studio().ensureWorkspace(found.production);
    var project = found.project;
    var pct =
      typeof prod.progress === 'number' ? prod.progress : Studio().statusProgress(prod.status);
    var ws = prod.workspace || Studio().defaultWorkspace();
    var ov = ws.overview || {};
    var stageIdx = 0;
    Studio().STATUSES.forEach(function (s, i) {
      if (s.id === prod.status) stageIdx = i;
    });
    if (prod.status === 'archived') stageIdx = Studio().STATUSES.length - 1;

    var view = (global.S && global.S.studioView) || {};
    var section = view.section || 'overview';

    var h = '';
    h += '<div class="studio-shell studio-fade pw-shell">';
    h += '<div class="studio-detail-hd">';
    h +=
      '<button type="button" class="studio-back" onclick="PreShootStudioUI.openProject(\'' +
      esc(project.id) +
      '\')" aria-label="Back">‹</button>';
    h += '<div class="studio-hd-text">';
    h += '<div class="studio-eyebrow">' + esc(project.name) + '</div>';
    h += '<div class="studio-title">' + esc(prod.name) + '</div>';
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.productionPresenceHtml) {
      h += PreShootWorkspaceUI.productionPresenceHtml(productionId);
    }
    var healthScore = Studio().computeProductionHealth
      ? Studio().computeProductionHealth(prod).score
      : prod.healthScore || 0;
    h +=
      '<div class="studio-sub">' +
      esc((Studio().STATUS_MAP[prod.status] || {}).label || prod.status) +
      ' · Stage ' +
      pct +
      '% · Health ' +
      healthScore +
      '%</div></div>';
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.workspaceSwitcherButtonHtml) {
      h += PreShootWorkspaceUI.workspaceSwitcherButtonHtml();
    }
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.getContext &&
      PreShootWorkspace.getContext().remoteUpdate
    ) {
      h +=
        '<button type="button" class="studio-btn ghost sm ws-remote-btn" onclick="PreShootWorkspaceUI.reviewRemoteUpdate()">Review update</button>';
    }
    h +=
      '<button type="button" class="studio-icon-btn" onclick="PreShootStudioUI.toggleProductionMenu(\'' +
      esc(productionId) +
      '\')" aria-label="Production options">⋯</button>';
    h += '</div>';
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.productionActivityHtml) {
      h += PreShootWorkspaceUI.productionActivityHtml(productionId);
    }
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared() &&
      global.PreShootWorkspaceComments
    ) {
      PreShootWorkspaceComments.ensureLoaded(productionId);
    }

    h += '<div id="st-production-menu" class="st-overflow-menu" hidden>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.renameProductionPrompt(\'' +
      esc(productionId) +
      '\')">Rename</button>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.moveProductionPrompt(\'' +
      esc(productionId) +
      '\')">Move</button>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.duplicateProduction(\'' +
      esc(productionId) +
      '\')">Duplicate</button>';
    h +=
      '<button type="button" onclick="PreShootStudioUI.archiveProductionPrompt(\'' +
      esc(productionId) +
      '\')">Archive</button>';
    h +=
      '<button type="button" class="danger" onclick="PreShootStudioUI.deleteProduction(\'' +
      esc(productionId) +
      '\')">Delete</button>';
    h += '</div>';

    /* Progress stages */
    h += '<div class="pw-card pw-progress-card">';
    h += '<div class="pw-card-kicker">Progress</div>';
    h += '<div class="st-stage-rail pw-stage-rail" aria-label="Production stages">';
    Studio().STATUSES.forEach(function (s, i) {
      if (s.id === 'archived') return;
      var cls = 'st-stage';
      if (i < stageIdx) cls += ' done';
      if (i === stageIdx) cls += ' on';
      h +=
        '<button type="button" class="' +
        cls +
        '" onclick="PreShootStudioUI.setStatus(\'' +
        esc(productionId) +
        "','" +
        esc(s.id) +
        '\')"><span class="st-stage-dot"></span><span class="st-stage-lbl">' +
        esc(s.label) +
        '</span></button>';
    });
    h += '</div>';
    h += progressBar(pct);
    h += '</div>';

    /* Section tabs = Production Tools */
    var tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'shots', label: 'Shot List' },
      { id: 'script', label: 'Script' },
      { id: 'refs', label: 'Assets & Refs' },
      { id: 'performance', label: 'Performance' }
    ];
    h += '<div class="st-tabs">';
    tabs.forEach(function (t) {
      h +=
        '<button type="button" class="st-tab' +
        (section === t.id || (t.id === 'refs' && section === 'assets') ? ' on' : '') +
        '" onclick="PreShootStudioUI.setProdSection(\'' +
        esc(productionId) +
        "','" +
        esc(t.id) +
        '\')">' +
        esc(t.label) +
        '</button>';
    });
    h += '</div>';

    h += '<div class="st-section">';
    if (section === 'overview') h += renderOverviewSection(prod, project, productionId, ov, pct);
    else if (section === 'shots') h += renderShotsSection(prod, productionId, ws);
    else if (section === 'script') h += renderScriptSection(prod, productionId, ws);
    else if (section === 'trending') h += renderTrendingSection(prod, productionId);
    else if (section === 'refs' || section === 'assets') h += renderRefsSection(prod, productionId, ws);
    else if (section === 'performance') h += renderPerformanceSection(prod, productionId, ws);
    h += '</div>';

    h += renderDirectorCard(productionId);

    h += '</div>';
    root.innerHTML = h;
    if (section === 'trending' && global.PreShootTrending && PreShootTrending.hydrateStudio) {
      PreShootTrending.hydrateStudio(productionId);
    }
    setTimeout(function () {
      setDirectorGoState('idle');
    }, 0);
  }

  function setProdSection(productionId, section) {
    if (!global.S) return;
    var projectId =
      (global.S.studioView && global.S.studioView.projectId) || null;
    try {
      var found = Studio().findProduction(productionId);
      if (found && found.project) projectId = found.project.id;
    } catch (e) {}
    global.S.studioView = {
      mode: 'production',
      projectId: projectId,
      productionId: productionId,
      section: section || 'overview'
    };
    if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
      PreShootWorkspaceRealtime.scheduleTrack();
    }
    renderStudio();
  }

  function saveWorkspaceField(productionId, group, field, value) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    if (!prod.workspace[group] || typeof prod.workspace[group] !== 'object') {
      prod.workspace[group] = {};
    }
    prod.workspace[group][field] = value;
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    renderContinueCard();
  }

  function saveScript(productionId, value) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    if (Studio().applyScriptPlainText) {
      var applied = Studio().applyScriptPlainText(prod.workspace, value, 'replace');
      Studio().updateProduction(productionId, { workspace: applied.workspace });
    } else {
      prod.workspace.script = prod.workspace.script || { body: '' };
      prod.workspace.script.body = value;
      Studio().updateProduction(productionId, { workspace: prod.workspace });
    }
    refreshScriptFullscreenIfOpen(productionId);
  }

  var _scriptFsProductionId = null;

  function ensureScriptFullscreen() {
    var ov = document.getElementById('script-fs-ov');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'script-fs-ov';
    ov.className = 'script-fs-ov';
    ov.setAttribute('hidden', '');
    ov.innerHTML =
      '<div class="script-fs-shell">' +
      '<header class="script-fs-hd">' +
      '<button type="button" class="studio-btn ghost sm" id="script-fs-back" aria-label="Exit full screen">← Studio</button>' +
      '<div class="script-fs-title">Script</div>' +
      '<button type="button" class="studio-btn ghost sm" id="script-fs-dir-toggle" aria-label="Director">Director</button>' +
      '</header>' +
      '<textarea id="script-fs-input" class="script-fs-input" placeholder="Write your script…" autocomplete="off" autocorrect="on" autocapitalize="sentences" spellcheck="true"></textarea>' +
      '<div class="script-fs-dir" id="script-fs-dir">' +
      '<div class="dir-cmd" data-dir-scope="script-fs">' +
      '<div class="dir-cmd-bar">' +
      '<span class="dir-cmd-mark" aria-hidden="true">D</span>' +
      '<input type="text" class="dir-cmd-input" id="script-fs-dir-input" placeholder="Finish this script…" autocomplete="off" />' +
      '<button type="button" class="dir-cmd-mic" id="script-fs-dir-mic" aria-label="Voice input">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>' +
      '</button>' +
      '<button type="button" class="dir-cmd-go" id="script-fs-dir-go" disabled>Go</button>' +
      '</div>' +
      '<div class="dir-cmd-panel" id="script-fs-dir-panel" hidden></div>' +
      '</div></div></div>';
    document.body.appendChild(ov);
    document.getElementById('script-fs-back').addEventListener('click', function () {
      closeScriptFullscreen();
    });
    document.getElementById('script-fs-dir-toggle').addEventListener('click', function () {
      var bar = document.getElementById('script-fs-dir');
      if (!bar) return;
      bar.classList.toggle('open');
      if (bar.classList.contains('open')) {
        var inp = document.getElementById('script-fs-dir-input');
        if (inp) inp.focus();
      }
    });
    var ta = document.getElementById('script-fs-input');
    if (ta) {
      ta.addEventListener('change', function () {
        if (_scriptFsProductionId) saveScript(_scriptFsProductionId, ta.value);
      });
      ta.addEventListener('blur', function () {
        if (_scriptFsProductionId) saveScript(_scriptFsProductionId, ta.value);
      });
    }
    var fsInp = document.getElementById('script-fs-dir-input');
    if (fsInp) {
      fsInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submitScriptFullscreenDirector();
        }
      });
      fsInp.addEventListener('input', function () {
        var go = document.getElementById('script-fs-dir-go');
        if (go && _dirGoState !== 'ready' && _dirGoState !== 'executing') {
          var has = !!String(fsInp.value || '').trim();
          go.disabled = !has;
          go.classList.toggle('ready', has);
        }
      });
    }
    var fsGo = document.getElementById('script-fs-dir-go');
    if (fsGo) {
      fsGo.addEventListener('click', function () {
        submitScriptFullscreenDirector();
      });
    }
    var fsMic = document.getElementById('script-fs-dir-mic');
    if (fsMic) {
      fsMic.addEventListener('click', function () {
        toggleDirectorVoiceFromScriptFs();
      });
    }
    return ov;
  }

  function openScriptFullscreen(productionId) {
    if (!productionId || !Studio()) return;
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var text = Studio().getScriptPlainText
      ? Studio().getScriptPlainText(prod.workspace || {})
      : '';
    _scriptFsProductionId = productionId;
    if (global.S) {
      global.S.activeProductionId = productionId;
      global.S.studioView = global.S.studioView || {};
      global.S.studioView.mode = 'production';
      global.S.studioView.productionId = productionId;
      global.S.studioView.section = 'script';
    }
    var ov = ensureScriptFullscreen();
    var ta = document.getElementById('script-fs-input');
    if (ta) ta.value = text;
    ov.removeAttribute('hidden');
    ov.classList.add('open');
    document.documentElement.classList.add('script-fs-active');
    var bnav = document.querySelector('.bnav');
    if (bnav) bnav.classList.add('hidden');
    setTimeout(function () {
      if (ta) ta.focus();
    }, 40);
  }

  function closeScriptFullscreen() {
    var ov = document.getElementById('script-fs-ov');
    var ta = document.getElementById('script-fs-input');
    if (_scriptFsProductionId && ta) {
      saveScript(_scriptFsProductionId, ta.value);
    }
    if (ov) {
      ov.classList.remove('open');
      ov.setAttribute('hidden', '');
    }
    document.documentElement.classList.remove('script-fs-active');
    var bnav = document.querySelector('.bnav');
    if (bnav) bnav.classList.remove('hidden');
    var pid = _scriptFsProductionId;
    _scriptFsProductionId = null;
    if (pid) {
      if (global.S && global.S.studioView) global.S.studioView.section = 'script';
      renderStudio();
    }
  }

  function refreshScriptFullscreenIfOpen(productionId) {
    if (!_scriptFsProductionId || _scriptFsProductionId !== productionId) return;
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var text = Studio().getScriptPlainText
      ? Studio().getScriptPlainText(prod.workspace || {})
      : '';
    var ta = document.getElementById('script-fs-input');
    if (ta && document.activeElement !== ta) ta.value = text;
    else if (ta && !String(ta.value || '').trim()) ta.value = text;
  }

  function submitScriptFullscreenDirector() {
    var inp = document.getElementById('script-fs-dir-input');
    var text = inp ? String(inp.value || '').trim() : '';
    if (_dirGoState === 'ready' && pendingDirectorAction) {
      executeStagedDirectorAction();
      return;
    }
    if (!text) {
      setDirectorStatus('error', 'Tell Director what to change in the script.');
      return;
    }
    if (inp) inp.value = '';
    var mainInp = document.getElementById('dir-cmd-input');
    if (mainInp) mainInp.value = text;
    submitDirectorCommand(text);
    var bar = document.getElementById('script-fs-dir');
    if (bar) bar.classList.add('open');
  }

  function toggleDirectorVoiceFromScriptFs() {
    var Voice = global.PreShootDirectorVoice;
    var btn = document.getElementById('script-fs-dir-mic');
    if (Voice && Voice.isOpen && Voice.isOpen()) {
      Voice.close({ cancel: true });
      if (btn) btn.classList.remove('listening');
      return;
    }
    if (!Voice || !Voice.isSupported || !Voice.isSupported()) {
      toast('Voice mode isn’t available in this browser. Type your request instead.');
      return;
    }
    if (btn) btn.classList.add('listening');
    setDirectorStatus('thinking', 'Starting microphone…');
    Voice.open({
      onFinal: function (said) {
        if (btn) btn.classList.remove('listening');
        var text = String(said || '').trim();
        if (!text) {
          setDirectorStatus('error', 'I didn’t catch that. Try again.');
          return;
        }
        var fsInp = document.getElementById('script-fs-dir-input');
        if (fsInp) fsInp.value = text;
        submitDirectorCommand(text);
      },
      onError: function (errMsg) {
        if (btn) btn.classList.remove('listening');
        setDirectorStatus('error', errMsg || 'Microphone access failed.');
        toast(errMsg || 'Microphone access failed.');
      }
    });
  }

  function toggleProjectMenu(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    var other = document.getElementById('st-production-menu');
    if (other) other.hidden = true;
  }

  function toggleProductionMenu(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    var other = document.getElementById('st-project-menu');
    if (other) other.hidden = true;
  }

  function renameProductionPrompt(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (menu) menu.hidden = true;
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var name = prompt('Rename production', found.production.name);
    if (name == null) return;
    Studio().updateProduction(productionId, { name: name });
    toast('Production renamed');
    openProduction(productionId);
  }

  function archiveProductionPrompt(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (menu) menu.hidden = true;
    if (!confirm('Archive this production?')) return;
    Studio().updateProduction(productionId, { status: 'archived', archived: true });
    toast('Production archived');
    var found = Studio().findProduction(productionId);
    if (found && found.project) openProject(found.project.id);
    else backToList();
  }


  function toggleShot(productionId, shotId) {
    var map = ensureExpandedMap(productionId);
    map[shotId] = !map[shotId];
    if (global.S) {
      global.S.studioView = {
        mode: 'production',
        productionId: productionId,
        section: 'shots'
      };
    }
    renderStudio();
  }

  function updateShotField(productionId, shotId, field, value) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var list = prod.workspace.shotList || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === shotId) {
        list[i][field] = value;
        break;
      }
    }
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    renderContinueCard();
  }

  function addShot(productionId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var list = prod.workspace.shotList || [];
    var order = list.length + 1;
    list.push(
      Studio().createShot({
        order: order,
        purpose: 'Setup',
        durationSec: 3,
        beginnerTip: 'Keep it simple — one clear action per shot.'
      })
    );
    prod.workspace.shotList = list;
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    ensureExpandedMap(productionId)[list[list.length - 1].id] = true;
    if (global.PreShootAnalytics) {
      PreShootAnalytics.track('shotlist_created', {
        mode: 'shot',
        id: String(productionId).slice(0, 40)
      });
    }
    if (global.S) {
      global.S.studioView = { mode: 'production', productionId: productionId, section: 'shots' };
    }
    renderStudio();
  }

  function deleteShot(productionId, shotId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    prod.workspace.shotList = (prod.workspace.shotList || []).filter(function (s) {
      return s.id !== shotId;
    });
    prod.workspace.shotList.forEach(function (s, i) {
      s.order = i + 1;
    });
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    renderStudio();
  }

  function addScriptLine(productionId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    prod.workspace.script = prod.workspace.script || { body: '', lines: [] };
    if (!Array.isArray(prod.workspace.script.lines)) prod.workspace.script.lines = [];
    prod.workspace.script.lines.push(Studio().createScriptLine({ text: '' }));
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    if (global.PreShootAnalytics) {
      PreShootAnalytics.track('script_created', {
        mode: 'line',
        id: String(productionId).slice(0, 40)
      });
    }
    if (global.S) {
      global.S.studioView = { mode: 'production', productionId: productionId, section: 'script' };
    }
    renderStudio();
  }

  function updateScriptLine(productionId, lineId, text) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var lines = (prod.workspace.script && prod.workspace.script.lines) || [];
    lines.forEach(function (l) {
      if (l.id === lineId) l.text = text;
    });
    prod.workspace.script.lines = lines;
    prod.workspace.script.body = lines
      .map(function (l) {
        return l.text;
      })
      .join('\n\n');
    Studio().updateProduction(productionId, { workspace: prod.workspace });
  }

  function linkScriptLine(productionId, lineId, shotId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var shot = null;
    (prod.workspace.shotList || []).forEach(function (s) {
      if (s.id === shotId) shot = s;
    });
    (prod.workspace.script.lines || []).forEach(function (l) {
      if (l.id === lineId) {
        l.shotId = shot ? shot.id : null;
        l.shotOrder = shot ? shot.order : null;
      }
    });
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    renderStudio();
  }

  function deleteScriptLine(productionId, lineId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    prod.workspace.script.lines = (prod.workspace.script.lines || []).filter(function (l) {
      return l.id !== lineId;
    });
    prod.workspace.script.body = prod.workspace.script.lines
      .map(function (l) {
        return l.text;
      })
      .join('\n\n');
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    renderStudio();
  }

  function convertScriptBody(productionId) {
    var found = Studio().findProduction(productionId);
    if (!found) return;
    var prod = Studio().ensureWorkspace(found.production);
    var body = (prod.workspace.script && prod.workspace.script.body) || '';
    var parts = body
      .split(/\n\s*\n/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean);
    if (!parts.length) {
      parts = body
        .split('\n')
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean);
    }
    prod.workspace.script.lines = parts.map(function (text, i) {
      return Studio().createScriptLine({ text: text, shotOrder: i + 1 });
    });
    Studio().updateProduction(productionId, { workspace: prod.workspace });
    toast('Script converted to lines');
    renderStudio();
  }

  function generateScript(productionId) {
    if (!studioCanMutate()) {
      toast('This workspace is read-only');
      return;
    }
    if (!Studio() || !productionId) return;
    var found = Studio().findProduction(productionId);
    if (!found) {
      toast('Production not found');
      return;
    }
    var prod = Studio().ensureWorkspace(found.production);
    var idea = prod.ideaSnapshot || {};
    var ov = (prod.workspace && prod.workspace.overview) || {};
    if (Studio().hasRealScript && Studio().hasRealScript(prod.workspace, idea)) {
      if (!confirm('Replace the current script with a newly generated draft? Your current script will be overwritten.')) {
        return;
      }
    }
    var niche = (global.S && global.S.niche) || {};
    var prompt =
      'Write ONLY the spoken script for this production. Script and shot list are separate documents.\n' +
      'The Script contains what is SAID. Do NOT write how it is filmed.\n' +
      'Do NOT copy the idea description, strategy, or why-it-works text.\n' +
      'Return the FULL spoken script only.\n\n' +
      'Allowed: HOOK / SETUP / PAYOFF / CTA labels, speaker names, [ON CAMERA], [VOICEOVER], [NARRATION], spoken lines.\n' +
      'Forbidden inside the Script: [VISUAL], [SHOT], [CAMERA], [B-ROLL], camera bodies, gimbals, lenses, framing, movement, lighting, B-roll, equipment, depth of field, or any production instruction.\n' +
      'Those belong in the Shot List, which you must NOT generate here.\n\n' +
      'Required shape (blank line between beats):\n' +
      'HOOK\n[ON CAMERA]\nYou don\'t learn faster by studying more.\nYou learn faster by teaching.\n\n' +
      'SETUP\n[VOICEOVER] or [ON CAMERA]\nspoken lines only\n\nPAYOFF\nspoken lines only\n\nCTA\nspoken lines only\n\n' +
      'Context — concept only, not script:\n' +
      'Title: ' + (idea.title || prod.name || '') + '\n' +
      'Hook idea: ' + (idea.hook || '') + '\n' +
      'Angle: ' + (idea.shotAngle || '') + '\n' +
      'Why it works (do not paste): ' + String(idea.whyItWorks || '').slice(0, 180) + '\n' +
      'Platform: ' + (ov.platform || niche.platform || '') + '\n' +
      'Audience / niche: ' + (niche.contentType || '') + '\n' +
      'Format: ' + (ov.format || idea.category || '') + '\n' +
      'Goal: ' + (ov.goal || '') + '\n' +
      'Production notes: ' + String(prod.notes || '').slice(0, 160);
    if (global.S) {
      global.S.studioView = global.S.studioView || {};
      global.S.studioView.productionId = productionId;
      global.S.studioView.section = 'script';
    }
    requestScriptAiEdit({ productionId: productionId, mode: 'replace', message: prompt });
  }

  function generateShotList(productionId) {
    if (!studioCanMutate()) {
      toast('This workspace is read-only');
      return;
    }
    if (!Studio() || !Studio().buildShotListFromScript) return;
    var found = Studio().findProduction(productionId);
    if (!found) {
      toast('Production not found');
      return;
    }
    var prod = Studio().ensureWorkspace(found.production);
    var ws = prod.workspace || {};
    if (!Studio().hasRealScript(ws, prod.ideaSnapshot || {})) {
      toast('Write or generate a script first');
      if (global.S && global.S.studioView) global.S.studioView.section = 'script';
      renderStudio();
      return;
    }
    if (ws.shotList && ws.shotList.length) {
      if (!confirm('Replace the current shot list? Script stays. Existing shots will be overwritten.')) {
        return;
      }
    }
    var result = Studio().buildShotListFromScript(productionId, { allowStarter: false });
    if (!result || !result.ok) {
      toast((result && result.message) || 'Could not generate shot list');
      return;
    }
    toast('Shot list built from script');
    noteStreak('shotlist');
    if (global.S && global.S.studioView) global.S.studioView.section = 'shots';
    renderContinueCard();
    renderStudio();
  }

  function copyScript(productionId) {
    var Ex = global.PreShootStudioExport;
    if (!Ex) {
      toast('Export unavailable');
      return;
    }
    Ex.copyScript(productionId).then(
      function () { toast('Script copied'); },
      function () { toast('Could not copy script'); }
    );
  }

  function copyShotList(productionId) {
    var Ex = global.PreShootStudioExport;
    if (!Ex) {
      toast('Export unavailable');
      return;
    }
    Ex.copyShotList(productionId).then(
      function () { toast('Shot list copied'); },
      function () { toast('Could not copy shot list'); }
    );
  }

  function exportScriptPdf(productionId) {
    var Ex = global.PreShootStudioExport;
    if (!Ex || !Ex.exportScriptPdf(productionId)) toast('Could not export script PDF');
    else toast('Downloading script PDF');
  }

  function exportShotListPdf(productionId) {
    var Ex = global.PreShootStudioExport;
    if (!Ex || !Ex.exportShotListPdf(productionId)) toast('Could not export shot list PDF');
    else toast('Downloading shot list PDF');
  }

  function exportPackagePdf(productionId) {
    var Ex = global.PreShootStudioExport;
    if (!Ex || !Ex.exportPackagePdf(productionId)) toast('Could not export package PDF');
    else toast('Downloading production package');
  }

  function seedFromIdea(productionId) {
    if (!studioCanMutate()) {
      toast('This workspace is read-only');
      return;
    }
    if (!Studio().buildWorkspaceFromIdea) return;
    Studio().buildWorkspaceFromIdea(productionId);
    toast('Workspace built from idea');
    if (global.S) {
      global.S.studioView = {
        mode: 'production',
        productionId: productionId,
        section: (global.S.studioView && global.S.studioView.section) || 'shots'
      };
    }
    renderContinueCard();
    renderStudio();
  }

  /* ── Continue Working + Suggested Next (compact Home) ── */
  var pendingSuggestedNext = null;

  function suggestedNextHeadline(next) {
    if (!next) return '';
    var name = next.productionName || '';
    if (next.id === 'continue' || next.id === 'open_recent') {
      return name ? 'Continue editing: ' + name : next.text || 'Continue where you left off';
    }
    if (name) return 'Continue editing: ' + name;
    return next.text || 'Suggested next step';
  }

  function suggestedNextReason(next) {
    if (!next) return '';
    var reasons = {
      continue: 'Pick up this production and keep momentum.',
      open_recent: 'This is your most recently updated production.',
      need_shots: 'A shot list makes filming faster and more intentional.',
      need_script: 'Mapping lines to shots keeps the edit clear.',
      need_refs: 'References help lock the look before you film.',
      need_assets: 'Inspiration and scan assets ground the production.',
      need_goal: 'A clear goal helps Director give better advice.',
      need_platform: 'Platform pacing changes hook length and structure.',
      script_long: 'Short-form audiences drop off when scripts run long.',
      weak_hook: 'A sharper first line improves retention.',
      ready_film: 'Completeness looks strong — time to shoot.',
      add_perf: 'Logging results improves future recommendations.'
    };
    if (reasons[next.id]) return reasons[next.id];
    return 'Director AI recommends this as your next step.';
  }

  function renderContinueCard() {
    var mount = document.getElementById('continue-working');
    var smart = document.getElementById('home-smart');
    if (!Studio()) return;
    var insights = Studio().getHomeInsights ? Studio().getHomeInsights() : null;
    var cw = insights ? insights.continueWorking : Studio().getContinueWorking();

    if (mount) {
      if (!cw) {
        mount.innerHTML = '';
        mount.style.display = 'none';
      } else {
        var statusLbl =
          (Studio().STATUS_MAP[cw.production.status] || {}).label || cw.production.status || 'Planning';
        mount.style.display = 'block';
        mount.innerHTML =
          '<button type="button" class="continue-card continue-card-compact" onclick="PreShootStudioUI.openProduction(\'' +
          esc(cw.production.id) +
          '\')">' +
          '<div class="continue-body">' +
          '<div class="continue-kicker">Continue Working</div>' +
          '<div class="continue-title">' +
          esc(cw.production.name) +
          '</div>' +
          '<div class="continue-meta-line">' +
          esc(statusLbl) +
          ' · ' +
          cw.progress +
          '%</div>' +
          '</div>' +
          '<div class="continue-cta">Continue <span aria-hidden="true">→</span></div>' +
          '</button>';
      }
    }

    /* Home: Suggested Next only (Recent Productions / Scans live in Studio + Library) */
    if (!smart) return;
    var next = insights && insights.nextAction;
    pendingSuggestedNext = next || null;
    if (!next || !next.text) {
      smart.innerHTML = '';
      smart.style.display = 'none';
      return;
    }
    smart.style.display = 'block';
    smart.innerHTML =
      '<button type="button" class="home-suggest-compact" onclick="PreShootStudioUI.openSuggestedNext()">' +
      '<span class="home-suggest-ico" aria-hidden="true">✦</span>' +
      '<div class="home-suggest-compact-body">' +
      '<div class="continue-kicker">Suggested Next</div>' +
      '<div class="home-suggest-compact-title">' +
      esc(suggestedNextHeadline(next)) +
      '</div>' +
      '</div>' +
      '<span class="home-suggest-chev" aria-hidden="true">›</span>' +
      '</button>';
  }

  function openSuggestedFromStudio(suggestion) {
    pendingSuggestedNext = Object.assign({}, suggestion || {}, {
      productionName: suggestion && suggestion.productionName,
      productionId:
        (suggestion && suggestion.productionId) ||
        (suggestion && suggestion.payload && suggestion.payload.productionId) ||
        (global.S && global.S.studioView && global.S.studioView.productionId) ||
        null
    });
    openSuggestedNext();
  }

  function handleOverviewSuggestion(index) {
    var list = global.__preshootOverviewSuggestions || [];
    var s = list[index];
    if (!s) return;
    if (s.action) {
      proposeDirectorAction(s.action, s.payload || {});
      return;
    }
    openSuggestedFromStudio(s);
  }

  function openSuggestedNext() {
    var next = pendingSuggestedNext;
    if (!next) {
      if (Studio() && Studio().getHomeInsights) {
        next = (Studio().getHomeInsights() || {}).nextAction;
        pendingSuggestedNext = next || null;
      }
    }
    if (!next) return;
    var title = document.getElementById('suggested-next-title');
    var body = document.getElementById('suggested-next-body');
    var reason = document.getElementById('suggested-next-reason');
    var openBtn = document.getElementById('suggested-next-open');
    if (title) title.textContent = 'Suggested Next';
    if (body) body.textContent = next.text || suggestedNextHeadline(next);
    if (reason) reason.textContent = suggestedNextReason(next);
    if (openBtn) {
      if (next.productionId) {
        openBtn.style.display = '';
        openBtn.onclick = function () {
          if (typeof global.closeM === 'function') global.closeM('suggested-next-modal');
          openProduction(next.productionId);
        };
      } else {
        openBtn.style.display = 'none';
      }
    }
    if (typeof global.openM === 'function') global.openM('suggested-next-modal');
  }

  function renderStudioRecents() {
    if (!Studio() || !Studio().getHomeInsights) return '';
    var insights = Studio().getHomeInsights();
    var recent = (insights && insights.recentProductions) || [];
    var projects = Studio()
      .listProjects()
      .slice()
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })
      .slice(0, 4);
    var h = '';
    if (insights && insights.continueWorking) {
      var cw = insights.continueWorking;
      var st =
        (Studio().STATUS_MAP[cw.production.status] || {}).label || cw.production.status || 'Planning';
      h += '<div class="studio-recents">';
      h +=
        '<button type="button" class="continue-card continue-card-compact studio-continue" onclick="PreShootStudioUI.openProduction(\'' +
        esc(cw.production.id) +
        '\')">' +
        '<div class="continue-body">' +
        '<div class="continue-kicker">Continue</div>' +
        '<div class="continue-title">' +
        esc(cw.production.name) +
        '</div>' +
        '<div class="continue-meta-line">' +
        esc(st) +
        ' · ' +
        cw.progress +
        '%</div></div>' +
        '<div class="continue-cta">Open <span aria-hidden="true">→</span></div></button>';
      h += '</div>';
    }
    if (recent.length) {
      h += '<div class="studio-recents">';
      h += '<div class="studio-section-label">Recent Productions</div>';
      h += '<div class="studio-recent-list">';
      recent.forEach(function (r) {
        h +=
          '<button type="button" class="studio-recent-row" onclick="PreShootStudioUI.openProduction(\'' +
          esc(r.productionId) +
          '\')"><span class="studio-recent-name">' +
          esc(r.name) +
          '</span><span class="home-smart-meta">' +
          esc((Studio().STATUS_MAP[r.status] || {}).label || r.status) +
          '</span></button>';
      });
      h += '</div></div>';
    }
    if (projects.length) {
      h += '<div class="studio-recents">';
      h += '<div class="studio-section-label">Recent Projects</div>';
      h += '<div class="studio-recent-list">';
      projects.forEach(function (p) {
        h +=
          '<button type="button" class="studio-recent-row" onclick="PreShootStudioUI.openProject(\'' +
          esc(p.id) +
          '\')"><span class="studio-recent-name">' +
          esc(p.name) +
          '</span><span class="home-smart-meta">' +
          (p.productionCount != null ? p.productionCount : (p.productions || []).length) +
          '</span></button>';
      });
      h += '</div></div>';
    }
    return h;
  }

  function proposeDirectorAction(action, payload, meta) {
    meta = meta || {};
    /* Prefer in-page staged action + green Go when Studio command bar is present */
    if (
      global.S &&
      global.S.tab === 'studio' &&
      document.getElementById('dir-cmd-go') &&
      document.getElementById('dir-cmd-panel')
    ) {
      stageDirectorAction(action, payload || {}, meta);
      return;
    }
    pendingDirectorAction = {
      action: action,
      payload: payload || {},
      object: meta.object || (payload && payload.__object) || null,
      tool: meta.tool || null,
      mutates: meta.mutates
    };
    var preview = null;
    if (global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed) {
      preview = global.PreShootDirectorOS.executeProposed(
        {
          action: action,
          payload: payload || {},
          object: pendingDirectorAction.object,
          mutates: pendingDirectorAction.mutates
        },
        { confirmed: false }
      );
    } else {
      preview = Studio().handleDirectorAction(action, payload || {}, { confirmed: false });
    }
    var msg =
      (preview && preview.message) ||
      (Studio().confirmMessage && Studio().confirmMessage(action, payload)) ||
      'Confirm this action?';
    var title = document.getElementById('dir-action-title');
    var body = document.getElementById('dir-action-body');
    if (title) title.textContent = actionLabel(action);
    if (body) {
      body.innerHTML = '';
      var card = document.createElement('div');
      card.className = 'dir-action-card-inline';
      card.innerHTML = actionCardHtml(action, payload || {}, msg).replace(
        'dir-action-card',
        'dir-action-card flat'
      );
      /* Use text for modal compatibility */
      body.textContent = msg;
    }
    var goBtn = document.getElementById('dir-action-go');
    if (goBtn) {
      goBtn.classList.add('ready');
      goBtn.disabled = false;
      goBtn.textContent = 'Go';
    }
    if (typeof global.openM === 'function') global.openM('dir-action-modal');
  }

  function confirmDirectorAction() {
    if (!pendingDirectorAction) return;
    var goBtn = document.getElementById('dir-action-go');
    if (goBtn) {
      goBtn.classList.add('executing');
      goBtn.disabled = true;
      goBtn.textContent = '…';
    }
    var action = pendingDirectorAction.action;
    var payload = pendingDirectorAction.payload || {};
    var object = pendingDirectorAction.object || null;
    var mutates = pendingDirectorAction.mutates;
    pendingDirectorAction = null;
    if (typeof global.closeM === 'function') global.closeM('dir-action-modal');
    var result = null;
    if (global.PreShootDirectorOS && global.PreShootDirectorOS.executeProposed) {
      result = global.PreShootDirectorOS.executeProposed(
        { action: action, payload: payload, object: object, mutates: mutates },
        { confirmed: true }
      );
    } else {
      result = Studio().handleDirectorAction(action, payload, { confirmed: true });
    }
    if (!result || !result.ok) {
      if (goBtn) {
        goBtn.classList.remove('executing');
        goBtn.disabled = false;
        goBtn.textContent = 'Go';
      }
      toast((result && (result.message || result.error)) || 'Action failed');
      return;
    }
    var verified = verifyDirectorMutation(action, payload);
    if (!verified.ok) {
      toast(verified.message || 'Action failed');
      return;
    }

    function finishModalSuccess() {
      toast(verified.label ? 'Updated to “' + verified.label + '”' : 'Done');
      var openId =
        (result.open &&
          ((result.result && result.result.productionId) || payload.productionId)) ||
        null;
      if (openId) {
        openProduction(openId);
        return;
      }
      renderContinueCard();
      renderStudio();
      setTimeout(function () {
        setDirectorStatus('done', 'Done ✓');
        setDirectorGoState('done');
        setTimeout(function () {
          setDirectorGoState('idle');
        }, 1400);
      }, 40);
    }

    function failModalPersist(msg) {
      toast(msg || 'Save failed — change was not confirmed');
      setDirectorStatus('error', msg || 'Save failed');
      setDirectorGoState('idle');
    }

    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared()
    ) {
      if (PreShootWorkspace.canEdit && !PreShootWorkspace.canEdit()) {
        failModalPersist('Read-only workspace — changes were not saved');
        return;
      }
      if (PreShootWorkspace.markSharedDirty) PreShootWorkspace.markSharedDirty();
      if (PreShootWorkspace.setPendingChangeHint) {
        var hint2 = null;
        if (action === 'update_script' && payload.productionId) {
          hint2 = {
            type: 'script.updated',
            productionId: payload.productionId,
            projectId: payload.projectId || null,
            entityId: payload.productionId
          };
        } else if (action === 'rebuild_shot_list' && payload.productionId) {
          hint2 = {
            type: 'shotlist.updated',
            productionId: payload.productionId,
            entityId: payload.productionId
          };
        } else if (payload.productionId) {
          hint2 = {
            type: 'production.updated',
            productionId: payload.productionId,
            entityId: payload.productionId
          };
        }
        PreShootWorkspace.setPendingChangeHint(hint2);
      }
      PreShootWorkspace.saveNow()
        .then(function (saveRes) {
          if (saveRes && saveRes.ok === true) {
            finishModalSuccess();
            return;
          }
          if (saveRes && saveRes.conflict) {
            failModalPersist(
              'Another collaborator changed this workspace. Resolve the conflict, then try again.'
            );
            return;
          }
          failModalPersist(
            (saveRes && saveRes.message) ||
              'Workspace save failed. Your Studio was not updated.'
          );
        })
        .catch(function () {
          failModalPersist('Workspace save failed. Your Studio was not updated.');
        });
      return;
    }

    var modalFlush =
      global.PreShootStudioSync && typeof PreShootStudioSync.flush === 'function'
        ? PreShootStudioSync.flush({ pushFirst: true })
        : Promise.resolve({ ok: true, local_only: true });
    Promise.resolve(modalFlush)
      .then(function (flushRes) {
        if (flushRes && flushRes.ok === false) {
          failModalPersist(
            (flushRes && flushRes.message) || 'Save failed. Studio may be out of sync.'
          );
          return;
        }
        finishModalSuccess();
      })
      .catch(function () {
        failModalPersist('Save failed. Studio may be out of sync.');
      });
  }

  function cancelDirectorAction() {
    pendingDirectorAction = null;
    if (typeof global.closeM === 'function') global.closeM('dir-action-modal');
  }

  function savePerformanceField(productionId, field, value) {
    if (!Studio().savePerformance) return;
    var patch = {};
    patch[field] = value;
    Studio().savePerformance(productionId, patch);
    if (global.PreShootAnalytics) {
      PreShootAnalytics.track('production_performance_updated', {
        field: String(field || '').slice(0, 40),
        has_value: !!String(value || '').trim()
      });
    }
    renderContinueCard();
  }

  function onPerformancePdf(productionId, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    Studio().savePerformance(productionId, { pdfName: file.name });
    toast('PDF noted · ' + file.name);
    if (global.S) {
      global.S.studioView = { mode: 'production', productionId: productionId, section: 'performance' };
    }
    renderStudio();
  }

  var searchTimer = null;
  function openSearch() {
    if (typeof global.openM === 'function') global.openM('global-search-modal');
    var inp = document.getElementById('global-search-input');
    if (inp) {
      inp.value = '';
      setTimeout(function () {
        inp.focus();
      }, 50);
    }
    var results = document.getElementById('global-search-results');
    if (results) results.innerHTML = '<div class="pw-section-sub">Type to search projects, productions, scans, ideas…</div>';
  }

  function onSearchInput(value) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      runSearch(value);
    }, 120);
  }

  function runSearch(value) {
    var results = document.getElementById('global-search-results');
    if (!results || !Studio().globalSearch) return;
    var data = Studio().globalSearch(value);
    var total = 0;
    Object.keys(data).forEach(function (k) {
      total += (data[k] || []).length;
    });
    if (!String(value || '').trim()) {
      results.innerHTML = '<div class="pw-section-sub">Type to search projects, productions, scans, ideas…</div>';
      return;
    }
    if (!total) {
      results.innerHTML = '<div class="pw-section-sub">No matches</div>';
      return;
    }
    var h = '';
    function block(title, items, onOpen) {
      if (!items || !items.length) return;
      h += '<div class="search-block"><div class="pw-card-kicker">' + esc(title) + '</div>';
      items.forEach(function (item) {
        h +=
          '<button type="button" class="home-smart-row" onclick="' +
          onOpen(item) +
          '"><span>' +
          esc(item.name) +
          '</span><span class="home-smart-meta">' +
          esc(item.projectName || item.kind || item.type || '') +
          '</span></button>';
      });
      h += '</div>';
    }
    block('Projects', data.projects, function (item) {
      return 'closeM(\'global-search-modal\');PreShootStudioUI.openProject(\'' + esc(item.id) + '\')';
    });
    block('Productions', data.productions, function (item) {
      return 'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' + esc(item.id) + '\')';
    });
    block('Scans', data.scans, function (item) {
      return 'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' + esc(item.productionId) + '\')';
    });
    block('Ideas', data.ideas, function (item) {
      return 'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' + esc(item.productionId) + '\')';
    });
    block('Scripts', data.scripts, function (item) {
      return (
        'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' +
        esc(item.productionId) +
        '\');PreShootStudioUI.setProdSection(\'' +
        esc(item.productionId) +
        "','script')"
      );
    });
    block('Assets', data.assets, function (item) {
      return (
        'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' +
        esc(item.productionId) +
        '\');PreShootStudioUI.setProdSection(\'' +
        esc(item.productionId) +
        "','assets')"
      );
    });
    block('References', data.references, function (item) {
      return (
        'closeM(\'global-search-modal\');PreShootStudioUI.openProduction(\'' +
        esc(item.productionId) +
        '\');PreShootStudioUI.setProdSection(\'' +
        esc(item.productionId) +
        "','refs')"
      );
    });
    results.innerHTML = h;
  }

  var pendingDirectorAction = null;

  function openCreateProject() {
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared() &&
      PreShootWorkspace.canEdit &&
      !PreShootWorkspace.canEdit()
    ) {
      toast('This workspace is read-only');
      return;
    }
    projectDraft = { step: 1, name: '', notes: '', coverImage: null };
    renderProjectWizard();
    openM('studio-project-modal');
  }

  function renderProjectWizard() {
    var body = document.getElementById('st-project-wizard');
    if (!body) return;
    var step = projectDraft.step;
    var h = '';
    h += '<div class="st-steps">';
    for (var i = 1; i <= 3; i++) {
      h += '<span class="st-step' + (i === step ? ' on' : i < step ? ' done' : '') + '"></span>';
    }
    h += '</div>';

    if (step === 1) {
      h += '<div class="st-step-title">Project name</div>';
      h += '<div class="st-step-sub">What are you creating?</div>';
      h +=
        '<input class="st-input" id="st-new-project-name" placeholder="e.g. Cafe Launch" value="' +
        esc(projectDraft.name) +
        '">';
      h +=
        '<button type="button" class="studio-btn primary block" onclick="PreShootStudioUI.projectWizardNext()">Continue</button>';
    } else if (step === 2) {
      h += '<div class="st-step-title">Description</div>';
      h += '<div class="st-step-sub">Optional — you can skip this.</div>';
      h +=
        '<textarea class="st-input st-notes" id="st-new-project-notes" placeholder="Optional description">' +
        esc(projectDraft.notes) +
        '</textarea>';
      h += '<div class="st-wizard-nav">';
      h +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.projectWizardBack()">Back</button>';
      h +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.projectWizardSkip()">Skip</button>';
      h +=
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.projectWizardNext()">Continue</button>';
      h += '</div>';
    } else {
      h += '<div class="st-step-title">Cover image</div>';
      h += '<div class="st-step-sub">Optional — add a cover later anytime.</div>';
      h +=
        '<label class="st-cover-pick">' +
        (projectDraft.coverImage
          ? '<img src="' + esc(projectDraft.coverImage) + '" alt="">'
          : '<span>Choose image</span>') +
        '<input type="file" accept="image/*" onchange="PreShootStudioUI.onProjectCover(this)" hidden>' +
        '</label>';
      if (projectDraft.coverImage) {
        h +=
          '<button type="button" class="studio-btn ghost block" onclick="PreShootStudioUI.clearProjectCover()">Remove cover</button>';
      }
      h += '<div class="st-wizard-nav">';
      h +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.projectWizardBack()">Back</button>';
      h +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.confirmCreateProject()">Skip</button>';
      h +=
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.confirmCreateProject()">Create Project</button>';
      h += '</div>';
    }
    body.innerHTML = h;
    var nameEl = document.getElementById('st-new-project-name');
    if (nameEl) setTimeout(function () { nameEl.focus(); }, 50);
  }

  function projectWizardBack() {
    if (projectDraft.step <= 1) return;
    captureWizardFields();
    projectDraft.step -= 1;
    renderProjectWizard();
  }

  function projectWizardSkip() {
    captureWizardFields();
    projectDraft.step = Math.min(3, projectDraft.step + 1);
    renderProjectWizard();
  }

  function projectWizardNext() {
    captureWizardFields();
    if (projectDraft.step === 1) {
      var name = String(projectDraft.name || '').trim();
      if (!name) {
        toast('Enter a project name');
        return;
      }
    }
    if (projectDraft.step >= 3) {
      confirmCreateProject();
      return;
    }
    projectDraft.step += 1;
    renderProjectWizard();
  }

  function captureWizardFields() {
    var nameEl = document.getElementById('st-new-project-name');
    var notesEl = document.getElementById('st-new-project-notes');
    if (nameEl) projectDraft.name = nameEl.value;
    if (notesEl) projectDraft.notes = notesEl.value;
  }

  function onProjectCover(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 640;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var r = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * r);
        cv.height = Math.round(h * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        projectDraft.coverImage = cv.toDataURL('image/jpeg', 0.72);
        renderProjectWizard();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearProjectCover() {
    projectDraft.coverImage = null;
    renderProjectWizard();
  }

  function confirmCreateProject() {
    captureWizardFields();
    var name = String(projectDraft.name || '').trim() || 'Untitled Project';
    var p = Studio().createProject({
      name: name,
      notes: projectDraft.notes || '',
      coverImage: projectDraft.coverImage || null
    });
    closeM('studio-project-modal');
    projectDraft = { step: 1, name: '', notes: '', coverImage: null };
    if (global.PreShootAnalytics) {
      PreShootAnalytics.track('project_created', { id: String(p.id || '').slice(0, 40) });
    }
    toast('Project created');
    noteStreak('project');
    openProject(p.id);
  }

  function openCreateProduction(projectId) {
    var sel = document.getElementById('st-blank-project');
    var nameEl = document.getElementById('st-blank-name');
    var notesEl = document.getElementById('st-blank-notes');
    var wrap = document.getElementById('st-blank-project-wrap');
    if (nameEl) nameEl.value = '';
    if (notesEl) notesEl.value = '';
    if (sel) {
      var projects = Studio().listProjects();
      sel.innerHTML = projects
        .map(function (p) {
          return (
            '<option value="' +
            esc(p.id) +
            '"' +
            (p.id === projectId ? ' selected' : '') +
            '>' +
            esc(p.name) +
            '</option>'
          );
        })
        .join('');
      if (!projects.length) {
        toast('Create a project first');
        openCreateProject();
        return;
      }
      if (wrap) wrap.style.display = projectId ? 'none' : '';
    }
    var ttl = document.getElementById('st-blank-modal-ttl');
    if (ttl) ttl.textContent = 'New Production';
    openM('studio-blank-modal');
    if (nameEl) setTimeout(function () { nameEl.focus(); }, 80);
  }

  function openCreateBlankProduction() {
    openCreateProduction(null);
  }

  function confirmBlankProduction() {
    var sel = document.getElementById('st-blank-project');
    var nameEl = document.getElementById('st-blank-name');
    var notesEl = document.getElementById('st-blank-notes');
    var projectId = sel ? sel.value : '';
    if (!projectId) {
      toast('Choose a project');
      return;
    }
    var name = nameEl ? String(nameEl.value || '').trim() : '';
    if (!name) {
      toast('Enter a production name');
      return;
    }
    var result = Studio().createProduction(projectId, {
      name: name,
      notes: notesEl ? notesEl.value : '',
      source: 'blank'
    });
    closeM('studio-blank-modal');
    if (!result) {
      toast('Could not create production');
      return;
    }
    if (global.PreShootAnalytics) {
      PreShootAnalytics.track('production_created', {
        id: String(result.production.id || '').slice(0, 40),
        source: 'blank'
      });
      PreShootAnalytics.noteProductionCreated();
    }
    if (global.PreShootEntitlements && PreShootEntitlements.recordActivity) {
      PreShootEntitlements.recordActivity('studio');
    }
    if (global.PreShootCalendar && PreShootCalendar.indexProduction) {
      PreShootCalendar.indexProduction(result.production, result.project);
    }
    toast('Production created');
    openProduction(result.production.id);
  }

  function studioCanMutate() {
    if (
      global.PreShootWorkspace &&
      PreShootWorkspace.isShared &&
      PreShootWorkspace.isShared() &&
      PreShootWorkspace.canEdit &&
      !PreShootWorkspace.canEdit()
    ) {
      return false;
    }
    return true;
  }

  /* ── Send to Studio ── */
  var pendingSend = null;

  function fillSendProductions(projectId, selectedProductionId) {
    var prodSel = document.getElementById('st-send-production');
    var nameWrap = document.getElementById('st-send-new-prod-wrap');
    if (!prodSel) return;
    var project = projectId && Studio() ? Studio().findProject(projectId) : null;
    var productions = (project && project.productions) || [];
    prodSel.innerHTML =
      '<option value="">Create new production…</option>' +
      productions
        .map(function (prod) {
          return (
            '<option value="' +
            esc(prod.id) +
            '"' +
            (prod.id === selectedProductionId ? ' selected' : '') +
            '>' +
            esc(prod.name || 'Untitled') +
            '</option>'
          );
        })
        .join('');
    if (nameWrap) nameWrap.style.display = prodSel.value ? 'none' : '';
  }

  function onSendProjectChange() {
    var projSel = document.getElementById('st-send-project');
    fillSendProductions(projSel ? projSel.value : '', '');
  }

  function onSendProductionChange() {
    var prodSel = document.getElementById('st-send-production');
    var nameWrap = document.getElementById('st-send-new-prod-wrap');
    if (nameWrap) nameWrap.style.display = prodSel && prodSel.value ? 'none' : '';
  }

  function openSendToStudio(idx, src) {
    var ideas = [];
    if (src === 'results') ideas = (global.S && global.S.ideas) || [];
    else if (src === 'lib') ideas = typeof global.getLib === 'function' ? global.getLib() : [];
    else if (typeof src === 'string' && src.indexOf('hist_') === 0) {
      var hi = parseInt(src.slice(5), 10);
      var hist = typeof global.getHistory === 'function' ? global.getHistory() : [];
      ideas = (hist[hi] && hist[hi].ideas) || [];
    }
    var idea = ideas[idx];
    if (!idea && global.S && global.S.activeIdea != null && global.S.ideas) {
      idea = global.S.ideas[global.S.activeIdea];
    }
    if (!idea) {
      toast('Idea not found');
      return;
    }
    if (!studioCanMutate()) {
      toast('This workspace is read-only');
      return;
    }
    var sceneInfo = global.S.sceneInfo || {};
    var rec = Studio().recommendProject(idea, sceneInfo);
    pendingSend = {
      idx: idx,
      src: src,
      idea: idea,
      sceneInfo: sceneInfo,
      coverImage: global.S.scanImg || idea.image || null,
      recommendation: rec
    };

    var reason = document.getElementById('st-send-reason');
    var suggestedBtn = document.getElementById('st-send-suggested');
    var projectSel = document.getElementById('st-send-project');
    var newName = document.getElementById('st-send-new-name');
    var prodName = document.getElementById('st-send-prod-name');

    if (reason) {
      reason.textContent = rec.reason || 'Choose the exact project and production this idea belongs to.';
    }
    var projects = Studio().listProjects();
    var preferredId = rec.suggested ? rec.suggested.id : '';
    if (projectSel) {
      projectSel.innerHTML =
        '<option value="">Choose a project…</option>' +
        projects
          .map(function (p) {
            return (
              '<option value="' +
              esc(p.id) +
              '"' +
              (p.id === preferredId ? ' selected' : '') +
              '>' +
              esc(p.name) +
              '</option>'
            );
          })
          .join('');
    }
    if (suggestedBtn) {
      if (rec.suggested) {
        suggestedBtn.style.display = '';
        suggestedBtn.textContent = 'Use “' + rec.suggested.name + '”';
        suggestedBtn.onclick = function () {
          if (projectSel) projectSel.value = rec.suggested.id;
          fillSendProductions(rec.suggested.id, '');
        };
      } else {
        suggestedBtn.style.display = 'none';
      }
    }
    fillSendProductions(preferredId, '');
    if (newName) newName.value = rec.suggestedName || Studio().suggestProjectName(idea, sceneInfo);
    if (prodName) prodName.value = idea.title || '';
    openM('studio-send-modal');
  }

  function confirmSend(mode) {
    if (!pendingSend) return;
    if (!studioCanMutate()) {
      toast('This workspace is read-only');
      return;
    }
    var projectSel = document.getElementById('st-send-project');
    var prodSel = document.getElementById('st-send-production');
    var newName = document.getElementById('st-send-new-name');
    var prodName = document.getElementById('st-send-prod-name');
    var opts = {
      idea: pendingSend.idea,
      sceneInfo: pendingSend.sceneInfo,
      meta: { source: 'idea', coverImage: pendingSend.coverImage }
    };

    if (mode === 'new') {
      opts.newProjectName = newName ? newName.value : pendingSend.recommendation.suggestedName;
      opts.newProductionName = prodName && prodName.value ? prodName.value : pendingSend.idea.title;
    } else {
      var projectId = projectSel ? projectSel.value : '';
      if (mode === 'suggested' && pendingSend.recommendation && pendingSend.recommendation.suggested) {
        projectId = pendingSend.recommendation.suggested.id;
      }
      if (!projectId) {
        toast('Choose a project');
        return;
      }
      opts.projectId = projectId;
      var productionId = prodSel ? prodSel.value : '';
      if (productionId) {
        opts.productionId = productionId;
      } else {
        opts.newProductionName = prodName && prodName.value ? prodName.value : pendingSend.idea.title;
      }
    }

    if (!Studio().importIdeaIntoStudio) {
      toast('Studio import unavailable');
      return;
    }
    var result = Studio().importIdeaIntoStudio(opts);
    closeM('studio-send-modal');
    pendingSend = null;
    if (typeof global.shCloseForce === 'function') global.shCloseForce();
    if (!result || !result.ok || !result.production) {
      var err = (result && result.error) || '';
      if (err === 'production_not_in_project') toast('That production is not in the selected project');
      else if (err === 'production_not_found') toast('Production not found');
      else if (err === 'project_not_found') toast('Project not found');
      else toast('Could not import to Studio');
      return;
    }
    if (global.PreShootAnalytics) {
      if (result.createdProject) PreShootAnalytics.track('project_created', { source: 'send' });
      if (result.createdProduction) {
        PreShootAnalytics.track('production_created', {
          id: String(result.production.id || '').slice(0, 40),
          source: 'idea'
        });
        PreShootAnalytics.noteProductionCreated();
      }
    }
    if (global.PreShootEntitlements && PreShootEntitlements.recordActivity) {
      PreShootEntitlements.recordActivity('studio');
    }
    if (global.PreShootCalendar && PreShootCalendar.indexProduction && result.createdProduction) {
      PreShootCalendar.indexProduction(result.production, result.project);
    }
    toast(result.createdProduction ? 'Imported to a new production' : 'Imported into “' + (result.production.name || 'production') + '”');
    openProduction(result.production.id);
  }

  function renameProjectPrompt(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    var p = Studio().findProject(projectId);
    if (!p) {
      toast('Project not found');
      return;
    }
    var name = prompt('Rename project', p.name);
    if (name == null) return;
    var updated = Studio().renameProject(projectId, name);
    if (!updated) {
      toast('Couldn’t rename project');
      return;
    }
    toast('Project renamed');
    openProject(projectId);
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    }
  }

  function duplicateProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    var copy = Studio().duplicateProject(projectId);
    if (!copy) {
      toast('Couldn’t duplicate project');
      return;
    }
    toast('Project duplicated');
    openProject(copy.id);
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    }
  }

  function archiveProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    if (!confirm('Archive this project? You can restore it anytime from Studio.')) return;
    var updated = Studio().archiveProject(projectId, true);
    if (!updated) {
      toast('Couldn’t archive project');
      return;
    }
    toast('Project archived');
    backToList();
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    }
  }

  function restoreProject(projectId) {
    var updated = Studio().restoreProject(projectId);
    if (!updated) {
      toast('Couldn’t restore project');
      return;
    }
    toast('Project restored');
    backToList();
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    }
  }

  function deleteProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    if (!projectId) {
      toast('Couldn’t delete project');
      return;
    }
    if (!confirm('Permanently delete this project and its productions? This cannot be undone.')) {
      return;
    }
    if (!Studio() || typeof Studio().deleteProject !== 'function') {
      toast('Studio isn’t ready. Try again.');
      return;
    }
    var ok = false;
    try {
      ok = !!Studio().deleteProject(projectId);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      toast('Couldn’t delete project. Try again.');
      return;
    }
    toast('Project deleted');
    if (global.S && global.S.studioView) {
      if (global.S.studioView.projectId === projectId) {
        global.S.studioView = { mode: 'list' };
      }
    }
    backToList();
    /* Force immediate sync so other devices don’t resurrect the project */
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    } else if (typeof global.scheduleCloudSync === 'function') {
      global.scheduleCloudSync();
    }
  }

  function setStatus(productionId, status) {
    Studio().setProductionStatus(productionId, status);
    renderStudio();
    renderContinueCard();
  }

  function saveProductionField(productionId, field, value) {
    var patch = {};
    patch[field] = value;
    Studio().updateProduction(productionId, patch);
    renderContinueCard();
    noteStreak('save');
  }

  function moveProductionPrompt(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (menu) menu.hidden = true;
    var projects = Studio().listProjects();
    if (projects.length < 2) {
      toast('Create another project to move into');
      return;
    }
    var names = projects
      .map(function (p, i) {
        return i + 1 + '. ' + p.name;
      })
      .join('\n');
    var pick = prompt('Move to which project?\n' + names + '\n\nEnter number:');
    var idx = parseInt(pick, 10) - 1;
    if (!projects[idx]) return;
    Studio().moveProduction(productionId, projects[idx].id);
    toast('Production moved');
    openProduction(productionId);
  }

  function duplicateProduction(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (menu) menu.hidden = true;
    var result = Studio().duplicateProduction(productionId);
    if (!result) return;
    toast('Production duplicated');
    openProduction(result.production.id);
  }

  function deleteProduction(productionId) {
    var menu = document.getElementById('st-production-menu');
    if (menu) menu.hidden = true;
    if (!confirm('Delete this production? This cannot be undone.')) return;
    if (!Studio() || typeof Studio().deleteProduction !== 'function') {
      toast('Studio isn’t ready. Try again.');
      return;
    }
    var found = Studio().findProduction(productionId);
    var projectId = found && found.project ? found.project.id : null;
    var ok = false;
    try {
      ok = !!Studio().deleteProduction(productionId);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      toast('Couldn’t delete production. Try again.');
      return;
    }
    toast('Production deleted');
    renderContinueCard();
    if (projectId) openProject(projectId);
    else backToList();
    if (global.PreShootStudioSync && typeof global.PreShootStudioSync.pushNow === 'function') {
      global.PreShootStudioSync.pushNow().catch(function () {});
    } else if (typeof global.scheduleCloudSync === 'function') {
      global.scheduleCloudSync();
    }
  }

  global.PreShootStudioUI = {
    renderStudio: renderStudio,
    renderContinueCard: renderContinueCard,
    openProject: openProject,
    openProduction: openProduction,
    backToList: backToList,
    openCreateProject: openCreateProject,
    confirmCreateProject: confirmCreateProject,
    projectWizardNext: projectWizardNext,
    projectWizardBack: projectWizardBack,
    projectWizardSkip: projectWizardSkip,
    onProjectCover: onProjectCover,
    clearProjectCover: clearProjectCover,
    openCreateProduction: openCreateProduction,
    openCreateBlankProduction: openCreateBlankProduction,
    confirmBlankProduction: confirmBlankProduction,
    openSendToStudio: openSendToStudio,
    confirmSend: confirmSend,
    onSendProjectChange: onSendProjectChange,
    onSendProductionChange: onSendProductionChange,
    renameProjectPrompt: renameProjectPrompt,
    duplicateProject: duplicateProject,
    archiveProject: archiveProject,
    restoreProject: restoreProject,
    deleteProject: deleteProject,
    setStatus: setStatus,
    saveProductionField: saveProductionField,
    moveProductionPrompt: moveProductionPrompt,
    duplicateProduction: duplicateProduction,
    deleteProduction: deleteProduction,
    toggleProjectMenu: toggleProjectMenu,
    toggleProductionMenu: toggleProductionMenu,
    renameProductionPrompt: renameProductionPrompt,
    archiveProductionPrompt: archiveProductionPrompt,
    directorPlaceholder: directorPlaceholder,
    openDirectorForProduction: openDirectorForProduction,
    submitDirectorCommand: submitDirectorCommand,
    onDirectorInputChange: onDirectorInputChange,
    toggleDirectorVoice: toggleDirectorVoice,
    chooseDirectorClarify: chooseDirectorClarify,
    chooseDirectorClarifyIndex: chooseDirectorClarifyIndex,
    setProdSection: setProdSection,
    saveWorkspaceField: saveWorkspaceField,
    saveScript: saveScript,
    openScriptFullscreen: openScriptFullscreen,
    closeScriptFullscreen: closeScriptFullscreen,
    retryLastScriptAi: retryLastScriptAi,
    toggleShot: toggleShot,
    updateShotField: updateShotField,
    addShot: addShot,
    deleteShot: deleteShot,
    addScriptLine: addScriptLine,
    updateScriptLine: updateScriptLine,
    linkScriptLine: linkScriptLine,
    deleteScriptLine: deleteScriptLine,
    convertScriptBody: convertScriptBody,
    generateScript: generateScript,
    generateShotList: generateShotList,
    copyScript: copyScript,
    copyShotList: copyShotList,
    exportScriptPdf: exportScriptPdf,
    exportShotListPdf: exportShotListPdf,
    exportPackagePdf: exportPackagePdf,
    findProductionReferences: findProductionReferences,
    saveResearchItem: saveResearchItem,
    removeProductionReference: removeProductionReference,
    copyRefLink: copyRefLink,
    uploadProductionAsset: uploadProductionAsset,
    removeProductionAsset: removeProductionAsset,
    filterAssetFolder: filterAssetFolder,
    seedFromIdea: seedFromIdea,
    proposeDirectorAction: proposeDirectorAction,
    confirmDirectorAction: confirmDirectorAction,
    cancelDirectorAction: cancelDirectorAction,
    savePerformanceField: savePerformanceField,
    onPerformancePdf: onPerformancePdf,
    openSearch: openSearch,
    onSearchInput: onSearchInput,
    runSearch: runSearch,
    openSuggestedNext: openSuggestedNext,
    openSuggestedFromStudio: openSuggestedFromStudio,
    handleOverviewSuggestion: handleOverviewSuggestion
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
