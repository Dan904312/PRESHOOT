/* PreShoot entitlements — client mirror of server check-plan overlay.
 * Never grant from localStorage. Server is the source of truth.
 */
(function (global) {
  function tz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  function apply(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof S === 'undefined') return;
    if (data.entitlement) data = Object.assign({}, data, data.entitlement);
    S.plan = data.plan === 'pro' ? 'pro' : 'free';
    S.entitlement = {
      plan: S.plan,
      status: data.status || 'none',
      director: data.director === true,
      studio: data.studio === true,
      scansUnlimited: data.scansUnlimited === true,
      canScan: data.canScan !== false,
      freeScansRemaining: Math.max(0, parseInt(data.freeScansRemaining || 0, 10) || 0),
      dailyScansRemaining:
        data.dailyScansRemaining == null ? null : Math.max(0, parseInt(data.dailyScansRemaining, 10) || 0),
      onboardingRewardGranted: data.onboardingRewardGranted === true,
      onboardingRewardGrantedAt: data.onboardingRewardGrantedAt || null,
      directorTrialEndsAt: data.directorTrialEndsAt || null,
      studioTrialEndsAt: data.studioTrialEndsAt || null,
      streak: data.streak || { current: 0, longest: 0, lastActiveDate: null, days: [] }
    };
    try {
      if (typeof ss === 'function') {
        ss('plan', S.plan);
        ss('plan_checked', Date.now());
      }
    } catch (e) {}
    if (typeof renderHome === 'function') renderHome();
    if (S.tab === 'profile' && typeof renderProf === 'function') renderProf();
    var dl = document.getElementById('dir-lock');
    if (dl) dl.style.display = hasDirector() ? 'none' : 'inline';
    if (global.PreShootStreak && PreShootStreak.syncFromEntitlement) {
      PreShootStreak.syncFromEntitlement(S.entitlement);
    }
  }

  function hasDirector() {
    if (typeof S === 'undefined') return false;
    if (S.plan === 'pro') return true;
    return !!(S.entitlement && S.entitlement.director);
  }

  function hasStudio() {
    if (typeof S === 'undefined') return false;
    if (S.plan === 'pro') return true;
    return !!(S.entitlement && S.entitlement.studio);
  }

  function canScan() {
    if (typeof S === 'undefined') return false;
    if (S.plan === 'pro') return true;
    var e = S.entitlement;
    if (e) {
      if (e.scansUnlimited) return true;
      if ((e.freeScansRemaining || 0) > 0) return true;
      if (e.dailyScansRemaining != null) return e.dailyScansRemaining > 0;
      if (e.canScan === true) return true;
      if (e.canScan === false) return false;
    }
    return typeof scansToday === 'function' ? scansToday() < 3 : true;
  }

  function remainingMs(iso) {
    if (!iso) return 0;
    var t = Date.parse(iso);
    if (!isFinite(t)) return 0;
    return Math.max(0, t - Date.now());
  }

  function formatRemaining(iso) {
    var ms = remainingMs(iso);
    if (ms <= 0) return '';
    var totalMin = Math.ceil(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + 'm remaining';
    return h + 'h ' + String(m).padStart(2, '0') + 'm remaining';
  }

  function apiPost(action, extra) {
    if (typeof apiFetch !== 'function') return Promise.reject(new Error('no api'));
    var body = Object.assign({ timezone: tz() }, extra || {});
    if (action) body.action = action;
    return apiFetch('/api/check-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json();
    });
  }

  function refresh() {
    if (typeof S === 'undefined' || !S.authUser) return Promise.resolve(null);
    return apiPost(null).then(function (data) {
      apply(data);
      return data;
    }).catch(function () {
      return null;
    });
  }

  function completeOnboarding() {
    if (typeof S === 'undefined' || !S.authUser) {
      return Promise.resolve({ ok: false, error: 'auth_required' });
    }
    return apiPost('grant_onboarding_reward').then(function (data) {
      if (data && data.entitlement) apply(data.entitlement);
      else if (data && data.plan) apply(data);
      return data;
    });
  }

  function recordActivity(kind) {
    if (typeof S === 'undefined' || !S.authUser) return Promise.resolve(null);
    return apiPost('record_activity', { kind: kind }).then(function (data) {
      if (data && data.ok && S.entitlement) {
        S.entitlement.streak = {
          current: data.current || 0,
          longest: data.longest || 0,
          lastActiveDate: data.lastActiveDate || null,
          days: Array.isArray(data.days) ? data.days : (S.entitlement.streak && S.entitlement.streak.days) || []
        };
        if (global.PreShootStreak && PreShootStreak.onActivity) {
          PreShootStreak.onActivity(data);
        }
        if (typeof renderHome === 'function') renderHome();
      }
      return data;
    }).catch(function () {
      return null;
    });
  }

  function showRewardModal() {
    if (typeof openM === 'function') openM('reward-modal');
  }

  function startCreating() {
    if (typeof closeM === 'function') closeM('reward-modal');
    if (typeof goTab === 'function') goTab('home');
  }

  global.PreShootEntitlements = {
    apply: apply,
    refresh: refresh,
    completeOnboarding: completeOnboarding,
    recordActivity: recordActivity,
    hasDirector: hasDirector,
    hasStudio: hasStudio,
    canScan: canScan,
    remainingMs: remainingMs,
    formatRemaining: formatRemaining,
    showRewardModal: showRewardModal,
    startCreating: startCreating,
    tz: tz
  };

  global.hasDirectorAccess = hasDirector;
  global.hasStudioAccess = hasStudio;
})(typeof window !== 'undefined' ? window : globalThis);
