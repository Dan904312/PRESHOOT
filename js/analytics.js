/**
 * Minimal first-party product analytics (Phase 6).
 * No PII content payloads — event name + small metadata only.
 * Uses existing /api/track-user rewrite → check-plan?__resource=event
 */
(function (global) {
  'use strict';

  var ALLOWED = {
    signup: 1,
    workspace_created: 1,
    workspace_invited: 1,
    workspace_joined: 1,
    project_created: 1,
    production_created: 1,
    director_used: 1,
    director_action_success: 1,
    director_action_failure: 1,
    script_created: 1,
    shotlist_created: 1,
    asset_uploaded: 1,
    comment_created: 1,
    production_reviewed: 1,
    subscription_started: 1
  };

  var _queue = [];
  var _flushTimer = null;

  function apiFetch(url, opts) {
    if (typeof global.apiFetch === 'function') return global.apiFetch(url, opts);
    return fetch(url, opts || {});
  }

  function track(eventName, meta) {
    var name = String(eventName || '');
    if (!ALLOWED[name]) return;
    var payload = {
      event: name,
      meta: meta && typeof meta === 'object' ? meta : {},
      at: Date.now()
    };
    /* Strip sensitive keys if present */
    delete payload.meta.body;
    delete payload.meta.script;
    delete payload.meta.messages;
    delete payload.meta.document;
    _queue.push(payload);
    if (_queue.length > 20) _queue = _queue.slice(-20);
    if (_flushTimer) return;
    _flushTimer = setTimeout(flush, 1200);
  }

  function flush() {
    _flushTimer = null;
    if (!_queue.length) return;
    if (!global.S || !global.S.authUser) {
      _queue = [];
      return;
    }
    var batch = _queue.slice();
    _queue = [];
    apiFetch('/api/track-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'events', events: batch })
    }).catch(function () {});
  }

  global.PreShootAnalytics = {
    track: track,
    flush: flush
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
