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
    h += '<div class="studio-sub">Your creative workspace</div>';
    h += '</div>';
    h += '<div class="studio-hd-actions">';
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.openSearch()">Search</button>';
    h +=
      '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">New Project</button>';
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
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">Create Project</button>' +
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
    renderStudio();
  }

  function openProduction(productionId) {
    if (!global.S) return;
    Studio().setContinueWorking(productionId);
    global.S.studioView = { mode: 'production', productionId: productionId, section: 'overview' };
    if (typeof global.goTab === 'function') global.goTab('studio');
    else renderStudio();
  }

  function backToList() {
    if (!global.S) return;
    global.S.studioView = { mode: 'list' };
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

    h += '<div class="pw-card">';
    h += '<div class="pw-card-kicker">Production Tools</div>';
    h += '<div class="pw-tools">';
    [
      ['shots', 'Shot List', 'What to film'],
      ['script', 'Script', 'What to say'],
      ['refs', 'References', 'Inspiration'],
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
    return h;
  }

  function renderShotsSection(prod, productionId, ws) {
    var level = skillLevel();
    var shots = (ws.shotList || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    var expanded = ensureExpandedMap(productionId);
    var fields = shotFieldsForLevel(level);
    var h = '';
    h += '<div class="pw-section-hd">';
    h += '<div><div class="pw-card-kicker">Shot List</div>';
    h +=
      '<div class="pw-section-sub">Adapted for <strong>' +
      esc(level) +
      '</strong> · tap a shot to expand</div></div>';
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.addShot(\'' +
      esc(productionId) +
      '\')">Add shot</button></div>';

    if (!shots.length) {
      h += '<div class="pw-card pw-empty-card">';
      h += '<div class="studio-empty-t">No shots yet</div>';
      h += '<div class="studio-empty-s">Build a filmable shot list from the linked idea, or add shots manually.</div>';
      if (prod.ideaSnapshot && (prod.ideaSnapshot.title || prod.ideaSnapshot.hook)) {
        h +=
          '<button type="button" class="studio-btn" style="margin-top:12px" onclick="PreShootStudioUI.seedFromIdea(\'' +
          esc(productionId) +
          '\')">Build from idea</button>';
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
      h += '<div class="pw-shot-dur">' + esc(dur) + '</div>';
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
    var h = '';
    h += '<div class="pw-section-hd">';
    h += '<div><div class="pw-card-kicker">Script</div>';
    h += '<div class="pw-section-sub">Each line maps to a shot</div></div>';
    h +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootStudioUI.addScriptLine(\'' +
      esc(productionId) +
      '\')">Add line</button></div>';

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
        h += '<div class="studio-empty-t">No script lines</div>';
        h += '<div class="studio-empty-s">Add dialogue or VO lines and link each to a shot.</div>';
        if (prod.ideaSnapshot && prod.ideaSnapshot.hook) {
          h +=
            '<button type="button" class="studio-btn" style="margin-top:12px" onclick="PreShootStudioUI.seedFromIdea(\'' +
            esc(productionId) +
            '\')">Build from idea</button>';
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

  function renderRefsSection(prod, productionId, ws) {
    var refs = ws.references || {};
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">References</div>';
    h += '<div class="pw-section-sub">Inspiration stays inside PreShoot — no random browser jumps</div></div></div>';

    function block(title, items, empty) {
      var out = '<div class="pw-card"><div class="pw-card-kicker">' + esc(title) + '</div>';
      if (!items || !items.length) {
        out += '<div class="pw-section-sub">' + esc(empty) + '</div></div>';
        return out;
      }
      items.forEach(function (item) {
        out += '<div class="pw-ref-row">';
        out += '<div class="pw-ref-title">' + esc(item.title || item.query || 'Reference') + '</div>';
        if (item.note) out += '<div class="pw-ref-note">' + esc(item.note) + '</div>';
        if (item.query) out += '<div class="pw-ref-query">Search · ' + esc(item.query) + '</div>';
        out += '</div>';
      });
      out += '</div>';
      return out;
    }

    h += block('YouTube inspiration', refs.youtube, 'No YouTube references yet. Send an idea with a search cue to seed this.');
    h += block('CapCut templates', refs.capcut, 'No CapCut template ideas yet.');
    h += block('Uploaded references', refs.uploads, 'Upload support arrives in a later polish pass. Architecture is ready.');
    h += block('Pinterest', refs.pinterest, 'Pinterest support is prepared for a future update.');

    if (
      (!refs.youtube || !refs.youtube.length) &&
      (!refs.capcut || !refs.capcut.length) &&
      prod.ideaSnapshot &&
      (prod.ideaSnapshot.ytSearch || prod.ideaSnapshot.capcutSearch)
    ) {
      h +=
        '<button type="button" class="studio-btn" onclick="PreShootStudioUI.seedFromIdea(\'' +
        esc(productionId) +
        '\')">Pull references from idea</button>';
    }
    return h;
  }

  function renderAssetsSection(prod, productionId, ws) {
    var assets = ws.assets || [];
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">Assets</div>';
    h += '<div class="pw-section-sub">Scans, images, and files for this production</div></div></div>';

    if (!assets.length && prod.coverImage) {
      /* Soft-migrate cover into display without forcing save */
      assets = [
        {
          id: 'cover',
          type: 'image',
          kind: 'scan',
          name: 'Original scan',
          src: prod.coverImage
        }
      ];
    }

    if (!assets.length) {
      h += '<div class="pw-card pw-empty-card">';
      h += '<div class="studio-empty-t">No assets yet</div>';
      h += '<div class="studio-empty-s">Scan images and uploads will appear here. Advanced asset tools come later.</div></div>';
      return h;
    }

    h += '<div class="pw-asset-grid">';
    assets.forEach(function (a) {
      h += '<div class="pw-asset-card">';
      if (a.type === 'image' && a.src) {
        h += '<img class="pw-asset-thumb" src="' + esc(a.src) + '" alt="">';
      } else {
        h += '<div class="pw-asset-thumb ph">' + esc((a.type || 'file').toUpperCase()) + '</div>';
      }
      h += '<div class="pw-asset-name">' + esc(a.name || 'Asset') + '</div>';
      h += '<div class="pw-asset-kind">' + esc(a.kind || a.type || '') + '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }


  function renderPerformanceSection(prod, productionId, ws) {
    var perf = (ws && ws.performance) || {};
    var h = '';
    h += '<div class="pw-section-hd"><div><div class="pw-card-kicker">Performance Review</div>';
    h += '<div class="pw-section-sub">Manual metrics or a PDF note — no social APIs yet</div></div></div>';
    h += '<div class="pw-card">';
    h += '<div class="pw-perf-grid">';
    [
      ['views', 'Views'],
      ['likes', 'Likes'],
      ['comments', 'Comments'],
      ['watchTime', 'Watch time'],
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
    var panel = document.getElementById('dir-cmd-panel');
    if (!panel) return;
    if (!html) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;
    panel.innerHTML = html;
    if (opts.scroll !== false) {
      try {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) {}
    }
  }

  var _dirGoState = 'idle';
  function setDirectorGoState(state) {
    _dirGoState = state || 'idle';
    var btn = document.getElementById('dir-cmd-go');
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
      var inp = document.getElementById('dir-cmd-input');
      var hasText = !!(inp && String(inp.value || '').trim());
      btn.textContent = 'Go';
      btn.disabled = !hasText;
    }
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

  function actionCardHtml(action, payload, message) {
    payload = payload || {};
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
        '<div class="dir-action-row"><span>Current</span><strong>' +
        esc(current || '—') +
        '</strong></div>';
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
    } else if (message) {
      rows += '<div class="dir-action-msg">' + esc(message) + '</div>';
    }
    return (
      '<div class="dir-action-card">' +
      '<div class="dir-action-title">' +
      esc(title) +
      '</div>' +
      rows +
      '<div class="dir-action-hint">Press Go to apply</div>' +
      '</div>'
    );
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
    setDirectorPanel(actionCardHtml(action, payload, msg));
    setDirectorGoState('ready');
    return true;
  }

  function executeStagedDirectorAction() {
    if (!pendingDirectorAction) return;
    if (_dirGoState === 'executing') return;
    setDirectorGoState('executing');
    var action = pendingDirectorAction.action;
    var payload = pendingDirectorAction.payload || {};
    var object = pendingDirectorAction.object || null;
    var mutates = pendingDirectorAction.mutates;
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
      setDirectorPanel(
        '<div class="dir-cmd-reply">' +
          esc((result && (result.message || result.error)) || 'Action failed') +
          '</div>'
      );
      toast((result && (result.message || result.error)) || 'Action failed');
      return;
    }
    setDirectorGoState('done');
    setDirectorPanel('<div class="dir-cmd-reply dir-cmd-done">Done.</div>');
    toast('Done');
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
        setDirectorPanel('<div class="dir-cmd-reply dir-cmd-done">Done.</div>');
        setDirectorGoState('done');
        setTimeout(function () {
          setDirectorGoState('idle');
        }, 1200);
      }, 40);
    }, 280);
  }

  function submitDirectorCommand() {
    /* Ready Go = execute staged action */
    if (_dirGoState === 'ready' && pendingDirectorAction) {
      executeStagedDirectorAction();
      return;
    }
    if (_dirGoState === 'executing' || _dirGoState === 'done') return;

    var inp = document.getElementById('dir-cmd-input');
    var text = inp ? String(inp.value || '').trim() : '';
    if (!text) return;
    if (!Studio()) return;
    if (global.S && global.S.plan !== 'pro') {
      if (typeof global.openM === 'function') global.openM('pw-modal');
      return;
    }
    if (!global.PreShootDirectorOS || !global.PreShootDirectorOS.processStudioCommand) {
      toast('Director is unavailable');
      return;
    }
    if (inp) inp.value = '';
    pendingDirectorAction = null;
    setDirectorGoState('executing');
    setDirectorPanel('<div class="dir-cmd-status">Working…</div>');
    var result = global.PreShootDirectorOS.processStudioCommand(text);
    handleDirectorCommandResult(result);
  }

  function handleDirectorCommandResult(result) {
    if (!result) {
      setDirectorPanel('');
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
        '<div class="dir-cmd-reply">' +
        esc(result.question || 'Which one?') +
        '</div><div class="dir-cmd-choices">';
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
          openProduction(prop.payload.productionId);
          return;
        }
        handleDirectorCommandResult({
          kind: 'done',
          message: (opened && opened.ok && 'Done.') || (opened && opened.error) || 'Done.',
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
      setDirectorPanel('');
      setDirectorGoState('idle');
      if (result.target.type === 'project') openProject(result.target.id);
      else if (result.target.type === 'production') openProduction(result.target.id);
      return;
    }
    if (result.kind === 'done') {
      setDirectorGoState('done');
      setDirectorPanel(
        '<div class="dir-cmd-reply dir-cmd-done">' + esc(result.message || 'Done.') + '</div>'
      );
      if (result.section && global.S && global.S.studioView && global.S.studioView.productionId) {
        global.S.studioView.section = result.section;
      }
      if (result.open && result.result && result.result.result && result.result.result.productionId) {
        openProduction(result.result.result.productionId);
        return;
      }
      if (result.refresh !== false) {
        renderContinueCard();
        renderStudio();
        /* restore brief done flash after re-render */
        setTimeout(function () {
          setDirectorPanel(
            '<div class="dir-cmd-reply dir-cmd-done">' + esc(result.message || 'Done.') + '</div>'
          );
          setDirectorGoState('done');
          setTimeout(function () {
            setDirectorGoState('idle');
          }, 1200);
        }, 30);
      } else {
        setTimeout(function () {
          setDirectorGoState('idle');
        }, 1200);
      }
      return;
    }
    if (result.kind === 'explain') {
      setDirectorGoState('idle');
      requestDirectorExplain(result);
      return;
    }
    if (result.kind === 'reply') {
      setDirectorPanel('<div class="dir-cmd-reply">' + esc(result.text || '') + '</div>');
      setDirectorGoState('idle');
      return;
    }
    if (result.kind === 'error') {
      setDirectorPanel('<div class="dir-cmd-reply">' + esc(result.message || 'Something went wrong.') + '</div>');
      setDirectorGoState('idle');
      return;
    }
    setDirectorPanel('');
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
    setDirectorPanel('<div class="dir-cmd-reply">' + esc(fallback) + '</div><div class="dir-cmd-status">Refining…</div>');
    var ctxLines = '';
    try {
      if (global.PreShootDirectorOS && global.PreShootDirectorOS.buildOSContext) {
        ctxLines = global.PreShootDirectorOS.buildOSContext();
      }
    } catch (e) {}
    var msg = String((result && result.message) || '').slice(0, 500);
    if (typeof global.apiFetch !== 'function') {
      setDirectorPanel('<div class="dir-cmd-reply">' + esc(fallback) + '</div>');
      return;
    }
    global
      .apiFetch('/api/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream: false,
          context: ctxLines + '\n\nMODE: Studio embedded answer. Max 3 short sentences. No ACTION block unless essential.',
          messages: [
            {
              role: 'user',
              content:
                'Answer briefly inside Studio (no chat UI). Question: ' +
                msg +
                '\nIf useful, end with one concrete next action the user can type.'
            }
          ]
        })
      })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var block = (data.content || []).find(function (b) {
          return b.type === 'text';
        });
        var text = (block && block.text) || fallback;
        if (global.PreShootDirectorOS && global.PreShootDirectorOS.stripActionMarker) {
          text = global.PreShootDirectorOS.stripActionMarker(text);
        }
        var act =
          global.PreShootDirectorOS && global.PreShootDirectorOS.parseActionFromReply
            ? global.PreShootDirectorOS.parseActionFromReply((block && block.text) || '')
            : null;
        setDirectorPanel('<div class="dir-cmd-reply">' + esc(text) + '</div>');
        if (act) {
          setTimeout(function () {
            proposeDirectorAction(act.action, act.payload || {});
          }, 200);
        }
      })
      .catch(function () {
        setDirectorPanel('<div class="dir-cmd-reply">' + esc(fallback) + '</div>');
      });
  }

  var _dirVoiceRec = null;
  function toggleDirectorVoice() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    var btn = document.getElementById('dir-cmd-mic');
    if (!SR) {
      toast('Voice input isn’t supported in this browser yet');
      return;
    }
    if (_dirVoiceRec) {
      try {
        _dirVoiceRec.stop();
      } catch (e) {}
      _dirVoiceRec = null;
      if (btn) btn.classList.remove('listening');
      return;
    }
    var rec = new SR();
    _dirVoiceRec = rec;
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    if (btn) btn.classList.add('listening');
    rec.onresult = function (ev) {
      var said = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
      var inp = document.getElementById('dir-cmd-input');
      if (inp && said) {
        inp.value = said;
        submitDirectorCommand();
      }
    };
    rec.onerror = function () {
      if (btn) btn.classList.remove('listening');
      _dirVoiceRec = null;
      toast('Couldn’t hear that — try again');
    };
    rec.onend = function () {
      if (btn) btn.classList.remove('listening');
      _dirVoiceRec = null;
    };
    try {
      rec.start();
    } catch (e) {
      if (btn) btn.classList.remove('listening');
      _dirVoiceRec = null;
      toast('Microphone unavailable');
    }
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
    h +=
      '<button type="button" class="studio-icon-btn" onclick="PreShootStudioUI.toggleProductionMenu(\'' +
      esc(productionId) +
      '\')" aria-label="Production options">⋯</button>';
    h += '</div>';

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
      { id: 'refs', label: 'References' },
      { id: 'assets', label: 'Assets' },
      { id: 'performance', label: 'Performance' }
    ];
    h += '<div class="st-tabs">';
    tabs.forEach(function (t) {
      h +=
        '<button type="button" class="st-tab' +
        (section === t.id ? ' on' : '') +
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
    else if (section === 'refs') h += renderRefsSection(prod, productionId, ws);
    else if (section === 'assets') h += renderAssetsSection(prod, productionId, ws);
    else if (section === 'performance') h += renderPerformanceSection(prod, productionId, ws);
    h += '</div>';

    h += renderDirectorCard(productionId);

    h += '</div>';
    root.innerHTML = h;
    setTimeout(function () {
      setDirectorGoState('idle');
    }, 0);
  }

  function setProdSection(productionId, section) {
    if (!global.S) return;
    global.S.studioView = {
      mode: 'production',
      productionId: productionId,
      section: section || 'overview'
    };
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
    prod.workspace.script = prod.workspace.script || { body: '' };
    prod.workspace.script.body = value;
    Studio().updateProduction(productionId, { workspace: prod.workspace });
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

  function seedFromIdea(productionId) {
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
      toast((result && (result.message || result.error)) || 'Action failed');
      return;
    }
    toast('Done');
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
      setDirectorPanel('<div class="dir-cmd-reply dir-cmd-done">Done.</div>');
      setDirectorGoState('done');
      setTimeout(function () {
        setDirectorGoState('idle');
      }, 1200);
    }, 40);
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
    toast('Project created');
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
    toast('Production created');
    openProduction(result.production.id);
  }

  /* ── Send to Studio ── */
  var pendingSend = null;

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
    var existing = document.getElementById('st-send-existing');
    var newName = document.getElementById('st-send-new-name');

    if (reason) reason.textContent = rec.reason || '';
    if (suggestedBtn) {
      if (rec.suggested) {
        suggestedBtn.style.display = '';
        suggestedBtn.textContent = 'Use “' + rec.suggested.name + '”';
        suggestedBtn.onclick = function () {
          confirmSend('suggested');
        };
      } else {
        suggestedBtn.style.display = 'none';
      }
    }
    if (existing) {
      var projects = Studio().listProjects();
      existing.innerHTML =
        '<option value="">Choose existing project…</option>' +
        projects
          .map(function (p) {
            return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
          })
          .join('');
    }
    if (newName) newName.value = rec.suggestedName || Studio().suggestProjectName(idea, sceneInfo);
    openM('studio-send-modal');
  }

  function confirmSend(mode) {
    if (!pendingSend) return;
    var projectId = null;
    if (mode === 'suggested' && pendingSend.recommendation && pendingSend.recommendation.suggested) {
      projectId = pendingSend.recommendation.suggested.id;
    } else if (mode === 'existing') {
      var existing = document.getElementById('st-send-existing');
      projectId = existing ? existing.value : '';
      if (!projectId) {
        toast('Choose a project');
        return;
      }
    } else if (mode === 'new') {
      var newName = document.getElementById('st-send-new-name');
      var p = Studio().createProject({
        name: newName ? newName.value : pendingSend.recommendation.suggestedName,
        coverImage: pendingSend.coverImage
      });
      projectId = p.id;
    } else {
      return;
    }

    var payload = Studio().productionFromIdea(pendingSend.idea, pendingSend.sceneInfo, {
      source: 'idea',
      coverImage: pendingSend.coverImage
    });
    var result = Studio().createProduction(projectId, payload);
    closeM('studio-send-modal');
    pendingSend = null;
    if (typeof global.shCloseForce === 'function') global.shCloseForce();
    if (!result) {
      toast('Could not create production');
      return;
    }
    toast('Sent to Studio');
    openProduction(result.production.id);
  }

  function renameProjectPrompt(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    var p = Studio().findProject(projectId);
    if (!p) return;
    var name = prompt('Rename project', p.name);
    if (name == null) return;
    Studio().renameProject(projectId, name);
    toast('Project renamed');
    openProject(projectId);
  }

  function duplicateProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    var copy = Studio().duplicateProject(projectId);
    if (!copy) return;
    toast('Project duplicated');
    openProject(copy.id);
  }

  function archiveProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    if (!confirm('Archive this project? You can restore it anytime from Studio.')) return;
    Studio().archiveProject(projectId, true);
    toast('Project archived');
    backToList();
  }

  function restoreProject(projectId) {
    Studio().restoreProject(projectId);
    toast('Project restored');
    backToList();
  }

  function deleteProject(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (menu) menu.hidden = true;
    if (!confirm('Permanently delete this project and its productions?')) return;
    Studio().deleteProject(projectId);
    toast('Project deleted');
    backToList();
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
    var found = Studio().findProduction(productionId);
    var projectId = found && found.project ? found.project.id : null;
    Studio().deleteProduction(productionId);
    toast('Production deleted');
    renderContinueCard();
    if (projectId) openProject(projectId);
    else backToList();
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
    toggleShot: toggleShot,
    updateShotField: updateShotField,
    addShot: addShot,
    deleteShot: deleteShot,
    addScriptLine: addScriptLine,
    updateScriptLine: updateScriptLine,
    linkScriptLine: linkScriptLine,
    deleteScriptLine: deleteScriptLine,
    convertScriptBody: convertScriptBody,
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
