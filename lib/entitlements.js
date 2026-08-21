/**
 * Server-authoritative onboarding reward + creator streak.
 * Paid Stripe/promo subscriptions are never mutated here.
 * Does not import security.js (avoid circular entitlement gates).
 */

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  };
}

const FREE_DAILY_SCANS = parseInt(process.env.FREE_DAILY_SCANS || '3', 10);

export const ONBOARDING_FREE_SCANS = 3;
export const ONBOARDING_TRIAL_HOURS = 24;
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];
export const STREAK_KINDS = ['scan', 'idea', 'director', 'studio', 'plan', 'post'];
export const STREAK_DAYS_CAP = 120;

const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

export function sanitizeTimezone(tz) {
  const s = String(tz || '').trim();
  if (!TZ_RE.test(s) || s.includes('..')) return 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: s }).format(new Date());
    return s;
  } catch (e) {
    return 'UTC';
  }
}

export function localDateIso(now, tz) {
  const safe = sanitizeTimezone(tz);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: safe,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now instanceof Date ? now : new Date(now));
  } catch (e) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now instanceof Date ? now : new Date(now));
  }
}

export function addDaysIso(iso, delta) {
  const parts = String(iso || '').split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + delta));
  return d.toISOString().slice(0, 10);
}

function uniqueSortedDays(days) {
  const set = {};
  (Array.isArray(days) ? days : []).forEach((d) => {
    const s = String(d || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set[s] = true;
  });
  return Object.keys(set).sort();
}

/**
 * Pure streak transition. Multiple actions on the same local day do not increment.
 * Skipping a local calendar day resets current streak to 1.
 */
export function applyStreakTransition(prev, todayIso) {
  const last = (prev && prev.lastActiveDate) || null;
  const current0 = Math.max(0, parseInt((prev && prev.current) || 0, 10) || 0);
  const longest0 = Math.max(0, parseInt((prev && prev.longest) || 0, 10) || 0);
  const days0 = uniqueSortedDays(prev && prev.days);

  if (last === todayIso) {
    return {
      current: current0 || 1,
      longest: Math.max(longest0, current0 || 1),
      lastActiveDate: todayIso,
      days: days0.includes(todayIso) ? days0 : uniqueSortedDays(days0.concat([todayIso])).slice(-STREAK_DAYS_CAP),
      incremented: false,
      milestone: null
    };
  }

  const yesterday = addDaysIso(todayIso, -1);
  const current = last === yesterday ? current0 + 1 : 1;
  const longest = Math.max(longest0, current);
  const days = uniqueSortedDays(days0.concat([todayIso])).slice(-STREAK_DAYS_CAP);
  const milestone = STREAK_MILESTONES.indexOf(current) >= 0 ? current : null;

  return {
    current,
    longest,
    lastActiveDate: todayIso,
    days,
    incremented: true,
    milestone
  };
}

export function trialActive(iso, now) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t > (now instanceof Date ? now.getTime() : Date.now());
}

function parseDays(raw) {
  if (Array.isArray(raw)) return uniqueSortedDays(raw);
  if (typeof raw === 'string') {
    try {
      return uniqueSortedDays(JSON.parse(raw));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Merge paid subscription with onboarding overlay.
 * `plan` remains the real subscription. Director/Studio flags are overlays.
 */
export function buildEntitlementSnapshot(sub, row, now, dailyUsed) {
  const paid = !!(sub && sub.plan === 'pro');
  const ts = now instanceof Date ? now : new Date();
  const directorTrialEndsAt = (row && row.director_trial_ends_at) || null;
  const studioTrialEndsAt = (row && row.studio_trial_ends_at) || null;
  const directorTrial = trialActive(directorTrialEndsAt, ts);
  const studioTrial = trialActive(studioTrialEndsAt, ts);
  const freeScansRemaining = Math.max(
    0,
    Math.min(
      ONBOARDING_FREE_SCANS,
      parseInt((row && row.free_scans_remaining) || 0, 10) || 0
    )
  );
  const used = Math.max(0, parseInt(dailyUsed || 0, 10) || 0);
  const dailyRemaining = paid
    ? null
    : Math.max(0, FREE_DAILY_SCANS - used);
  const scansUnlimited = paid;
  const canScan = scansUnlimited || freeScansRemaining > 0 || dailyRemaining > 0;

  return {
    plan: paid ? 'pro' : 'free',
    status: (sub && sub.status) || 'none',
    director: paid || directorTrial,
    studio: paid || studioTrial,
    scansUnlimited,
    canScan,
    freeScansRemaining,
    dailyScansRemaining: dailyRemaining,
    onboardingRewardGranted: !!(row && row.onboarding_reward_granted),
    onboardingRewardGrantedAt: (row && row.onboarding_reward_granted_at) || null,
    directorTrialEndsAt,
    studioTrialEndsAt,
    streak: {
      current: Math.max(0, parseInt((row && row.streak_current) || 0, 10) || 0),
      longest: Math.max(0, parseInt((row && row.streak_longest) || 0, 10) || 0),
      lastActiveDate: (row && row.streak_last_active_date) || null,
      days: parseDays(row && row.streak_days),
      timezone: sanitizeTimezone((row && row.timezone) || 'UTC')
    }
  };
}

async function rpc(name, body) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return { ok: false, error: 'no_config' };
  }
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(body || {})
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    return {
      ok: false,
      error: 'rpc_failed',
      status: r.status,
      hint: data && (data.message || data.hint || data.code)
    };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'rpc_failed' };
  return data;
}

export async function fetchUserEntitlementRow(userId) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY || !userId) return null;
  const r = await fetch(
    `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=onboarding_reward_granted,onboarding_reward_granted_at,free_scans_remaining,director_trial_ends_at,studio_trial_ends_at,streak_current,streak_longest,streak_last_active_date,streak_days,timezone&limit=1`,
    { headers: serviceHeaders() }
  );
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rows[0];
}

export async function fetchDailyScanCount(userId) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY || !userId) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const r = await fetch(
    `${SUPA_URL}/rest/v1/usage_daily?user_id=eq.${encodeURIComponent(userId)}&day=eq.${day}&select=scans&limit=1`,
    { headers: serviceHeaders() }
  );
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows) || !rows[0]) return 0;
  return parseInt(rows[0].scans || 0, 10) || 0;
}

export async function loadEntitlement(userId, email, getSubscription) {
  const sub = await getSubscription(userId, email);
  const row = await fetchUserEntitlementRow(userId);
  const dailyUsed = sub.plan === 'pro' ? 0 : await fetchDailyScanCount(userId);
  return buildEntitlementSnapshot(sub, row, new Date(), dailyUsed);
}

export async function grantOnboardingReward(userId, timezone) {
  const tz = sanitizeTimezone(timezone);
  const result = await rpc('grant_onboarding_reward', {
    p_user_id: userId,
    p_timezone: tz
  });
  return result;
}

export async function consumeOnboardingScan(userId) {
  return rpc('consume_onboarding_scan', { p_user_id: userId });
}

export async function refundOnboardingScan(userId) {
  return rpc('refund_onboarding_scan', { p_user_id: userId });
}

export async function recordCreationActivity(userId, kind, timezone) {
  const safeKind = STREAK_KINDS.indexOf(String(kind || '')) >= 0 ? kind : 'studio';
  return rpc('record_creation_activity', {
    p_user_id: userId,
    p_kind: safeKind,
    p_timezone: sanitizeTimezone(timezone)
  });
}
