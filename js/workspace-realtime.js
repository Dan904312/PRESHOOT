/**
 * PreShoot Workspace Realtime — Phase 3A–5B
 * Private Broadcast + ephemeral Presence for shared workspaces.
 * Database + /api/workspace-sync remain the source of truth.
 * Never broadcasts documents, personal data, or credentials.
 *
 * Presence is ephemeral (Supabase Presence) — not stored in workspace_data.
 */
(function (global) {
  'use strict';

  var EVENT = 'workspace.updated';
  var channel = null;
  var subscribedId = null;
  var status = 'idle'; /* idle | connecting | subscribed | error */
  var reconnectTimer = null;
  var authRetry = 0;
  var presenceMap = {}; /* userId → presence meta */
  var trackTimer = null;
  var lastTrackKey = '';

  function Ctx() {
    return global.PreShootWorkspace;
  }

  function topicFor(workspaceId) {
    return 'workspace:' + workspaceId;
  }

  function getSupa() {
    return global.supa || null;
  }

  function getAccessToken() {
    if (typeof global.getAccessToken === 'function') return global.getAccessToken();
    return Promise.resolve(null);
  }

  function setStatus(next) {
    status = next;
    if (global.S) global.S.workspaceRealtimeStatus = status;
  }

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(workspaceId) {
    clearReconnect();
    reconnectTimer = setTimeout(function () {
      if (Ctx() && Ctx().isShared && Ctx().isShared()) {
        var id = Ctx().getContext().activeWorkspaceId;
        if (id === workspaceId) {
          subscribe(workspaceId, { force: true }).then(function (res) {
            if (res && res.ok && Ctx().onRealtimeReconnected) {
              Ctx().onRealtimeReconnected(workspaceId);
            }
          });
        }
      }
    }, 2500);
  }

  function clearPresenceState() {
    presenceMap = {};
    lastTrackKey = '';
    if (global.S) global.S.workspacePresence = [];
    if (Ctx() && Ctx().onPresenceChanged) Ctx().onPresenceChanged([]);
  }

  function unsubscribe() {
    clearReconnect();
    if (trackTimer) {
      clearTimeout(trackTimer);
      trackTimer = null;
    }
    var prev = channel;
    channel = null;
    subscribedId = null;
    setStatus('idle');
    clearPresenceState();
    if (!prev) return Promise.resolve();
    try {
      var untrack = Promise.resolve();
      if (prev.untrack) {
        untrack = Promise.resolve(prev.untrack()).catch(function () {});
      }
      return untrack.then(function () {
        var s = getSupa();
        if (s && s.removeChannel) return s.removeChannel(prev);
        if (prev.unsubscribe) return prev.unsubscribe();
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function ensureRealtimeAuth() {
    var s = getSupa();
    if (!s || !s.realtime || typeof s.realtime.setAuth !== 'function') {
      return Promise.resolve(false);
    }
    return getAccessToken().then(function (token) {
      if (!token) return false;
      return Promise.resolve(s.realtime.setAuth(token)).then(function () {
        return true;
      });
    }).catch(function () {
      return false;
    });
  }

  function myUserId() {
    return (global.S && global.S.authUser && global.S.authUser.id) || null;
  }

  function buildPresencePayload(workspaceId) {
    var uid = myUserId();
    if (!uid) return null;
    var ctx = Ctx() ? Ctx().getContext() : null;
    var editing =
      Ctx() && Ctx().getEditingContext ? Ctx().getEditingContext() : null;
    var profile = (global.S && global.S.profile) || {};
    var dirty = !!(ctx && ctx.sharedDirty);
    var section = editing && editing.activeSection ? editing.activeSection : null;
    if (!section && global.S && global.S.studioView) {
      section = global.S.studioView.section || null;
    }
    return {
      userId: uid,
      workspaceId: workspaceId,
      displayName:
        profile.name ||
        (global.S.authUser && (global.S.authUser.email || '').split('@')[0]) ||
        'Collaborator',
      role: (ctx && ctx.activeWorkspaceRole) || null,
      activeProjectId: (editing && editing.activeProjectId) || null,
      activeProductionId: (editing && editing.activeProductionId) || null,
      activeSection: section,
      editing: dirty,
      lastSeen: new Date().toISOString()
    };
  }

  function normalizePresenceState(state) {
    var out = [];
    var seen = {};
    Object.keys(state || {}).forEach(function (key) {
      var metas = state[key] || [];
      var meta = metas[metas.length - 1];
      if (!meta || !meta.userId) return;
      var id = String(meta.userId);
      if (seen[id]) return;
      seen[id] = true;
      out.push({
        userId: id,
        workspaceId: meta.workspaceId || subscribedId,
        displayName: meta.displayName || 'Collaborator',
        role: meta.role || null,
        activeProjectId: meta.activeProjectId || null,
        activeProductionId: meta.activeProductionId || null,
        activeSection: meta.activeSection || null,
        editing: !!meta.editing,
        lastSeen: meta.lastSeen || null
      });
    });
    out.sort(function (a, b) {
      return String(a.displayName).localeCompare(String(b.displayName));
    });
    return out;
  }

  function applyPresenceSync() {
    if (!channel || typeof channel.presenceState !== 'function') return;
    var list = normalizePresenceState(channel.presenceState());
    presenceMap = {};
    list.forEach(function (p) {
      presenceMap[p.userId] = p;
    });
    if (global.S) global.S.workspacePresence = list.slice();
    if (Ctx() && Ctx().onPresenceChanged) Ctx().onPresenceChanged(list);
    if (global.PreShootWorkspaceUI && PreShootWorkspaceUI.onPresenceChanged) {
      PreShootWorkspaceUI.onPresenceChanged(list);
    }
  }

  function trackPresenceNow(workspaceId) {
    if (!channel || subscribedId !== workspaceId) return Promise.resolve({ ok: false });
    var payload = buildPresencePayload(workspaceId);
    if (!payload) return Promise.resolve({ ok: false });
    var key =
      payload.userId +
      '|' +
      (payload.activeProductionId || '') +
      '|' +
      (payload.activeProjectId || '') +
      '|' +
      (payload.activeSection || '') +
      '|' +
      (payload.editing ? '1' : '0');
    if (key === lastTrackKey) return Promise.resolve({ ok: true, skipped: true });
    lastTrackKey = key;
    if (typeof channel.track !== 'function') return Promise.resolve({ ok: false });
    return Promise.resolve(channel.track(payload))
      .then(function () {
        return { ok: true };
      })
      .catch(function (err) {
        return { ok: false, error: String(err && err.message) };
      });
  }

  function scheduleTrack(workspaceId) {
    if (trackTimer) clearTimeout(trackTimer);
    trackTimer = setTimeout(function () {
      trackTimer = null;
      trackPresenceNow(workspaceId || subscribedId);
    }, 400);
  }

  /**
   * Subscribe to a private shared-workspace channel.
   * Membership is enforced server-side via realtime.messages RLS.
   */
  function subscribe(workspaceId, opts) {
    opts = opts || {};
    if (!workspaceId) return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    if (!opts.force && subscribedId === workspaceId && channel) {
      scheduleTrack(workspaceId);
      return Promise.resolve({ ok: true, already: true, workspaceId: workspaceId });
    }

    var s = getSupa();
    if (!s || typeof s.channel !== 'function') {
      setStatus('error');
      return Promise.resolve({ ok: false, error: 'realtime_unavailable' });
    }

    var uid = myUserId();
    return unsubscribe().then(function () {
      return ensureRealtimeAuth();
    }).then(function (authed) {
      if (!authed) {
        setStatus('error');
        scheduleReconnect(workspaceId);
        return { ok: false, error: 'auth_required' };
      }

      setStatus('connecting');
      subscribedId = workspaceId;
      var ch = s.channel(topicFor(workspaceId), {
        config: {
          private: true,
          presence: { key: uid || undefined }
        }
      });

      ch.on('broadcast', { event: EVENT }, function (msg) {
        handleBroadcast(workspaceId, msg && msg.payload ? msg.payload : msg);
      });

      ch.on('presence', { event: 'sync' }, function () {
        if (subscribedId !== workspaceId) return;
        applyPresenceSync();
      });
      ch.on('presence', { event: 'join' }, function () {
        if (subscribedId !== workspaceId) return;
        applyPresenceSync();
      });
      ch.on('presence', { event: 'leave' }, function () {
        if (subscribedId !== workspaceId) return;
        applyPresenceSync();
      });

      channel = ch;
      return new Promise(function (resolve) {
        ch.subscribe(function (st, err) {
          if (st === 'SUBSCRIBED') {
            authRetry = 0;
            setStatus('subscribed');
            trackPresenceNow(workspaceId).then(function () {
              applyPresenceSync();
              resolve({ ok: true, workspaceId: workspaceId });
            });
            return;
          }
          if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
            setStatus('error');
            if (subscribedId === workspaceId) {
              scheduleReconnect(workspaceId);
            }
            resolve({
              ok: false,
              error: 'subscribe_failed',
              status: st,
              detail: err ? String(err.message || err) : null
            });
          }
        });
      });
    });
  }

  function handleBroadcast(expectedWorkspaceId, payload) {
    if (!payload || typeof payload !== 'object') return;
    var ctx = Ctx();
    if (!ctx || !ctx.isShared || !ctx.isShared()) return;

    var live = ctx.getContext();
    if (!live || live.activeWorkspaceId !== expectedWorkspaceId) return;
    if (payload.workspace_id && payload.workspace_id !== expectedWorkspaceId) return;

    var incomingRev = Number(payload.revision);
    if (!Number.isFinite(incomingRev) || incomingRev < 1) return;

    /* Loop prevention: ignore our own save echo / stale */
    if (ctx.shouldIgnoreRealtimeRevision && ctx.shouldIgnoreRealtimeRevision(incomingRev, payload)) {
      return;
    }

    var currentRev = Number(live.activeWorkspaceRevision) || 0;
    if (incomingRev <= currentRev) return;

    var change =
      payload.change ||
      (payload.change_type
        ? {
            type: payload.change_type,
            entityId: payload.entity_id || null,
            entityLabel: payload.entity_label || null,
            projectId: payload.project_id || null,
            productionId: payload.production_id || null
          }
        : null);

    if (ctx.onRemoteWorkspaceUpdated) {
      ctx.onRemoteWorkspaceUpdated({
        workspace_id: expectedWorkspaceId,
        revision: incomingRev,
        updated_by: payload.updated_by || null,
        updated_at: payload.updated_at || null,
        type: payload.type || 'workspace.updated',
        gap: incomingRev > currentRev + 1,
        change: change,
        change_type: payload.change_type || (change && change.type) || null,
        entity_id: payload.entity_id || (change && change.entityId) || null,
        entity_label: payload.entity_label || (change && change.entityLabel) || null,
        project_id: payload.project_id || (change && change.projectId) || null,
        production_id: payload.production_id || (change && change.productionId) || null,
        activity_label: payload.activity_label || null,
        changes: payload.changes || null
      });
    }
  }

  function onAuthChanged() {
    if (!Ctx() || !Ctx().isShared || !Ctx().isShared()) return;
    var id = Ctx().getContext().activeWorkspaceId;
    if (id) subscribe(id, { force: true });
  }

  function getPresence() {
    return Object.keys(presenceMap).map(function (k) {
      return presenceMap[k];
    });
  }

  function getStatus() {
    return {
      status: status,
      workspaceId: subscribedId,
      topic: subscribedId ? topicFor(subscribedId) : null,
      presenceCount: Object.keys(presenceMap).length
    };
  }

  global.PreShootWorkspaceRealtime = {
    EVENT: EVENT,
    topicFor: topicFor,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    onAuthChanged: onAuthChanged,
    getStatus: getStatus,
    getPresence: getPresence,
    trackPresence: function () {
      return trackPresenceNow(subscribedId);
    },
    scheduleTrack: scheduleTrack,
    ensureRealtimeAuth: ensureRealtimeAuth
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
