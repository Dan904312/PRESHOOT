/**
 * PreShoot Studio Sync — reliable multi-device sync (Phase 3).
 * Offline dirty queue + pull-merge-push + Supabase realtime / focus refresh.
 */
(function (global) {
  'use strict';

  var saving = false;
  var pulling = false;
  var channel = null;
  var lastPullAt = 0;
  var lastRemoteUpdatedAt = null;

  function Studio() {
    return global.PreShootStudio;
  }

  function authUser() {
    return global.S && global.S.authUser;
  }

  function refreshStudioUI() {
    try {
      if (global.PreShootStudioUI) {
        if (typeof global.PreShootStudioUI.renderContinueCard === 'function') {
          global.PreShootStudioUI.renderContinueCard();
        }
        if (global.S && global.S.tab === 'studio' && typeof global.PreShootStudioUI.renderStudio === 'function') {
          global.PreShootStudioUI.renderStudio();
        }
      }
    } catch (e) {}
  }

  function buildPayload() {
    var S = global.S;
    if (!S) return null;
    var personalStudio = null;
    if (Studio()) {
      try {
        personalStudio = Studio().exportForSync();
        /* Never put shared workspace document into personal prefs /api/sync */
        if (!S.prefs) S.prefs = {};
        S.prefs.studio = personalStudio;
        if (typeof global.ss === 'function') global.ss('prefs', S.prefs);
        if (!(global.PreShootWorkspace && PreShootWorkspace.isShared && PreShootWorkspace.isShared())) {
          S.studio = personalStudio;
        }
      } catch (e) {}
    }
    return {
      history: (typeof global.getHistory === 'function' ? global.getHistory() : []).map(function (h) {
        return {
          sceneType: h.sceneType,
          sceneLabel: h.sceneLabel,
          image: h.image || null,
          ideas: h.ideas,
          ts: h.ts
        };
      }),
      library: typeof global.getLib === 'function' ? global.getLib() : [],
      director_history: (S.directorHistory || []).slice(-30),
      director_convs: (S.directorConvs || []).slice(0, 20).map(function (c) {
        return {
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          context: c.context || null,
          messages: (c.messages || []).slice(-40)
        };
      }),
      active_dir_conv: S.activeDirConvId || null,
      niche: S.niche,
      platform_focus: S.platformFocus,
      aesthetic: S.aesthetic,
      gear: S.gear,
      profile: {
        name: S.profile.name,
        handle: S.profile.handle,
        bio: S.profile.bio
      },
      prefs: S.prefs,
      connected_accounts:
        global.PreShootResearch && PreShootResearch.getConnectedAccounts
          ? PreShootResearch.getConnectedAccounts()
          : S.connectedAccounts || {},
      studio: personalStudio
    };
  }

  function pushNow() {
    if (!authUser()) return Promise.resolve({ ok: false, skipped: true });
    if (saving) return Promise.resolve({ ok: false, busy: true });
    saving = true;
    var data = buildPayload();
    return global
      .apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', user_id: authUser().id, data: data })
      })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false };
        });
      })
      .then(function (res) {
        saving = false;
        if (res && res.ok) {
          if (Studio()) Studio().clearDirty();
          if (res.updated_at) lastRemoteUpdatedAt = res.updated_at;
          else lastRemoteUpdatedAt = new Date().toISOString();
          return { ok: true };
        }
        if (Studio()) Studio().markDirty();
        return { ok: false, error: (res && res.error) || 'save_failed' };
      })
      .catch(function () {
        saving = false;
        if (Studio()) Studio().markDirty();
        return { ok: false, error: 'network' };
      });
  }

  function applyPulledRow(d) {
    if (!d) return;
    lastRemoteUpdatedAt = d.updated_at || lastRemoteUpdatedAt;
    var cloudStudio = (d.prefs && d.prefs.studio) || d.studio || null;
    if (cloudStudio && Studio()) {
      Studio().applyCloudStudio(cloudStudio);
    }
    /* Keep non-Studio fields in sync on pull (login already merges; realtime needs this) */
    try {
      var S = global.S;
      if (!S) return;
      if (d.history && d.history.length && typeof global.getHistory === 'function' && typeof global.ss === 'function') {
        /* Soft merge: prefer longer/newer cloud history when local idle */
        if (!Studio() || !(Studio().isPersonalDirty ? Studio().isPersonalDirty() : Studio().isDirty())) {
          var MH = typeof global.MH === 'number' ? global.MH : 40;
          var localH = global.getHistory();
          if (!localH.length || d.history.length >= localH.length) {
            global.ss('history', d.history.slice(0, MH));
          }
        }
      }
      if (d.library && Array.isArray(d.library) && typeof global.ss === 'function') {
        if (!Studio() || !(Studio().isPersonalDirty ? Studio().isPersonalDirty() : Studio().isDirty())) {
          global.ss('library', d.library);
        }
      }
      if (d.director_convs && Array.isArray(d.director_convs)) {
        S.directorConvs = d.director_convs;
        if (typeof global.ss === 'function') global.ss('director_convs', S.directorConvs);
      }
      if (d.connected_accounts) {
        S.connectedAccounts = d.connected_accounts;
        if (typeof global.ss === 'function') global.ss('connected_accounts', d.connected_accounts);
        if (global.PreShootResearch && PreShootResearch.setConnectedAccounts) {
          PreShootResearch.setConnectedAccounts(d.connected_accounts);
        }
      }
    } catch (e) {}
  }

  function pullNow(opts) {
    opts = opts || {};
    if (!authUser()) return Promise.resolve({ ok: false, skipped: true });
    if (pulling) return Promise.resolve({ ok: false, busy: true });
    var now = Date.now();
    if (!opts.force && now - lastPullAt < 1500) return Promise.resolve({ ok: true, cached: true });
    pulling = true;
    lastPullAt = now;
    return global
      .apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load', user_id: authUser().id })
      })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        pulling = false;
        if (!res || !res.ok || !res.data) return { ok: true, empty: true };
        applyPulledRow(res.data);
        refreshStudioUI();
        return { ok: true, data: res.data };
      })
      .catch(function () {
        pulling = false;
        return { ok: false, error: 'network' };
      });
  }

  /**
   * Authoritative reconcile: pull+merge first, then push when needed.
   * - Default / realtime: push only if Studio dirty (avoids sync loops).
   * - opts.alwaysPush: after pull, always push (profile/library/settings saves).
   * - opts.pushFirst: push local tombstones/mutations first, then pull.
   */
  function flush(opts) {
    opts = opts || {};
    if (!authUser()) return Promise.resolve();
    var dirty = Studio()
      ? Studio().isPersonalDirty
        ? Studio().isPersonalDirty()
        : Studio().isDirty()
      : false;
    if (opts.pushFirst && dirty) {
      return pushNow().then(function () {
        return pullNow({ force: true });
      });
    }
    return pullNow({ force: true }).then(function () {
      var stillDirty = Studio()
        ? Studio().isPersonalDirty
          ? Studio().isPersonalDirty()
          : Studio().isDirty()
        : false;
      if (opts.alwaysPush || stillDirty) return pushNow();
      return { ok: true };
    });
  }

  function startRealtime() {
    stopRealtime();
    if (!authUser() || !global.supa || !global.supa.channel) return;
    var uid = authUser().id;
    try {
      channel = global.supa
        .channel('studio-sync-' + uid)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_data',
            filter: 'user_id=eq.' + uid
          },
          function (payload) {
            var row = payload.new || payload.old || {};
            if (row.updated_at && row.updated_at === lastRemoteUpdatedAt) return;
            /* Always pull-merge first so remote wins over stale local; then push if still dirty */
            flush();
          }
        )
        .subscribe();
    } catch (e) {
      channel = null;
    }
  }

  function stopRealtime() {
    if (channel && global.supa && global.supa.removeChannel) {
      try {
        global.supa.removeChannel(channel);
      } catch (e) {}
    }
    channel = null;
  }

  function onAuthReady() {
    if (!authUser()) {
      stopRealtime();
      return;
    }
    /* After login merge, pull again then push only if Studio still dirty */
    flush().then(function () {
      startRealtime();
      refreshStudioUI();
    });
  }

  function clearLocalUserCache() {
    stopRealtime();
    lastRemoteUpdatedAt = null;
    lastPullAt = 0;
    try {
      if (Studio() && Studio().clearDirty) Studio().clearDirty();
      if (typeof global.ss === 'function') {
        global.ss('studio_dirty', false);
        /* Drop cached user workspace so next login cannot restore stale Studio over server */
        global.ss('studio', {
          version: 3,
          projects: [],
          continueProductionId: null,
          deletedProjects: [],
          deletedProductions: [],
          updatedAt: 0
        });
        global.ss('history', []);
        global.ss('library', []);
        global.ss('director_convs', []);
        global.ss('director_history', []);
        global.ss('active_dir_conv', null);
        global.ss('connected_accounts', {});
      }
      if (global.S) {
        global.S.studio = null;
        global.S.directorConvs = [];
        global.S.directorHistory = [];
        global.S.activeDirConvId = null;
        global.S.connectedAccounts = {};
        if (global.S.prefs && typeof global.S.prefs === 'object') {
          global.S.prefs.studio = null;
          if (typeof global.ss === 'function') global.ss('prefs', global.S.prefs);
        }
      }
      if (global.PreShootResearch && PreShootResearch.setConnectedAccounts) {
        PreShootResearch.setConnectedAccounts({});
      }
    } catch (e) {}
  }

  function bindLifecycle() {
    if (bindLifecycle._done) return;
    bindLifecycle._done = true;

    window.addEventListener('online', function () {
      flush();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        if (Studio() && Studio().isDirty()) pushNow();
      } else if (document.visibilityState === 'visible' && authUser()) {
        flush();
      }
    });

    window.addEventListener('pagehide', function () {
      if (Studio() && Studio().isDirty()) {
        try {
          pushNow();
        } catch (e) {}
      }
    });

    window.addEventListener('focus', function () {
      if (!authUser()) return;
      flush();
    });
  }

  global.PreShootStudioSync = {
    pushNow: pushNow,
    pullNow: pullNow,
    flush: flush,
    startRealtime: startRealtime,
    stopRealtime: stopRealtime,
    onAuthReady: onAuthReady,
    bindLifecycle: bindLifecycle,
    refreshStudioUI: refreshStudioUI,
    clearLocalUserCache: clearLocalUserCache
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindLifecycle);
    } else {
      bindLifecycle();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
