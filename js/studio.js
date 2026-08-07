/**
 * PreShoot Studio — Projects & Productions (Phases 1–5).
 * Library remains scan history. Studio is the production workspace.
 * Phase 5: Director actions (confirm-gated), health, timeline, performance, search.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'studio';
  var VERSION = 3;
  var DIRTY_KEY = 'studio_dirty';
  var TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

  var STATUSES = [
    { id: 'planning', label: 'Planning', order: 0 },
    { id: 'ready', label: 'Ready to Film', order: 1 },
    { id: 'filming', label: 'Filming', order: 2 },
    { id: 'editing', label: 'Editing', order: 3 },
    { id: 'ready_to_post', label: 'Ready to Post', order: 4 },
    { id: 'posted', label: 'Posted', order: 5 },
    { id: 'performance', label: 'Performance Review', order: 6 },
    { id: 'archived', label: 'Archived', order: 7 }
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
    return {
      version: VERSION,
      projects: [],
      continueProductionId: null,
      updatedAt: 0,
      deletedProjects: {},
      deletedProductions: {}
    };
  }

  function normalizeTombstones(map) {
    var out = {};
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (id) {
      var ts = Number(map[id]) || 0;
      if (!id || !ts) return;
      if (Date.now() - ts > TOMBSTONE_TTL_MS) return;
      out[id] = ts;
    });
    return out;
  }

  function mergeTombstoneMaps(a, b) {
    var out = {};
    [a, b].forEach(function (map) {
      if (!map || typeof map !== 'object') return;
      Object.keys(map).forEach(function (id) {
        var ts = Number(map[id]) || 0;
        if (!id || !ts) return;
        out[id] = Math.max(out[id] || 0, ts);
      });
    });
    return normalizeTombstones(out);
  }

  function rememberDeletedProject(store, projectId) {
    store.deletedProjects = store.deletedProjects || {};
    store.deletedProjects[projectId] = now();
  }

  function rememberDeletedProduction(store, productionId) {
    store.deletedProductions = store.deletedProductions || {};
    store.deletedProductions[productionId] = now();
  }

  function clearDeletedProject(store, projectId) {
    if (store.deletedProjects && store.deletedProjects[projectId]) {
      delete store.deletedProjects[projectId];
    }
  }

  function clearDeletedProduction(store, productionId) {
    if (store.deletedProductions && store.deletedProductions[productionId]) {
      delete store.deletedProductions[productionId];
    }
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
      script: { body: '', lines: [] },
      references: { youtube: [], capcut: [], uploads: [], pinterest: [] },
      assets: [],
      performance: {
        views: '',
        likes: '',
        comments: '',
        watchTime: '',
        ctr: '',
        notes: '',
        pdfName: ''
      }
    };
  }

  function defaultTimeline() {
    return [{ id: uid('evt'), type: 'created', label: 'Created', at: now() }];
  }

  function getSkillLevel() {
    var n = (global.S && global.S.niche) || {};
    var level = String(n.experienceLevel || n.skillLevel || 'intermediate').toLowerCase();
    if (level === 'beginner' || level === 'advanced') return level;
    return 'intermediate';
  }

  function createShot(input) {
    input = input || {};
    return {
      id: input.id || uid('shot'),
      order: typeof input.order === 'number' ? input.order : 1,
      purpose: String(input.purpose || 'Setup'),
      durationSec: typeof input.durationSec === 'number' ? input.durationSec : 3,
      cameraMovement: String(input.cameraMovement || ''),
      framing: String(input.framing || ''),
      lens: String(input.lens || ''),
      gear: String(input.gear || ''),
      lighting: String(input.lighting || ''),
      audio: String(input.audio || ''),
      notes: String(input.notes || ''),
      beginnerTip: String(input.beginnerTip || ''),
      advancedDetail: String(input.advancedDetail || '')
    };
  }

  function createScriptLine(input) {
    input = input || {};
    return {
      id: input.id || uid('line'),
      text: String(input.text || ''),
      shotId: input.shotId || null,
      shotOrder: typeof input.shotOrder === 'number' ? input.shotOrder : null
    };
  }

  function createRefItem(input) {
    input = input || {};
    return {
      id: input.id || uid('ref'),
      title: String(input.title || input.query || 'Reference'),
      query: String(input.query || input.title || ''),
      note: String(input.note || ''),
      url: String(input.url || '')
    };
  }

  function createAsset(input) {
    input = input || {};
    return {
      id: input.id || uid('asset'),
      type: String(input.type || 'image'),
      kind: String(input.kind || 'upload'),
      name: String(input.name || 'Asset'),
      src: input.src || null,
      note: String(input.note || '')
    };
  }

  function seedWorkspaceFromIdea(idea, sceneInfo, meta) {
    idea = idea || {};
    sceneInfo = sceneInfo || {};
    meta = meta || {};
    var skill = getSkillLevel();
    var shot1 = createShot({
      order: 1,
      purpose: 'Hook',
      durationSec: 3,
      framing:
        skill === 'beginner'
          ? 'Fill the frame with the most interesting subject'
          : 'Tight cold-open on the hero detail or face',
      cameraMovement:
        skill === 'advanced' ? 'Locked off with a micro push-in' : 'Hold steady for 3 seconds',
      lens: skill === 'advanced' ? '24–35mm equivalent' : skill === 'intermediate' ? 'Wide-to-normal' : '',
      gear: skill === 'beginner' ? 'Phone is fine — steady hands or lean on something' : '',
      lighting:
        skill === 'beginner'
          ? 'Stand so light hits the subject from the front or side'
          : 'Key from window/practicals; avoid flat overhead',
      audio: idea.audio || (skill === 'beginner' ? 'Speak clearly or add soft music later' : 'Clean VO + room tone'),
      notes: idea.hook ? 'Open on: “' + String(idea.hook).slice(0, 120) + '”' : '',
      beginnerTip: 'Film this first. If the hook is weak, nothing else matters — reshoot before moving on.',
      advancedDetail:
        skill === 'advanced'
          ? 'Protect headroom for captions; bias contrast and motion toward the hook subject.'
          : ''
    });
    var shot2 = createShot({
      order: 2,
      purpose: 'Setup',
      durationSec: 5,
      framing: idea.shotAngle || 'Wide establish → medium',
      cameraMovement: idea.shotAngle ? String(idea.shotAngle).slice(0, 80) : 'Slow walk-in or gentle pan',
      lens: skill === 'advanced' ? '16–24mm establish, then 35–50mm' : '',
      gear: '',
      lighting: skill === 'beginner' ? 'Keep the same light direction as the hook' : 'Match key direction to hook for continuity',
      audio: '',
      notes: idea.whyItWorks || '',
      beginnerTip: 'Show where you are so viewers can orient quickly.',
      advancedDetail:
        skill === 'advanced' ? 'Match eyeline/parallax to the hook for a seamless cut.' : ''
    });
    var shot3 = createShot({
      order: 3,
      purpose: 'Payoff',
      durationSec: 4,
      framing: 'Detail, reaction, or reveal',
      cameraMovement: 'Locked or soft orbit',
      lens: skill === 'advanced' ? '50–85mm equivalent for isolation' : '',
      gear: '',
      lighting: '',
      audio: '',
      notes: idea.editingStyle ? 'Edit vibe: ' + idea.editingStyle : '',
      beginnerTip: 'This is the “aha” moment — make it clear and satisfying.',
      advancedDetail:
        skill === 'advanced'
          ? 'Time the reveal on a beat; leave 4–6 frames of handles for the cut.'
          : ''
    });
    var shot4 = createShot({
      order: 4,
      purpose: 'CTA',
      durationSec: 3,
      framing: 'Face-to-camera or end card',
      cameraMovement: 'Hold',
      lens: '',
      gear: '',
      lighting: skill === 'beginner' ? 'Bright, friendly light on your face' : '',
      audio: 'Clear spoken CTA',
      notes: 'Invite a follow, visit, or save',
      beginnerTip: 'Say one clear next step. Don’t stack three CTAs.',
      advancedDetail: skill === 'advanced' ? 'End on a loopable frame for rewatches.' : ''
    });
    var shots = [shot1, shot2, shot3, shot4];
    var lines = [];
    if (idea.hook) {
      lines.push(createScriptLine({ text: idea.hook, shotId: shot1.id, shotOrder: 1 }));
    }
    lines.push(
      createScriptLine({
        text: idea.whyItWorks
          ? String(idea.whyItWorks).slice(0, 140)
          : 'Here’s why this works…',
        shotId: shot2.id,
        shotOrder: 2
      })
    );
    lines.push(
      createScriptLine({
        text: 'Come see for yourself.',
        shotId: shot4.id,
        shotOrder: 4
      })
    );
    var references = {
      youtube: [],
      capcut: [],
      uploads: [],
      pinterest: []
    };
    if (idea.ytSearch) {
      references.youtube.push(
        createRefItem({
          title: idea.ytSearch,
          query: idea.ytSearch,
          note: 'YouTube inspiration'
        })
      );
    }
    if (idea.capcutSearch) {
      references.capcut.push(
        createRefItem({
          title: idea.capcutSearch,
          query: idea.capcutSearch,
          note: 'CapCut template idea'
        })
      );
    }
    var assets = [];
    if (meta.coverImage) {
      assets.push(
        createAsset({
          type: 'image',
          kind: 'scan',
          name: 'Original scan',
          src: meta.coverImage,
          note: sceneInfo.label || sceneInfo.mainSubject || ''
        })
      );
    }
    return {
      overview: {
        summary: [idea.title, idea.hook].filter(Boolean).join(' — ').slice(0, 280),
        goal: idea.category ? 'Ship a strong ' + idea.category + ' piece' : '',
        platform: '',
        format: idea.category || ''
      },
      shotList: shots,
      script: {
        body: lines
          .map(function (l) {
            return l.text;
          })
          .join('\n\n'),
        lines: lines
      },
      references: references,
      assets: assets
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
      if (!Array.isArray(prod.workspace.script.lines)) prod.workspace.script.lines = [];
      prod.workspace.references = Object.assign(
        {},
        d.references,
        prod.workspace.references || {}
      );
      if (!Array.isArray(prod.workspace.references.youtube)) prod.workspace.references.youtube = [];
      if (!Array.isArray(prod.workspace.references.capcut)) prod.workspace.references.capcut = [];
      if (!Array.isArray(prod.workspace.references.uploads)) prod.workspace.references.uploads = [];
      if (!Array.isArray(prod.workspace.references.pinterest)) prod.workspace.references.pinterest = [];
      if (!Array.isArray(prod.workspace.assets)) prod.workspace.assets = [];
      prod.workspace.performance = Object.assign(
        {},
        d.performance,
        prod.workspace.performance || {}
      );
    }
    if (!Array.isArray(prod.timeline) || !prod.timeline.length) {
      prod.timeline = defaultTimeline();
      if (prod.createdAt) prod.timeline[0].at = prod.createdAt;
    }
    return prod;
  }

  function getStore() {
    var raw = gs(STORAGE_KEY, null);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) {
      return emptyStore();
    }
    raw.version = VERSION;
    raw.deletedProjects = normalizeTombstones(raw.deletedProjects);
    raw.deletedProductions = normalizeTombstones(raw.deletedProductions);
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
    store.deletedProjects = normalizeTombstones(store.deletedProjects);
    store.deletedProductions = normalizeTombstones(store.deletedProductions);
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
          youtube: (newerWs.references && newerWs.references.youtube && newerWs.references.youtube.length
            ? newerWs.references.youtube
            : olderWs.references && olderWs.references.youtube) || [],
          capcut: (newerWs.references && newerWs.references.capcut && newerWs.references.capcut.length
            ? newerWs.references.capcut
            : olderWs.references && olderWs.references.capcut) || [],
          uploads: (newerWs.references && newerWs.references.uploads && newerWs.references.uploads.length
            ? newerWs.references.uploads
            : olderWs.references && olderWs.references.uploads) || [],
          pinterest: (newerWs.references && newerWs.references.pinterest && newerWs.references.pinterest.length
            ? newerWs.references.pinterest
            : olderWs.references && olderWs.references.pinterest) || []
        },
        assets: (newerWs.assets && newerWs.assets.length ? newerWs.assets : olderWs.assets) || [],
        performance: Object.assign({}, olderWs.performance || {}, newerWs.performance || {})
      };
      if (!Array.isArray(out.workspace.script.lines)) out.workspace.script.lines = [];
    }
    if (localP && cloudP) {
      var newerT = ((localP.updatedAt || 0) >= (cloudP.updatedAt || 0) ? localP.timeline : cloudP.timeline) || [];
      var olderT = newerT === localP.timeline ? cloudP.timeline : localP.timeline;
      out.timeline = (newerT && newerT.length ? newerT : olderT) || defaultTimeline();
    }
    out.updatedAt = Math.max(localP && localP.updatedAt || 0, cloudP && cloudP.updatedAt || 0);
    return out;
  }

  function mergeProject(localProj, cloudProj, deletedProductions) {
    deletedProductions = deletedProductions || {};
    var base = pickNewer(localProj, cloudProj);
    var other = base === localProj ? cloudProj : localProj;
    var out = Object.assign({}, other || {}, base || {});
    var map = {};
    ((localProj && localProj.productions) || []).forEach(function (p) {
      if (p && p.id && !deletedProductions[p.id]) map[p.id] = p;
    });
    ((cloudProj && cloudProj.productions) || []).forEach(function (p) {
      if (!p || !p.id || deletedProductions[p.id]) return;
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

  function resolveContinueId(continueId, projects, deletedProductions) {
    if (!continueId) return null;
    if (deletedProductions && deletedProductions[continueId]) return null;
    var list = projects || [];
    for (var i = 0; i < list.length; i++) {
      var prods = list[i].productions || [];
      for (var j = 0; j < prods.length; j++) {
        if (prods[j] && prods[j].id === continueId) return continueId;
      }
    }
    return null;
  }

  function mergeStudioStores(local, cloud) {
    local = local && typeof local === 'object' ? local : emptyStore();
    cloud = cloud && typeof cloud === 'object' ? cloud : emptyStore();
    var localProjects = Array.isArray(local.projects) ? local.projects : [];
    var cloudProjects = Array.isArray(cloud.projects) ? cloud.projects : [];
    var deletedProjects = mergeTombstoneMaps(local.deletedProjects, cloud.deletedProjects);
    var deletedProductions = mergeTombstoneMaps(local.deletedProductions, cloud.deletedProductions);
    var localEmpty = !localProjects.length;
    var cloudEmpty = !cloudProjects.length;
    var persisted = hasPersistedStore();

    function filterProjects(list) {
      return (list || []).filter(function (p) {
        return p && p.id && !deletedProjects[p.id];
      });
    }

    if (!persisted || (localEmpty && !cloudEmpty)) {
      var cloudOnly = filterProjects(cloudProjects).map(function (p) {
        return mergeProject(null, p, deletedProductions);
      });
      return {
        version: VERSION,
        projects: cloudOnly,
        continueProductionId: resolveContinueId(
          cloud.continueProductionId,
          cloudOnly,
          deletedProductions
        ),
        updatedAt: cloud.updatedAt || now(),
        deletedProjects: deletedProjects,
        deletedProductions: deletedProductions
      };
    }
    if (cloudEmpty && !localEmpty) {
      var localOnly = filterProjects(localProjects).map(function (p) {
        return mergeProject(p, null, deletedProductions);
      });
      return {
        version: VERSION,
        projects: localOnly,
        continueProductionId: resolveContinueId(
          local.continueProductionId,
          localOnly,
          deletedProductions
        ),
        updatedAt: local.updatedAt || now(),
        deletedProjects: deletedProjects,
        deletedProductions: deletedProductions
      };
    }

    var map = {};
    filterProjects(localProjects).forEach(function (p) {
      map[p.id] = p;
    });
    filterProjects(cloudProjects).forEach(function (p) {
      map[p.id] = map[p.id]
        ? mergeProject(map[p.id], p, deletedProductions)
        : mergeProject(null, p, deletedProductions);
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
      continueProductionId: resolveContinueId(continueId, projects, deletedProductions),
      updatedAt: Math.max(local.updatedAt || 0, cloud.updatedAt || 0),
      deletedProjects: deletedProjects,
      deletedProductions: deletedProductions
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
      planning: 10,
      ready: 25,
      filming: 40,
      editing: 55,
      ready_to_post: 70,
      posted: 85,
      performance: 100,
      archived: 100
    };
    return map[status] != null ? map[status] : 10;
  }

  function statusTimelineLabel(status) {
    var map = {
      planning: 'Planning',
      ready: 'Ready to film',
      filming: 'Filming started',
      editing: 'Editing started',
      ready_to_post: 'Ready to post',
      posted: 'Posted',
      performance: 'Performance added',
      archived: 'Archived'
    };
    return map[status] || status;
  }

  function pushTimeline(prod, type, label) {
    if (!prod) return;
    if (!Array.isArray(prod.timeline)) prod.timeline = defaultTimeline();
    var last = prod.timeline[prod.timeline.length - 1];
    if (last && last.type === type && last.label === label) {
      last.at = now();
      return;
    }
    prod.timeline.push({ id: uid('evt'), type: type || 'event', label: label || type, at: now() });
    if (prod.timeline.length > 40) prod.timeline = prod.timeline.slice(-40);
  }

  function computeProductionHealth(prod) {
    prod = prod || {};
    var ws = (prod.workspace && typeof prod.workspace === 'object') ? prod.workspace : defaultWorkspace();
    var ov = ws.overview || {};
    var shots = ws.shotList || [];
    var lines = (ws.script && ws.script.lines) || [];
    var body = (ws.script && ws.script.body) || '';
    var refs = ws.references || {};
    var refCount =
      (refs.youtube || []).length +
      (refs.capcut || []).length +
      (refs.uploads || []).length +
      (refs.pinterest || []).length;
    var assets = ws.assets || [];
    var perf = ws.performance || {};
    var checks = [
      { id: 'shots', label: 'Shot list', ok: shots.length > 0, weight: 20 },
      { id: 'script', label: 'Script', ok: lines.length > 0 || !!String(body).trim(), weight: 15 },
      { id: 'refs', label: 'References', ok: refCount > 0, weight: 10 },
      {
        id: 'assets',
        label: 'Assets',
        ok: assets.length > 0 || !!prod.coverImage,
        weight: 10
      },
      {
        id: 'status',
        label: 'Status',
        ok: prod.status && prod.status !== 'planning',
        weight: 10
      },
      { id: 'goal', label: 'Goal', ok: !!String(ov.goal || '').trim(), weight: 15 },
      { id: 'platform', label: 'Platform', ok: !!String(ov.platform || '').trim(), weight: 10 },
      {
        id: 'performance',
        label: 'Performance',
        ok:
          prod.status === 'performance' ||
          !!(perf.views || perf.likes || perf.comments || perf.watchTime || perf.ctr || perf.pdfName),
        weight: 10
      }
    ];
    var earned = 0;
    var total = 0;
    var missing = [];
    checks.forEach(function (c) {
      total += c.weight;
      if (c.ok) earned += c.weight;
      else missing.push(c);
    });
    var score = total ? Math.round((earned / total) * 100) : 0;
    return { score: score, checks: checks, missing: missing };
  }

  function getProductionSuggestions(productionId) {
    var found = findProduction(getStore(), productionId);
    if (!found) return [];
    var prod = ensureWorkspace(found.production);
    var health = computeProductionHealth(prod);
    var ws = prod.workspace;
    var ov = ws.overview || {};
    var suggestions = [];
    health.missing.forEach(function (m) {
      if (m.id === 'shots')
        suggestions.push({
          id: 'need_shots',
          severity: 'high',
          text: 'Your production has no shot list yet.',
          action: 'generate_sections',
          payload: { productionId: productionId, sections: ['shots'] }
        });
      if (m.id === 'script')
        suggestions.push({
          id: 'need_script',
          severity: 'high',
          text: 'Add a script so each line maps to a shot.',
          action: 'generate_sections',
          payload: { productionId: productionId, sections: ['script'] }
        });
      if (m.id === 'refs')
        suggestions.push({
          id: 'need_refs',
          severity: 'med',
          text: 'Your production has no references yet.',
          action: null
        });
      if (m.id === 'assets')
        suggestions.push({
          id: 'need_assets',
          severity: 'med',
          text: 'You haven’t uploaded any inspiration or scan assets.',
          action: null
        });
      if (m.id === 'goal')
        suggestions.push({
          id: 'need_goal',
          severity: 'med',
          text: 'Set a goal so Director can advise with intent.',
          action: null
        });
      if (m.id === 'platform')
        suggestions.push({
          id: 'need_platform',
          severity: 'med',
          text: 'Choose a platform so pacing and length advice fits.',
          action: null
        });
    });
    var lines = (ws.script && ws.script.lines) || [];
    var totalChars = lines.reduce(function (n, l) {
      return n + String(l.text || '').length;
    }, 0);
    var plat = String(ov.platform || '').toLowerCase();
    if ((plat.indexOf('tiktok') >= 0 || plat.indexOf('reel') >= 0 || plat.indexOf('short') >= 0) && totalChars > 420) {
      suggestions.push({
        id: 'script_long',
        severity: 'med',
        text: 'This script may be too long for TikTok / Reels — tighten the hook and CTA.',
        action: null
      });
    }
    var idea = prod.ideaSnapshot || {};
    if (idea.hook && String(idea.hook).length < 12) {
      suggestions.push({
        id: 'weak_hook',
        severity: 'med',
        text: 'This hook could be stronger — make the first line more specific.',
        action: null
      });
    }
    if (health.score >= 70 && (prod.status === 'planning' || prod.status === 'ready')) {
      suggestions.push({
        id: 'ready_film',
        severity: 'low',
        text: 'This production looks ready to film.',
        action: 'update_status',
        payload: { productionId: productionId, status: 'ready' }
      });
    }
    if (prod.status === 'posted' && health.missing.some(function (m) { return m.id === 'performance'; })) {
      suggestions.push({
        id: 'add_perf',
        severity: 'med',
        text: 'Add performance metrics to improve future recommendations.',
        action: 'update_status',
        payload: { productionId: productionId, status: 'performance' }
      });
    }
    return suggestions.slice(0, 6);
  }

  function globalSearch(query) {
    query = String(query || '').trim().toLowerCase();
    var out = { projects: [], productions: [], scans: [], ideas: [], assets: [], scripts: [], references: [] };
    if (!query || query.length < 1) return out;
    var store = getStore();
    (store.projects || []).forEach(function (p) {
      if (String(p.name || '').toLowerCase().indexOf(query) >= 0 || String(p.notes || '').toLowerCase().indexOf(query) >= 0) {
        out.projects.push({ id: p.id, name: p.name, type: 'project' });
      }
      (p.productions || []).forEach(function (prod) {
        ensureWorkspace(prod);
        var blob = [prod.name, prod.notes, (prod.workspace.overview || {}).summary, (prod.workspace.overview || {}).goal]
          .join(' ')
          .toLowerCase();
        if (blob.indexOf(query) >= 0) {
          out.productions.push({
            id: prod.id,
            projectId: p.id,
            name: prod.name,
            projectName: p.name,
            status: prod.status,
            type: 'production'
          });
        }
        if (prod.scanRef) {
          var scanBlob = [prod.scanRef.sceneLabel, prod.scanRef.mainSubject, prod.scanRef.sceneType]
            .join(' ')
            .toLowerCase();
          if (scanBlob.indexOf(query) >= 0) {
            out.scans.push({
              productionId: prod.id,
              projectId: p.id,
              name: prod.scanRef.mainSubject || prod.scanRef.sceneLabel || 'Scan',
              type: 'scan'
            });
          }
        }
        if (prod.ideaSnapshot && String(prod.ideaSnapshot.title || '').toLowerCase().indexOf(query) >= 0) {
          out.ideas.push({
            productionId: prod.id,
            projectId: p.id,
            name: prod.ideaSnapshot.title,
            type: 'idea'
          });
        }
        ((prod.workspace.script && prod.workspace.script.lines) || []).forEach(function (line) {
          if (String(line.text || '').toLowerCase().indexOf(query) >= 0) {
            out.scripts.push({
              productionId: prod.id,
              projectId: p.id,
              name: String(line.text).slice(0, 80),
              type: 'script'
            });
          }
        });
        (prod.workspace.assets || []).forEach(function (a) {
          if (String(a.name || '').toLowerCase().indexOf(query) >= 0) {
            out.assets.push({
              productionId: prod.id,
              projectId: p.id,
              name: a.name,
              type: 'asset'
            });
          }
        });
        var refs = prod.workspace.references || {};
        ['youtube', 'capcut', 'uploads', 'pinterest'].forEach(function (k) {
          (refs[k] || []).forEach(function (r) {
            var rt = String(r.title || r.query || '').toLowerCase();
            if (rt.indexOf(query) >= 0) {
              out.references.push({
                productionId: prod.id,
                projectId: p.id,
                name: r.title || r.query,
                kind: k,
                type: 'reference'
              });
            }
          });
        });
      });
    });
    /* Cap each bucket for snappy UI */
    Object.keys(out).forEach(function (k) {
      out[k] = out[k].slice(0, 8);
    });
    return out;
  }

  function getHomeInsights() {
    var store = getStore();
    var cw = getContinueWorking();
    var recent = [];
    (store.projects || []).forEach(function (p) {
      if (p.archived) return;
      (p.productions || []).forEach(function (prod) {
        if (prod.archived || prod.status === 'archived') return;
        recent.push({
          productionId: prod.id,
          projectId: p.id,
          name: prod.name,
          projectName: p.name,
          status: prod.status,
          updatedAt: prod.updatedAt || 0,
          health: computeProductionHealth(prod).score
        });
      });
    });
    recent.sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    recent = recent.slice(0, 4);
    var nextAction = null;
    if (cw) {
      var sug = getProductionSuggestions(cw.production.id);
      if (sug.length) nextAction = Object.assign({ productionId: cw.production.id, productionName: cw.production.name }, sug[0]);
      else
        nextAction = {
          productionId: cw.production.id,
          productionName: cw.production.name,
          text: 'Continue “' + cw.production.name + '”.',
          id: 'continue'
        };
    } else if (recent.length) {
      nextAction = {
        productionId: recent[0].productionId,
        productionName: recent[0].name,
        text: 'Open “' + recent[0].name + '” and keep momentum.',
        id: 'open_recent'
      };
    }
    var scans = recent
      .map(function (r) {
        var f = findProduction(store, r.productionId);
        if (!f || !f.production.scanRef) return null;
        return {
          productionId: r.productionId,
          name: f.production.scanRef.mainSubject || f.production.scanRef.sceneLabel || r.name,
          coverImage: f.production.coverImage || null
        };
      })
      .filter(Boolean)
      .slice(0, 3);
    return { continueWorking: cw, recentProductions: recent, nextAction: nextAction, recentScans: scans };
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
    var rawName = String((input && input.name) || 'Untitled Project').trim() || 'Untitled Project';
    var name =
      global.PreShootDirectorOS && global.PreShootDirectorOS.toTitleCase
        ? global.PreShootDirectorOS.toTitleCase(rawName) || rawName
        : rawName;
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
    clearDeletedProject(store, project.id);
    store.projects.unshift(project);
    saveStore(store);
    return project;
  }

  function renameProject(projectId, name) {
    var store = getStore();
    var p = findProject(store, projectId);
    if (!p) return null;
    var titled =
      global.PreShootDirectorOS && global.PreShootDirectorOS.toTitleCase
        ? global.PreShootDirectorOS.toTitleCase(name)
        : String(name || '').trim();
    p.name = titled || p.name;
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
    var target = findProject(store, projectId);
    if (!target) {
      /* Still record tombstone so sync cannot resurrect a missing id */
      rememberDeletedProject(store, projectId);
      saveStore(store);
      return true;
    }
    (target.productions || []).forEach(function (prod) {
      if (prod && prod.id) {
        rememberDeletedProduction(store, prod.id);
        if (store.continueProductionId === prod.id) store.continueProductionId = null;
      }
    });
    rememberDeletedProject(store, projectId);
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
      timeline: input.timeline || defaultTimeline(),
      healthScore: 0,
      archived: false,
      createdAt: now(),
      updatedAt: now()
    };
    ensureWorkspace(production);
    production.healthScore = computeProductionHealth(production).score;
    if (production.workspace && production.workspace.shotList && production.workspace.shotList.length) {
      pushTimeline(production, 'shots', 'Shot list generated');
    }
    if (production.workspace && production.workspace.script && ((production.workspace.script.lines || []).length || production.workspace.script.body)) {
      pushTimeline(production, 'script', 'Script generated');
    }
    if (!Array.isArray(project.productions)) project.productions = [];
    clearDeletedProduction(store, production.id);
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
    var prevStatus = prod.status;
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'id') return;
      prod[k] = patch[k];
    });
    ensureWorkspace(prod);
    if (patch && patch.status && typeof patch.progress !== 'number') {
      prod.progress = statusProgress(patch.status);
    }
    if (patch && patch.status && patch.status !== prevStatus) {
      pushTimeline(prod, patch.status, statusTimelineLabel(patch.status));
    }
    if (patch && patch.workspace && patch.workspace.performance) {
      var perf = patch.workspace.performance;
      if (perf.views || perf.likes || perf.comments || perf.watchTime || perf.ctr || perf.pdfName) {
        pushTimeline(prod, 'performance', 'Performance added');
      }
    }
    prod.healthScore = computeProductionHealth(prod).score;
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

  function savePerformance(productionId, fields) {
    var found = findProduction(getStore(), productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    prod.workspace.performance = Object.assign({}, prod.workspace.performance || {}, fields || {});
    return updateProduction(productionId, { workspace: prod.workspace });
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
    clearDeletedProduction(store, copy.id);
    found.project.productions.unshift(copy);
    found.project.updatedAt = now();
    saveStore(store);
    return { project: found.project, production: copy };
  }

  function deleteProduction(productionId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    rememberDeletedProduction(store, productionId);
    if (!found) {
      if (store.continueProductionId === productionId) store.continueProductionId = null;
      saveStore(store);
      return false;
    }
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
    var workspace = seedWorkspaceFromIdea(idea, sceneInfo, meta);
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
      coverImage: meta.coverImage || null,
      workspace: workspace
    };
  }

  function buildWorkspaceFromIdea(productionId) {
    var found = findProduction(getStore(), productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var idea = prod.ideaSnapshot || {};
    var scene = prod.scanRef || {};
    var seeded = seedWorkspaceFromIdea(idea, scene, { coverImage: prod.coverImage });
    /* Preserve any manually typed overview fields if present */
    seeded.overview = Object.assign({}, seeded.overview, {
      summary: (prod.workspace.overview && prod.workspace.overview.summary) || seeded.overview.summary,
      goal: (prod.workspace.overview && prod.workspace.overview.goal) || seeded.overview.goal,
      platform: (prod.workspace.overview && prod.workspace.overview.platform) || seeded.overview.platform,
      format:
        (prod.workspace.overview && prod.workspace.overview.format) ||
        seeded.overview.format ||
        idea.category ||
        ''
    });
    return updateProduction(productionId, { workspace: seeded });
  }


  /**
   * Phase 5 — Director actions. Mutations require opts.confirmed === true.
   */
  var DIRECTOR_ACTIONS = {
    create_project: { ready: true, phase: 5, mutates: true },
    rename_project: { ready: true, phase: 5, mutates: true },
    rename_production: { ready: true, phase: 5, mutates: true },
    move_production: { ready: true, phase: 5, mutates: true },
    archive_production: { ready: true, phase: 5, mutates: true },
    archive_project: { ready: true, phase: 5, mutates: true },
    create_production: { ready: true, phase: 5, mutates: true },
    update_status: { ready: true, phase: 5, mutates: true },
    generate_sections: { ready: true, phase: 5, mutates: true },
    open_production: { ready: true, phase: 5, mutates: false },
    find_projects: { ready: true, phase: 5, mutates: false },
    search_assets: { ready: true, phase: 5, mutates: false },
    organize_projects: { ready: true, phase: 5, mutates: false },
    link_scan: { ready: true, phase: 5, mutates: true },
    unlink_scan: { ready: true, phase: 5, mutates: true },
    delete_production: { ready: true, phase: 5, mutates: true }
  };

  function confirmMessage(action, payload) {
    payload = payload || {};
    if (action === 'rename_project')
      return 'Rename Project to “' + (payload.name || '') + '”?';
    if (action === 'rename_production')
      return 'Rename Production to “' + (payload.name || '') + '”?';
    if (action === 'move_production')
      return 'Move this production to the selected project?';
    if (action === 'archive_production') return 'Archive this production?';
    if (action === 'archive_project') return 'Archive this project?';
    if (action === 'delete_production') return 'Delete this production? This cannot be undone.';
    if (action === 'create_project') return 'Create project “' + (payload.name || 'Untitled Project') + '”?';
    if (action === 'create_production')
      return 'Create production “' + (payload.name || 'Untitled Production') + '”?';
    if (action === 'update_status')
      return 'Update status to “' + ((STATUS_MAP[payload.status] || {}).label || payload.status || '') + '”?';
    if (action === 'generate_sections') return 'Generate missing production sections from the linked idea?';
    if (action === 'link_scan') return 'Link the current scan to this production?';
    if (action === 'unlink_scan') return 'Unlink the scan from this production?';
    return 'Confirm this Director action?';
  }

  function getDirectorCapabilityManifest() {
    return {
      version: 2,
      phase: 5,
      note: 'Director actions are available. Mutations require explicit user confirmation.',
      actions: DIRECTOR_ACTIONS,
      statuses: STATUSES.map(function (s) {
        return s.id;
      })
    };
  }

  function handleDirectorAction(action, payload, opts) {
    opts = opts || {};
    payload = payload || {};
    var meta = DIRECTOR_ACTIONS[action];
    if (!meta) return { ok: false, error: 'unknown_action' };
    if (!meta.ready) {
      return { ok: false, error: 'not_implemented', phase: meta.phase };
    }
    if (meta.mutates && !opts.confirmed) {
      return {
        ok: false,
        needsConfirmation: true,
        action: action,
        payload: payload,
        message: confirmMessage(action, payload)
      };
    }

    try {
      if (action === 'rename_project') {
        if (!payload.projectId || !payload.name) return { ok: false, error: 'missing_fields' };
        var rp = renameProject(payload.projectId, payload.name);
        return { ok: !!rp, result: rp };
      }
      if (action === 'rename_production') {
        if (!payload.productionId || !payload.name) return { ok: false, error: 'missing_fields' };
        var prodName =
          global.PreShootDirectorOS && global.PreShootDirectorOS.toTitleCase
            ? global.PreShootDirectorOS.toTitleCase(payload.name)
            : String(payload.name || '').trim();
        return {
          ok: !!updateProduction(payload.productionId, { name: prodName }),
          result: true
        };
      }
      if (action === 'move_production') {
        if (!payload.productionId || !payload.toProjectId) return { ok: false, error: 'missing_fields' };
        var mv = moveProduction(payload.productionId, payload.toProjectId);
        return { ok: !!mv, result: mv };
      }
      if (action === 'archive_production') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        return { ok: !!updateProduction(payload.productionId, { status: 'archived', archived: true }) };
      }
      if (action === 'archive_project') {
        if (!payload.projectId) return { ok: false, error: 'missing_fields' };
        return { ok: !!archiveProject(payload.projectId) };
      }
      if (action === 'delete_production') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        return { ok: !!deleteProduction(payload.productionId) };
      }
      if (action === 'create_project') {
        var np = createProject({ name: payload.name || 'Untitled Project', notes: payload.notes || '' });
        return { ok: !!np, result: np };
      }
      if (action === 'create_production') {
        if (!payload.projectId) return { ok: false, error: 'missing_fields' };
        var cp = createProduction(payload.projectId, {
          name: payload.name || 'Untitled Production',
          notes: payload.notes || '',
          source: 'director'
        });
        return { ok: !!cp, result: cp };
      }
      if (action === 'update_status') {
        if (!payload.productionId || !payload.status) return { ok: false, error: 'missing_fields' };
        return { ok: !!setProductionStatus(payload.productionId, payload.status) };
      }
      if (action === 'generate_sections') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        return { ok: !!buildWorkspaceFromIdea(payload.productionId) };
      }
      if (action === 'open_production') {
        return { ok: true, result: { productionId: payload.productionId }, open: true };
      }
      if (action === 'find_projects') {
        var q = String(payload.query || '').toLowerCase();
        var projects = listProjects().filter(function (p) {
          return !q || String(p.name || '').toLowerCase().indexOf(q) >= 0;
        });
        return {
          ok: true,
          result: projects.map(function (p) {
            return { id: p.id, name: p.name };
          })
        };
      }
      if (action === 'search_assets') {
        return { ok: true, result: globalSearch(payload.query || '') };
      }
      if (action === 'organize_projects') {
        var insights = getHomeInsights();
        return { ok: true, result: insights };
      }
      if (action === 'link_scan') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        var scanRef = payload.scanRef || null;
        var cover = payload.coverImage || null;
        if (!scanRef && global.S && global.S.sceneInfo) {
          scanRef = {
            sceneLabel: global.S.sceneInfo.label || '',
            sceneType: global.S.sceneInfo.type || '',
            mainSubject: global.S.sceneInfo.mainSubject || ''
          };
          cover = cover || global.S.scanImg || null;
        }
        var patch = { scanRef: scanRef };
        if (cover) patch.coverImage = cover;
        var linked = updateProduction(payload.productionId, patch);
        if (linked) pushTimeline(linked.production, 'scan', 'Scan linked');
        if (linked) {
          linked.production.healthScore = computeProductionHealth(linked.production).score;
          saveStore(getStore());
        }
        return { ok: !!linked };
      }
      if (action === 'unlink_scan') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        return {
          ok: !!updateProduction(payload.productionId, { scanRef: null })
        };
      }
      return { ok: false, error: 'not_implemented' };
    } catch (e) {
      return { ok: false, error: 'exception', message: String(e && e.message ? e.message : e) };
    }
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
    seedWorkspaceFromIdea: seedWorkspaceFromIdea,
    buildWorkspaceFromIdea: buildWorkspaceFromIdea,
    createShot: createShot,
    createScriptLine: createScriptLine,
    createRefItem: createRefItem,
    createAsset: createAsset,
    getSkillLevel: getSkillLevel,
    getDirectorCapabilityManifest: getDirectorCapabilityManifest,
    handleDirectorAction: handleDirectorAction,
    confirmMessage: confirmMessage,
    computeProductionHealth: computeProductionHealth,
    getProductionSuggestions: getProductionSuggestions,
    globalSearch: globalSearch,
    getHomeInsights: getHomeInsights,
    savePerformance: savePerformance,
    pushTimeline: pushTimeline,
    getDirectorContext: function (productionId) {
      var found = productionId ? findProduction(getStore(), productionId) : null;
      var prod = found ? ensureWorkspace(found.production) : null;
      var skill = getSkillLevel();
      var shots = (prod && prod.workspace && prod.workspace.shotList) || [];
      var lines = (prod && prod.workspace && prod.workspace.script && prod.workspace.script.lines) || [];
      var health = prod ? computeProductionHealth(prod) : null;
      return {
        phase: 5,
        skillLevel: skill,
        studio: exportForSync(),
        project: found ? { id: found.project.id, name: found.project.name } : null,
        production: prod
          ? {
              id: prod.id,
              name: prod.name,
              status: prod.status,
              progress: prod.progress,
              notes: prod.notes,
              source: prod.source,
              ideaSnapshot: prod.ideaSnapshot,
              scanRef: prod.scanRef,
              overview: prod.workspace.overview,
              shotCount: shots.length,
              scriptLineCount: lines.length,
              shotList: shots,
              scriptLines: lines,
              references: prod.workspace.references,
              assetCount: (prod.workspace.assets || []).length,
              performance: prod.workspace.performance || {},
              timeline: prod.timeline || [],
              healthScore: health ? health.score : 0,
              health: health,
              suggestions: getProductionSuggestions(prod.id)
            }
          : null,
        home: productionId ? null : getHomeInsights(),
        actions: DIRECTOR_ACTIONS
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
