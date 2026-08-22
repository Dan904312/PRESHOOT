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
export const STREAK_DAYS_CAP = 120;
export const STREAK_ACTIVITY_LOOKBACK = 120;

/**
 * Configurable streak milestones. Access rewards are server-granted.
 * Later milestones can add hours/director/studio without UI rewrites.
 */
export const STREAK_REWARD_CATALOG = [
  {
    days: 3,
    kind: 'achievement',
    title: '3-day streak',
    description: 'Three days in a row.'
  },
  {
    days: 7,
    kind: 'achievement',
    title: '7-day streak',
    description: 'A full week of creating.'
  },
  {
    days: 10,
    kind: 'access',
    hours: 48,
    director: true,
    studio: true,
    freeOnly: true,
    title: '10-day streak',
    description: '2 free days of Director + Studio'
  },
  {
    days: 30,
    kind: 'achievement',
    title: '30-day streak',
    description: 'A month of consistent creating.'
  },
  {
    days: 60,
    kind: 'achievement',
    title: '60-day streak',
    description: 'Two months in a row.'
  },
  {
    days: 100,
    kind: 'achievement',
    title: '100-day streak',
    description: 'Major consistency milestone.'
  }
];

export const STREAK_MILESTONES = STREAK_REWARD_CATALOG.map((r) => r.days);

export const STREAK_KINDS = [
  'scan',
  'idea',
  'director',
  'studio',
  'plan',
  'post',
  'onboarding',
  'project',
  'script',
  'shotlist',
  'save'
];

export const ACTIVITY_KIND_LABELS = {
  scan: 'Completed Scan',
  idea: 'Created idea',
  director: 'Director session',
  studio: 'Studio update',
  plan: 'Planned content',
  post: 'Marked Posted',
  onboarding: 'Completed intro',
  project: 'Created project',
  script: 'Generated script',
  shotlist: 'Generated shot list',
  save: 'Saved Studio content'
};

const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (DATE_RE.test(s)) set[s] = true;
  });
  return Object.keys(set).sort();
}

export function longestConsecutiveRun(days) {
  const unique = uniqueSortedDays(days);
  if (!unique.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === addDaysIso(unique[i - 1], 1)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

function runEndingAt(days, endIso) {
  const set = {};
  uniqueSortedDays(days).forEach((d) => {
    set[d] = true;
  });
  if (!set[endIso]) return 0;
  let n = 0;
  let cursor = endIso;
  while (set[cursor]) {
    n += 1;
    cursor = addDaysIso(cursor, -1);
  }
  return n;
}

/**
 * Whether a missed local day should be ignored. Reserved for a future
 * streak-freeze product. freezeUntil is a YYYY-MM-DD local date or null.
 */
export function freezeCoversDate(freezeUntil, iso) {
  const f = String(freezeUntil || '').slice(0, 10);
  const d = String(iso || '').slice(0, 10);
  return DATE_RE.test(f) && DATE_RE.test(d) && d <= f;
}

/**
 * Deterministic streak from unique local dates.
 * today inactive + yesterday active → current remains until today expires.
 * A gap with no freeze → current is 0 until the user is active again.
 */
export function computeStreakFromDates(dates, todayIso, opts) {
  const unique = uniqueSortedDays(dates);
  const freezeUntil = opts && opts.freezeUntil ? String(opts.freezeUntil).slice(0, 10) : null;
  const longest = longestConsecutiveRun(unique);
  const lastActiveDate = unique.length ? unique[unique.length - 1] : null;
  const yesterday = addDaysIso(todayIso, -1);
  const hasToday = unique.indexOf(todayIso) >= 0;
  const hasYesterday =
    unique.indexOf(yesterday) >= 0 || freezeCoversDate(freezeUntil, yesterday);

  let endDate = null;
  if (hasToday) endDate = todayIso;
  else if (hasYesterday) endDate = yesterday;

  if (!endDate) {
    return {
      current: 0,
      longest,
      lastActiveDate,
      days: unique.slice(-STREAK_DAYS_CAP),
      todayComplete: false
    };
  }

  const current = runEndingAt(unique, endDate);
  return {
    current,
    longest: Math.max(longest, current),
    lastActiveDate,
    days: unique.slice(-STREAK_DAYS_CAP),
    todayComplete: hasToday
  };
}

export function nextRewardProgress(current) {
  const n = Math.max(0, parseInt(current, 10) || 0);
  for (let i = 0; i < STREAK_REWARD_CATALOG.length; i++) {
    const item = STREAK_REWARD_CATALOG[i];
    if (n < item.days) {
      return {
        at: n,
        target: item.days,
        reward: item
      };
    }
  }
  const last = STREAK_REWARD_CATALOG[STREAK_REWARD_CATALOG.length - 1];
  return { at: n, target: last ? last.days : n, reward: null };
}

export function resolveRewardForPlan(def, plan) {
  if (!def) return null;
  if (def.kind === 'access' && def.freeOnly && plan === 'pro') {
    return {
      days: def.days,
      kind: 'achievement',
      hours: 0,
      director: false,
      studio: false,
      title: def.title,
      description: def.description,
      skippedAccess: true
    };
  }
  return {
    days: def.days,
    kind: def.kind,
    hours: def.hours || 0,
    director: def.director === true,
    studio: def.studio === true,
    title: def.title,
    description: def.description,
    skippedAccess: false
  };
}

export function evaluateMilestoneGrants(current, alreadyGranted, plan) {
  const n = Math.max(0, parseInt(current, 10) || 0);
  const granted = alreadyGranted instanceof Set ? alreadyGranted : new Set(alreadyGranted || []);
  const out = [];
  STREAK_REWARD_CATALOG.forEach((def) => {
    if (n < def.days) return;
    if (granted.has(def.days)) return;
    out.push(resolveRewardForPlan(def, plan === 'pro' ? 'pro' : 'free'));
  });
  return out;
}

/**
 * Stack a new timed grant on top of any still-active overlay.
 * Uses the latest of (now, existing expiry timestamps) then adds hours.
 */
export function computeStackedExpiry(existingEnds, addHours, now) {
  const hours = Math.max(0, Number(addHours) || 0);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  let base = nowMs;
  (Array.isArray(existingEnds) ? existingEnds : [existingEnds]).forEach((iso) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > base) base = t;
  });
  return new Date(base + hours * 3600 * 1000).toISOString();
}

function laterIso(a, b) {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? b : null;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
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

function groupActivity(rows) {
  const byDate = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const iso = String((row && (row.local_date || row.date)) || '').slice(0, 10);
    const kind = String((row && (row.event_type || row.kind)) || '').slice(0, 32);
    if (!DATE_RE.test(iso) || STREAK_KINDS.indexOf(kind) < 0) return;
    if (!byDate[iso]) byDate[iso] = [];
    if (byDate[iso].indexOf(kind) < 0) byDate[iso].push(kind);
  });
  return Object.keys(byDate)
    .sort()
    .map((date) => ({
      date,
      types: byDate[date],
      labels: byDate[date].map((k) => ACTIVITY_KIND_LABELS[k] || k)
    }));
}

/**
 * Merge paid subscription with onboarding + streak overlays.
 * `plan` remains the real subscription. Director/Studio flags are overlays.
 */
export function buildEntitlementSnapshot(sub, row, now, dailyUsed, extras) {
  const paid = !!(sub && sub.plan === 'pro');
  const ts = now instanceof Date ? now : new Date();
  const directorTrialEndsAt = (row && row.director_trial_ends_at) || null;
  const studioTrialEndsAt = (row && row.studio_trial_ends_at) || null;
  const streakDirectorEndsAt = (row && row.streak_director_ends_at) || null;
  const streakStudioEndsAt = (row && row.streak_studio_ends_at) || null;
  const directorTrial = trialActive(directorTrialEndsAt, ts);
  const studioTrial = trialActive(studioTrialEndsAt, ts);
  const streakDirector = trialActive(streakDirectorEndsAt, ts);
  const streakStudio = trialActive(streakStudioEndsAt, ts);
  const freeScansRemaining = Math.max(
    0,
    Math.min(
      ONBOARDING_FREE_SCANS,
      parseInt((row && row.free_scans_remaining) || 0, 10) || 0
    )
  );
  const used = Math.max(0, parseInt(dailyUsed || 0, 10) || 0);
  const dailyRemaining = paid ? null : Math.max(0, FREE_DAILY_SCANS - used);
  const scansUnlimited = paid;
  const canScan = scansUnlimited || freeScansRemaining > 0 || dailyRemaining > 0;
  const tz = sanitizeTimezone((row && row.timezone) || (extras && extras.timezone) || 'UTC');
  const todayIso = localDateIso(ts, tz);
  const activity = extras && Array.isArray(extras.activity) ? extras.activity : [];
  const fromDays = computeStreakFromDates(
    parseDays(row && row.streak_days).concat(activity.map((a) => a && a.date)),
    todayIso,
    {
      freezeUntil: row && row.streak_freeze_until
    }
  );
  const rewards = extras && Array.isArray(extras.rewards) ? extras.rewards : [];
  const progress = nextRewardProgress(fromDays.current);
  const accessEndsAt = laterIso(
    laterIso(directorTrial ? directorTrialEndsAt : null, studioTrial ? studioTrialEndsAt : null),
    laterIso(streakDirector ? streakDirectorEndsAt : null, streakStudio ? streakStudioEndsAt : null)
  );

  return {
    plan: paid ? 'pro' : 'free',
    status: (sub && sub.status) || 'none',
    director: paid || directorTrial || streakDirector,
    studio: paid || studioTrial || streakStudio,
    scansUnlimited,
    canScan,
    freeScansRemaining,
    dailyScansRemaining: dailyRemaining,
    onboardingRewardGranted: !!(row && row.onboarding_reward_granted),
    onboardingRewardGrantedAt: (row && row.onboarding_reward_granted_at) || null,
    directorTrialEndsAt,
    studioTrialEndsAt,
    streakAccessEndsAt: laterIso(
      streakDirector ? streakDirectorEndsAt : null,
      streakStudio ? streakStudioEndsAt : null
    ),
    accessEndsAt,
    streak: {
      current: fromDays.current,
      longest: Math.max(
        fromDays.longest,
        Math.max(0, parseInt((row && row.streak_longest) || 0, 10) || 0)
      ),
      lastActiveDate: fromDays.lastActiveDate,
      days: fromDays.days,
      timezone: tz,
      todayComplete: fromDays.todayComplete,
      freezeUntil: (row && row.streak_freeze_until) || null,
      nextReward: progress.reward
        ? {
            days: progress.reward.days,
            title: progress.reward.title,
            description: progress.reward.description,
            kind: progress.reward.kind
          }
        : null,
      progress: { at: progress.at, target: progress.target },
      catalog: STREAK_REWARD_CATALOG.map((r) => ({
        days: r.days,
        kind: r.kind,
        title: r.title,
        description: r.description,
        hours: r.hours || 0
      })),
      activity,
      rewards
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

async function restJson(path, init) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, status: 0, data: null };
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init && init.headers) }
  });
  const text = await r.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text.slice(0, 200);
    }
  }
  return { ok: r.ok, status: r.status, data };
}

const USER_SELECT =
  'onboarding_reward_granted,onboarding_reward_granted_at,free_scans_remaining,director_trial_ends_at,studio_trial_ends_at,streak_current,streak_longest,streak_last_active_date,streak_days,timezone,streak_director_ends_at,streak_studio_ends_at,streak_freeze_until,streak_backfilled_at';

export async function fetchUserEntitlementRow(userId) {
  if (!userId) return null;
  let r = await restJson(
    `users?user_id=eq.${encodeURIComponent(userId)}&select=${USER_SELECT}&limit=1`
  );
  if (!r.ok) {
    r = await restJson(
      `users?user_id=eq.${encodeURIComponent(userId)}&select=onboarding_reward_granted,onboarding_reward_granted_at,free_scans_remaining,director_trial_ends_at,studio_trial_ends_at,streak_current,streak_longest,streak_last_active_date,streak_days,timezone&limit=1`
    );
  }
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  return r.data[0];
}

export async function fetchDailyScanCount(userId) {
  if (!userId) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const r = await restJson(
    `usage_daily?user_id=eq.${encodeURIComponent(userId)}&day=eq.${day}&select=scans&limit=1`
  );
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return 0;
  return parseInt(r.data[0].scans || 0, 10) || 0;
}

async function ensureUserRow(userId, tz) {
  await restJson('users', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      timezone: tz,
      last_seen: new Date().toISOString()
    })
  });
}

async function fetchActivityRows(userId) {
  const r = await restJson(
    `activity_events?user_id=eq.${encodeURIComponent(userId)}&select=event_type,local_date,occurred_at&order=local_date.asc&limit=400`
  );
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data;
}

async function fetchRewardRows(userId) {
  const r = await restJson(
    `streak_rewards?user_id=eq.${encodeURIComponent(userId)}&select=milestone,reward_kind,granted_at,expires_at,director,studio,hours,plan_at_grant&order=milestone.asc`
  );
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.map((row) => ({
    milestone: parseInt(row.milestone, 10) || 0,
    kind: row.reward_kind,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    director: row.director === true,
    studio: row.studio === true,
    hours: parseInt(row.hours, 10) || 0,
    planAtGrant: row.plan_at_grant || null,
    active: trialActive(row.expires_at, new Date())
  }));
}

async function insertActivityEvent(userId, kind, localDate, workspaceId, now) {
  const row = {
    user_id: userId,
    event_type: kind,
    local_date: localDate,
    occurred_at: (now instanceof Date ? now : new Date()).toISOString(),
    workspace_id: workspaceId ? String(workspaceId).slice(0, 64) : null,
    metadata: {}
  };
  const r = await restJson(
    'activity_events?on_conflict=user_id,local_date,event_type',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row)
    }
  );
  return r;
}

async function fetchUsageActivityDates(userId, tz) {
  const r = await restJson(
    `usage_events?user_id=eq.${encodeURIComponent(userId)}&or=(event_type.eq.scan,event_type.eq.director_request)&status=eq.success&select=event_type,created_at&order=created_at.asc&limit=500`
  );
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data
    .map((row) => {
      const kind = row.event_type === 'director_request' ? 'director' : 'scan';
      const local_date = localDateIso(row.created_at, tz);
      return { event_type: kind, local_date, occurred_at: row.created_at };
    })
    .filter((row) => DATE_RE.test(row.local_date));
}

async function persistStreakRow(userId, patch) {
  return restJson(`users?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch)
  });
}

export async function persistUserTimezone(userId, timezone) {
  if (!userId) return;
  const tz = sanitizeTimezone(timezone);
  await ensureUserRow(userId, tz);
  await persistStreakRow(userId, { timezone: tz });
}

async function grantNewMilestones(userId, current, plan, row, now) {
  const existing = await fetchRewardRows(userId);
  const already = new Set(existing.map((r) => r.milestone).filter(Boolean));
  const pending = evaluateMilestoneGrants(current, already, plan);
  const granted = [];
  let streakDirectorEnds = (row && row.streak_director_ends_at) || null;
  let streakStudioEnds = (row && row.streak_studio_ends_at) || null;

  for (let i = 0; i < pending.length; i++) {
    const def = pending[i];
    const expiresAt =
      def.kind === 'access' && def.hours
        ? computeStackedExpiry(
            [
              row && row.director_trial_ends_at,
              row && row.studio_trial_ends_at,
              streakDirectorEnds,
              streakStudioEnds
            ],
            def.hours,
            now
          )
        : null;
    const insert = await restJson(
      'streak_rewards?on_conflict=user_id,milestone',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: userId,
          milestone: def.days,
          reward_kind: def.kind,
          granted_at: now.toISOString(),
          expires_at: expiresAt,
          director: def.director === true,
          studio: def.studio === true,
          hours: def.hours || 0,
          plan_at_grant: plan === 'pro' ? 'pro' : 'free'
        })
      }
    );
    const created = insert.ok && Array.isArray(insert.data) && insert.data[0];
    if (!created) continue;
    granted.push({
      milestone: def.days,
      kind: def.kind,
      expiresAt,
      skippedAccess: def.skippedAccess === true
    });
    if (def.kind === 'access' && expiresAt) {
      if (def.director) streakDirectorEnds = expiresAt;
      if (def.studio) streakStudioEnds = expiresAt;
    }
  }

  if (granted.some((g) => g.kind === 'access')) {
    await persistStreakRow(userId, {
      streak_director_ends_at: streakDirectorEnds,
      streak_studio_ends_at: streakStudioEnds
    });
  }

  return { granted, streakDirectorEnds, streakStudioEnds };
}

async function inferPlan(userId) {
  const r = await restJson(
    `subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan,status&limit=1`
  );
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return 'free';
  const row = r.data[0];
  const isPro =
    row.plan === 'pro' && ['active', 'promo', 'trialing'].indexOf(row.status) >= 0;
  return isPro ? 'pro' : 'free';
}

async function backfillFromUsage(userId, tz, row) {
  if (row && row.streak_backfilled_at) return row;
  const usage = await fetchUsageActivityDates(userId, tz);
  if (!usage.length) {
    await persistStreakRow(userId, { streak_backfilled_at: new Date().toISOString() });
    return row;
  }
  for (let i = 0; i < usage.length; i++) {
    await insertActivityEvent(
      userId,
      usage[i].event_type,
      usage[i].local_date,
      null,
      usage[i].occurred_at
    );
  }
  const activityRows = await fetchActivityRows(userId);
  const days = uniqueSortedDays(
    parseDays(row && row.streak_days).concat(activityRows.map((r) => r.local_date))
  );
  const now = new Date();
  const todayIso = localDateIso(now, tz);
  const computed = computeStreakFromDates(days, todayIso, {
    freezeUntil: row && row.streak_freeze_until
  });
  await persistStreakRow(userId, {
    streak_current: computed.current,
    streak_longest: Math.max(
      computed.longest,
      Math.max(0, parseInt((row && row.streak_longest) || 0, 10) || 0)
    ),
    streak_last_active_date: computed.lastActiveDate,
    streak_days: computed.days,
    timezone: tz,
    streak_backfilled_at: now.toISOString()
  });
  const plan = await inferPlan(userId);
  const fresh = await fetchUserEntitlementRow(userId);
  await grantNewMilestones(userId, computed.current, plan, fresh || row, now);
  return fetchUserEntitlementRow(userId);
}

export async function loadEntitlement(userId, email, getSubscription) {
  const sub = await getSubscription(userId, email);
  let row = await fetchUserEntitlementRow(userId);
  const tz = sanitizeTimezone((row && row.timezone) || 'UTC');
  if (row && !row.streak_backfilled_at) {
    row = (await backfillFromUsage(userId, tz, row)) || row;
  }
  const dailyUsed = sub.plan === 'pro' ? 0 : await fetchDailyScanCount(userId);
  const [activityRows, rewards] = await Promise.all([
    fetchActivityRows(userId),
    fetchRewardRows(userId)
  ]);
  const extras = {
    timezone: tz,
    activity: groupActivity(activityRows),
    rewards
  };
  const snap = buildEntitlementSnapshot(sub, row, new Date(), dailyUsed, extras);
  if (
    row &&
    (parseInt(row.streak_current, 10) || 0) !== snap.streak.current
  ) {
    persistStreakRow(userId, {
      streak_current: snap.streak.current,
      streak_longest: snap.streak.longest
    }).catch(function () {});
  }
  return snap;
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

/**
 * Record one meaningful activity for the authenticated user.
 * One local calendar day still equals one streak day.
 * Persistence is JS + tables first so streaming functions cannot drop an unawaited RPC.
 */
export async function recordCreationActivity(userId, kind, timezone, opts) {
  if (!userId) return { ok: false, error: 'invalid_user' };
  const safeKind = STREAK_KINDS.indexOf(String(kind || '')) >= 0 ? kind : 'studio';
  const tz = sanitizeTimezone(timezone);
  const now = (opts && opts.now) || new Date();
  const todayIso = localDateIso(now, tz);
  const workspaceId = opts && opts.workspaceId ? String(opts.workspaceId).slice(0, 64) : null;
  const plan =
    opts && opts.plan === 'pro'
      ? 'pro'
      : opts && opts.plan === 'free'
        ? 'free'
        : await inferPlan(userId);

  await ensureUserRow(userId, tz);
  const inserted = await insertActivityEvent(userId, safeKind, todayIso, workspaceId, now);

  let activityRows = await fetchActivityRows(userId);
  if (!activityRows.length && inserted && !inserted.ok) {
    /* activity_events table missing — fall back to users.streak_days only. */
    const row = await fetchUserEntitlementRow(userId);
    const next = applyStreakTransition(
      {
        current: row && row.streak_current,
        longest: row && row.streak_longest,
        lastActiveDate: row && row.streak_last_active_date,
        days: parseDays(row && row.streak_days)
      },
      todayIso
    );
    await persistStreakRow(userId, {
      streak_current: next.current,
      streak_longest: next.longest,
      streak_last_active_date: next.lastActiveDate,
      streak_days: next.days,
      timezone: tz,
      last_seen: now.toISOString()
    });
    const rpcFallback = await rpc('record_creation_activity', {
      p_user_id: userId,
      p_kind: safeKind,
      p_timezone: tz
    });
    return {
      ok: true,
      incremented: next.incremented,
      current: next.current,
      longest: next.longest,
      last_active_date: next.lastActiveDate,
      days: next.days,
      milestone: next.milestone,
      kind: safeKind,
      todayComplete: true,
      grants: [],
      fallback: rpcFallback && rpcFallback.ok === true ? 'rpc' : 'users_row'
    };
  }

  const row = await fetchUserEntitlementRow(userId);
  const days = uniqueSortedDays(
    parseDays(row && row.streak_days).concat(activityRows.map((r) => r.local_date))
  );
  const prevCurrent = Math.max(0, parseInt((row && row.streak_current) || 0, 10) || 0);
  const computed = computeStreakFromDates(days, todayIso, {
    freezeUntil: row && row.streak_freeze_until
  });
  await persistStreakRow(userId, {
    streak_current: computed.current,
    streak_longest: Math.max(
      computed.longest,
      Math.max(0, parseInt((row && row.streak_longest) || 0, 10) || 0)
    ),
    streak_last_active_date: computed.lastActiveDate,
    streak_days: computed.days,
    timezone: tz,
    last_seen: now.toISOString()
  });

  const grantResult = await grantNewMilestones(
    userId,
    computed.current,
    plan,
    row,
    now instanceof Date ? now : new Date(now)
  );

  const milestone =
    computed.current !== prevCurrent && STREAK_MILESTONES.indexOf(computed.current) >= 0
      ? computed.current
      : grantResult.granted.length
        ? grantResult.granted[grantResult.granted.length - 1].milestone
        : null;

  return {
    ok: true,
    incremented: computed.current !== prevCurrent && computed.todayComplete,
    current: computed.current,
    longest: Math.max(
      computed.longest,
      Math.max(0, parseInt((row && row.streak_longest) || 0, 10) || 0)
    ),
    last_active_date: computed.lastActiveDate,
    days: computed.days,
    milestone,
    kind: safeKind,
    todayComplete: computed.todayComplete,
    grants: grantResult.granted,
    activity: groupActivity(activityRows)
  };
}
