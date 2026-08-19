/**
 * Admin session helpers — HttpOnly cookie + hashed token in Supabase.
 * Master ADMIN_SECRET is only used at login; never returned to the browser.
 */
import crypto from 'crypto';
import { serviceHeaders, timingSafeEqualStr } from './security.js';

export const ADMIN_COOKIE = 'ps_admin_session';

export function adminSessionTtlSec() {
  const hours = parseInt(process.env.ADMIN_SESSION_HOURS || '8', 10);
  const h = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : 8;
  return h * 60 * 60;
}

function isProduction() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

export function parseCookies(req) {
  const raw = req.headers.cookie || req.headers.Cookie || '';
  const out = {};
  if (typeof raw !== 'string' || !raw) return out;
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function buildAdminCookie(token, maxAgeSec) {
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(60, maxAgeSec | 0)}`
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

export function clearAdminCookie() {
  const parts = [
    `${ADMIN_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(res, value) {
  const prev = res.getHeader && res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(prev) ? prev.concat(value) : [prev, value];
  res.setHeader('Set-Cookie', list);
}

export function setAdminSessionCookie(res, token, maxAgeSec) {
  appendSetCookie(res, buildAdminCookie(token, maxAgeSec));
}

export function clearAdminSessionCookie(res) {
  appendSetCookie(res, clearAdminCookie());
}

export function verifyAdminSecret(candidate) {
  const secret = process.env.ADMIN_SECRET || '';
  if (!secret) return false;
  return timingSafeEqualStr(candidate, secret);
}

/**
 * Create a server-side admin session. Returns raw token for the cookie.
 */
export async function createAdminSession() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return { ok: false, error: 'db_unavailable' };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const ttl = adminSessionTtlSec();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const r = await fetch(`${SUPA_URL}/rest/v1/admin_sessions`, {
    method: 'POST',
    headers: { ...serviceHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({
      token_hash: tokenHash,
      expires_at: expiresAt
    })
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error('admin_sessions insert failed:', r.status, body.slice(0, 200));
    return { ok: false, error: 'session_create_failed' };
  }

  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    ok: true,
    token,
    ttl,
    expiresAt,
    sessionId: row && row.id ? row.id : null
  };
}

/**
 * Validate cookie session. Optionally touch last_seen_at.
 */
export async function requireAdminSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE];
  if (!token) {
    return { ok: false, status: 401, error: 'auth_required' };
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return { ok: false, status: 500, error: 'db_unavailable' };
  }

  const tokenHash = hashToken(token);
  const r = await fetch(
    `${SUPA_URL}/rest/v1/admin_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,expires_at,revoked_at&limit=1`,
    { headers: serviceHeaders() }
  );
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) {
    return { ok: false, status: 401, error: 'invalid_session' };
  }

  const row = rows[0];
  if (row.revoked_at) {
    return { ok: false, status: 401, error: 'session_revoked' };
  }
  if (!row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: 'session_expired' };
  }

  /* Best-effort last_seen touch — ignore failures */
  fetch(
    `${SUPA_URL}/rest/v1/admin_sessions?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(),
      body: JSON.stringify({ last_seen_at: new Date().toISOString() })
    }
  ).catch(() => {});

  return {
    ok: true,
    sessionId: row.id,
    expiresAt: row.expires_at
  };
}

export { requireAdminSession as requireAdmin };

/** Revoke current cookie session (logout). */
export async function revokeAdminSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE];
  if (!token) return { ok: true };

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: true };

  const tokenHash = hashToken(token);
  await fetch(
    `${SUPA_URL}/rest/v1/admin_sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(),
      body: JSON.stringify({ revoked_at: new Date().toISOString() })
    }
  ).catch(() => {});

  return { ok: true };
}
