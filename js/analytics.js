/**
 * PreShoot product analytics (Phase 6–7).
 * Metadata-only events → /api/track-user (check-plan).
 * Never sends scripts, chats, or media.
 */
(function (global) {
  'use strict';

  var ALLOWED = {
    signup: 1,
    onboarding_started: 1,
    onboarding_completed: 1,
    scan_started: 1,
    scan_completed: 1,
    idea_generated: 1,
    project_created: 1,
    production_created: 1,
    script_created: 1,
    shotlist_created: 1,
    director_opened: 1,
    director_used: 1,
    director_action_requested: 1,
    director_action_success: 1,
    director_action_failure: 1,
    asset_uploaded: 1,
    reference_added: 1,
    workspace_created: 1,
    workspace_invited: 1,
    workspace_joined: 1,
    comment_created: 1,
    production_reviewed: 1,
    production_performance_updated: 1,
    pricing_viewed: 1,
    checkout_started: 1,
    subscription_started: 1,
    subscription_cancelled: 1,
    referral_created: 1,
    referral_clicked: 1,
    referral_signup: 1,
    referral_activation: 1,
    hook_structure_used: 1,
    ai_request: 1,
    api_error: 1,
    perf_timing: 1
  };

  var _queue = [];
  var _flushTimer = null;
  var _seen = {};

  function apiFetch(url, opts) {
    if (typeof global.apiFetch === 'function') return global.apiFetch(url, opts);
    return fetch(url, opts || {});
  }

  function deviceSurface() {
    try {
      if (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) return 'mobile';
      if (/iPhone|iPad|iPod|Android/i.test(String(global.navigator && navigator.userAgent))) {
        return 'mobile';
      }
    } catch (e) {}
    return 'desktop';
  }

  function baseMeta(extra) {
    var m = {
      surface: deviceSurface(),
      plan: (global.S && S.plan) || 'unknown'
    };
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (k) {
        m[k] = extra[k];
      });
    }
    return m;
  }

  function captureReferralFromUrl() {
    try {
      var params = new URLSearchParams(global.location && location.search ? location.search : '');
      var ref = params.get('ref') || params.get('referral');
      if (!ref) return;
      ref = String(ref).slice(0, 40);
      localStorage.setItem('scout_ref', ref);
      track('referral_clicked', { ref: ref });
      /* Clean URL without losing hash */
      if (global.history && history.replaceState) {
        params.delete('ref');
        params.delete('referral');
        var q = params.toString();
        history.replaceState(
          {},
          '',
          location.pathname + (q ? '?' + q : '') + (location.hash || '')
        );
      }
    } catch (e) {}
  }

  function getReferralCode() {
    try {
      return localStorage.getItem('scout_ref') || null;
    } catch (e) {
      return null;
    }
  }

  function myReferralCode() {
    var id = global.S && S.authUser && S.authUser.id;
    if (!id) return null;
    return String(id).replace(/-/g, '').slice(0, 10);
  }

  function referralShareUrl() {
    var code = myReferralCode();
    if (!code) return 'https://preshoot.vercel.app/app.html';
    return 'https://preshoot.vercel.app/app.html?ref=' + encodeURIComponent(code);
  }

  function track(eventName, meta, opts) {
    var name = String(eventName || '');
    if (!ALLOWED[name]) return;
    opts = opts || {};
    /* Dedupe identical events within a short window (reconnect spam) */
    if (opts.dedupeKey) {
      var dk = name + ':' + opts.dedupeKey;
      var now = Date.now();
      if (_seen[dk] && now - _seen[dk] < 4000) return;
      _seen[dk] = now;
    }
    var payload = {
      event: name,
      meta: baseMeta(meta),
      at: Date.now()
    };
    delete payload.meta.body;
    delete payload.meta.script;
    delete payload.meta.messages;
    delete payload.meta.document;
    delete payload.meta.prompt;
    delete payload.meta.content;
    _queue.push(payload);
    if (_queue.length > 30) _queue = _queue.slice(-30);
    if (_flushTimer) return;
    _flushTimer = setTimeout(flush, 900);
  }

  function flush() {
    _flushTimer = null;
    if (!_queue.length) return;
    if (!global.S || !global.S.authUser) {
      /* Keep referral_clicked / pre-auth events until auth, then drop others */
      _queue = _queue.filter(function (e) {
        return e.event === 'referral_clicked' || e.event === 'pricing_viewed';
      });
      if (!_queue.length) return;
      /* pricing/referral before auth: wait for auth */
      return;
    }
    var batch = _queue.slice();
    _queue = [];
    var ref = getReferralCode();
    if (ref) {
      batch.forEach(function (e) {
        if (e.event === 'signup' || e.event === 'onboarding_completed') {
          e.meta = e.meta || {};
          e.meta.ref = ref;
        }
      });
    }
    apiFetch('/api/track-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'events', events: batch, ref: ref || undefined })
    }).catch(function () {});
  }

  function markActivatedLocally() {
    try {
      localStorage.setItem('scout_activated', '1');
    } catch (e) {}
  }

  function maybeTrackActivation() {
    try {
      if (localStorage.getItem('scout_activated') === '1') return;
      var hasIdea = localStorage.getItem('scout_had_idea') === '1';
      var hasProd = localStorage.getItem('scout_had_production') === '1';
      if (hasIdea && hasProd) {
        markActivatedLocally();
        var ref = getReferralCode();
        if (ref) track('referral_activation', { ref: ref });
      }
    } catch (e) {}
  }

  function noteIdeaGenerated() {
    try {
      localStorage.setItem('scout_had_idea', '1');
    } catch (e) {}
    maybeTrackActivation();
  }

  function noteProductionCreated() {
    try {
      localStorage.setItem('scout_had_production', '1');
    } catch (e) {}
    maybeTrackActivation();
  }

  /* Capture ?ref= on load */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', captureReferralFromUrl);
    } else {
      captureReferralFromUrl();
    }
  }

  global.PreShootAnalytics = {
    track: track,
    flush: flush,
    deviceSurface: deviceSurface,
    getReferralCode: getReferralCode,
    myReferralCode: myReferralCode,
    referralShareUrl: referralShareUrl,
    noteIdeaGenerated: noteIdeaGenerated,
    noteProductionCreated: noteProductionCreated,
    captureReferralFromUrl: captureReferralFromUrl,
    ALLOWED: ALLOWED
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
