/**
 * PreShoot Studio — Projects & Productions (Phase 1 foundation).
 * Library remains scan history. Studio is the production workspace.
 * Director project actions are registered but not executed until later phases.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'studio';
  var VERSION = 2;
  var DIRTY_KEY = 'studio_dirty';

  var STATUSES = [
    { id: 'planning', label: 'Planning', order: 0 },
    { id: 'ready', label: 'Ready to Film', order: 1 },
    { id: 'filming', label: 'Filming', order: 2 },
    { id: 'editing', label: 'Editing', order: 3 },
    { id: 'posted', label: 'Posted', order: 4 },
    { id: 'archived', label: 'Archived', order: 5 }
  ];

  var STATUS_MAP = {};
  STATUSES.forEach(function (s) {
    STATUS_MAP[s.id] = s;
  });

  function uid(prefix) {
    return (
      (prefix || 'id') +
      '_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function now() {
    return Date.now();
  }

  function gs(k, fallback) {
    try {
      var v = localStorage.getItem('scout_' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function ss(k, v) {
    try {
      localStorage.setItem('scout_' + k, JSON.stringify(v));
    } catch (e) {}
  }

  function emptyStore() {
    /* updatedAt:0 so a fresh device never looks "newer" than cloud */
    return { version: VERSION, projects: [], continueProductionId: null, updatedAt: 0 };
  }

  function hasPersistedStore() {
    try {
      return localStorage.getItem('scout_' + STORAGE_KEY) != null;
    } catch (e) {
      return false;
    }
  }

  function defaultWorkspace() {
    return {
      overview: { summary: '', goal: '', platform: '', format: '' },
      shotList: [],
      script: { body: '' },
      references: { youtube: [], capcut: [], uploads: [] },
      assets: []
    };
  }

  function ensureWorkspace(prod) {
    if (!prod || typeof prod !== 'object') return prod;
    if (!prod.workspace || typeof prod.workspace !== 'object') {
      prod.workspace = defaultWorkspace();
    } else {
      var d = defaultWorkspace();
      prod.workspace.overview = Object.assign({}, d.overview, prod.workspace.overview || {});
      if (!Array.isArray(prod.workspace.shotList)) prod.workspace.shotList = [];
      prod.workspace.script = Object.assign({}, d.script, prod.workspace.script || {});
      prod.workspace.references = Object.assign(
        {},
        d.references,
        prod.workspace.references || {}
      );
      if (!Array.isArray(prod.workspace.references.youtube)) prod.workspace.references.youtube = [];
      if (!Array.isArray(prod.workspace.references.capcut)) prod.workspace.references.capcut = [];
      if (!Array.isArray(prod.workspace.references.uploads)) prod.workspace.references.uploads = [];
      if (!Array.isArray(prod.workspace.assets)) prod.workspace.assets = [];
    }
    return prod;
  }

  function getStore() {
    var raw = gs(STORAGE_KEY, null);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) {
      return emptyStore();
    }
    raw.version = VERSION;
    (raw.projects || []).forEach(function (p) {
      (p.productions || []).forEach(ensureWorkspace);
    });
    return raw;
  }

  function markDirty() {
    ss(DIRTY_KEY, true);
  }

  function clearDirty() {
    ss(DIRTY_KEY, false);
  }

  function isDirty() {
    return gs(DIRTY_KEY, false) === true;
  }

  function saveStore(store, opts) {
    opts = opts || {};
    store = store || getStore();
    if (!opts.keepUpdatedAt) store.updatedAt = now();
    store.version = VERSION;
    (store.projects || []).forEach(function (p) {
      (p.productions || []).forEach(ensureWorkspace);
    });
    ss(STORAGE_KEY, store);
    if (global.S) {
      global.S.studio = store;
      if (global.S.prefs && typeof global.S.prefs === 'object') {
        global.S.prefs.studio = store;
        ss('prefs', global.S.prefs);
      }
    }
    if (!opts.silent) {
      markDirty();
      if (typeof global.scheduleCloudSync === 'function') global.scheduleCloudSync();
    }
    return store;
  }

  function pickNewer(a, b) {
    var at = (a && a.updatedAt) || 0;
    var bt = (b && b.updatedAt) || 0;
    if (bt > at) return b;
    if (at > bt) return a;
    return a || b;
  }

  function mergeProduction(localP, cloudP) {
    var base = pickNewer(localP, cloudP);
    var other = base === localP ? cloudP : localP;
    var out = Object.assign({}, other || {}, base || {});
    ensureWorkspace(out);
    if (localP && localP.workspace && cloudP && cloudP.workspace) {
      var lw = localP.workspace;
      var cw = cloudP.workspace;
      var newerWs = ((localP.updatedAt || 0) >= (cloudP.updatedAt || 0) ? lw : cw) || {};
      var olderWs = newerWs === lw ? cw : lw;
      out.workspace = {
        overview: Object.assign({}, olderWs.overview || {}, newerWs.overview || {}),
        shotList:
          (newerWs.shotList && newerWs.shotList.length ? newerWs.shotList : olderWs.shotList) || [],
        script: Object.assign({}, olderWs.script || {}, newerWs.script || {}),
        references: {
          youtube: (newerWs.references && newerWs.references.youtube) ||
            (olderWs.references && olderWs.references.youtube) ||
            [],
          capcut: (newerWs.references && newerWs.references.capcut) ||
            (olderWs.references && olderWs.references.capcut) ||
            [],
          uploads: (newerWs.references && newerWs.references.uploads) ||
            (olderWs.references && olderWs.references.uploads) ||
            []
        },
        assets: (newerWs.assets && newerWs.assets.length ? newerWs.assets : olderWs.assets) || []
      };
    }
    out.updatedAt = Math.max(localP && localP.updatedAt || 0, cloudP && cloudP.updatedAt || 0);
    return out;
  }

  function mergeProject(localProj, cloudProj) {
    var base = pickNewer(localProj, cloudProj);
    var other = base === localProj ? cloudProj : localProj;
    var out = Object.assign({}, other || {}, base || {});
    var map = {};
    ((localProj && localProj.productions) || []).forEach(function (p) {
      map[p.id] = p;
    });
    ((cloudProj && cloudProj.productions) || []).forEach(function (p) {
      map[p.id] = map[p.id] ? mergeProduction(map[p.id], p) : p;
    });
    out.productions = Object.keys(map)
      .map(function (id) {
        return ensureWorkspace(map[id]);
      })
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    out.updatedAt = Math.max(
      (localProj && localProj.updatedAt) || 0,
      (cloudProj && cloudProj.updatedAt) || 0
    );
    return out;
  }

  function mergeStudioStores(local, cloud) {
    local = local && typeof local === 'object' ? local : emptyStore();
    cloud = cloud && typeof cloud === 'object' ? cloud : emptyStore();
    var localProjects = Array.isArray(local.projects) ? local.projects : [];
    var cloudProjects = Array.isArray(cloud.projects) ? cloud.projects : [];
    var localEmpty = !localProjects.length;
    var cloudEmpty = !cloudProjects.length;
    var persisted = hasPersistedStore();

    if (!persisted || (localEmpty && !cloudEmpty)) {
      return {
        version: VERSION,
        projects: cloudProjects,
        continueProductionId: cloud.continueProductionId || null,
        updatedAt: cloud.updatedAt || now()
      };
    }
    if (cloudEmpty && !localEmpty) {
      return {
        version: VERSION,
        projects: localProjects,
        continueProductionId: local.continueProductionId || null,
        updatedAt: local.updatedAt || now()
      };
    }

    var map = {};
    localProjects.forEach(function (p) {
      map[p.id] = p;
    });
    cloudProjects.forEach(function (p) {
      map[p.id] = map[p.id] ? mergeProject(map[p.id], p) : p;
    });
    var projects = Object.keys(map)
      .map(function (id) {
        return map[id];
      })
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

    var continueId = null;
    var localCont = local.continueProductionId;
    var cloudCont = cloud.continueProductionId;
    if ((local.updatedAt || 0) >= (cloud.updatedAt || 0)) {
      continueId = localCont || cloudCont || null;
    } else {
      continueId = cloudCont || localCont || null;
    }

    return {
      version: VERSION,
      projects: projects,
      continueProductionId: continueId,
      updatedAt: Math.max(local.updatedAt || 0, cloud.updatedAt || 0)
    };
  }

  function hydrateFromPrefs(prefs) {
    if (!prefs || !prefs.studio || !Array.isArray(prefs.studio.projects)) return getStore();
    var local = hasPersistedStore() ? getStore() : emptyStore();
    var merged = mergeStudioStores(local, prefs.studio);
    saveStore(merged, { silent: true, keepUpdatedAt: true });
    return merged;
  }

  function applyCloudStudio(cloudStudio) {
    if (!cloudStudio || typeof cloudStudio !== 'object') return getStore();
    var local = hasPersistedStore() ? getStore() : emptyStore();
    var merged = mergeStudioStores(local, cloudStudio);
    saveStore(merged, { silent: true, keepUpdatedAt: true });
    return merged;
  }

  function exportForSync() {
    var store = getStore();
    /* Slim cover images for sync payload size */
    try {
      var slim = JSON.parse(JSON.stringify(store));
      (slim.projects || []).forEach(function (p) {
        if (typeof p.coverImage === 'string' && p.coverImage.length > 180000) p.coverImage = null;
        (p.productions || []).forEach(function (prod) {
          if (typeof prod.coverImage === 'string' && prod.coverImage.length > 180000) {
            prod.coverImage = null;
          }
        });
      });
      return slim;
    } catch (e) {
      return store;
    }
  }

  function findProject(store, projectId) {
    return (store.projects || []).find(function (p) {
      return p.id === projectId;
    });
  }

  function findProduction(store, productionId) {
    var projects = store.projects || [];
    for (var i = 0; i < projects.length; i++) {
      var list = projects[i].productions || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === productionId) {
          return { project: projects[i], production: list[j], index: j };
        }
      }
    }
    return null;
  }

  function statusProgress(status) {
    var map = {
      planning: 15,
      ready: 35,
      filming: 55,
      editing: 75,
      posted: 100,
      archived: 100
    };
    return map[status] != null ? map[status] : 10;
  }

  function projectProgress(project) {
    var list = (project.productions || []).filter(function (p) {
      return p.status !== 'archived' && !p.archived;
    });
    if (!list.length) return 0;
    var sum = 0;
    list.forEach(function (p) {
      sum += typeof p.progress === 'number' ? p.progress : statusProgress(p.status);
    });
    return Math.round(sum / list.length);
  }

  function statusSummary(project) {
    var counts = {};
    STATUSES.forEach(function (s) {
      counts[s.id] = 0;
    });
    (project.productions || []).forEach(function (p) {
      var st = p.status || 'planning';
      if (counts[st] == null) counts[st] = 0;
      counts[st] += 1;
    });
    return counts;
  }

  function createProject(input) {
    var store = getStore();
    var name = String((input && input.name) || 'Untitled Project').trim() || 'Untitled Project';
    var project = {
      id: uid('proj'),
      name: name,
      notes: String((input && input.notes) || ''),
      coverImage: (input && input.coverImage) || null,
      archived: false,
      createdAt: now(),
      updatedAt: now(),
      productions: []
    };
    store.projects.unshift(project);
    saveStore(store);
    return project;
  }

  function renameProject(projectId, name) {
    var store = getStore();
    var p = findProject(store, projectId);
    if (!p) return null;
    p.name = String(name || '').trim() || p.name;
    p.updatedAt = now();
    saveStore(store);
    return p;
  }

  function archiveProject(projectId, archived) {
    var store = getStore();
    var p = findProject(store, projectId);
    if (!p) return null;
    p.archived = archived !== false;
    p.updatedAt = now();
    saveStore(store);
    return p;
  }

  function restoreProject(projectId) {
    return archiveProject(projectId, false);
  }

  function deleteProject(projectId) {
    var store = getStore();
    store.projects = (store.projects || []).filter(function (p) {
      return p.id !== projectId;
    });
    saveStore(store);
    return true;
  }

  function duplicateProject(projectId) {
    var store = getStore();
    var src = findProject(store, projectId);
    if (!src) return null;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid('proj');
    copy.name = src.name + ' (Copy)';
    copy.createdAt = now();
    copy.updatedAt = now();
    copy.archived = false;
    copy.productions = (copy.productions || []).map(function (prod) {
      prod.id = uid('prod');
      prod.createdAt = now();
      prod.updatedAt = now();
      return prod;
    });
    store.projects.unshift(copy);
    saveStore(store);
    return copy;
  }

  function createProduction(projectId, input) {
    var store = getStore();
    var project = findProject(store, projectId);
    if (!project) return null;
    input = input || {};
    var status = STATUS_MAP[input.status] ? input.status : 'planning';
    var production = {
      id: uid('prod'),
      name: String(input.name || 'Untitled Production').trim() || 'Untitled Production',
      notes: String(input.notes || ''),
      status: status,
      progress: typeof input.progress === 'number' ? input.progress : statusProgress(status),
      source: input.source || 'blank',
      ideaSnapshot: input.ideaSnapshot || null,
      scanRef: input.scanRef || null,
      coverImage: input.coverImage || null,
      workspace: input.workspace || defaultWorkspace(),
      archived: false,
      createdAt: now(),
      updatedAt: now()
    };
    ensureWorkspace(production);
    if (!Array.isArray(project.productions)) project.productions = [];
    project.productions.unshift(production);
    project.updatedAt = now();
    if (!project.coverImage && production.coverImage) {
      project.coverImage = production.coverImage;
    }
    store.continueProductionId = production.id;
    saveStore(store);
    return { project: project, production: production };
  }

  function updateProduction(productionId, patch) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = found.production;
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'id') return;
      prod[k] = patch[k];
    });
    if (patch && patch.status && typeof patch.progress !== 'number') {
      prod.progress = statusProgress(patch.status);
    }
    prod.updatedAt = now();
    found.project.updatedAt = now();
    store.continueProductionId = productionId;
    saveStore(store);
    return found;
  }

  function setProductionStatus(productionId, status) {
    if (!STATUS_MAP[status]) return null;
    return updateProduction(productionId, { status: status });
  }

  function moveProduction(productionId, toProjectId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    var dest = findProject(store, toProjectId);
    if (!found || !dest || found.project.id === toProjectId) return null;
    found.project.productions.splice(found.index, 1);
    found.project.updatedAt = now();
    dest.productions = dest.productions || [];
    dest.productions.unshift(found.production);
    dest.updatedAt = now();
    found.production.updatedAt = now();
    saveStore(store);
    return { project: dest, production: found.production };
  }

  function duplicateProduction(productionId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var copy = JSON.parse(JSON.stringify(found.production));
    copy.id = uid('prod');
    copy.name = found.production.name + ' (Copy)';
    copy.createdAt = now();
    copy.updatedAt = now();
    found.project.productions.unshift(copy);
    found.project.updatedAt = now();
    saveStore(store);
    return { project: found.project, production: copy };
  }

  function deleteProduction(productionId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return false;
    found.project.productions.splice(found.index, 1);
    found.project.updatedAt = now();
    if (store.continueProductionId === productionId) store.continueProductionId = null;
    saveStore(store);
    return true;
  }

  function listProjects(opts) {
    opts = opts || {};
    var store = getStore();
    return (store.projects || [])
      .filter(function (p) {
        if (opts.includeArchived) return true;
        return !p.archived;
      })
      .map(function (p) {
        return Object.assign({}, p, {
          progress: projectProgress(p),
          statusSummary: statusSummary(p),
          productionCount: (p.productions || []).length
        });
      });
  }

  function getContinueWorking() {
    var store = getStore();
    if (!store.continueProductionId) return null;
    var found = findProduction(store, store.continueProductionId);
    if (!found) return null;
    if (found.production.status === 'posted' || found.production.status === 'archived') {
      return null;
    }
    if (found.project.archived) return null;
    return {
      production: found.production,
      project: found.project,
      progress:
        typeof found.production.progress === 'number'
          ? found.production.progress
          : statusProgress(found.production.status)
    };
  }

  function setContinueWorking(productionId) {
    var store = getStore();
    store.continueProductionId = productionId || null;
    saveStore(store);
  }

  function clearContinueWorking() {
    setContinueWorking(null);
  }

  /** Heuristic project recommendation for Send to Studio (Phase 1 — no auto-move). */
  function recommendProject(idea, sceneInfo) {
    idea = idea || {};
    sceneInfo = sceneInfo || {};
    var projects = listProjects();
    if (!projects.length) {
      return {
        suggested: null,
        reason: 'No projects yet. Create one to start organizing productions.',
        suggestedName: suggestProjectName(idea, sceneInfo)
      };
    }
    var hay = [
      idea.title,
      idea.hook,
      idea.category,
      idea.editingStyle,
      sceneInfo.label,
      sceneInfo.type,
      sceneInfo.mainSubject
    ]
      .join(' ')
      .toLowerCase();

    var best = null;
    var bestScore = 0;
    projects.forEach(function (p) {
      var score = 0;
      var name = (p.name || '').toLowerCase();
      var notes = (p.notes || '').toLowerCase();
      name.split(/\s+/).forEach(function (w) {
        if (w.length > 2 && hay.indexOf(w) >= 0) score += 2;
      });
      notes.split(/\s+/).forEach(function (w) {
        if (w.length > 3 && hay.indexOf(w) >= 0) score += 1;
      });
      (p.productions || []).slice(0, 8).forEach(function (prod) {
        var t = ((prod.name || '') + ' ' + (prod.ideaSnapshot && prod.ideaSnapshot.title || '')).toLowerCase();
        t.split(/\s+/).forEach(function (w) {
          if (w.length > 3 && hay.indexOf(w) >= 0) score += 0.5;
        });
      });
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });

    if (!best || bestScore < 1.5) {
      return {
        suggested: null,
        reason: 'No clear project match. Choose an existing project or create a new one.',
        suggestedName: suggestProjectName(idea, sceneInfo)
      };
    }

    return {
      suggested: best,
      reason: 'This appears related to “' + best.name + '”.',
      suggestedName: best.name,
      score: bestScore
    };
  }

  function suggestProjectName(idea, sceneInfo) {
    var label = (sceneInfo && (sceneInfo.label || sceneInfo.mainSubject)) || '';
    if (label) return String(label).slice(0, 48);
    if (idea && idea.title) return String(idea.title).slice(0, 48);
    return 'New Project';
  }

  function productionFromIdea(idea, sceneInfo, meta) {
    idea = idea || {};
    sceneInfo = sceneInfo || {};
    meta = meta || {};
    return {
      name: String(idea.title || 'Untitled Production').trim(),
      notes: [idea.hook ? 'Hook: ' + idea.hook : '', idea.shotAngle || '', meta.notes || '']
        .filter(Boolean)
        .join('\n'),
      status: 'planning',
      source: meta.source || 'idea',
      ideaSnapshot: {
        title: idea.title || '',
        hook: idea.hook || idea.primaryHook || '',
        altHooks: idea.altHooks || [],
        shotAngle: idea.shotAngle || '',
        editingStyle: idea.editingStyle || '',
        audio: idea.audio || '',
        category: idea.category || '',
        difficulty: idea.difficulty || '',
        filmTime: idea.filmTime || '',
        whyItWorks: idea.whyItWorks || '',
        ytSearch: idea.ytSearch || '',
        capcutSearch: idea.capcutSearch || ''
      },
      scanRef: {
        sceneLabel: sceneInfo.label || '',
        sceneType: sceneInfo.type || '',
        mainSubject: sceneInfo.mainSubject || ''
      },
      coverImage: meta.coverImage || null
    };
  }

  /**
   * Phase 1 architecture for Director AI project management.
   * Actions are registered but NOT invoked until later phases.
   */
  var DIRECTOR_ACTIONS = {
    create_project: { ready: false, phase: 2 },
    rename_project: { ready: false, phase: 2 },
    move_production: { ready: false, phase: 2 },
    archive_production: { ready: false, phase: 2 },
    delete_production: { ready: false, phase: 2 },
    generate_production: { ready: false, phase: 3 },
    organize_projects: { ready: false, phase: 3 }
  };

  function getDirectorCapabilityManifest() {
    return {
      version: 1,
      phase: 1,
      note: 'Director project actions are prepared but not executable in Phase 1.',
      actions: DIRECTOR_ACTIONS,
      statuses: STATUSES.map(function (s) {
        return s.id;
      })
    };
  }

  function handleDirectorAction(action, payload) {
    var meta = DIRECTOR_ACTIONS[action];
    if (!meta) {
      return { ok: false, error: 'unknown_action' };
    }
    if (!meta.ready) {
      return {
        ok: false,
        error: 'not_implemented',
        phase: meta.phase,
        message: 'Director Studio actions unlock in a later phase.'
      };
    }
    return { ok: false, error: 'not_implemented' };
  }

  global.PreShootStudio = {
    STATUSES: STATUSES,
    STATUS_MAP: STATUS_MAP,
    getStore: getStore,
    saveStore: saveStore,
    hydrateFromPrefs: hydrateFromPrefs,
    applyCloudStudio: applyCloudStudio,
    mergeStudioStores: mergeStudioStores,
    exportForSync: exportForSync,
    hasPersistedStore: hasPersistedStore,
    isDirty: isDirty,
    markDirty: markDirty,
    clearDirty: clearDirty,
    defaultWorkspace: defaultWorkspace,
    ensureWorkspace: ensureWorkspace,
    listProjects: listProjects,
    findProject: function (id) {
      return findProject(getStore(), id);
    },
    findProduction: function (id) {
      return findProduction(getStore(), id);
    },
    createProject: createProject,
    renameProject: renameProject,
    archiveProject: archiveProject,
    restoreProject: restoreProject,
    deleteProject: deleteProject,
    duplicateProject: duplicateProject,
    createProduction: createProduction,
    updateProduction: updateProduction,
    setProductionStatus: setProductionStatus,
    moveProduction: moveProduction,
    duplicateProduction: duplicateProduction,
    deleteProduction: deleteProduction,
    projectProgress: projectProgress,
    statusSummary: statusSummary,
    statusProgress: statusProgress,
    getContinueWorking: getContinueWorking,
    setContinueWorking: setContinueWorking,
    clearContinueWorking: clearContinueWorking,
    recommendProject: recommendProject,
    suggestProjectName: suggestProjectName,
    productionFromIdea: productionFromIdea,
    getDirectorCapabilityManifest: getDirectorCapabilityManifest,
    handleDirectorAction: handleDirectorAction,
    getDirectorContext: function (productionId) {
      var found = productionId ? findProduction(getStore(), productionId) : null;
      return {
        phase: 3,
        studio: exportForSync(),
        project: found ? found.project : null,
        production: found ? ensureWorkspace(found.production) : null,
        actions: DIRECTOR_ACTIONS
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
