/**
 * Content planning calendar — pure helpers.
 * Events store IDs only (project / production / idea). No Studio duplication.
 * Streak days are personal and are never stored on a workspace calendar.
 */

export const CALENDAR_TYPES = ['post', 'scan', 'idea', 'production', 'other'];
export const CALENDAR_STATUSES = [
  'idea',
  'planned',
  'in_production',
  'ready',
  'posted',
  'skipped'
];
export const CALENDAR_EVENTS_CAP = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

export function emptyCalendar() {
  return { version: 1, events: [] };
}

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
    return new Date(now instanceof Date ? now : Date.now()).toISOString().slice(0, 10);
  }
}

export function addDaysIso(iso, delta) {
  const parts = String(iso || '').split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + delta));
  return d.toISOString().slice(0, 10);
}

export function clampStr(s, n) {
  return String(s == null ? '' : s).slice(0, n);
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = String(raw.date || '').slice(0, 10);
  if (!DATE_RE.test(date)) return null;
  const type = CALENDAR_TYPES.indexOf(String(raw.type || '')) >= 0 ? raw.type : 'post';
  const status =
    CALENDAR_STATUSES.indexOf(String(raw.status || '')) >= 0
      ? raw.status
      : type === 'idea'
        ? 'idea'
        : 'planned';
  const id = clampStr(raw.id, 80);
  if (!id) return null;
  return {
    id,
    date,
    type,
    status,
    title: clampStr(raw.title, 160) || 'Untitled',
    projectId: raw.projectId ? clampStr(raw.projectId, 80) : null,
    productionId: raw.productionId ? clampStr(raw.productionId, 80) : null,
    ideaId: raw.ideaId ? clampStr(raw.ideaId, 120) : null,
    workspaceId: raw.workspaceId ? clampStr(raw.workspaceId, 80) : null,
    platform: clampStr(raw.platform, 40),
    notes: clampStr(raw.notes, 2000),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    completedAt: raw.completedAt == null || raw.completedAt === '' ? null : Number(raw.completedAt)
  };
}

export function normalizeCalendar(raw) {
  const cal = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : emptyCalendar();
  const events = Array.isArray(cal.events) ? cal.events : [];
  const seen = {};
  const out = [];
  events.forEach((row) => {
    const ev = normalizeEvent(row);
    if (!ev || seen[ev.id]) return;
    seen[ev.id] = true;
    out.push(ev);
  });
  out.sort((a, b) => {
    const d = String(a.date).localeCompare(String(b.date));
    if (d) return d;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return { version: 1, events: out.slice(-CALENDAR_EVENTS_CAP) };
}

export function mergeCalendars(localCal, cloudCal) {
  const local = normalizeCalendar(localCal);
  const cloud = normalizeCalendar(cloudCal);
  const map = {};
  local.events.forEach((e) => {
    map[e.id] = e;
  });
  cloud.events.forEach((e) => {
    const prev = map[e.id];
    if (!prev) map[e.id] = e;
    else map[e.id] = (e.updatedAt || 0) >= (prev.updatedAt || 0) ? e : prev;
  });
  return normalizeCalendar({
    version: 1,
    events: Object.keys(map).map((id) => map[id])
  });
}

export function upsertEvent(calendar, input, nowMs) {
  const cal = normalizeCalendar(calendar);
  const now = Number(nowMs) || Date.now();
  const incoming = Object.assign({}, input || {});
  if (!incoming.id) incoming.id = 'cal_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  if (!incoming.createdAt) incoming.createdAt = now;
  incoming.updatedAt = now;
  const ev = normalizeEvent(incoming);
  if (!ev) return { ok: false, error: 'invalid_event', calendar: cal };
  const next = cal.events.filter((e) => e.id !== ev.id);
  next.push(ev);
  return { ok: true, event: ev, calendar: normalizeCalendar({ version: 1, events: next }) };
}

export function removeEvent(calendar, eventId) {
  const cal = normalizeCalendar(calendar);
  const id = String(eventId || '');
  return {
    ok: true,
    calendar: normalizeCalendar({
      version: 1,
      events: cal.events.filter((e) => e.id !== id)
    })
  };
}

export function eventsOnDate(calendar, iso) {
  const date = String(iso || '').slice(0, 10);
  return normalizeCalendar(calendar).events.filter((e) => e.date === date);
}

export function mondayOf(iso) {
  const parts = String(iso || '').split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dow = utc.getUTCDay(); /* 0 Sun */
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysIso(iso, delta);
}

export function monthRange(year, monthIndex) {
  const y = parseInt(year, 10);
  const m = parseInt(monthIndex, 10);
  const start = y + '-' + String(m + 1).padStart(2, '0') + '-01';
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const end = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(last).padStart(2, '0');
  return { start, end };
}

export function inRange(iso, start, end) {
  const d = String(iso || '');
  return d >= start && d <= end;
}

/**
 * Deterministic progress. streakDays = personal entitlement dates (never workspace).
 */
export function progressStats(calendar, opts) {
  opts = opts || {};
  const today = DATE_RE.test(opts.today) ? opts.today : localDateIso(new Date(), opts.timezone);
  const cal = normalizeCalendar(calendar);
  const weekStart = mondayOf(today);
  const weekEnd = addDaysIso(weekStart, 6);
  const monthStart = today.slice(0, 8) + '01';
  const last = new Date(
    Date.UTC(parseInt(today.slice(0, 4), 10), parseInt(today.slice(5, 7), 10), 0)
  ).getUTCDate();
  const monthEnd = today.slice(0, 8) + String(last).padStart(2, '0');

  function count(pred, start, end) {
    let n = 0;
    cal.events.forEach((e) => {
      if (!inRange(e.date, start, end)) return;
      if (pred(e)) n += 1;
    });
    return n;
  }

  const isPost = (e) => e.type === 'post' || e.type === 'production';
  const planned = (e) => isPost(e) && e.status !== 'posted' && e.status !== 'skipped';
  const posted = (e) => isPost(e) && e.status === 'posted';
  const ideaish = (e) => e.type === 'idea' || e.type === 'scan';

  const streakDays = Array.isArray(opts.streakDays) ? opts.streakDays : [];
  const scansExtra = Number(opts.scansThisMonth) || 0;
  const ideasExtra = Number(opts.ideasScanned) || 0;

  return {
    today,
    currentStreak: Math.max(0, parseInt(opts.currentStreak, 10) || 0),
    longestStreak: Math.max(0, parseInt(opts.longestStreak, 10) || 0),
    videosPlanned: count(planned, '0000-01-01', '9999-12-31'),
    videosPosted: count(posted, '0000-01-01', '9999-12-31'),
    ideasScanned: Math.max(count(ideaish, '0000-01-01', '9999-12-31'), ideasExtra),
    thisWeek: {
      planned: count(planned, weekStart, weekEnd),
      posted: count(posted, weekStart, weekEnd),
      scans: count(ideaish, weekStart, weekEnd),
      streakDays: streakDays.filter((d) => inRange(String(d).slice(0, 10), weekStart, weekEnd)).length
    },
    thisMonth: {
      planned: count(planned, monthStart, monthEnd),
      posted: count(posted, monthStart, monthEnd),
      scans: Math.max(count(ideaish, monthStart, monthEnd), scansExtra),
      streakDays: streakDays.filter((d) => inRange(String(d).slice(0, 10), monthStart, monthEnd)).length
    }
  };
}

export function dayMarkers(events, streakSet, iso) {
  const list = (events || []).filter((e) => e && e.date === iso);
  const planned = list.some((e) => e.status !== 'posted' && e.status !== 'skipped' && (e.type === 'post' || e.type === 'production' || e.type === 'other'));
  const posted = list.some((e) => e.status === 'posted');
  const scanned = list.some((e) => e.type === 'scan' || e.type === 'idea');
  const streak = !!(streakSet && streakSet[iso]);
  return { planned, posted, scanned, streak, count: list.length };
}
