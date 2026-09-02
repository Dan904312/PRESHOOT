/**
 * Persistent admin notifications. Never stores tokens, passwords, or secrets.
 * Writes go through the service role only.
 */
import { serviceHeaders } from './security.js';
import { getAccountStatus, ACCOUNT_SUSPENDED } from './account-status.js';
import { fetchAuthAudit } from './admin-console.js';

const TYPES = {
  account_suspended: { severity: 'critical', href: 'users' },
  account_restored: { severity: 'info', href: 'users' },
  suspended_login: { severity: 'critical', href: 'users' },
  security: { severity: 'warning', href: 'security' },
  system: { severity: 'warning', href: 'system' }
};

function headers() {
  return { ...serviceHeaders(), Prefer: 'return=representation' };
}

function clip(v, n) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
}

export function sessionRefFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const sid = payload.session_id || payload.sessionId || null;
    const sub = payload.sub || null;
    if (sid && sub) return 'session:' + String(sub).slice(0, 80) + ':' + String(sid).slice(0, 80);
    if (sub && payload.iat) return 'iat:' + String(sub).slice(0, 80) + ':' + String(payload.iat);
  } catch (e) {
    /* ignore malformed JWT — caller already verified via Auth /user */
  }
  return null;
}

export async function writeAdminNotification(entry) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, error: 'no_config' };

  const type = TYPES[entry && entry.type] ? entry.type : 'security';
  const meta = TYPES[type];
  const userId = clip(entry && entry.user_id, 128);
  const row = {
    type,
    severity: clip((entry && entry.severity) || meta.severity, 20) || 'info',
    title: clip(entry && entry.title, 160) || 'Admin event',
    body: clip(entry && entry.body, 500) || '',
    user_id: userId,
    user_email: clip(entry && entry.user_email, 320),
    href: clip(entry && entry.href, 200) || (userId ? 'users:' + userId : meta.href),
    source_ref: clip(entry && entry.source_ref, 180),
    metadata:
      entry && entry.metadata && typeof entry.metadata === 'object'
        ? Object.keys(entry.metadata)
            .slice(0, 8)
            .reduce((acc, k) => {
              if (/token|password|secret|authorization|cookie/i.test(k)) return acc;
              const v = entry.metadata[k];
              if (typeof v === 'string') acc[String(k).slice(0, 40)] = v.slice(0, 120);
              else if (typeof v === 'boolean') acc[String(k).slice(0, 40)] = v;
              else if (typeof v === 'number' && Number.isFinite(v)) acc[String(k).slice(0, 40)] = v;
              return acc;
            }, {})
        : {}
  };

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/admin_notifications?on_conflict=source_ref`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(row)
    });
    if (r.status === 409) return { ok: true, duplicate: true };
    if (!r.ok) return { ok: false, error: 'write_failed', status: r.status };
    const rows = await r.json().catch(() => null);
    return { ok: true, row: Array.isArray(rows) ? rows[0] : rows };
  } catch (e) {
    return { ok: false, error: 'write_failed' };
  }
}

export async function notifyAccountSuspended({ userId, email, reason, blocked }) {
  return writeAdminNotification({
    type: 'account_suspended',
    title: 'Account suspended',
    body:
      (email || userId || 'Account') +
      ' was suspended.' +
      (reason ? ' Reason: ' + String(reason).slice(0, 160) : '') +
      (blocked === false ? ' Auth ban did not confirm; API access is still blocked.' : ''),
    user_id: userId,
    user_email: email,
    source_ref: 'suspend:' + String(userId || '').slice(0, 80) + ':' + Date.now(),
    metadata: { blocked: blocked !== false }
  });
}

export async function notifyAccountRestored({ userId, email }) {
  return writeAdminNotification({
    type: 'account_restored',
    title: 'Account restored',
    body: (email || userId || 'Account') + ' can sign in again. Paid plan was not granted.',
    user_id: userId,
    user_email: email,
    source_ref: 'restore:' + String(userId || '').slice(0, 80) + ':' + Date.now()
  });
}

/**
 * Called from authenticated app routes when a suspended account presents a session.
 * Dedupes per Auth session so page reloads of the same JWT session do not flood,
 * while a new login (new session) always creates another notification.
 */
export async function notifySuspendedAuthAttempt({ userId, email, source, token, blocked }) {
  if (!userId) return { ok: false };
  const ref = sessionRefFromToken(token) || 'attempt:' + userId + ':' + Date.now();
  return writeAdminNotification({
    type: 'suspended_login',
    title: 'Suspended account attempted login',
    body:
      'Account: ' +
      (email || userId) +
      '. Status: Blocked. Source: ' +
      String(source || 'auth').slice(0, 40) +
      '.',
    user_id: userId,
    user_email: email,
    source_ref: 'login:' + ref,
    metadata: {
      blocked: blocked !== false,
      source: String(source || 'auth').slice(0, 40)
    }
  });
}

export async function listAdminNotifications({ unreadOnly, limit }) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, error: 'no_config', notifications: [], unread: 0 };

  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 80);
  let url =
    `${SUPA_URL}/rest/v1/admin_notifications?select=id,type,severity,title,body,user_id,user_email,href,read_at,created_at&order=created_at.desc&limit=${max}`;
  if (unreadOnly) url += '&read_at=is.null';

  const [listR, countR] = await Promise.all([
    fetch(url, { headers: serviceHeaders() }),
    fetch(
      `${SUPA_URL}/rest/v1/admin_notifications?read_at=is.null&select=id`,
      { headers: { ...serviceHeaders(), Prefer: 'count=exact', Range: '0-0' } }
    )
  ]);

  if (!listR.ok) {
    return { ok: false, error: 'list_failed', notifications: [], unread: 0, status: listR.status };
  }
  const rows = await listR.json().catch(() => []);
  const contentRange = countR.headers.get('content-range') || '';
  const unread = /\/(\d+)\s*$/.test(contentRange)
    ? parseInt(RegExp.$1, 10)
    : Array.isArray(rows)
      ? rows.filter((n) => !n.read_at).length
      : 0;

  return {
    ok: true,
    notifications: Array.isArray(rows) ? rows : [],
    unread: Number.isFinite(unread) ? unread : 0
  };
}

export async function markNotificationsRead({ ids, all }) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, error: 'no_config' };
  const now = new Date().toISOString();
  let url = `${SUPA_URL}/rest/v1/admin_notifications?read_at=is.null`;
  if (!all) {
    const list = (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').slice(0, 80))
      .filter(Boolean)
      .slice(0, 50);
    if (!list.length) return { ok: false, error: 'ids_required' };
    url += `&id=in.(${list.map((id) => encodeURIComponent(id)).join(',')})`;
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ read_at: now })
  });
  return { ok: r.ok, error: r.ok ? null : 'mark_failed' };
}

/**
 * Convert GoTrue admin audit login rows for currently suspended accounts
 * into notifications. Official Auth admin API — no passwords or tokens stored.
 */
export async function ingestSuspendedLoginAudits() {
  const audit = await fetchAuthAudit(80);
  if (!audit || !audit.available || !Array.isArray(audit.entries)) {
    return { ok: true, ingested: 0, available: false };
  }
  let ingested = 0;
  for (const entry of audit.entries) {
    const action = String(entry.payload_type || '').toLowerCase();
    if (action && action.indexOf('login') < 0 && action.indexOf('token') < 0 && action !== 'user_signedin') {
      continue;
    }
    const actorId = clip(entry.actor_id, 128) || clip(entry.actor, 128);
    if (!actorId) continue;
    let userId = /^[0-9a-f-]{36}$/i.test(actorId) ? actorId : null;
    if (!userId) continue;
    const row = await getAccountStatus(userId);
    if (row.status !== ACCOUNT_SUSPENDED) continue;
    if (row.at && entry.created_at && new Date(entry.created_at) < new Date(row.at)) continue;
    const email = row.email || clip(entry.actor, 320);
    const ref = 'audit:' + String(entry.id || entry.created_at || '').slice(0, 80);
    if (!ref || ref === 'audit:') continue;
    const written = await writeAdminNotification({
      type: 'suspended_login',
      title: 'Suspended account attempted login',
      body:
        'Account: ' +
        (email || userId) +
        '. Time recorded by Auth. Status: Blocked.',
      user_id: userId,
      user_email: email,
      source_ref: ref,
      metadata: { blocked: true, source: 'auth_audit' }
    });
    if (written && written.ok && !written.duplicate) ingested += 1;
  }
  return { ok: true, ingested, available: true };
}
