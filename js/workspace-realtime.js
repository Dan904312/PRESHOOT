/**
 * PreShoot Workspace Realtime — Phase 3A foundation.
 * Private Broadcast channels for shared workspaces only.
 * Database + /api/workspace-sync remain the source of truth.
 * Never broadcasts documents, personal data, or credentials.
 *
 * Presence-ready channel config (private:true) — Presence UI NOT implemented.
 */
(function (global) {
  'use strict';

  var EVENT = 'workspace.updated';
  var channel = null;
  var subscribedId = null;
  var status = 'idle'; /* idle | connecting | subscribed | error */
  var reconnectTimer = null;
  var authRetry = 0;

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

  function unsubscribe() {
    clearReconnect();
    var prev = channel;
    channel = null;
    subscribedId = null;
    setStatus('idle');
    if (!prev) return Promise.resolve();
    try {
      var s = getSupa();
      if (s && s.removeChannel) return Promise.resolve(s.removeChannel(prev));
      if (prev.unsubscribe) return Promise.resolve(prev.unsubscribe());
    } catch (e) {}
    return Promise.resolve();
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

  /**
   * Subscribe to a private shared-workspace channel.
   * Membership is enforced server-side via realtime.messages RLS.
   */
  function subscribe(workspaceId, opts) {
    opts = opts || {};
    if (!workspaceId) return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    if (!opts.force && subscribedId === workspaceId && channel) {
      return Promise.resolve({ ok: true, already: true, workspaceId: workspaceId });
    }

    var s = getSupa();
    if (!s || typeof s.channel !== 'function') {
      setStatus('error');
      return Promise.resolve({ ok: false, error: 'realtime_unavailable' });
    }

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
          private: true
          /* Presence can be enabled later without changing topic/auth shape */
        }
      });

      ch.on('broadcast', { event: EVENT }, function (msg) {
        handleBroadcast(workspaceId, msg && msg.payload ? msg.payload : msg);
      });

      channel = ch;
      return new Promise(function (resolve) {
        ch.subscribe(function (st, err) {
          if (st === 'SUBSCRIBED') {
            authRetry = 0;
            setStatus('subscribed');
            resolve({ ok: true, workspaceId: workspaceId });
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

    if (ctx.onRemoteWorkspaceUpdated) {
      ctx.onRemoteWorkspaceUpdated({
        workspace_id: expectedWorkspaceId,
        revision: incomingRev,
        updated_by: payload.updated_by || null,
        updated_at: payload.updated_at || null,
        type: payload.type || 'workspace.updated',
        gap: incomingRev > currentRev + 1
      });
    }
  }

  function onAuthChanged() {
    if (!Ctx() || !Ctx().isShared || !Ctx().isShared()) return;
    var id = Ctx().getContext().activeWorkspaceId;
    if (id) subscribe(id, { force: true });
  }

  function getStatus() {
    return {
      status: status,
      workspaceId: subscribedId,
      topic: subscribedId ? topicFor(subscribedId) : null
    };
  }

  global.PreShootWorkspaceRealtime = {
    EVENT: EVENT,
    topicFor: topicFor,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    onAuthChanged: onAuthChanged,
    getStatus: getStatus,
    ensureRealtimeAuth: ensureRealtimeAuth
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
