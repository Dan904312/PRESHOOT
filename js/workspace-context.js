/**
 * PreShoot Workspace Context — Phase 2 authoritative active-workspace state.
 * Personal Studio stays on /api/sync. Shared uses /api/workspace-sync.
 * Never mix persistence layers.
 */
(function (global) {
  'use strict';

  var ACTIVE_KEY = 'active_workspace_id';
  var SAVE_DEBOUNCE_MS = 1400;
  /* Recovery drafts: scout_ws_recovery_{userId}_{workspaceId} — never auto-applied */
  var RECOVERY_PREFIX = 'ws_recovery_';

  var state = {
    activeWorkspaceId: null,
    activeWorkspaceKind: 'personal',
    activeWorkspaceRole: 'owner',
    activeWorkspaceName: 'Personal',
    activeWorkspaceRevision: null,
    personalWorkspaceId: null,
    sharedDocument: null,
    sharedDirty: false,
    saving: false,
    switching: false,
    conflict: null,
    remoteUpdate: null /* { revision, updated_by, updated_at } when dirty */,
    lastLocalSave: null /* { workspaceId, revision, at } for loop prevention */,
    /* Authoritative shared save UX: saved|saving|dirty|conflict|error|offline */
    saveStatus: 'saved',
    saveError: null,
    lastActivity: null /* { revision, updated_by, updated_at, name, change } */,
    versionPreview: null /* view-only snapshot; does not mutate active doc */,
    pendingRecovery: null /* { workspaceId, document, revision, savedAt } prompt */,
    pendingChangeHint: null /* optional client hint; server re-validates */,
    presence: [], /* ephemeral collaborators from realtime presence */
    recentActivity: [], /* last fetched version/activity rows for Director/UI */
    commentCache: {}, /* productionId → { comments, summary, at, caps } */
    commentFeedback: [], /* compact unresolved for Director */
    unreadNotifications: 0,
    notifyQueue: [], /* for grouping rapid remote toasts */
    list: [],
    listLoadedAt: 0
  };

  var _notifyTimer = null;
  var _lastNotifyKey = '';
  var _lastNotifyAt = 0;

  var _saveTimer = null;
  var _switchToken = 0;
  var _fetchToken = 0;
  var _fetching = false;

  function API() {
    return global.PreShootWorkspaces;
  }

  function Studio() {
    return global.PreShootStudio;
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function ss(k, v) {
    if (typeof global.ss === 'function') return global.ss(k, v);
    try {
      localStorage.setItem('scout_' + k, JSON.stringify(v));
    } catch (e) {}
  }

  function gs(k, fallback) {
    if (typeof global.gs === 'function') return global.gs(k, fallback);
    try {
      var v = localStorage.getItem('scout_' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function syncToS() {
    if (!global.S) return;
    global.S.activeWorkspaceId = state.activeWorkspaceId;
    global.S.activeWorkspaceKind = state.activeWorkspaceKind;
    global.S.activeWorkspaceRole = state.activeWorkspaceRole;
    global.S.activeWorkspaceName = state.activeWorkspaceName;
    global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
    global.S.studioReadOnly = isShared() && !canEdit();
    global.S.workspaceRemoteUpdate = state.remoteUpdate;
    global.S.workspaceSaveStatus = isShared() ? state.saveStatus : null;
    global.S.workspaceLastActivity = state.lastActivity;
    global.S.workspaceVersionPreview = state.versionPreview;
  }

  function setSaveStatus(status, err) {
    if (!isShared()) {
      state.saveStatus = 'saved';
      state.saveError = null;
      return;
    }
    state.saveStatus = status || 'saved';
    state.saveError = err || null;
    syncToS();
    if (global.PreShootWorkspaceUI && typeof global.PreShootWorkspaceUI.onSaveStatus === 'function') {
      global.PreShootWorkspaceUI.onSaveStatus(state.saveStatus, state.saveError);
    }
  }

  function recoveryKey(workspaceId) {
    var uid = global.S && global.S.authUser && global.S.authUser.id;
    if (!uid || !workspaceId) return null;
    return RECOVERY_PREFIX + uid + '_' + workspaceId;
  }

  function writeRecoveryDraft(documentOverride) {
    if (!isShared() || !canEdit()) return;
    var key = recoveryKey(state.activeWorkspaceId);
    if (!key) return;
    try {
      ss(key, {
        workspaceId: state.activeWorkspaceId,
        revision: state.activeWorkspaceRevision,
        document: documentOverride
          ? normalizeDocument(documentOverride)
          : exportSharedDocument(),
        savedAt: Date.now()
      });
    } catch (e) {}
  }

  function clearRecoveryDraft(workspaceId) {
    var key = recoveryKey(workspaceId || state.activeWorkspaceId);
    if (!key) return;
    try {
      if (typeof global.ss === 'function') {
        /* ss stores JSON; clear by writing null */
        ss(key, null);
      }
      localStorage.removeItem('scout_' + key);
    } catch (e) {}
  }

  function readRecoveryDraft(workspaceId) {
    var key = recoveryKey(workspaceId);
    if (!key) return null;
    var raw = gs(key, null);
    if (!raw || typeof raw !== 'object' || !raw.document) return null;
    if (raw.workspaceId && raw.workspaceId !== workspaceId) return null;
    return raw;
  }

  function checkPendingRecovery(workspaceId) {
    var draft = readRecoveryDraft(workspaceId);
    if (!draft) {
      state.pendingRecovery = null;
      return null;
    }
    state.pendingRecovery = {
      workspaceId: workspaceId,
      document: draft.document,
      revision: draft.revision,
      savedAt: draft.savedAt
    };
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showRecoveryPrompt) {
      global.PreShootWorkspaceUI.showRecoveryPrompt(state.pendingRecovery);
    }
    return state.pendingRecovery;
  }

  function recoverPendingDraft() {
    if (!state.pendingRecovery || !isShared()) return { ok: false };
    if (state.pendingRecovery.workspaceId !== state.activeWorkspaceId) return { ok: false };
    var doc = normalizeDocument(state.pendingRecovery.document);
    state.sharedDocument = doc;
    if (global.S) global.S.studio = doc;
    state.sharedDirty = true;
    setSaveStatus('dirty');
    state.pendingRecovery = null;
    clearRecoveryDraft(state.activeWorkspaceId);
    writeRecoveryDraft();
    refreshStudioUI();
    toast('Recovered unsaved changes from your previous session');
    return { ok: true };
  }

  function discardPendingRecovery() {
    if (!state.pendingRecovery) return { ok: false };
    var wid = state.pendingRecovery.workspaceId;
    state.pendingRecovery = null;
    clearRecoveryDraft(wid);
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.hideRecoveryPrompt) {
      global.PreShootWorkspaceUI.hideRecoveryPrompt();
    }
    toast('Discarded previous unsaved changes');
    return { ok: true };
  }

  function RT() {
    return global.PreShootWorkspaceRealtime || null;
  }

  function stopRealtime() {
    var rt = RT();
    if (rt && rt.unsubscribe) return rt.unsubscribe();
    return Promise.resolve();
  }

  function startRealtime(workspaceId, opts) {
    opts = opts || {};
    var rt = RT();
    if (!rt || !rt.subscribe || !workspaceId) return Promise.resolve({ ok: false });
    return rt.subscribe(workspaceId, opts).then(function (res) {
      if (opts.reconcile && res && res.ok) onRealtimeReconnected(workspaceId);
      return res;
    });
  }

  function onRealtimeReconnected(workspaceId) {
    if (!isShared() || state.activeWorkspaceId !== workspaceId) return;
    if (state.sharedDirty || state.conflict) return;
    fetchAndApplyRemote('reconnect');
  }

  function isShared() {
    return state.activeWorkspaceKind === 'shared' && !!state.activeWorkspaceId;
  }

  function canEdit() {
    if (!isShared()) return true;
    var api = API();
    if (api && api.canEditRole) return api.canEditRole(state.activeWorkspaceRole);
    return state.activeWorkspaceRole === 'owner' || state.activeWorkspaceRole === 'editor';
  }

  function canManageMembers() {
    if (!isShared()) return false;
    var api = API();
    if (api && api.canManageMembersRole) return api.canManageMembersRole(state.activeWorkspaceRole);
    return state.activeWorkspaceRole === 'owner';
  }

  function getSharedDocument() {
    return state.sharedDocument;
  }

  function setSharedDocument(doc, revision) {
    state.sharedDocument = doc;
    if (revision != null && Number.isFinite(Number(revision))) {
      state.activeWorkspaceRevision = Number(revision);
    }
    if (global.S) global.S.studio = doc;
    syncToS();
  }

  function isSharedDirty() {
    return !!state.sharedDirty;
  }

  function markSharedDirty(changeHint) {
    if (!canEdit()) return;
    state.sharedDirty = true;
    if (changeHint && typeof changeHint === 'object') {
      state.pendingChangeHint = changeHint;
    }
    if (state.saveStatus !== 'conflict') setSaveStatus('dirty');
    writeRecoveryDraft();
    if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
      PreShootWorkspaceRealtime.scheduleTrack();
    }
  }

  function setPendingChangeHint(hint) {
    state.pendingChangeHint = hint && typeof hint === 'object' ? hint : null;
  }

  function getEditingContext() {
    if (global.PreShootWorkspaceChanges && PreShootWorkspaceChanges.editingContextFromStudio) {
      return PreShootWorkspaceChanges.editingContextFromStudio();
    }
    var view = global.S && global.S.studioView;
    return {
      activeProjectId: (view && view.projectId) || null,
      activeProductionId: (view && view.productionId) || null,
      activeEntity: null
    };
  }

  function clearSharedDirty() {
    state.sharedDirty = false;
  }

  function getContext() {
    return {
      activeWorkspaceId: state.activeWorkspaceId,
      activeWorkspaceKind: state.activeWorkspaceKind,
      activeWorkspaceRole: state.activeWorkspaceRole,
      activeWorkspaceName: state.activeWorkspaceName,
      activeWorkspaceRevision: state.activeWorkspaceRevision,
      personalWorkspaceId: state.personalWorkspaceId,
      canEdit: canEdit(),
      canManageMembers: canManageMembers(),
      isShared: isShared(),
      sharedDirty: state.sharedDirty,
      switching: state.switching,
      conflict: state.conflict,
      remoteUpdate: state.remoteUpdate,
      saveStatus: state.saveStatus,
      saveError: state.saveError,
      lastActivity: state.lastActivity,
      versionPreview: state.versionPreview,
      pendingRecovery: state.pendingRecovery,
      pendingChangeHint: state.pendingChangeHint,
      editingContext: getEditingContext(),
      presence: state.presence.slice(),
      recentActivity: state.recentActivity.slice(),
      commentCache: state.commentCache,
      commentFeedback: state.commentFeedback.slice(),
      unreadNotifications: state.unreadNotifications,
      list: state.list.slice()
    };
  }

  function normalizeDocument(doc) {
    if (!doc || typeof doc !== 'object') {
      return {
        version: 3,
        projects: [],
        continueProductionId: null,
        updatedAt: 0,
        deletedProjects: {},
        deletedProductions: {}
      };
    }
    if (!Array.isArray(doc.projects)) doc.projects = [];
    if (!doc.deletedProjects || typeof doc.deletedProjects !== 'object') doc.deletedProjects = {};
    if (!doc.deletedProductions || typeof doc.deletedProductions !== 'object') {
      doc.deletedProductions = {};
    }
    doc.version = 3;
    return doc;
  }

  function clearStudioView() {
    if (global.S) {
      global.S.studioView = { mode: 'list' };
      global.S.activeProductionId = null;
      global.__preshootDirectorProduction = null;
    }
  }

  function refreshStudioUI() {
    try {
      if (global.PreShootStudioUI && typeof global.PreShootStudioUI.renderStudio === 'function') {
        if (!global.S || global.S.tab === 'studio') global.PreShootStudioUI.renderStudio();
      }
      if (global.PreShootWorkspaceUI && typeof global.PreShootWorkspaceUI.refreshChrome === 'function') {
        global.PreShootWorkspaceUI.refreshChrome();
      }
      if (global.PreShootWorkspaceUI && typeof global.PreShootWorkspaceUI.syncRemoteBanner === 'function') {
        global.PreShootWorkspaceUI.syncRemoteBanner(state.remoteUpdate);
      }
    } catch (e) {}
  }

  function clearRemoteUpdateState() {
    state.remoteUpdate = null;
    if (global.S) global.S.workspaceRemoteUpdate = null;
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.hideRemoteBanner) {
      global.PreShootWorkspaceUI.hideRemoteBanner();
    }
  }

  /**
   * After a remote document replace, keep the user on a valid project/production
   * when possible; otherwise move to the nearest safe view.
   */
  function repairStudioView(prevView) {
    if (!global.S) return { repaired: false };
    var view = prevView || global.S.studioView || { mode: 'list' };
    var doc = state.sharedDocument || global.S.studio;
    var projects = (doc && doc.projects) || [];

    function findProject(id) {
      for (var i = 0; i < projects.length; i++) {
        if (projects[i] && projects[i].id === id) return projects[i];
      }
      return null;
    }

    function findProduction(id) {
      for (var i = 0; i < projects.length; i++) {
        var prods = (projects[i] && projects[i].productions) || [];
        for (var j = 0; j < prods.length; j++) {
          if (prods[j] && prods[j].id === id) {
            return { project: projects[i], production: prods[j] };
          }
        }
      }
      return null;
    }

    if (view.mode === 'production' && view.productionId) {
      var hit = findProduction(view.productionId);
      if (hit) {
        global.S.studioView = {
          mode: 'production',
          projectId: hit.project.id,
          productionId: hit.production.id,
          section: view.section || 'overview'
        };
        global.S.activeProductionId = hit.production.id;
        return { repaired: false, mode: 'production' };
      }
      if (view.projectId && findProject(view.projectId)) {
        global.S.studioView = { mode: 'project', projectId: view.projectId };
        global.S.activeProductionId = null;
        return { repaired: true, mode: 'project', reason: 'production_deleted' };
      }
      global.S.studioView = { mode: 'list' };
      global.S.activeProductionId = null;
      return { repaired: true, mode: 'list', reason: 'production_deleted' };
    }

    if (view.mode === 'project' && view.projectId) {
      if (findProject(view.projectId)) {
        global.S.studioView = { mode: 'project', projectId: view.projectId };
        return { repaired: false, mode: 'project' };
      }
      global.S.studioView = { mode: 'list' };
      global.S.activeProductionId = null;
      return { repaired: true, mode: 'list', reason: 'project_deleted' };
    }

    global.S.studioView = { mode: 'list' };
    return { repaired: false, mode: 'list' };
  }

  function applyReadOnlyClass() {
    var root = document.getElementById('studio-root');
    if (!root) return;
    if (isShared() && !canEdit()) root.classList.add('studio-readonly');
    else root.classList.remove('studio-readonly');
  }

  function setPersonalMode(personalMeta) {
    stopRealtime();
    clearTimeout(_saveTimer);
    _saveTimer = null;
    state.activeWorkspaceKind = 'personal';
    state.activeWorkspaceRole = 'owner';
    state.activeWorkspaceName =
      (personalMeta && personalMeta.name) || 'Personal';
    state.activeWorkspaceId =
      (personalMeta && personalMeta.id) || state.personalWorkspaceId || null;
    state.personalWorkspaceId = state.activeWorkspaceId;
    state.activeWorkspaceRevision = null;
    state.sharedDocument = null;
    state.sharedDirty = false;
    state.conflict = null;
    state.saveStatus = 'saved';
    state.saveError = null;
    state.lastActivity = null;
    state.versionPreview = null;
    state.pendingRecovery = null;
    state.presence = [];
    state.recentActivity = [];
    state.commentCache = {};
    state.commentFeedback = [];
    state.unreadNotifications = 0;
    state.notifyQueue = [];
    clearRemoteUpdateState();
    state.lastLocalSave = null;
    ss(ACTIVE_KEY, 'personal');
    syncToS();
    applyReadOnlyClass();
  }

  function setSharedMode(meta, document, revision, activity) {
    state.activeWorkspaceKind = 'shared';
    state.activeWorkspaceId = meta.id;
    state.activeWorkspaceName = meta.name || 'Workspace';
    state.activeWorkspaceRole = meta.role || 'viewer';
    state.activeWorkspaceRevision = Number(revision) || 1;
    state.sharedDocument = normalizeDocument(document);
    state.sharedDirty = false;
    state.conflict = null;
    state.saveStatus = 'saved';
    state.saveError = null;
    state.versionPreview = null;
    state.lastActivity = activity || {
      revision: state.activeWorkspaceRevision,
      updated_by: (activity && activity.updated_by) || null,
      updated_at: (activity && activity.updated_at) || null,
      name: (activity && activity.name) || null
    };
    state.notifyQueue = [];
    clearRemoteUpdateState();
    ss(ACTIVE_KEY, meta.id);
    if (global.S) global.S.studio = state.sharedDocument;
    syncToS();
    applyReadOnlyClass();
    startRealtime(meta.id);
    /* Never auto-apply recovery — prompt only */
    checkPendingRecovery(meta.id);
    refreshActivity(meta.id);
    refreshNotifications();
  }

  function onPresenceChanged(list) {
    if (!isShared()) {
      state.presence = [];
      return;
    }
    state.presence = Array.isArray(list) ? list.slice() : [];
    if (global.S) global.S.workspacePresence = state.presence.slice();
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.refreshPresence) {
      global.PreShootWorkspaceUI.refreshPresence(state.presence);
    }
  }

  function refreshActivity(workspaceId) {
    var api = API();
    var id = workspaceId || state.activeWorkspaceId;
    if (!api || !id || !isShared()) {
      state.recentActivity = [];
      return Promise.resolve({ ok: false });
    }
    var versionsP = api.listVersions(id);
    var commentsP = api.listCommentActivity
      ? api.listCommentActivity(id, { limit: 20 })
      : Promise.resolve({ ok: false });
    return Promise.all([versionsP, commentsP]).then(function (pair) {
      if (!isShared() || state.activeWorkspaceId !== id) return { ok: false, stale: true };
      var res = pair[0];
      var cres = pair[1];
      var versions = res && res.ok ? (res.versions || []).slice(0, 30) : [];
      var comments = cres && cres.ok ? cres.activity || [] : [];
      var merged = versions
        .concat(comments)
        .sort(function (a, b) {
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        })
        .slice(0, 40);
      state.recentActivity = merged;
      return { ok: true, versions: merged };
    });
  }

  function loadProductionComments(productionId, force) {
    var api = API();
    var id = state.activeWorkspaceId;
    if (!api || !id || !isShared() || !productionId) {
      return Promise.resolve({ ok: false });
    }
    var cached = state.commentCache[productionId];
    if (!force && cached && Date.now() - (cached.at || 0) < 15000) {
      return Promise.resolve({ ok: true, cached: true, comments: cached.comments, summary: cached.summary, caps: cached.caps });
    }
    return Promise.all([
      api.listComments(id, { productionId: productionId, limit: 100 }),
      api.getProductionReview ? api.getProductionReview(id, productionId) : Promise.resolve({ ok: false })
    ]).then(function (pair) {
      if (!isShared() || state.activeWorkspaceId !== id) return { ok: false, stale: true };
      var listed = pair[0];
      var summary = pair[1];
      if (!listed || !listed.ok) return listed || { ok: false };
      var caps = {
        canComment: !!listed.canComment,
        canResolve: !!listed.canResolve,
        canModerate: !!listed.canModerate,
        role: listed.role
      };
      state.commentCache[productionId] = {
        comments: listed.comments || [],
        summary: summary && summary.ok ? summary : null,
        caps: caps,
        at: Date.now()
      };
      state.commentFeedback = ((summary && summary.unresolved) || [])
        .slice(0, 8)
        .map(function (c) {
          return {
            id: c.id,
            target_type: c.target_type,
            body: c.body,
            author_name: c.author_name
          };
        });
      syncToS();
      return {
        ok: true,
        comments: listed.comments || [],
        summary: summary && summary.ok ? summary : null,
        caps: caps
      };
    });
  }

  function invalidateCommentCache(productionId) {
    if (productionId) delete state.commentCache[productionId];
    else state.commentCache = {};
  }

  function onRemoteCommentEvent(evt) {
    if (!isShared() || !evt) return;
    if (evt.workspace_id && evt.workspace_id !== state.activeWorkspaceId) return;
    var pid = evt.production_id;
    if (pid) invalidateCommentCache(pid);
    else invalidateCommentCache();
    refreshActivity(state.activeWorkspaceId);
    if (global.PreShootWorkspaceComments && PreShootWorkspaceComments.onRemoteEvent) {
      PreShootWorkspaceComments.onRemoteEvent(evt);
    }
    /* Soft toast for others' comments — avoid spam */
    var me = global.S && global.S.authUser && global.S.authUser.id;
    if (evt.author_id && me && evt.author_id === me) return;
    if (evt.type === 'comment.created' || evt.type === 'comment.replied') {
      toast('New comment in workspace');
    } else if (evt.type === 'comment.resolved') {
      toast('A comment was resolved');
    }
  }

  function refreshNotifications() {
    var api = API();
    var id = state.activeWorkspaceId;
    if (!api || !id || !isShared() || !api.listNotifications) {
      state.unreadNotifications = 0;
      return Promise.resolve({ ok: false });
    }
    return api.listNotifications(id, { unreadOnly: true, limit: 20 }).then(function (res) {
      if (!isShared() || state.activeWorkspaceId !== id) return { ok: false };
      state.unreadNotifications = res && res.ok ? (res.notifications || []).length : 0;
      syncToS();
      if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.refreshChrome) {
        PreShootWorkspaceUI.refreshChrome();
      }
      return res;
    });
  }

  function presenceOnProduction(productionId) {
    if (!productionId) return [];
    var pid = String(productionId);
    var me = global.S && global.S.authUser && global.S.authUser.id;
    return state.presence.filter(function (p) {
      return (
        p &&
        p.activeProductionId &&
        String(p.activeProductionId) === pid &&
        (!me || p.userId !== me)
      );
    });
  }

  function queueRemoteNotification(info) {
    if (!info) return;
    var change = info.change;
    var label =
      info.activity_label ||
      (change &&
        global.PreShootWorkspaceChanges &&
        PreShootWorkspaceChanges.changeTypeLabel &&
        PreShootWorkspaceChanges.changeTypeLabel(change.type)) ||
      'Workspace updated';
    var entity = (change && (change.entityLabel || change.entity_label)) || '';
    var key =
      (change && change.type) +
      '|' +
      ((change && change.productionId) || '') +
      '|' +
      info.revision;
    state.notifyQueue.push({
      key: key,
      sameEntity: !!info.sameEntity,
      label: label,
      entity: entity,
      revision: info.revision,
      at: Date.now()
    });
    if (_notifyTimer) clearTimeout(_notifyTimer);
    _notifyTimer = setTimeout(flushRemoteNotifications, 700);
  }

  function flushRemoteNotifications() {
    _notifyTimer = null;
    if (!state.notifyQueue.length) return;
    var items = state.notifyQueue.slice();
    state.notifyQueue = [];
    var same = items.filter(function (i) {
      return i.sameEntity;
    });
    var other = items.filter(function (i) {
      return !i.sameEntity;
    });

    if (same.length) {
      var s = same[same.length - 1];
      var msg =
        s.entity
          ? 'Production updated — "' + s.entity + '"'
          : 'This production was updated by a collaborator';
      if (state.sharedDirty) {
        msg =
          'A collaborator updated this production while you have unsaved changes.';
      }
      /* Same-entity: banner already covers Review; toast once */
      var nkey = 'same|' + s.revision;
      if (nkey !== _lastNotifyKey || Date.now() - _lastNotifyAt > 8000) {
        _lastNotifyKey = nkey;
        _lastNotifyAt = Date.now();
        toast(msg);
      }
    } else if (other.length) {
      var o = other[other.length - 1];
      var okey = 'other|' + o.key;
      if (okey === _lastNotifyKey && Date.now() - _lastNotifyAt < 5000) return;
      _lastNotifyKey = okey;
      _lastNotifyAt = Date.now();
      if (other.length >= 3) {
        toast('Collaborators made ' + other.length + ' updates');
      } else {
        toast(
          o.label + (o.entity ? ' — "' + o.entity + '"' : '')
        );
      }
    }
  }

  function loadPersonalIntoStudio() {
    var st = Studio();
    if (!st) return;
    var personal = st.getPersonalStore ? st.getPersonalStore() : st.getStore();
    if (global.S) global.S.studio = personal;
    clearStudioView();
  }

  function refreshList(force) {
    var api = API();
    if (!api || !global.S || !global.S.authUser) {
      return Promise.resolve({ ok: false, workspaces: [] });
    }
    if (!force && state.listLoadedAt && Date.now() - state.listLoadedAt < 8000) {
      return Promise.resolve({ ok: true, workspaces: state.list.slice() });
    }
    return api.listWorkspaces().then(function (res) {
      if (res && res.ok) {
        state.list = res.workspaces || [];
        state.listLoadedAt = Date.now();
        var personal = state.list.filter(function (w) {
          return w.kind === 'personal';
        })[0];
        if (personal) state.personalWorkspaceId = personal.id;
      }
      return res;
    });
  }

  function exportSharedDocument() {
    var st = Studio();
    if (st && typeof st.exportForWorkspaceSync === 'function') {
      return st.exportForWorkspaceSync();
    }
    return normalizeDocument(state.sharedDocument || (global.S && global.S.studio));
  }

  function scheduleSave() {
    if (!isShared() || !canEdit()) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function waitForSaveIdle(maxMs) {
    maxMs = maxMs || 8000;
    var started = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        if (!state.saving) return resolve({ ok: true });
        if (Date.now() - started > maxMs) return resolve({ ok: false, error: 'save_busy_timeout' });
        setTimeout(tick, 40);
      }
      tick();
    });
  }

  function saveNow() {
    if (!isShared() || !canEdit()) return Promise.resolve({ ok: false, skipped: true });
    if (state.saving) return Promise.resolve({ ok: false, busy: true });
    if (!state.sharedDirty && !state.conflict) {
      return Promise.resolve({ ok: true, skipped: true });
    }
    var api = API();
    if (!api) return Promise.resolve({ ok: false, error: 'no_api' });
    var workspaceId = state.activeWorkspaceId;
    var revision = state.activeWorkspaceRevision;
    var beforeDoc = state.sharedDocument;
    var document = exportSharedDocument();
    var changeHint = state.pendingChangeHint;
    if (
      !changeHint &&
      global.PreShootWorkspaceChanges &&
      PreShootWorkspaceChanges.detectDocumentChanges
    ) {
      var detected = PreShootWorkspaceChanges.detectDocumentChanges(beforeDoc, document);
      changeHint = PreShootWorkspaceChanges.primaryChange(detected);
    }
    state.saving = true;
    setSaveStatus('saving');
    writeRecoveryDraft();
    return api.saveSharedWorkspace(workspaceId, document, revision, changeHint).then(function (res) {
      state.saving = false;
      if (res && res.ok) {
        state.activeWorkspaceRevision = res.revision;
        state.sharedDocument = normalizeDocument(res.document || document);
        state.sharedDirty = false;
        state.conflict = null;
        state.pendingChangeHint = null;
        clearRemoteUpdateState();
        clearRecoveryDraft(workspaceId);
        state.lastLocalSave = {
          workspaceId: workspaceId,
          revision: Number(res.revision) || revision,
          at: Date.now(),
          updated_by: (global.S && global.S.authUser && global.S.authUser.id) || null
        };
        state.lastActivity = {
          revision: Number(res.revision) || revision,
          updated_by: res.updated_by || state.lastLocalSave.updated_by,
          updated_at: res.updated_at || new Date().toISOString(),
          name: (global.S && global.S.profile && global.S.profile.name) || null,
          change: res.change || changeHint || null,
          activity_label: res.activity_label || null
        };
        setSaveStatus('saved');
        if (global.PreShootWorkspaceRealtime && PreShootWorkspaceRealtime.scheduleTrack) {
          PreShootWorkspaceRealtime.scheduleTrack();
        }
        refreshActivity(workspaceId);
        if (global.S) {
          global.S.studio = state.sharedDocument;
          global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
        }
        if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.onSaveOk) {
          global.PreShootWorkspaceUI.onSaveOk(res);
        }
        return res;
      }
      if (res && res.conflict) {
        state.conflict = {
          localDraft: res.localDraft || document,
          serverDocument: res.document,
          revision: res.revision,
          client_revision: res.client_revision != null ? res.client_revision : revision,
          updated_at: res.updated_at,
          updated_by: res.updated_by,
          change: res.change || null,
          message: res.message
        };
        setSaveStatus('conflict');
        writeRecoveryDraft();
        if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showConflict) {
          global.PreShootWorkspaceUI.showConflict(state.conflict);
        } else {
          toast('This workspace was updated by someone else.');
        }
        return res;
      }
      var offline =
        !!(res && res.offline) ||
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        (res && (res.error === 'network_error' || res.status === 0));
      setSaveStatus(offline ? 'offline' : 'error', {
        status: res && res.status,
        error: res && res.error,
        message: res && res.message
      });
      writeRecoveryDraft();
      toast(
        (res && res.message) ||
          (offline ? 'Offline — changes stored locally' : 'Could not save workspace')
      );
      return res;
    });
  }

  function shouldIgnoreRealtimeRevision(incomingRev, payload) {
    var local = state.lastLocalSave;
    if (!local || local.workspaceId !== state.activeWorkspaceId) return false;
    if (Number(incomingRev) === Number(local.revision)) return true;
    var me = global.S && global.S.authUser && global.S.authUser.id;
    if (me && payload && payload.updated_by === me && Date.now() - local.at < 8000) {
      if (Number(incomingRev) <= Number(local.revision)) return true;
    }
    return false;
  }

  function applyAuthoritativeRemote(loaded) {
    if (!loaded || !loaded.ok || !isShared()) return { ok: false };
    var loadedRev = Number(loaded.revision);
    var currentRev = Number(state.activeWorkspaceRevision) || 0;
    /* Never apply an older document over a newer local revision */
    if (Number.isFinite(loadedRev) && loadedRev > 0 && loadedRev < currentRev) {
      return { ok: false, error: 'stale_apply', revision: currentRev };
    }
    if (Number.isFinite(loadedRev) && loadedRev > 0 && loadedRev === currentRev && !state.remoteUpdate) {
      /* Same revision already applied */
      clearRemoteUpdateState();
      return { ok: true, revision: currentRev, skipped: true };
    }

    var prevView = global.S ? Object.assign({}, global.S.studioView || {}) : null;
    state.activeWorkspaceRevision = Number.isFinite(loadedRev) && loadedRev > 0 ? loadedRev : currentRev;
    state.sharedDocument = normalizeDocument(loaded.document);
    state.sharedDirty = false;
    state.conflict = null;
    state.lastActivity = {
      revision: state.activeWorkspaceRevision,
      updated_by: loaded.updated_by || null,
      updated_at: loaded.updated_at || null,
      name: null
    };
    setSaveStatus('saved');
    clearRemoteUpdateState();
    if (global.S) {
      global.S.studio = state.sharedDocument;
      global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
    }
    var repair = repairStudioView(prevView);
    refreshStudioUI();
    if (repair && repair.repaired && typeof global.showToast === 'function') {
      if (repair.reason === 'production_deleted') {
        toast('That production was removed by a collaborator');
      } else if (repair.reason === 'project_deleted') {
        toast('That project was removed by a collaborator');
      }
    }
    return { ok: true, revision: state.activeWorkspaceRevision, repaired: !!(repair && repair.repaired) };
  }

  function fetchAndApplyRemote(reason) {
    if (!isShared()) return Promise.resolve({ ok: false });
    var api = API();
    var id = state.activeWorkspaceId;
    if (!api || !id) return Promise.resolve({ ok: false });

    var token = ++_fetchToken;
    _fetching = true;
    var expectedMinRev =
      (state.remoteUpdate && Number(state.remoteUpdate.revision)) ||
      Number(state.activeWorkspaceRevision) ||
      0;

    return api.loadSharedWorkspace(id).then(function (loaded) {
      if (token !== _fetchToken) {
        return { ok: false, error: 'stale_fetch' };
      }
      _fetching = false;
      if (!isShared() || state.activeWorkspaceId !== id) {
        return { ok: false, error: 'stale_workspace' };
      }
      if (!loaded || !loaded.ok) return loaded || { ok: false };

      var loadedRev = Number(loaded.revision) || 0;
      /* Ignore late responses older than what we already know */
      if (loadedRev > 0 && expectedMinRev > 0 && loadedRev < expectedMinRev) {
        return { ok: false, error: 'stale_revision', revision: loadedRev };
      }
      if (loadedRev > 0 && loadedRev < (Number(state.activeWorkspaceRevision) || 0)) {
        return { ok: false, error: 'stale_revision', revision: loadedRev };
      }

      /* If user became dirty while fetch was in flight, protect local work */
      if (state.sharedDirty) {
        state.remoteUpdate = {
          revision: loaded.revision,
          updated_by: loaded.updated_by || null,
          updated_at: loaded.updated_at || null,
          reason: reason || 'dirty_during_fetch'
        };
        syncToS();
        if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.onRemoteUpdateAvailable) {
          global.PreShootWorkspaceUI.onRemoteUpdateAvailable(state.remoteUpdate);
        }
        return { ok: true, deferred: true };
      }
      return applyAuthoritativeRemote(loaded);
    }).catch(function (err) {
      if (token === _fetchToken) _fetching = false;
      return { ok: false, error: 'network_error', message: String(err && err.message) };
    });
  }

  function onRemoteWorkspaceUpdated(evt) {
    if (!isShared() || !evt) return;
    if (evt.workspace_id && evt.workspace_id !== state.activeWorkspaceId) return;

    var incoming = Number(evt.revision);
    var current = Number(state.activeWorkspaceRevision) || 0;
    if (!Number.isFinite(incoming) || incoming <= current) return;

    var change =
      evt.change ||
      (evt.change_type
        ? {
            type: evt.change_type,
            entityId: evt.entity_id || null,
            entityLabel: evt.entity_label || null,
            projectId: evt.project_id || null,
            productionId: evt.production_id || null
          }
        : null);
    var editing = getEditingContext();
    var sameEntity = false;
    if (
      change &&
      global.PreShootWorkspaceChanges &&
      PreShootWorkspaceChanges.isSameEntityConflict
    ) {
      sameEntity = PreShootWorkspaceChanges.isSameEntityConflict(editing, change);
    } else if (change && editing.activeProductionId && change.productionId) {
      sameEntity = String(editing.activeProductionId) === String(change.productionId);
    }

    /* Already tracking this or newer remote revision while dirty */
    if (
      state.remoteUpdate &&
      Number(state.remoteUpdate.revision) >= incoming &&
      (state.sharedDirty || state.conflict)
    ) {
      return;
    }

    /* Dirty: never overwrite — mark remote available with entity context */
    if (state.sharedDirty || state.conflict) {
      state.remoteUpdate = {
        revision: incoming,
        updated_by: evt.updated_by || null,
        updated_at: evt.updated_at || null,
        reason: sameEntity ? 'same_entity_dirty' : 'dirty_protected',
        change: change,
        sameEntity: sameEntity,
        activity_label: evt.activity_label || null
      };
      syncToS();
      queueRemoteNotification(state.remoteUpdate);
      refreshActivity(state.activeWorkspaceId);
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.onRemoteUpdateAvailable) {
        global.PreShootWorkspaceUI.onRemoteUpdateAvailable(state.remoteUpdate);
      }
      return;
    }

    /* Clean: fetch authoritative document. Metadata tells UI what changed. */
    if (_fetching) {
      state.remoteUpdate = {
        revision: Math.max(incoming, Number((state.remoteUpdate && state.remoteUpdate.revision) || 0)),
        updated_by: evt.updated_by || null,
        updated_at: evt.updated_at || null,
        reason: 'fetch_coalesced',
        change: change,
        sameEntity: sameEntity,
        activity_label: evt.activity_label || null
      };
      return;
    }
    state.remoteUpdate = {
      revision: incoming,
      updated_by: evt.updated_by || null,
      updated_at: evt.updated_at || null,
      reason: evt.gap ? 'revision_gap' : 'remote_update',
      change: change,
      sameEntity: sameEntity,
      activity_label: evt.activity_label || null
    };
    queueRemoteNotification(state.remoteUpdate);
    refreshActivity(state.activeWorkspaceId);
    fetchAndApplyRemote(evt.gap ? 'revision_gap' : 'remote_update');
  }

  function reviewRemoteUpdate() {
    if (!state.remoteUpdate && !isShared()) return Promise.resolve({ ok: false });
    if (state.sharedDirty) {
      var ok = confirm(
        'Loading the latest workspace will discard your unsaved local changes. Continue?'
      );
      if (!ok) return Promise.resolve({ ok: false, error: 'cancelled' });
      state.sharedDirty = false;
    }
    return fetchAndApplyRemote('review_update');
  }

  /**
   * Keep local unsaved edits and dismiss the remote-update indicator.
   * Does not merge; next save may 409 if server is ahead — conflict UI handles that.
   */
  function keepLocalRemoteUpdate() {
    if (!isShared()) return { ok: false };
    clearRemoteUpdateState();
    syncToS();
    refreshStudioUI();
    toast('Kept your local changes');
    return { ok: true, kept: true };
  }

  function flushBeforeSwitch() {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    return waitForSaveIdle().then(function () {
      if (isShared()) {
        if (!state.sharedDirty) return { ok: true };
        return saveNow().then(function (res) {
          if (res && res.busy) return { ok: false, error: 'save_busy' };
          return res;
        });
      }
      if (global.PreShootStudioSync && global.PreShootStudioSync.flush) {
        return global.PreShootStudioSync.flush({ alwaysPush: true });
      }
      if (typeof global.saveToCloud === 'function') {
        return Promise.resolve(global.saveToCloud()).then(function () {
          return { ok: true };
        });
      }
      return { ok: true };
    });
  }

  function isDirtyForSwitch() {
    if (isShared()) return state.sharedDirty;
    var st = Studio();
    if (st && st.isPersonalDirty) return st.isPersonalDirty();
    return st && st.isDirty ? st.isDirty() : false;
  }

  /**
   * Switch to personal or a shared workspace id.
   * @param {'personal'|string} target - 'personal' or shared workspace UUID
   */
  function switchTo(target, opts) {
    opts = opts || {};
    if (state.switching) return Promise.resolve({ ok: false, error: 'busy' });
    if (!global.S || !global.S.authUser) {
      toast('Sign in to switch workspaces');
      return Promise.resolve({ ok: false, error: 'auth_required' });
    }

    var goingPersonal = target === 'personal' || target === state.personalWorkspaceId;
    if (goingPersonal && !isShared()) {
      return Promise.resolve({ ok: true, already: true });
    }
    if (!goingPersonal && isShared() && target === state.activeWorkspaceId) {
      return Promise.resolve({ ok: true, already: true });
    }

    if (state.conflict && !opts.force) {
      toast('Resolve the save conflict before switching');
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showConflict) {
        global.PreShootWorkspaceUI.showConflict(state.conflict);
      }
      return Promise.resolve({ ok: false, error: 'conflict_pending' });
    }

    if (isDirtyForSwitch() && !opts.force) {
      var proceed = true;
      if (!opts.skipConfirm) {
        proceed = confirm(
          'You have unsaved Studio changes. Save before switching?\n\nOK = Save & switch\nCancel = Stay'
        );
      }
      if (!proceed) return Promise.resolve({ ok: false, error: 'cancelled' });
    }

    var token = ++_switchToken;
    state.switching = true;
    /* Unsubscribe immediately so Workspace A events cannot touch B */
    stopRealtime();
    clearTimeout(_saveTimer);
    _saveTimer = null;
    clearRemoteUpdateState();
    state.presence = [];
    state.recentActivity = [];
    state.commentCache = {};
    state.commentFeedback = [];
    state.unreadNotifications = 0;
    state.notifyQueue = [];
    if (global.S) global.S.workspacePresence = [];
    _fetchToken += 1;
    _fetching = false;
    syncToS();
    refreshStudioUI();

    var blankRoot = document.getElementById('studio-root');
    if (blankRoot) {
      blankRoot.innerHTML =
        '<div class="studio-empty"><div class="studio-empty-t">Switching workspace…</div></div>';
    }

    return flushBeforeSwitch()
      .catch(function () {
        return { ok: false };
      })
      .then(function (flushRes) {
        if (token !== _switchToken) return { ok: false, error: 'stale' };
        if (flushRes && flushRes.conflict) {
          state.switching = false;
          if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showConflict) {
            global.PreShootWorkspaceUI.showConflict(state.conflict || flushRes);
          }
          refreshStudioUI();
          return { ok: false, error: 'conflict' };
        }
        /* Phase 6: never abandon dirty work on failed flush */
        if (flushRes && flushRes.ok === false && !flushRes.skipped && !flushRes.already) {
          state.switching = false;
          toast(
            (flushRes && flushRes.message) ||
              'Could not save before switching. Stay here, then try again.'
          );
          refreshStudioUI();
          return { ok: false, error: 'flush_failed' };
        }
        /* Clear visible document before load to avoid cross-workspace flash */
        clearStudioView();
        if (global.S) global.S.studio = { version: 3, projects: [], continueProductionId: null };

        if (goingPersonal) {
          return refreshList(true).then(function () {
            if (token !== _switchToken) return { ok: false, error: 'stale' };
            var personal = state.list.filter(function (w) {
              return w.kind === 'personal';
            })[0];
            setPersonalMode(personal || { id: state.personalWorkspaceId, name: 'Personal' });
            loadPersonalIntoStudio();
            state.switching = false;
            syncToS();
            refreshStudioUI();
            toast('Personal Studio');
            return { ok: true, kind: 'personal' };
          });
        }

        var api = API();
        return api.loadSharedWorkspace(target).then(function (loaded) {
          if (token !== _switchToken) return { ok: false, error: 'stale' };
          if (!loaded || !loaded.ok) {
            state.switching = false;
            setPersonalMode(
              state.list.filter(function (w) {
                return w.kind === 'personal';
              })[0]
            );
            loadPersonalIntoStudio();
            refreshStudioUI();
            toast((loaded && loaded.message) || 'Could not open workspace');
            return { ok: false, error: (loaded && loaded.error) || 'load_failed' };
          }
          setSharedMode(
            {
              id: target,
              name: (loaded.workspace && loaded.workspace.name) || 'Workspace',
              role: loaded.role
            },
            loaded.document,
            loaded.revision,
            {
              revision: loaded.revision,
              updated_by: loaded.updated_by || null,
              updated_at: loaded.updated_at || null,
              name: null
            }
          );
          clearStudioView();
          state.switching = false;
          syncToS();
          refreshStudioUI();
          toast(state.activeWorkspaceName);
          return { ok: true, kind: 'shared', role: loaded.role };
        });
      })
      .catch(function (err) {
        state.switching = false;
        refreshStudioUI();
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function createAndOpen(name) {
    var api = API();
    if (!api) {
      toast('Workspace system not ready — refresh and try again');
      return Promise.resolve({ ok: false, error: 'no_api' });
    }
    if (!global.S || !global.S.authUser) {
      toast('Sign in to create a workspace');
      return Promise.resolve({ ok: false, error: 'auth_required' });
    }
    return api.createWorkspace(name || 'Untitled Workspace').then(function (res) {
      if (!res || !res.ok || !res.workspace) {
        var msg =
          (res && (res.message || res.error)) ||
          'Could not create workspace';
        if (res && res.status === 401) msg = 'Sign in to create a workspace';
        toast(String(msg).slice(0, 120));
        return res || { ok: false };
      }
      state.listLoadedAt = 0;
      return switchTo(res.workspace.id, { skipConfirm: true }).then(function (sw) {
        if (!sw || !sw.ok) {
          toast(
            (sw && sw.message) ||
              'Workspace created, but it could not be opened. Open it from the switcher.'
          );
          /* Still treat create as success so the list can refresh */
          return Object.assign({}, res, { opened: false, switchError: sw && sw.error });
        }
        return res;
      });
    });
  }

  function resolveConflictReload() {
    if (!state.conflict || !isShared()) return Promise.resolve({ ok: false });
    var api = API();
    var id = state.activeWorkspaceId;
    var prevView = global.S ? Object.assign({}, global.S.studioView || {}) : null;
    /* Preserve unsaved local draft before loading server — never destroy user work */
    if (state.conflict.localDraft) {
      try {
        writeRecoveryDraft(state.conflict.localDraft);
      } catch (e) {}
    }
    return api.loadSharedWorkspace(id).then(function (loaded) {
      if (!loaded || !loaded.ok) {
        toast('Could not reload workspace');
        return loaded;
      }
      state.conflict = null;
      clearRemoteUpdateState();
      setSharedMode(
        {
          id: id,
          name: (loaded.workspace && loaded.workspace.name) || state.activeWorkspaceName,
          role: loaded.role || state.activeWorkspaceRole
        },
        loaded.document,
        loaded.revision,
        {
          revision: loaded.revision,
          updated_by: loaded.updated_by || null,
          updated_at: loaded.updated_at || null,
          name: null
        }
      );
      setSaveStatus('saved');
      repairStudioView(prevView);
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.closeConflict) {
        global.PreShootWorkspaceUI.closeConflict();
      }
      refreshStudioUI();
      toast('Loaded latest version — your previous edits were kept as a recovery draft if needed');
      return { ok: true };
    });
  }

  function resolveConflictKeepLocal() {
    if (!state.conflict || !isShared()) return Promise.resolve({ ok: false });
    var draft = state.conflict.localDraft;
    var serverRev = state.conflict.revision;
    /* Keep local draft; adopt server revision so an explicit save can overwrite after user confirms. */
    state.sharedDocument = normalizeDocument(draft);
    state.activeWorkspaceRevision = Number(serverRev) || state.activeWorkspaceRevision;
    state.sharedDirty = true;
    state.conflict = null;
    setSaveStatus('dirty');
    clearRemoteUpdateState();
    writeRecoveryDraft();
    if (global.S) {
      global.S.studio = state.sharedDocument;
      global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
    }
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.closeConflict) {
      global.PreShootWorkspaceUI.closeConflict();
    }
    refreshStudioUI();
    toast('Kept your local changes — save when ready to write them as a new revision');
    return Promise.resolve({ ok: true, kept: true });
  }

  /**
   * View-only: load a version snapshot into preview state.
   * Does NOT mutate the active Studio document.
   */
  function viewVersion(versionId) {
    if (!isShared()) return Promise.resolve({ ok: false });
    var api = API();
    if (!api) return Promise.resolve({ ok: false });
    return api.getVersion(state.activeWorkspaceId, versionId).then(function (res) {
      if (!res || !res.ok || !res.version) {
        toast((res && res.error) || 'Could not load version');
        return res || { ok: false };
      }
      state.versionPreview = {
        id: res.version.id,
        revision: res.version.revision,
        document: normalizeDocument(res.version.document),
        created_by: res.version.created_by,
        created_at: res.version.created_at,
        name: res.version.name,
        reason: res.version.reason,
        canRestore: !!res.canRestore
      };
      syncToS();
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showVersionPreview) {
        global.PreShootWorkspaceUI.showVersionPreview(state.versionPreview);
      }
      return { ok: true, version: state.versionPreview };
    });
  }

  function clearVersionPreview() {
    state.versionPreview = null;
    syncToS();
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.hideVersionPreview) {
      global.PreShootWorkspaceUI.hideVersionPreview();
    }
  }

  /**
   * Restore creates a NEW revision via optimistic concurrency.
   * Stale expected revision → 409 (does not overwrite).
   */
  function restoreVersion(versionId) {
    if (!isShared() || !canEdit()) {
      toast('Only owners and editors can restore versions');
      return Promise.resolve({ ok: false, error: 'forbidden' });
    }
    if (state.sharedDirty) {
      var ok = confirm(
        'You have unsaved changes. Restoring will replace them with the selected version as a new revision. Continue?'
      );
      if (!ok) return Promise.resolve({ ok: false, error: 'cancelled' });
    }
    var api = API();
    if (!api) return Promise.resolve({ ok: false });
    var expected = state.activeWorkspaceRevision;
    setSaveStatus('saving');
    return api.restoreVersion(state.activeWorkspaceId, versionId, expected).then(function (res) {
      if (res && res.ok) {
        state.activeWorkspaceRevision = res.revision;
        state.sharedDocument = normalizeDocument(res.document);
        state.sharedDirty = false;
        state.conflict = null;
        clearRemoteUpdateState();
        clearRecoveryDraft(state.activeWorkspaceId);
        clearVersionPreview();
        state.lastLocalSave = {
          workspaceId: state.activeWorkspaceId,
          revision: Number(res.revision),
          at: Date.now(),
          updated_by: (global.S && global.S.authUser && global.S.authUser.id) || null
        };
        state.lastActivity = {
          revision: Number(res.revision),
          updated_by: res.updated_by || null,
          updated_at: res.updated_at || new Date().toISOString(),
          name: (global.S && global.S.profile && global.S.profile.name) || null
        };
        if (global.S) {
          global.S.studio = state.sharedDocument;
          global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
        }
        setSaveStatus('saved');
        refreshStudioUI();
        toast(
          'Restored revision ' +
            (res.restored_from_revision || '') +
            ' as new revision ' +
            res.revision
        );
        return res;
      }
      if (res && res.conflict) {
        state.conflict = {
          localDraft: exportSharedDocument(),
          serverDocument: res.document,
          revision: res.revision,
          updated_at: res.updated_at,
          updated_by: res.updated_by,
          message:
            'This workspace changed before restore completed. Review the latest revision, then try again.'
        };
        setSaveStatus('conflict');
        if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showConflict) {
          global.PreShootWorkspaceUI.showConflict(state.conflict);
        }
        return res;
      }
      setSaveStatus('error', { error: res && res.error, message: res && res.message });
      toast((res && res.message) || 'Could not restore version');
      return res;
    });
  }

  function bindRecoveryLifecycle() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', function (e) {
      if (!isShared() || !state.sharedDirty) return;
      writeRecoveryDraft();
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('pagehide', function () {
      if (isShared() && state.sharedDirty) writeRecoveryDraft();
    });
    window.addEventListener('online', function () {
      if (!isShared()) return;
      if (state.saveStatus === 'offline') {
        setSaveStatus(state.sharedDirty ? 'dirty' : 'saved');
        if (state.sharedDirty) scheduleSave();
      }
    });
    window.addEventListener('offline', function () {
      if (!isShared()) return;
      if (state.sharedDirty || state.saveStatus === 'saving') {
        setSaveStatus('offline');
        writeRecoveryDraft();
      }
    });
  }

  function bootstrap() {
    bindRecoveryLifecycle();
    syncToS();
    if (!global.S || !global.S.authUser) return Promise.resolve();
    return refreshList(true).then(function () {
      var saved = gs(ACTIVE_KEY, 'personal');
      var personal = state.list.filter(function (w) {
        return w.kind === 'personal';
      })[0];
      if (personal) state.personalWorkspaceId = personal.id;

      if (!saved || saved === 'personal' || (personal && saved === personal.id)) {
        setPersonalMode(personal || { name: 'Personal' });
        loadPersonalIntoStudio();
        refreshStudioUI();
        return { ok: true };
      }

      var shared = state.list.filter(function (w) {
        return w.id === saved && w.kind === 'shared';
      })[0];
      if (!shared) {
        setPersonalMode(personal || { name: 'Personal' });
        loadPersonalIntoStudio();
        refreshStudioUI();
        return { ok: true };
      }

      return switchTo(saved, { skipConfirm: true, force: true });
    });
  }

  function handleInviteToken(token) {
    var api = API();
    if (!api || !token) return Promise.resolve({ ok: false });
    return api.acceptInvite(token).then(function (res) {
      if (!res || !res.ok) {
        var err = (res && res.error) || 'invite_failed';
        var msg = {
          invite_expired: 'This invitation has expired.',
          invite_revoked: 'This invitation was revoked.',
          invite_already_accepted: 'This invitation was already used.',
          invite_not_found: 'Invalid invitation link.',
          invalid_token: 'Invalid invitation link.',
          email_mismatch: 'Sign in with the invited email address.',
          email_required: 'Sign in with the invited email address.'
        }[err];
        toast(msg || (res && res.message) || 'Could not accept invitation');
        return res;
      }
      state.listLoadedAt = 0;
      toast(res.already_member ? 'Already a member' : 'Joined workspace');
      if (res.workspace_id) {
        return switchTo(res.workspace_id, { skipConfirm: true }).then(function () {
          return res;
        });
      }
      return res;
    });
  }

  function workspaceIdForUpload() {
    return isShared() ? state.activeWorkspaceId : null;
  }

  function workspaceIdForDirector() {
    return isShared() ? state.activeWorkspaceId : null;
  }

  global.PreShootWorkspace = {
    getContext: getContext,
    isShared: isShared,
    canEdit: canEdit,
    canManageMembers: canManageMembers,
    getSharedDocument: getSharedDocument,
    setSharedDocument: setSharedDocument,
    isSharedDirty: isSharedDirty,
    markSharedDirty: markSharedDirty,
    setPendingChangeHint: setPendingChangeHint,
    getEditingContext: getEditingContext,
    clearSharedDirty: clearSharedDirty,
    scheduleSave: scheduleSave,
    saveNow: saveNow,
    switchTo: switchTo,
    createAndOpen: createAndOpen,
    refreshList: refreshList,
    bootstrap: bootstrap,
    handleInviteToken: handleInviteToken,
    resolveConflictReload: resolveConflictReload,
    resolveConflictKeepLocal: resolveConflictKeepLocal,
    viewVersion: viewVersion,
    clearVersionPreview: clearVersionPreview,
    restoreVersion: restoreVersion,
    recoverPendingDraft: recoverPendingDraft,
    discardPendingRecovery: discardPendingRecovery,
    writeRecoveryDraft: writeRecoveryDraft,
    workspaceIdForUpload: workspaceIdForUpload,
    workspaceIdForDirector: workspaceIdForDirector,
    applyReadOnlyClass: applyReadOnlyClass,
    shouldIgnoreRealtimeRevision: shouldIgnoreRealtimeRevision,
    onRemoteWorkspaceUpdated: onRemoteWorkspaceUpdated,
    onRemoteCommentEvent: onRemoteCommentEvent,
    onRealtimeReconnected: onRealtimeReconnected,
    onPresenceChanged: onPresenceChanged,
    refreshActivity: refreshActivity,
    loadProductionComments: loadProductionComments,
    invalidateCommentCache: invalidateCommentCache,
    refreshNotifications: refreshNotifications,
    presenceOnProduction: presenceOnProduction,
    reviewRemoteUpdate: reviewRemoteUpdate,
    keepLocalRemoteUpdate: keepLocalRemoteUpdate,
    fetchAndApplyRemote: fetchAndApplyRemote,
    repairStudioView: repairStudioView,
    clearRemoteUpdateState: clearRemoteUpdateState,
    setSaveStatus: setSaveStatus
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
