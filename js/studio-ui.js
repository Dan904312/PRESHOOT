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
    h +=
      '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">New Project</button>';
    h += '</div>';

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
      return;
    }

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
  }

  function openProject(projectId) {
    if (!global.S) return;
    global.S.studioView = { mode: 'project', projectId: projectId };
    renderStudio();
  }

  function openProduction(productionId) {
    if (!global.S) return;
    Studio().setContinueWorking(productionId);
    global.S.studioView = { mode: 'production', productionId: productionId };
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

    h +=
      '<button type="button" class="studio-director-placeholder" onclick="PreShootStudioUI.directorPlaceholder(\'project\')">' +
      '<span>Ask Director AI about this project</span><span class="st-soon">Soon</span></button>';

    h += '</div>';
    root.innerHTML = h;
  }

  function renderProductionDetail(root, productionId) {
    var found = Studio().findProduction(productionId);
    if (!found) {
      backToList();
      return;
    }
    var prod = found.production;
    var project = found.project;
    var pct =
      typeof prod.progress === 'number' ? prod.progress : Studio().statusProgress(prod.status);

    var h = '';
    h += '<div class="studio-shell studio-fade">';
    h += '<div class="studio-detail-hd">';
    h +=
      '<button type="button" class="studio-back" onclick="PreShootStudioUI.openProject(\'' +
      esc(project.id) +
      '\')" aria-label="Back">‹</button>';
    h += '<div class="studio-hd-text"><div class="studio-title">' + esc(prod.name) + '</div>';
    h +=
      '<div class="studio-sub">' +
      esc(project.name) +
      ' · ' +
      pct +
      '%</div></div></div>';

    h += '<div class="st-status-row">';
    Studio().STATUSES.forEach(function (s) {
      if (s.id === 'archived') return;
      var sel = prod.status === s.id ? ' sel' : '';
      h +=
        '<button type="button" class="st-status-btn st-' +
        esc(s.id) +
        sel +
        '" onclick="PreShootStudioUI.setStatus(\'' +
        esc(productionId) +
        "','" +
        esc(s.id) +
        '\')"><span class="st-dot"></span>' +
        esc(s.label) +
        '</button>';
    });
    h += '</div>';

    h += '<div class="st-panel">';
    h += '<div class="st-card-progress-row"><span>Completion</span><strong>' + pct + '%</strong></div>';
    h += progressBar(pct);
    h += '</div>';

    h += '<div class="st-panel">';
    h += '<label class="st-label">Production name</label>';
    h +=
      '<input class="st-input" id="st-prod-name" value="' +
      esc(prod.name) +
      '" onchange="PreShootStudioUI.saveProductionField(\'' +
      esc(productionId) +
      "','name',this.value)\">";
    h += '<label class="st-label">Notes</label>';
    h +=
      '<textarea class="st-input st-notes" id="st-prod-notes" rows="5" placeholder="Shot notes, tone, references…" onchange="PreShootStudioUI.saveProductionField(\'' +
      esc(productionId) +
      "','notes',this.value)\">" +
      esc(prod.notes || '') +
      '</textarea>';
    h += '</div>';

    if (prod.ideaSnapshot && (prod.ideaSnapshot.title || prod.ideaSnapshot.hook)) {
      h += '<div class="st-panel">';
      h += '<div class="st-label">Source idea</div>';
      if (prod.ideaSnapshot.title)
        h += '<div class="st-idea-t">' + esc(prod.ideaSnapshot.title) + '</div>';
      if (prod.ideaSnapshot.hook)
        h += '<div class="st-idea-h">“' + esc(prod.ideaSnapshot.hook) + '”</div>';
      h += '</div>';
    }

    h += '<div class="studio-actions-row">';
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.moveProductionPrompt(\'' +
      esc(productionId) +
      '\')">Move</button>';
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.duplicateProduction(\'' +
      esc(productionId) +
      '\')">Duplicate</button>';
    h +=
      '<button type="button" class="studio-btn ghost danger" onclick="PreShootStudioUI.deleteProduction(\'' +
      esc(productionId) +
      '\')">Delete</button>';
    h += '</div>';

    h +=
      '<button type="button" class="studio-director-placeholder" onclick="PreShootStudioUI.directorPlaceholder(\'production\')">' +
      '<span>Ask Director AI about this production</span><span class="st-soon">Soon</span></button>';

    h += '</div>';
    root.innerHTML = h;
  }

  function toggleProjectMenu(projectId) {
    var menu = document.getElementById('st-project-menu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
  }

  function directorPlaceholder() {
    toast('Director Studio actions unlock in a later phase');
  }

  /* ── Continue Working (Home) ── */
  function renderContinueCard() {
    var mount = document.getElementById('continue-working');
    if (!mount || !Studio()) return;
    var cw = Studio().getContinueWorking();
    if (!cw) {
      mount.innerHTML = '';
      mount.style.display = 'none';
      return;
    }
    mount.style.display = 'block';
    mount.innerHTML =
      '<button type="button" class="continue-card" onclick="PreShootStudioUI.openProduction(\'' +
      esc(cw.production.id) +
      '\')">' +
      '<div class="continue-body">' +
      '<div class="continue-kicker">Continue Working</div>' +
      '<div class="continue-project">' +
      esc(cw.project.name) +
      '</div>' +
      '<div class="continue-title">' +
      esc(cw.production.name) +
      '</div>' +
      '<div class="continue-meta">' +
      statusChip(cw.production.status) +
      '<span class="continue-pct">' +
      cw.progress +
      '%</span></div>' +
      progressBar(cw.progress) +
      '</div>' +
      '<div class="continue-cta">Continue <span aria-hidden="true">→</span></div>' +
      '</button>';
  }

  /* ── Create Project (stepped) ── */
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
    var result = Studio().duplicateProduction(productionId);
    if (!result) return;
    toast('Production duplicated');
    openProduction(result.production.id);
  }

  function deleteProduction(productionId) {
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
    directorPlaceholder: directorPlaceholder
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
