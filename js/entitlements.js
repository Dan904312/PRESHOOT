/* PreShoot entitlements — client mirror of server check-plan overlay.
 * Never grant from localStorage. Server is the source of truth.
 */
(function (global) {
  var recordedToday = {};

  function tz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  function todayIso() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function workspaceId() {
    try {
      if (global.PreShootWorkspace && PreShootWorkspace.workspaceIdForDirector) {
        return PreShootWorkspace.workspaceIdForDirector() || null;
      }
    } catch (e) {}
    return null;
  }

  function apply(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof S === 'undefined') return;
    if (data.status === 'account_suspended' || data.error === 'account_suspended' || data.blocked === true) {
      if (typeof global.handleAccountSuspended === 'function') global.handleAccountSuspended();
      return;
    }
    if (data.entitlement) data = Object.assign({}, data, data.entitlement);
    S.plan = data.plan === 'pro' ? 'pro' : 'free';
    var streakIn = data.streak || {};
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
      streakAccessEndsAt: data.streakAccessEndsAt || null,
      accessEndsAt: data.accessEndsAt || null,
      streak: {
        current: Math.max(0, parseInt(streakIn.current || 0, 10) || 0),
        longest: Math.max(0, parseInt(streakIn.longest || 0, 10) || 0),
        lastActiveDate: streakIn.lastActiveDate || null,
        days: Array.isArray(streakIn.days) ? streakIn.days : [],
        timezone: streakIn.timezone || tz(),
        todayComplete: streakIn.todayComplete === true,
        freezeUntil: streakIn.freezeUntil || null,
        nextReward: streakIn.nextReward || null,
        progress: streakIn.progress || { at: 0, target: 10 },
        catalog: Array.isArray(streakIn.catalog) ? streakIn.catalog : [],
        activity: Array.isArray(streakIn.activity) ? streakIn.activity : [],
        rewards: Array.isArray(streakIn.rewards) ? streakIn.rewards : []
      }
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
    if (global.PreShootCalendar && PreShootCalendar.render && S.tab === 'plan') {
      PreShootCalendar.render();
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

  function accessEndsAt() {
    var e = typeof S !== 'undefined' ? S.entitlement : null;
    if (!e) return null;
    return e.accessEndsAt || e.streakAccessEndsAt || e.directorTrialEndsAt || e.studioTrialEndsAt || null;
  }

  function apiPost(action, extra) {
    if (typeof apiFetch !== 'function') return Promise.reject(new Error('no api'));
    var body = Object.assign({ timezone: tz() }, extra || {});
    if (action) body.action = action;
    var wid = workspaceId();
    if (wid && !body.workspaceId) body.workspaceId = wid;
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
    var day = todayIso();
    var key = String(kind || 'studio') + ':' + day;
    if (recordedToday[key]) return recordedToday[key];
    recordedToday[key] = apiPost('record_activity', { kind: kind }).then(function (data) {
      if (data && data.entitlement) {
        apply(data.entitlement);
      } else if (data && data.ok && S.entitlement) {
        S.entitlement.streak = Object.assign({}, S.entitlement.streak || {}, {
          current: data.current || 0,
          longest: data.longest || 0,
          lastActiveDate: data.lastActiveDate || null,
          days: Array.isArray(data.days) ? data.days : (S.entitlement.streak && S.entitlement.streak.days) || [],
          todayComplete: data.todayComplete === true
        });
        if (global.PreShootStreak && PreShootStreak.onActivity) {
          PreShootStreak.onActivity(data);
        }
        if (typeof renderHome === 'function') renderHome();
      } else {
        recordedToday[key] = null;
      }
      if (data && data.ok && global.PreShootStreak && PreShootStreak.onActivity) {
        PreShootStreak.onActivity(data);
      }
      return data;
    }).catch(function () {
      recordedToday[key] = null;
      return null;
    });
    return recordedToday[key];
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
    accessEndsAt: accessEndsAt,
    showRewardModal: showRewardModal,
    startCreating: startCreating,
    tz: tz
  };

  global.hasDirectorAccess = hasDirector;
  global.hasStudioAccess = hasStudio;
})(typeof window !== 'undefined' ? window : globalThis);
