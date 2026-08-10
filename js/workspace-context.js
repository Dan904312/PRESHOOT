/**
 * PreShoot Workspace Context — Phase 2 authoritative active-workspace state.
 * Personal Studio stays on /api/sync. Shared uses /api/workspace-sync.
 * Never mix persistence layers.
 */
(function (global) {
  'use strict';

  var ACTIVE_KEY = 'active_workspace_id';
  var SAVE_DEBOUNCE_MS = 1400;

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
    list: [],
    listLoadedAt: 0
  };

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

  function setSharedDocument(doc) {
    state.sharedDocument = doc;
    if (global.S) global.S.studio = doc;
  }

  function isSharedDirty() {
    return !!state.sharedDirty;
  }

  function markSharedDirty() {
    if (!canEdit()) return;
    state.sharedDirty = true;
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
    clearRemoteUpdateState();
    state.lastLocalSave = null;
    ss(ACTIVE_KEY, 'personal');
    syncToS();
    applyReadOnlyClass();
  }

  function setSharedMode(meta, document, revision) {
    state.activeWorkspaceKind = 'shared';
    state.activeWorkspaceId = meta.id;
    state.activeWorkspaceName = meta.name || 'Workspace';
    state.activeWorkspaceRole = meta.role || 'viewer';
    state.activeWorkspaceRevision = Number(revision) || 1;
    state.sharedDocument = normalizeDocument(document);
    state.sharedDirty = false;
    state.conflict = null;
    clearRemoteUpdateState();
    ss(ACTIVE_KEY, meta.id);
    if (global.S) global.S.studio = state.sharedDocument;
    syncToS();
    applyReadOnlyClass();
    startRealtime(meta.id);
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
    var document = exportSharedDocument();
    state.saving = true;
    return api.saveSharedWorkspace(workspaceId, document, revision).then(function (res) {
      state.saving = false;
      if (res && res.ok) {
        state.activeWorkspaceRevision = res.revision;
        state.sharedDocument = normalizeDocument(res.document || document);
        state.sharedDirty = false;
        state.conflict = null;
        clearRemoteUpdateState();
        state.lastLocalSave = {
          workspaceId: workspaceId,
          revision: Number(res.revision) || revision,
          at: Date.now(),
          updated_by: (global.S && global.S.authUser && global.S.authUser.id) || null
        };
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
          updated_at: res.updated_at,
          updated_by: res.updated_by,
          message: res.message
        };
        if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.showConflict) {
          global.PreShootWorkspaceUI.showConflict(state.conflict);
        } else {
          toast('This workspace was updated by someone else.');
        }
        return res;
      }
      toast((res && res.message) || 'Could not save workspace');
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

    /* Already tracking this or newer remote revision while dirty */
    if (
      state.remoteUpdate &&
      Number(state.remoteUpdate.revision) >= incoming &&
      (state.sharedDirty || state.conflict)
    ) {
      return;
    }

    /* Dirty: never overwrite — mark remote available */
    if (state.sharedDirty || state.conflict) {
      state.remoteUpdate = {
        revision: incoming,
        updated_by: evt.updated_by || null,
        updated_at: evt.updated_at || null,
        reason: 'dirty_protected'
      };
      syncToS();
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.onRemoteUpdateAvailable) {
        global.PreShootWorkspaceUI.onRemoteUpdateAvailable(state.remoteUpdate);
      } else {
        toast('This workspace was updated by another collaborator.');
      }
      return;
    }

    /* Clean: fetch authoritative document (gap or +1). Avoid duplicate in-flight fetches. */
    if (_fetching) {
      state.remoteUpdate = {
        revision: Math.max(incoming, Number((state.remoteUpdate && state.remoteUpdate.revision) || 0)),
        updated_by: evt.updated_by || null,
        updated_at: evt.updated_at || null,
        reason: 'fetch_coalesced'
      };
      return;
    }
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
          return { ok: false, error: 'conflict' };
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
            loaded.revision
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
    if (!api) return Promise.resolve({ ok: false });
    return api.createWorkspace(name || 'Untitled Workspace').then(function (res) {
      if (!res || !res.ok || !res.workspace) {
        toast((res && res.message) || 'Could not create workspace');
        return res;
      }
      state.listLoadedAt = 0;
      return switchTo(res.workspace.id, { skipConfirm: true }).then(function () {
        return res;
      });
    });
  }

  function resolveConflictReload() {
    if (!state.conflict || !isShared()) return Promise.resolve({ ok: false });
    var api = API();
    var id = state.activeWorkspaceId;
    var prevView = global.S ? Object.assign({}, global.S.studioView || {}) : null;
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
        loaded.revision
      );
      repairStudioView(prevView);
      if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.closeConflict) {
        global.PreShootWorkspaceUI.closeConflict();
      }
      refreshStudioUI();
      toast('Loaded latest version');
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
    clearRemoteUpdateState();
    if (global.S) {
      global.S.studio = state.sharedDocument;
      global.S.activeWorkspaceRevision = state.activeWorkspaceRevision;
    }
    if (global.PreShootWorkspaceUI && global.PreShootWorkspaceUI.closeConflict) {
      global.PreShootWorkspaceUI.closeConflict();
    }
    refreshStudioUI();
    toast('Kept your local changes — save to overwrite the latest server version');
    return saveNow();
  }

  function bootstrap() {
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
    workspaceIdForUpload: workspaceIdForUpload,
    workspaceIdForDirector: workspaceIdForDirector,
    applyReadOnlyClass: applyReadOnlyClass,
    shouldIgnoreRealtimeRevision: shouldIgnoreRealtimeRevision,
    onRemoteWorkspaceUpdated: onRemoteWorkspaceUpdated,
    onRealtimeReconnected: onRealtimeReconnected,
    reviewRemoteUpdate: reviewRemoteUpdate,
    keepLocalRemoteUpdate: keepLocalRemoteUpdate,
    fetchAndApplyRemote: fetchAndApplyRemote,
    repairStudioView: repairStudioView,
    clearRemoteUpdateState: clearRemoteUpdateState
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
