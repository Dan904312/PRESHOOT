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
  var CAL_TYPES = ['post', 'scan', 'idea', 'production', 'other'];
  var CAL_STATUSES = ['idea', 'planned', 'in_production', 'ready', 'posted', 'skipped'];
  var CAL_CAP = 500;

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
      deletedProductions: {},
      calendar: { version: 1, events: [] }
    };
  }

  function emptyCalendar() {
    return { version: 1, events: [] };
  }

  function clampCal(s, n) {
    return String(s == null ? '' : s).slice(0, n);
  }

  function normalizeCalendarEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var date = String(raw.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var id = clampCal(raw.id, 80);
    if (!id) return null;
    var type = CAL_TYPES.indexOf(String(raw.type || '')) >= 0 ? raw.type : 'post';
    var status =
      CAL_STATUSES.indexOf(String(raw.status || '')) >= 0
        ? raw.status
        : type === 'idea'
          ? 'idea'
          : 'planned';
    return {
      id: id,
      date: date,
      type: type,
      status: status,
      title: clampCal(raw.title, 160) || 'Untitled',
      projectId: raw.projectId ? clampCal(raw.projectId, 80) : null,
      productionId: raw.productionId ? clampCal(raw.productionId, 80) : null,
      ideaId: raw.ideaId ? clampCal(raw.ideaId, 120) : null,
      workspaceId: raw.workspaceId ? clampCal(raw.workspaceId, 80) : null,
      platform: clampCal(raw.platform, 40),
      notes: clampCal(raw.notes, 2000),
      createdAt: Number(raw.createdAt) || 0,
      updatedAt: Number(raw.updatedAt) || 0,
      completedAt: raw.completedAt == null || raw.completedAt === '' ? null : Number(raw.completedAt)
    };
  }

  function normalizeCalendar(raw) {
    var events = raw && Array.isArray(raw.events) ? raw.events : [];
    var seen = {};
    var out = [];
    events.forEach(function (row) {
      var ev = normalizeCalendarEvent(row);
      if (!ev || seen[ev.id]) return;
      seen[ev.id] = true;
      out.push(ev);
    });
    out.sort(function (a, b) {
      var d = String(a.date).localeCompare(String(b.date));
      if (d) return d;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return { version: 1, events: out.slice(-CAL_CAP) };
  }

  function mergeCalendars(a, b) {
    var left = normalizeCalendar(a);
    var right = normalizeCalendar(b);
    var map = {};
    left.events.forEach(function (e) {
      map[e.id] = e;
    });
    right.events.forEach(function (e) {
      var prev = map[e.id];
      if (!prev) map[e.id] = e;
      else map[e.id] = (e.updatedAt || 0) >= (prev.updatedAt || 0) ? e : prev;
    });
    return normalizeCalendar({ version: 1, events: Object.keys(map).map(function (id) { return map[id]; }) });
  }

  function activeWorkspaceId() {
    try {
      var ctx = workspaceCtx();
      if (ctx && ctx.isShared && ctx.isShared() && ctx.getContext) {
        var c = ctx.getContext();
        return (c && (c.workspaceId || c.activeWorkspaceId)) || null;
      }
    } catch (e) {}
    return null;
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
      references: { youtube: [], capcut: [], uploads: [], other: [], pinterest: [], trending: [], _cache: {} },
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
      cameraAngle: String(input.cameraAngle || ''),
      lens: String(input.lens || ''),
      gear: String(input.gear || ''),
      lighting: String(input.lighting || ''),
      audio: String(input.audio || ''),
      notes: String(input.notes || ''),
      beginnerTip: String(input.beginnerTip || ''),
      advancedDetail: String(input.advancedDetail || ''),
      scriptLineId: input.scriptLineId || null
    };
  }

  function createScriptLine(input) {
    input = input || {};
    return {
      id: input.id || uid('line'),
      text: String(input.text || ''),
      shotId: input.shotId || null,
      shotOrder: typeof input.shotOrder === 'number' ? input.shotOrder : null,
      kind: String(input.kind || '')
    };
  }

  function createRefItem(input) {
    input = input || {};
    return {
      id: input.id || uid('ref'),
      title: String(input.title || input.query || 'Reference'),
      query: String(input.query || input.title || ''),
      note: String(input.note || input.why || ''),
      why: String(input.why || input.note || ''),
      url: String(input.url || ''),
      platform: String(input.platform || ''),
      thumbnail: input.thumbnail || null,
      channel: String(input.channel || ''),
      viewsLabel: String(input.viewsLabel || ''),
      publishedAt: String(input.publishedAt || input.date || ''),
      source: String(input.source || 'manual'),
      savedAt: typeof input.savedAt === 'number' ? input.savedAt : now()
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
      url: input.url || input.src || null,
      storagePath: input.storagePath || null,
      mime: String(input.mime || ''),
      size: typeof input.size === 'number' ? input.size : 0,
      sizeLabel: String(input.sizeLabel || ''),
      folder: String(input.folder || 'Assets'),
      note: String(input.note || ''),
      uploadedAt: typeof input.uploadedAt === 'number' ? input.uploadedAt : now()
    };
  }

  var ASSET_FOLDERS = ['Assets', 'Footage', 'Photos', 'Audio', 'References', 'Brand'];

  function ensureRefBuckets(refs) {
    refs = refs && typeof refs === 'object' ? refs : {};
    if (!Array.isArray(refs.youtube)) refs.youtube = [];
    if (!Array.isArray(refs.capcut)) refs.capcut = [];
    if (!Array.isArray(refs.uploads)) refs.uploads = [];
    if (!Array.isArray(refs.other)) refs.other = Array.isArray(refs.pinterest) ? refs.pinterest : [];
    if (!Array.isArray(refs.pinterest)) refs.pinterest = [];
    if (!Array.isArray(refs.trending)) refs.trending = [];
    if (!refs._cache || typeof refs._cache !== 'object') refs._cache = {};
    return refs;
  }

  function refBucketForPlatform(platform) {
    var p = String(platform || '').toLowerCase();
    if (p === 'youtube') return 'youtube';
    if (p === 'capcut') return 'capcut';
    if (p === 'upload' || p === 'uploads') return 'uploads';
    if (p === 'trending' || p === 'trend') return 'trending';
    return 'other';
  }

  function addReference(productionId, item) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    prod.workspace.references = ensureRefBuckets(prod.workspace.references);
    var platform = item.platform || (item.url && /youtube\.com|youtu\.be/i.test(item.url) ? 'youtube' : '');
    if (!platform && item.url && /capcut\.com/i.test(item.url)) platform = 'capcut';
    var bucket = refBucketForPlatform(platform || 'other');
    var ref = createRefItem(
      Object.assign({}, item, { platform: platform || bucket, savedAt: now() })
    );
    /* Dedupe by URL */
    var list = prod.workspace.references[bucket] || [];
    if (ref.url) {
      var exists = list.some(function (r) {
        return r.url && r.url === ref.url;
      });
      if (exists) return { production: prod, reference: ref, duplicate: true };
    }
    list.unshift(ref);
    prod.workspace.references[bucket] = list.slice(0, 40);
    found.project.updatedAt = now();
    prod.updatedAt = now();
    saveStore(store);
    return { production: prod, reference: ref };
  }

  function removeReference(productionId, refId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    prod.workspace.references = ensureRefBuckets(prod.workspace.references);
    var removed = null;
    ['youtube', 'capcut', 'uploads', 'other', 'pinterest', 'trending'].forEach(function (key) {
      var before = prod.workspace.references[key] || [];
      prod.workspace.references[key] = before.filter(function (r) {
        if (r.id === refId) {
          removed = r;
          return false;
        }
        return true;
      });
    });
    if (!removed) return null;
    prod.updatedAt = now();
    saveStore(store);
    return { production: prod, reference: removed };
  }

  function listReferences(productionId) {
    var found = findProduction(getStore(), productionId);
    if (!found) return [];
    var prod = ensureWorkspace(found.production);
    var refs = ensureRefBuckets(prod.workspace.references);
    return []
      .concat(refs.youtube || [])
      .concat(refs.capcut || [])
      .concat(refs.uploads || [])
      .concat(refs.other || [])
      .concat(refs.pinterest || [])
      .concat(refs.trending || []);
  }

  function addAsset(productionId, item) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var asset = createAsset(item);
    if (ASSET_FOLDERS.indexOf(asset.folder) < 0) asset.folder = 'Assets';
    prod.workspace.assets = (prod.workspace.assets || []).concat([]);
    prod.workspace.assets.unshift(asset);
    prod.workspace.assets = prod.workspace.assets.slice(0, 60);
    prod.updatedAt = now();
    saveStore(store);
    return { production: prod, asset: asset };
  }

  function removeAsset(productionId, assetId) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var before = prod.workspace.assets || [];
    var removed = null;
    prod.workspace.assets = before.filter(function (a) {
      if (a.id === assetId) {
        removed = a;
        return false;
      }
      return true;
    });
    if (!removed) return null;
    prod.updatedAt = now();
    saveStore(store);
    return { production: prod, asset: removed };
  }

  function setAssetFolder(productionId, assetId, folder) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var hit = (prod.workspace.assets || []).find(function (a) {
      return a.id === assetId;
    });
    if (!hit) return null;
    hit.folder = ASSET_FOLDERS.indexOf(folder) >= 0 ? folder : 'Assets';
    prod.updatedAt = now();
    saveStore(store);
    return { production: prod, asset: hit };
  }

  function setResearchCache(productionId, platform, payload, cacheKey) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    prod.workspace.references = ensureRefBuckets(prod.workspace.references);
    prod.workspace.references._cache[platform] = {
      at: now(),
      key: String(cacheKey || ''),
      items: (payload && payload.items) || [],
      mode: (payload && payload.mode) || '',
      strategy: (payload && payload.strategy) || null,
      emptyMessage: (payload && payload.emptyMessage) || ''
    };
    saveStore(store, { silent: true, keepUpdatedAt: true });
    return prod.workspace.references._cache[platform];
  }

  function getResearchCache(productionId, platform, cacheKey, maxAgeMs) {
    var found = findProduction(getStore(), productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var refs = ensureRefBuckets(prod.workspace.references);
    var row = refs._cache && refs._cache[platform];
    if (!row) return null;
    maxAgeMs = maxAgeMs || 24 * 60 * 60 * 1000;
    if (cacheKey && row.key && row.key !== cacheKey) return null;
    if (now() - (row.at || 0) > maxAgeMs) return null;
    return row;
  }

  function starterShotListFromIdea(idea, sceneInfo, meta) {
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
    return shots;
  }

  function ideaSnapshotFromIdea(idea) {
    idea = idea || {};
    return {
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
    };
  }

  function scanRefFromScene(sceneInfo) {
    sceneInfo = sceneInfo || {};
    return {
      sceneLabel: sceneInfo.label || '',
      sceneType: sceneInfo.type || '',
      mainSubject: sceneInfo.mainSubject || ''
    };
  }

  function seedWorkspaceFromIdea(idea, sceneInfo, meta) {
    idea = idea || {};
    sceneInfo = sceneInfo || {};
    meta = meta || {};
    var references = {
      youtube: [],
      capcut: [],
      uploads: [],
      other: [],
      pinterest: [],
      _cache: {}
    };
    if (idea.ytSearch) {
      references.youtube.push(
        createRefItem({
          title: idea.ytSearch,
          query: idea.ytSearch,
          note: 'YouTube search from idea',
          why: 'Seeded from this production’s idea',
          platform: 'youtube',
          url:
            'https://www.youtube.com/results?search_query=' +
            encodeURIComponent(idea.ytSearch) +
            '&sp=CAM%253D',
          source: 'idea'
        })
      );
    }
    if (idea.capcutSearch) {
      references.capcut.push(
        createRefItem({
          title: idea.capcutSearch,
          query: idea.capcutSearch,
          note: 'CapCut template search from idea',
          why: 'Editing style match for this production',
          platform: 'capcut',
          url:
            'https://www.capcut.com/template-center?keyword=' +
            encodeURIComponent(idea.capcutSearch),
          source: 'idea'
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
    /* Idea copy is concept only. Never pretends to be a shooting script. */
    var shotList = meta.includeStarterShots ? starterShotListFromIdea(idea, sceneInfo, meta) : [];
    return {
      overview: {
        summary: [idea.title, idea.hook].filter(Boolean).join(' — ').slice(0, 280),
        goal: idea.category ? 'Ship a strong ' + idea.category + ' piece' : '',
        platform: '',
        format: idea.category || ''
      },
      shotList: shotList,
      script: { body: '', lines: [] },
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
      if (!Array.isArray(prod.workspace.references.other)) {
        prod.workspace.references.other = Array.isArray(prod.workspace.references.pinterest)
          ? prod.workspace.references.pinterest.slice()
          : [];
      }
      if (!Array.isArray(prod.workspace.references.pinterest)) prod.workspace.references.pinterest = [];
      if (!Array.isArray(prod.workspace.references.trending)) prod.workspace.references.trending = [];
      if (!prod.workspace.references._cache || typeof prod.workspace.references._cache !== 'object') {
        prod.workspace.references._cache = {};
      }
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

  function getPersonalStore() {
    var raw = gs(STORAGE_KEY, null);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) {
      return emptyStore();
    }
    raw.version = VERSION;
    raw.deletedProjects = normalizeTombstones(raw.deletedProjects);
    raw.deletedProductions = normalizeTombstones(raw.deletedProductions);
    raw.calendar = normalizeCalendar(raw.calendar);
    (raw.projects || []).forEach(function (p) {
      (p.productions || []).forEach(ensureWorkspace);
    });
    return raw;
  }

  function workspaceCtx() {
    return global.PreShootWorkspace || null;
  }

  function isSharedActive() {
    var ctx = workspaceCtx();
    return !!(ctx && ctx.isShared && ctx.isShared());
  }

  function getStore() {
    if (isSharedActive()) {
      var ctx = workspaceCtx();
      var doc = ctx.getSharedDocument && ctx.getSharedDocument();
      if (doc && typeof doc === 'object' && Array.isArray(doc.projects)) {
        doc.version = VERSION;
        doc.deletedProjects = normalizeTombstones(doc.deletedProjects);
        doc.deletedProductions = normalizeTombstones(doc.deletedProductions);
        doc.calendar = normalizeCalendar(doc.calendar);
        (doc.projects || []).forEach(function (p) {
          (p.productions || []).forEach(ensureWorkspace);
        });
        return doc;
      }
      return emptyStore();
    }
    return getPersonalStore();
  }

  function markDirty() {
    if (isSharedActive()) {
      var ctx = workspaceCtx();
      if (ctx && ctx.markSharedDirty) ctx.markSharedDirty();
      return;
    }
    ss(DIRTY_KEY, true);
  }

  function clearDirty() {
    /* Personal sync success always clears personal dirty only */
    ss(DIRTY_KEY, false);
  }

  function clearSharedDirtyFlag() {
    var ctx = workspaceCtx();
    if (ctx && ctx.clearSharedDirty) ctx.clearSharedDirty();
  }

  function isPersonalDirty() {
    return gs(DIRTY_KEY, false) === true;
  }

  function isDirty() {
    if (isSharedActive()) {
      var ctx = workspaceCtx();
      return !!(ctx && ctx.isSharedDirty && ctx.isSharedDirty());
    }
    return isPersonalDirty();
  }

  function savePersonalStore(store, opts) {
    opts = opts || {};
    store = store || getPersonalStore();
    if (!opts.keepUpdatedAt) store.updatedAt = now();
    store.version = VERSION;
    store.deletedProjects = normalizeTombstones(store.deletedProjects);
    store.deletedProductions = normalizeTombstones(store.deletedProductions);
    store.calendar = normalizeCalendar(store.calendar);
    (store.projects || []).forEach(function (p) {
      (p.productions || []).forEach(ensureWorkspace);
    });
    ss(STORAGE_KEY, store);
    if (global.S && !isSharedActive()) {
      global.S.studio = store;
      if (global.S.prefs && typeof global.S.prefs === 'object') {
        global.S.prefs.studio = store;
        ss('prefs', global.S.prefs);
      }
    } else if (global.S && global.S.prefs && typeof global.S.prefs === 'object') {
      /* Keep prefs.studio as personal snapshot even while viewing shared */
      global.S.prefs.studio = store;
      ss('prefs', global.S.prefs);
    }
    if (!opts.silent) {
      ss(DIRTY_KEY, true);
      if (typeof global.scheduleCloudSync === 'function') global.scheduleCloudSync();
    }
    return store;
  }

  function saveStore(store, opts) {
    opts = opts || {};
    if (isSharedActive()) {
      var ctx = workspaceCtx();
      if (ctx && ctx.canEdit && !ctx.canEdit()) {
        if (!opts.silent && typeof global.showToast === 'function') {
          global.showToast('This workspace is read-only');
        }
        return (ctx.getSharedDocument && ctx.getSharedDocument()) || getStore();
      }
      store = store || getStore();
      if (!opts.keepUpdatedAt) store.updatedAt = now();
      store.version = VERSION;
      store.deletedProjects = normalizeTombstones(store.deletedProjects);
      store.deletedProductions = normalizeTombstones(store.deletedProductions);
      store.calendar = normalizeCalendar(store.calendar);
      (store.projects || []).forEach(function (p) {
        (p.productions || []).forEach(ensureWorkspace);
      });
      if (ctx && ctx.setSharedDocument) ctx.setSharedDocument(store);
      if (global.S) global.S.studio = store;
      /* Never write shared docs into scout_studio / personal prefs */
      if (!opts.silent) {
        if (ctx && ctx.markSharedDirty) ctx.markSharedDirty();
        if (ctx && ctx.scheduleSave) ctx.scheduleSave();
      }
      return store;
    }
    return savePersonalStore(store, opts);
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
            : olderWs.references && olderWs.references.pinterest) || [],
          other: (newerWs.references && newerWs.references.other && newerWs.references.other.length
            ? newerWs.references.other
            : olderWs.references && olderWs.references.other) || [],
          trending: (newerWs.references && newerWs.references.trending && newerWs.references.trending.length
            ? newerWs.references.trending
            : olderWs.references && olderWs.references.trending) || []
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
        deletedProductions: deletedProductions,
        calendar: mergeCalendars(local.calendar, cloud.calendar)
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
        deletedProductions: deletedProductions,
        calendar: mergeCalendars(local.calendar, cloud.calendar)
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
      deletedProductions: deletedProductions,
      calendar: mergeCalendars(local.calendar, cloud.calendar)
    };
  }

  function hydrateFromPrefs(prefs) {
    if (!prefs || !prefs.studio || !Array.isArray(prefs.studio.projects)) {
      return isSharedActive() ? getStore() : getPersonalStore();
    }
    var local = hasPersistedStore() ? getPersonalStore() : emptyStore();
    var merged = mergeStudioStores(local, prefs.studio);
    savePersonalStore(merged, { silent: true, keepUpdatedAt: true });
    if (!isSharedActive() && global.S) global.S.studio = merged;
    return isSharedActive() ? getStore() : merged;
  }

  function applyCloudStudio(cloudStudio) {
    if (!cloudStudio || typeof cloudStudio !== 'object') {
      return isSharedActive() ? getStore() : getPersonalStore();
    }
    var local = hasPersistedStore() ? getPersonalStore() : emptyStore();
    var merged = mergeStudioStores(local, cloudStudio);
    savePersonalStore(merged, { silent: true, keepUpdatedAt: true });
    if (!isSharedActive() && global.S) global.S.studio = merged;
    return isSharedActive() ? getStore() : merged;
  }

  function exportForSync() {
    /* Always personal Studio for /api/sync — never shared workspace document */
    var store = getPersonalStore();
    /* Slim cover images / inline asset blobs for sync payload size */
    try {
      var slim = JSON.parse(JSON.stringify(store));
      (slim.projects || []).forEach(function (p) {
        if (typeof p.coverImage === 'string' && p.coverImage.length > 180000) p.coverImage = null;
        (p.productions || []).forEach(function (prod) {
          if (typeof prod.coverImage === 'string' && prod.coverImage.length > 180000) {
            prod.coverImage = null;
          }
          var ws = prod.workspace;
          if (!ws) return;
          (ws.assets || []).forEach(function (a) {
            if (typeof a.src === 'string' && a.src.length > 120000) {
              if (a.storagePath) a.src = null;
              else a.src = a.src.slice(0, 0) || null;
            }
            if (typeof a.url === 'string' && a.url.indexOf('data:') === 0 && a.url.length > 120000) {
              if (a.storagePath) a.url = null;
            }
            if (typeof a.thumbnail === 'string' && a.thumbnail.length > 80000) a.thumbnail = null;
          });
          var refs = ws.references || {};
          ['youtube', 'capcut', 'uploads', 'other', 'pinterest'].forEach(function (k) {
            (refs[k] || []).forEach(function (r) {
              if (typeof r.thumbnail === 'string' && r.thumbnail.indexOf('data:') === 0 && r.thumbnail.length > 40000) {
                r.thumbnail = null;
              }
            });
          });
          /* Drop research cache from sync payload (re-fetchable) */
          if (refs._cache) delete refs._cache;
        });
      });
      return slim;
    } catch (e) {
      return store;
    }
  }

  function exportForWorkspaceSync() {
    /* Active shared (or personal) document for workspace-sync — same slim rules */
    var store = getStore();
    try {
      var slim = JSON.parse(JSON.stringify(store));
      (slim.projects || []).forEach(function (p) {
        if (typeof p.coverImage === 'string' && p.coverImage.length > 180000) p.coverImage = null;
        (p.productions || []).forEach(function (prod) {
          if (typeof prod.coverImage === 'string' && prod.coverImage.length > 180000) {
            prod.coverImage = null;
          }
          var ws = prod.workspace;
          if (!ws) return;
          (ws.assets || []).forEach(function (a) {
            if (typeof a.src === 'string' && a.src.length > 120000) {
              if (a.storagePath) a.src = null;
              else a.src = null;
            }
            if (typeof a.url === 'string' && a.url.indexOf('data:') === 0 && a.url.length > 120000) {
              if (a.storagePath) a.url = null;
            }
            if (typeof a.thumbnail === 'string' && a.thumbnail.length > 80000) a.thumbnail = null;
          });
          if (ws.references && ws.references._cache) ws.references._cache = {};
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
    var workspace = seedWorkspaceFromIdea(idea, sceneInfo, Object.assign({}, meta, { includeStarterShots: false }));
    return {
      name: String(idea.title || 'Untitled Production').trim(),
      notes: [idea.hook ? 'Hook (idea, not script): ' + idea.hook : '', idea.shotAngle || '', meta.notes || '']
        .filter(Boolean)
        .join('\n'),
      status: 'planning',
      source: meta.source || 'idea',
      ideaSnapshot: ideaSnapshotFromIdea(idea),
      scanRef: scanRefFromScene(sceneInfo),
      coverImage: meta.coverImage || null,
      workspace: workspace
    };
  }

  function attachIdeaToProduction(productionId, idea, sceneInfo, meta) {
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return null;
    idea = idea || {};
    sceneInfo = sceneInfo || {};
    meta = meta || {};
    var prod = ensureWorkspace(found.production);
    prod.ideaSnapshot = ideaSnapshotFromIdea(idea);
    prod.scanRef = scanRefFromScene(sceneInfo);
    if (meta.coverImage && !prod.coverImage) prod.coverImage = meta.coverImage;
    if (!found.project.coverImage && prod.coverImage) found.project.coverImage = prod.coverImage;
    if (meta.coverImage) {
      var assets = prod.workspace.assets || [];
      var already = assets.some(function (a) {
        return a && (a.src === meta.coverImage || a.kind === 'scan');
      });
      if (!already) {
        assets.unshift(
          createAsset({
            type: 'image',
            kind: 'scan',
            name: 'Original scan',
            src: meta.coverImage,
            note: sceneInfo.label || sceneInfo.mainSubject || ''
          })
        );
        prod.workspace.assets = assets.slice(0, 60);
      }
    }
    var ov = prod.workspace.overview || {};
    if (!ov.summary) {
      ov.summary = [idea.title, idea.hook].filter(Boolean).join(' — ').slice(0, 280);
    }
    if (!ov.format && idea.category) ov.format = idea.category;
    prod.workspace.overview = ov;
    prod.source = prod.source || 'idea';
    prod.updatedAt = now();
    found.project.updatedAt = now();
    store.continueProductionId = prod.id;
    pushTimeline(prod, 'idea', 'Idea imported from scan');
    saveStore(store);
    return { project: found.project, production: prod };
  }

  /**
   * Import a scan idea into an exact project/production.
   * Never creates a duplicate production when productionId is provided.
   */
  function importIdeaIntoStudio(opts) {
    opts = opts || {};
    var idea = opts.idea || {};
    var sceneInfo = opts.sceneInfo || {};
    var meta = opts.meta || {};
    var store = getStore();

    if (opts.productionId) {
      var found = findProduction(store, opts.productionId);
      if (!found) return { ok: false, error: 'production_not_found' };
      if (opts.projectId && found.project.id !== opts.projectId) {
        return { ok: false, error: 'production_not_in_project' };
      }
      var attached = attachIdeaToProduction(opts.productionId, idea, sceneInfo, meta);
      if (!attached) return { ok: false, error: 'attach_failed' };
      return {
        ok: true,
        project: attached.project,
        production: attached.production,
        createdProject: false,
        createdProduction: false
      };
    }

    var project = null;
    var createdProject = false;
    if (opts.projectId) {
      project = findProject(store, opts.projectId);
      if (!project) return { ok: false, error: 'project_not_found' };
    } else {
      var rawName = String(opts.newProjectName || suggestProjectName(idea, sceneInfo) || 'New Project').trim();
      project = createProject({ name: rawName, coverImage: meta.coverImage || null });
      createdProject = true;
    }

    var payload = productionFromIdea(idea, sceneInfo, meta);
    if (opts.newProductionName) {
      payload.name = String(opts.newProductionName).trim() || payload.name;
    }
    var created = createProduction(project.id, payload);
    if (!created) return { ok: false, error: 'create_failed' };
    return {
      ok: true,
      project: created.project,
      production: created.production,
      createdProject: createdProject,
      createdProduction: true
    };
  }

  function hasRealScript(ws, idea) {
    var text = getScriptPlainText(ws || {});
    if (!text) return false;
    var t = text.replace(/\s+/g, ' ').trim();
    if (t.length < 8) return false;
    if (/here.?s why this works/i.test(t)) return false;
    if (/come see for yourself/i.test(t) && t.length < 80) return false;
    idea = idea || {};
    var why = String(idea.whyItWorks || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (why && t === why) return false;
    if (why && t.indexOf(why) >= 0 && t.length < why.length + 40) return false;
    return true;
  }

  function inferShotPurpose(lineText, index, total) {
    var t = String(lineText || '').toLowerCase();
    if (index === 0 || /\bhook\b/.test(t)) return 'Hook';
    if (index === total - 1 || /\bcta\b|\bfollow\b|\bsubscribe\b/.test(t)) return 'CTA';
    if (/\bpayoff\b|\breveal\b|\baha\b/.test(t)) return 'Payoff';
    if (/\bvo\b|\bvoiceover\b|\bvoice-over\b/.test(t)) return 'Voiceover';
    return index === 1 ? 'Setup' : 'Beat ' + (index + 1);
  }

  function inferShotFraming(lineText, index) {
    var t = String(lineText || '').toLowerCase();
    if (/\bclose.?up\b|\bproduct\b|\bdetail\b/.test(t)) return 'Close-up';
    if (/\bwide\b|\bestablish\b|\bscene\b/.test(t)) return 'Wide';
    if (index === 0) return 'Medium close-up';
    return 'Medium shot';
  }

  function buildShotListFromScript(productionId, opts) {
    opts = opts || {};
    var store = getStore();
    var found = findProduction(store, productionId);
    if (!found) return { ok: false, error: 'not_found' };
    var prod = ensureWorkspace(found.production);
    var ws = prod.workspace;
    var idea = prod.ideaSnapshot || {};
    if (!hasRealScript(ws, idea) && !opts.allowStarter) {
      return { ok: false, error: 'no_script', message: 'Write or generate a script before building a shot list.' };
    }
    var lines = (ws.script && ws.script.lines) || [];
    if (!lines.length && ws.script && ws.script.body) {
      var applied = applyScriptPlainText(ws, ws.script.body, 'replace');
      ws = applied.workspace;
      lines = ws.script.lines || [];
    }
    var shots = [];
    if (lines.length) {
      lines.forEach(function (line, i) {
        var text = String(line.text || '').trim();
        var shot = createShot({
          order: i + 1,
          purpose: inferShotPurpose(text, i, lines.length),
          durationSec: Math.min(8, Math.max(2, Math.round(text.length / 28) || 3)),
          framing: inferShotFraming(text, i),
          cameraAngle: i === 0 ? 'Eye level' : '',
          cameraMovement: i === 0 ? 'Hold / micro push-in' : i === lines.length - 1 ? 'Hold' : 'Slow move or locked',
          lens: '',
          gear: ((global.S && global.S.gear && global.S.gear.camera) || '') + '',
          lighting: '',
          audio: text.slice(0, 180),
          notes: 'Covers script section ' + String(i + 1).padStart(2, '0'),
          beginnerTip: 'Match this shot to the linked script beat before you roll.',
          scriptLineId: line.id
        });
        line.shotId = shot.id;
        line.shotOrder = shot.order;
        shots.push(shot);
      });
    } else if (opts.allowStarter) {
      shots = starterShotListFromIdea(idea, prod.scanRef || {}, { coverImage: prod.coverImage });
    }
    ws.shotList = shots;
    pushTimeline(prod, 'shots', 'Shot list generated from script');
    var saved = updateProduction(productionId, { workspace: ws });
    return {
      ok: !!saved,
      production: saved && saved.production,
      result: { shotCount: shots.length },
      message: shots.length ? 'Shot list built from script' : 'No shots created'
    };
  }

  function buildWorkspaceFromIdea(productionId) {
    var found = findProduction(getStore(), productionId);
    if (!found) return null;
    var prod = ensureWorkspace(found.production);
    var idea = prod.ideaSnapshot || {};
    var scene = prod.scanRef || {};
    var seeded = seedWorkspaceFromIdea(idea, scene, { coverImage: prod.coverImage });
    var existing = prod.workspace || defaultWorkspace();
    seeded.overview = Object.assign({}, seeded.overview, {
      summary: (existing.overview && existing.overview.summary) || seeded.overview.summary,
      goal: (existing.overview && existing.overview.goal) || seeded.overview.goal,
      platform: (existing.overview && existing.overview.platform) || seeded.overview.platform,
      format:
        (existing.overview && existing.overview.format) ||
        seeded.overview.format ||
        idea.category ||
        ''
    });
    seeded.script =
      existing.script && ((existing.script.lines || []).length || existing.script.body)
        ? existing.script
        : { body: '', lines: [] };
    if (existing.shotList && existing.shotList.length) seeded.shotList = existing.shotList;
    if (existing.assets && existing.assets.length) {
      seeded.assets = existing.assets.concat(seeded.assets || []);
    }
    seeded.references = Object.assign({}, seeded.references, existing.references || {});
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
    rebuild_shot_list: { ready: true, phase: 5, mutates: true },
    update_script: { ready: true, phase: 5, mutates: true },
    add_reference: { ready: true, phase: 5, mutates: true },
    remove_reference: { ready: true, phase: 5, mutates: true },
    list_references: { ready: true, phase: 5, mutates: false },
    find_references: { ready: true, phase: 5, mutates: false },
    add_asset: { ready: true, phase: 5, mutates: true },
    remove_asset: { ready: true, phase: 5, mutates: true },
    open_production: { ready: true, phase: 5, mutates: false },
    find_projects: { ready: true, phase: 5, mutates: false },
    search_assets: { ready: true, phase: 5, mutates: false },
    organize_projects: { ready: true, phase: 5, mutates: false },
    link_scan: { ready: true, phase: 5, mutates: true },
    unlink_scan: { ready: true, phase: 5, mutates: true },
    delete_production: { ready: true, phase: 5, mutates: true }
  };

  function getScriptPlainText(ws) {
    ws = ws || {};
    var script = ws.script || {};
    if (script.lines && script.lines.length) {
      return script.lines
        .map(function (l) {
          return String(l.text || '').trim();
        })
        .filter(Boolean)
        .join('\n\n');
    }
    return String(script.body || '').trim();
  }

  function applyScriptPlainText(ws, text, mode) {
    ws = ws || defaultWorkspace();
    ws.script = ws.script || { body: '', lines: [] };
    var prev = getScriptPlainText(ws);
    var next = String(text || '').trim();
    mode = mode || 'replace';
    if (mode === 'append') {
      if (prev && next) {
        /* Avoid duplicating if model returned full script */
        if (next.indexOf(prev) === 0) next = next;
        else next = prev + (prev.slice(-1) === '\n' ? '\n' : '\n\n') + next;
      } else {
        next = prev || next;
      }
    } else if (mode === 'patch_ending') {
      if (prev && next && next.indexOf(prev) !== 0) {
        next = prev + (prev.slice(-1) === '\n' ? '\n' : '\n\n') + next;
      }
    } else if (mode === 'patch_hook') {
      var parts = prev ? prev.split(/\n\n+/) : [];
      var hookBlock = next;
      if (parts.length) {
        parts[0] = hookBlock;
        next = parts.join('\n\n');
      }
    }
    ws.script.body = next;
    var chunks = next
      ? next.split(/\n\n+/).map(function (t) {
          return t.trim();
        }).filter(Boolean)
      : [];
    if (!chunks.length && next) chunks = [next];
    var oldLines = Array.isArray(ws.script.lines) ? ws.script.lines : [];
    ws.script.lines = chunks.map(function (chunk, i) {
      var prevLine = oldLines[i];
      return createScriptLine({
        id: prevLine && prevLine.id ? prevLine.id : undefined,
        order: i + 1,
        text: chunk,
        shotId: prevLine && prevLine.shotId ? prevLine.shotId : null,
        shotOrder: prevLine && prevLine.shotOrder ? prevLine.shotOrder : i + 1,
        kind: prevLine && prevLine.kind ? prevLine.kind : ''
      });
    });
    return { previous: prev, next: next, workspace: ws };
  }

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
    if (action === 'generate_sections') return 'Fill missing production sections from the linked idea? Existing script will not be overwritten.';
    if (action === 'rebuild_shot_list')
      return 'Rebuild the shot list from the current script? Existing shots will be replaced (script stays).';
    if (action === 'link_scan') return 'Link the current scan to this production?';
    if (action === 'unlink_scan') return 'Unlink the scan from this production?';
    if (action === 'update_script') {
      var m = payload.mode || 'replace';
      if (m === 'replace') return 'Replace the entire script with Director’s draft?';
      if (m === 'append' || m === 'patch_ending') return 'Update current script (keep existing lines, add continuation)?';
      if (m === 'patch_hook') return 'Update the hook / opening of the current script?';
      return 'Update current script?';
    }
    if (action === 'add_reference') return 'Save this reference to the production?';
    if (action === 'remove_reference') return 'Remove this reference?';
    if (action === 'add_asset') return 'Add this asset to the production?';
    if (action === 'remove_asset') return 'Remove this asset?';
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
      if (action === 'rebuild_shot_list') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        var rebuilt = buildShotListFromScript(payload.productionId, { allowStarter: true });
        return {
          ok: !!rebuilt.ok,
          error: rebuilt.error,
          result: rebuilt.result,
          message: rebuilt.message || 'Shot list rebuilt',
          openSection: 'shots'
        };
      }
      if (action === 'update_script') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        if (!payload.body && !(payload.lines && payload.lines.length)) {
          return { ok: false, error: 'missing_fields', message: 'No script content to apply' };
        }
        var foundScript = findProduction(getStore(), payload.productionId);
        if (!foundScript) return { ok: false, error: 'not_found' };
        var prodScript = ensureWorkspace(foundScript.production);
        var modeScript = payload.mode || 'replace';
        var textIn =
          payload.body != null
            ? String(payload.body)
            : (payload.lines || [])
                .map(function (l) {
                  return typeof l === 'string' ? l : l && l.text;
                })
                .filter(Boolean)
                .join('\n\n');
        var applied = applyScriptPlainText(prodScript.workspace, textIn, modeScript);
        var saved = updateProduction(payload.productionId, { workspace: applied.workspace });
        return {
          ok: !!saved,
          result: {
            productionId: payload.productionId,
            mode: modeScript,
            previous: applied.previous,
            next: applied.next
          },
          message: modeScript === 'replace' ? 'Script replaced' : 'Script updated'
        };
      }
      if (action === 'add_reference') {
        if (!payload.productionId || (!payload.url && !payload.title)) {
          return { ok: false, error: 'missing_fields' };
        }
        var ar = addReference(payload.productionId, payload);
        return {
          ok: !!ar,
          result: ar && ar.reference,
          message: ar && ar.duplicate ? 'Already saved' : 'Reference saved',
          duplicate: !!(ar && ar.duplicate)
        };
      }
      if (action === 'remove_reference') {
        if (!payload.productionId || !payload.refId) return { ok: false, error: 'missing_fields' };
        var rr = removeReference(payload.productionId, payload.refId);
        return { ok: !!rr, result: rr && rr.reference, message: rr ? 'Reference removed' : 'Not found' };
      }
      if (action === 'list_references') {
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        var listed = listReferences(payload.productionId);
        return { ok: true, result: listed, message: listed.length ? listed.length + ' references' : 'No references yet' };
      }
      if (action === 'find_references') {
        /* Non-mutating: UI triggers research; returns current saved refs + cache hint */
        if (!payload.productionId) return { ok: false, error: 'missing_fields' };
        return {
          ok: true,
          result: {
            saved: listReferences(payload.productionId),
            platform: payload.platform || 'youtube',
            needsResearch: true
          },
          message: 'Open Assets & References to load fresh results.',
          openSection: 'refs'
        };
      }
      if (action === 'add_asset') {
        if (!payload.productionId || !payload.name) return { ok: false, error: 'missing_fields' };
        var aa = addAsset(payload.productionId, payload);
        return { ok: !!aa, result: aa && aa.asset };
      }
      if (action === 'remove_asset') {
        if (!payload.productionId || !payload.assetId) return { ok: false, error: 'missing_fields' };
        var ra = removeAsset(payload.productionId, payload.assetId);
        return { ok: !!ra, result: ra && ra.asset };
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

  function localCalDate() {
    var tz =
      global.PreShootEntitlements && PreShootEntitlements.tz ? PreShootEntitlements.tz() : 'UTC';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function pickCalendarStore(personal) {
    return personal ? getPersonalStore() : getStore();
  }

  function commitCalendarStore(store, personal) {
    if (personal) return savePersonalStore(store);
    return saveStore(store);
  }

  function listCalendarEvents(opts) {
    opts = opts || {};
    return normalizeCalendar(pickCalendarStore(opts.personal === true).calendar).events;
  }

  function upsertCalendarEvent(input, opts) {
    opts = opts || {};
    var personal = opts.personal === true;
    if (!personal && isSharedActive()) {
      var ctx = workspaceCtx();
      if (ctx && ctx.canEdit && !ctx.canEdit()) return { ok: false, error: 'read_only' };
    }
    var store = pickCalendarStore(personal);
    var nowTs = now();
    var incoming = Object.assign({}, input || {});
    if (!incoming.id) incoming.id = uid('cal');
    if (!incoming.createdAt) incoming.createdAt = nowTs;
    incoming.updatedAt = nowTs;
    if (!incoming.date) incoming.date = localCalDate();
    if (personal) incoming.workspaceId = null;
    else if (!incoming.workspaceId) incoming.workspaceId = activeWorkspaceId();
    var ev = normalizeCalendarEvent(incoming);
    if (!ev) return { ok: false, error: 'invalid_event' };
    var next = normalizeCalendar(store.calendar).events.filter(function (e) {
      return e.id !== ev.id;
    });
    next.push(ev);
    store.calendar = normalizeCalendar({ version: 1, events: next });
    commitCalendarStore(store, personal);
    return { ok: true, event: ev, calendar: store.calendar };
  }

  function removeCalendarEvent(eventId, opts) {
    opts = opts || {};
    var personal = opts.personal === true;
    if (!personal && isSharedActive()) {
      var ctx = workspaceCtx();
      if (ctx && ctx.canEdit && !ctx.canEdit()) return { ok: false, error: 'read_only' };
    }
    var store = pickCalendarStore(personal);
    var id = String(eventId || '');
    store.calendar = normalizeCalendar({
      version: 1,
      events: normalizeCalendar(store.calendar).events.filter(function (e) {
        return e.id !== id;
      })
    });
    commitCalendarStore(store, personal);
    return { ok: true, calendar: store.calendar };
  }

  function markCalendarPosted(eventId, opts) {
    opts = opts || {};
    var list = listCalendarEvents(opts);
    var found = null;
    list.forEach(function (e) {
      if (e.id === eventId) found = e;
    });
    if (!found) return { ok: false, error: 'not_found' };
    found.status = 'posted';
    found.completedAt = now();
    return upsertCalendarEvent(found, opts);
  }

  function listStudioLinkOptions() {
    var projects = listProjects();
    var productions = [];
    projects.forEach(function (p) {
      (p.productions || []).forEach(function (prod) {
        productions.push({
          id: prod.id,
          name: prod.name,
          status: prod.status,
          projectId: p.id,
          projectName: p.name
        });
      });
    });
    return { projects: projects, productions: productions };
  }


  global.PreShootStudio = {
    STATUSES: STATUSES,
    STATUS_MAP: STATUS_MAP,
    getStore: getStore,
    getPersonalStore: getPersonalStore,
    saveStore: saveStore,
    hydrateFromPrefs: hydrateFromPrefs,
    applyCloudStudio: applyCloudStudio,
    mergeStudioStores: mergeStudioStores,
    listCalendarEvents: listCalendarEvents,
    upsertCalendarEvent: upsertCalendarEvent,
    removeCalendarEvent: removeCalendarEvent,
    markCalendarPosted: markCalendarPosted,
    listStudioLinkOptions: listStudioLinkOptions,
    localCalDate: localCalDate,
    normalizeCalendar: normalizeCalendar,
    mergeCalendars: mergeCalendars,
    exportForSync: exportForSync,
    exportForWorkspaceSync: exportForWorkspaceSync,
    hasPersistedStore: hasPersistedStore,
    isDirty: isDirty,
    isPersonalDirty: isPersonalDirty,
    markDirty: markDirty,
    clearDirty: clearDirty,
    clearSharedDirtyFlag: clearSharedDirtyFlag,
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
    importIdeaIntoStudio: importIdeaIntoStudio,
    attachIdeaToProduction: attachIdeaToProduction,
    seedWorkspaceFromIdea: seedWorkspaceFromIdea,
    starterShotListFromIdea: starterShotListFromIdea,
    buildWorkspaceFromIdea: buildWorkspaceFromIdea,
    buildShotListFromScript: buildShotListFromScript,
    hasRealScript: hasRealScript,
    createShot: createShot,
    createScriptLine: createScriptLine,
    createRefItem: createRefItem,
    createAsset: createAsset,
    ASSET_FOLDERS: ASSET_FOLDERS,
    addReference: addReference,
    removeReference: removeReference,
    listReferences: listReferences,
    addAsset: addAsset,
    removeAsset: removeAsset,
    setAssetFolder: setAssetFolder,
    setResearchCache: setResearchCache,
    getResearchCache: getResearchCache,
    getSkillLevel: getSkillLevel,
    getScriptPlainText: getScriptPlainText,
    applyScriptPlainText: applyScriptPlainText,
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
