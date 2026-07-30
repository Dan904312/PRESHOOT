/**
 * PreShoot Studio UI — Phase 1 screens & modals (uses PreShootStudio data layer).
 */
(function (global) {
  'use strict';

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

  function statusChip(status) {
    var meta = Studio().STATUS_MAP[status] || { label: status || 'Planning', id: 'planning' };
    return '<span class="st-chip st-' + esc(meta.id) + '">' + esc(meta.label) + '</span>';
  }

  function summaryLine(summary) {
    var parts = [];
    ['planning', 'ready', 'filming', 'editing', 'posted'].forEach(function (id) {
      var n = summary && summary[id] ? summary[id] : 0;
      if (!n) return;
      var label = (Studio().STATUS_MAP[id] && Studio().STATUS_MAP[id].label) || id;
      parts.push(label + ': ' + n);
    });
    return parts.length ? parts.join(' · ') : 'No productions yet';
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

  function syncNav() {
    if (typeof global.scheduleCloudSync === 'function') global.scheduleCloudSync();
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
    h += '<div class="studio-hd">';
    h += '<div><div class="studio-title">Studio</div><div class="studio-sub">Projects you are producing</div></div>';
    h += '<button type="button" class="studio-btn" onclick="PreShootStudioUI.openCreateProject()">New Project</button>';
    h += '</div>';

    h += '<div class="studio-toolbar">';
    h += '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.openCreateBlankProduction()">Blank Production</button>';
    h += '</div>';

    if (!projects.length) {
      h +=
        '<div class="studio-empty">' +
        '<div class="studio-empty-t">No projects yet</div>' +
        '<div class="studio-empty-s">Create a project, or send an idea from a scan with Send to Studio.</div>' +
        '<button type="button" class="studio-btn" onclick="PreShootStudioUI.openCreateProject()">Create Project</button>' +
        '</div>';
      root.innerHTML = h;
      return;
    }

    h += '<div class="studio-grid">';
    projects.forEach(function (p) {
      var cover = p.coverImage
        ? '<img class="st-cover" src="' + esc(p.coverImage) + '" alt="">'
        : '<div class="st-cover ph"></div>';
      h +=
        '<article class="st-card" onclick="PreShootStudioUI.openProject(\'' +
        esc(p.id) +
        '\')">' +
        cover +
        '<div class="st-card-body">' +
        '<div class="st-card-title">' +
        esc(p.name) +
        '</div>' +
        '<div class="st-card-meta">' +
        (p.productionCount || 0) +
        ' Production' +
        ((p.productionCount || 0) === 1 ? '' : 's') +
        ' · ' +
        (p.progress || 0) +
        '% complete</div>' +
        '<div class="st-card-sum">' +
        esc(summaryLine(p.statusSummary)) +
        '</div>' +
        '</div></article>';
    });
    h += '</div>';

    var archived = Studio().listProjects({ includeArchived: true }).filter(function (p) {
      return p.archived;
    });
    if (archived.length) {
      h += '<div class="studio-sub" style="padding:18px 16px 8px">Archived</div><div class="studio-grid">';
      archived.forEach(function (p) {
        h +=
          '<article class="st-card" style="opacity:.75">' +
          '<div class="st-cover ph"></div>' +
          '<div class="st-card-body">' +
          '<div class="st-card-title">' +
          esc(p.name) +
          '</div>' +
          '<div class="st-card-meta">Archived</div>' +
          '<button type="button" class="studio-btn ghost" style="margin-top:8px" onclick="event.stopPropagation();PreShootStudioUI.restoreProject(\'' +
          esc(p.id) +
          '\')">Restore</button>' +
          '<button type="button" class="studio-btn ghost danger" style="margin-top:8px;margin-left:6px" onclick="event.stopPropagation();PreShootStudioUI.deleteProject(\'' +
          esc(p.id) +
          '\')">Delete</button>' +
          '</div></article>';
      });
      h += '</div>';
    }
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

    var h = '';
    h += '<div class="studio-detail-hd">';
    h +=
      '<button type="button" class="studio-back" onclick="PreShootStudioUI.backToList()" aria-label="Back">←</button>';
    h += '<div style="flex:1;min-width:0"><div class="studio-title">' + esc(project.name) + '</div>';
    h +=
      '<div class="studio-sub">' +
      (project.productions || []).length +
      ' productions · ' +
      progress +
      '% · ' +
      esc(summaryLine(summary)) +
      '</div></div>';
    h += '</div>';

    h += '<div class="studio-actions-row">';
    h +=
      '<button type="button" class="studio-btn" onclick="PreShootStudioUI.openCreateProduction(\'' +
      esc(projectId) +
      '\')">Add Production</button>';
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.renameProjectPrompt(\'' +
      esc(projectId) +
      '\')">Rename</button>';
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.duplicateProject(\'' +
      esc(projectId) +
      '\')">Duplicate</button>';
    h +=
      '<button type="button" class="studio-btn ghost danger" onclick="PreShootStudioUI.archiveProject(\'' +
      esc(projectId) +
      '\')">Archive</button>';
    h +=
      '<button type="button" class="studio-btn ghost danger" onclick="PreShootStudioUI.deleteProject(\'' +
      esc(projectId) +
      '\')">Delete</button>';
    h += '</div>';

    var prods = project.productions || [];
    if (!prods.length) {
      h +=
        '<div class="studio-empty"><div class="studio-empty-t">Empty project</div><div class="studio-empty-s">Add a blank production or send an idea here from a scan.</div></div>';
    } else {
      h += '<div class="st-prod-list">';
      prods.forEach(function (prod) {
        var pct =
          typeof prod.progress === 'number'
            ? prod.progress
            : Studio().statusProgress(prod.status);
        h +=
          '<button type="button" class="st-prod-row" onclick="PreShootStudioUI.openProduction(\'' +
          esc(prod.id) +
          '\')">' +
          '<div class="st-prod-main"><div class="st-prod-name">' +
          esc(prod.name) +
          '</div><div class="st-prod-meta">' +
          pct +
          '% complete</div></div>' +
          statusChip(prod.status) +
          '</button>';
      });
      h += '</div>';
    }
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
    h += '<div class="studio-detail-hd">';
    h +=
      '<button type="button" class="studio-back" onclick="PreShootStudioUI.openProject(\'' +
      esc(project.id) +
      '\')" aria-label="Back">←</button>';
    h += '<div style="flex:1;min-width:0"><div class="studio-title">' + esc(prod.name) + '</div>';
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
        '\')">' +
        esc(s.label) +
        '</button>';
    });
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
      '<textarea class="st-input st-notes" id="st-prod-notes" rows="5" onchange="PreShootStudioUI.saveProductionField(\'' +
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

    root.innerHTML = h;
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
      '<div class="continue-card">' +
      '<div class="continue-body">' +
      '<div class="continue-kicker">Continue working</div>' +
      '<div class="continue-title">' +
      esc(cw.production.name) +
      '</div>' +
      '<div class="continue-meta">' +
      esc(cw.project.name) +
      ' · ' +
      esc((Studio().STATUS_MAP[cw.production.status] || {}).label || cw.production.status) +
      ' · ' +
      cw.progress +
      '%</div></div>' +
      '<button type="button" class="studio-btn" onclick="PreShootStudioUI.openProduction(\'' +
      esc(cw.production.id) +
      '\')">Continue</button></div>';
  }

  /* ── Modals ── */
  function openCreateProject() {
    var nameEl = document.getElementById('st-new-project-name');
    var notesEl = document.getElementById('st-new-project-notes');
    if (nameEl) nameEl.value = '';
    if (notesEl) notesEl.value = '';
    openM('studio-project-modal');
  }

  function confirmCreateProject() {
    var nameEl = document.getElementById('st-new-project-name');
    var notesEl = document.getElementById('st-new-project-notes');
    var name = nameEl ? nameEl.value : '';
    var notes = notesEl ? notesEl.value : '';
    var p = Studio().createProject({ name: name, notes: notes });
    closeM('studio-project-modal');
    toast('Project created');
    openProject(p.id);
  }

  function openCreateProduction(projectId) {
    var sel = document.getElementById('st-blank-project');
    var nameEl = document.getElementById('st-blank-name');
    var notesEl = document.getElementById('st-blank-notes');
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
    }
    openM('studio-blank-modal');
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
    var result = Studio().createProduction(projectId, {
      name: nameEl ? nameEl.value : 'Untitled Production',
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
    var p = Studio().findProject(projectId);
    if (!p) return;
    var name = prompt('Rename project', p.name);
    if (name == null) return;
    Studio().renameProject(projectId, name);
    toast('Project renamed');
    openProject(projectId);
  }

  function duplicateProject(projectId) {
    var copy = Studio().duplicateProject(projectId);
    if (!copy) return;
    toast('Project duplicated');
    openProject(copy.id);
  }

  function archiveProject(projectId) {
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
    var names = projects.map(function (p, i) {
      return i + 1 + '. ' + p.name;
    }).join('\n');
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
    deleteProduction: deleteProduction
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
