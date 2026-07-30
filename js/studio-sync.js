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
    if (Studio()) {
      try {
        var st = Studio().exportForSync();
        S.studio = st;
        if (!S.prefs) S.prefs = {};
        S.prefs.studio = st;
        if (typeof global.ss === 'function') global.ss('prefs', S.prefs);
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
      studio: Studio() ? Studio().exportForSync() : null
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
        var d = res.data;
        lastRemoteUpdatedAt = d.updated_at || null;

        if (d.prefs && d.prefs.studio && Studio()) {
          Studio().applyCloudStudio(d.prefs.studio);
        } else if (d.studio && Studio()) {
          Studio().applyCloudStudio(d.studio);
        }

        refreshStudioUI();
        return { ok: true, data: d };
      })
      .catch(function () {
        pulling = false;
        return { ok: false, error: 'network' };
      });
  }

  function flush() {
    if (!authUser()) return Promise.resolve();
    var dirty = Studio() ? Studio().isDirty() : false;
    return pullNow({ force: true }).then(function () {
      if (dirty || (Studio() && Studio().isDirty())) return pushNow();
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
            if (Studio() && Studio().isDirty()) {
              /* Local edits pending — merge then push */
              flush();
            } else {
              pullNow({ force: true });
            }
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
    flush().then(function () {
      startRealtime();
      refreshStudioUI();
    });
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
        /* Best-effort sync; keepalive via fetch if available */
        try {
          pushNow();
        } catch (e) {}
      }
    });

    window.addEventListener('focus', function () {
      if (authUser()) pullNow({ force: false });
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
    refreshStudioUI: refreshStudioUI
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindLifecycle);
    } else {
      bindLifecycle();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
