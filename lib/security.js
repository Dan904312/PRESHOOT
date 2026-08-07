import crypto from 'crypto';

/**
 * Shared security helpers for PreShoot Vercel API routes.
 */

const DEFAULT_ORIGINS = [
  'https://preshoot.vercel.app',
  'https://www.preshoot.app',
  'https://preshoot.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173'
];

function allowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.length ? extra : DEFAULT_ORIGINS;
}

export function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allow = allowedOrigins();
  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (
    process.env.NODE_ENV !== 'production' &&
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
}

export function handleOptions(req, res) {
  setCors(req, res);
  res.status(200).end();
}

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key
  };
}

export async function requireUser(req) {
  const token = getBearer(req);
  if (!token) return { error: 'auth_required', status: 401 };

  const SUPA_URL = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPA_URL) return { error: 'server_misconfigured', status: 500 };

  const apikey = anon || process.env.SUPABASE_SERVICE_KEY;
  if (!apikey) return { error: 'server_misconfigured', status: 500 };

  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: {
        Authorization: 'Bearer ' + token,
        apikey
      }
    });
    if (!r.ok) return { error: 'invalid_token', status: 401 };
    const user = await r.json();
    if (!user || !user.id) return { error: 'invalid_token', status: 401 };
    return {
      user: {
        id: user.id,
        email: user.email || null,
        name:
          (user.user_metadata &&
            (user.user_metadata.full_name || user.user_metadata.name)) ||
          null,
        avatar: (user.user_metadata && user.user_metadata.avatar_url) || null,
        provider: (user.app_metadata && user.app_metadata.provider) || null
      },
      token
    };
  } catch (e) {
    return { error: 'auth_failed', status: 401 };
  }
}

export async function getSubscription(userId, email) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { plan: 'free', status: 'no_config' };

  const h = serviceHeaders();
  try {
    if (userId) {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan,status,stripe_customer_id&limit=1`,
        { headers: h }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        const isPro =
          row.plan === 'pro' &&
          ['active', 'promo', 'trialing'].includes(row.status);
        return {
          plan: isPro ? 'pro' : 'free',
          status: row.status || 'none',
          stripe_customer_id: row.stripe_customer_id || null
        };
      }
    }
    if (email) {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}&select=plan,status,stripe_customer_id&limit=1`,
        { headers: h }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        const isPro =
          row.plan === 'pro' &&
          ['active', 'promo', 'trialing'].includes(row.status);
        return {
          plan: isPro ? 'pro' : 'free',
          status: row.status || 'none',
          stripe_customer_id: row.stripe_customer_id || null
        };
      }
    }
  } catch (e) {
    return { plan: 'free', status: 'error' };
  }
  return { plan: 'free', status: 'none', stripe_customer_id: null };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export const FREE_DAILY_SCANS = parseInt(process.env.FREE_DAILY_SCANS || '3', 10);
export const DIR_DAILY_MSGS = parseInt(process.env.DIR_DAILY_MSGS || '50', 10);
export const RESEARCH_DAILY_CALLS = parseInt(process.env.RESEARCH_DAILY_CALLS || '30', 10);

async function bumpUsage(userId, field, limit) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return { ok: false, error: 'no_config', count: 0 };
  }
  const day = todayKey();
  const h = serviceHeaders();
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/usage_daily?user_id=eq.${encodeURIComponent(userId)}&day=eq.${day}&select=*&limit=1`,
      { headers: h }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) {
      return { ok: false, error: 'usage_error', count: 0 };
    }
    const row = rows[0] || null;
    const current = row ? parseInt(row[field] || 0, 10) : 0;
    if (current >= limit) {
      return { ok: false, error: 'quota_exceeded', count: current, limit };
    }
    const next = current + 1;
    const payload = {
      user_id: userId,
      day,
      scans: field === 'scans' ? next : (row ? row.scans || 0 : 0),
      director_msgs:
        field === 'director_msgs' ? next : (row ? row.director_msgs || 0 : 0),
      updated_at: new Date().toISOString()
    };
    /* Only write research_calls when tracking research, or when the column
       already exists on the row — avoids breaking scan/director upserts
       before the research_calls migration has been applied. */
    if (field === 'research_calls') {
      payload.research_calls = next;
    } else if (row && Object.prototype.hasOwnProperty.call(row, 'research_calls')) {
      payload.research_calls = parseInt(row.research_calls || 0, 10);
    }

    const write = await fetch(`${SUPA_URL}/rest/v1/usage_daily`, {
      method: 'POST',
      headers: { ...h, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(payload)
    });
    if (!write.ok) {
      return { ok: false, error: 'usage_error', count: current };
    }
    return { ok: true, count: next, limit };
  } catch (e) {
    return { ok: false, error: 'usage_error', count: 0 };
  }
}

export async function requireScanAccess(user) {
  const sub = await getSubscription(user.id, user.email);
  if (sub.plan === 'pro') return { ok: true, plan: 'pro', sub };
  const usage = await bumpUsage(user.id, 'scans', FREE_DAILY_SCANS);
  if (!usage.ok) {
    if (usage.error === 'quota_exceeded') {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'free', sub };
    }
    /* usage_daily missing — soft per-user cap until SQL migration runs */
    if (!rateLimitMemory('scan-degraded:' + user.id, FREE_DAILY_SCANS, 24 * 60 * 60 * 1000)) {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'free', sub };
    }
    return { ok: true, plan: 'free', sub, degraded: true };
  }
  return { ok: true, plan: 'free', sub, usage };
}

export async function requireDirectorAccess(user) {
  const sub = await getSubscription(user.id, user.email);
  if (sub.plan !== 'pro') {
    return { ok: false, status: 403, error: 'pro_required', plan: 'free', sub };
  }
  const usage = await bumpUsage(user.id, 'director_msgs', DIR_DAILY_MSGS);
  if (!usage.ok) {
    if (usage.error === 'quota_exceeded') {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'pro', sub };
    }
    /* If usage table missing, still allow Pro (plan already verified) with soft IP cap */
    if (!rateLimitMemory('dir-degraded:' + user.id, DIR_DAILY_MSGS, 24 * 60 * 60 * 1000)) {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'pro', sub };
    }
    return { ok: true, plan: 'pro', sub, degraded: true };
  }
  return { ok: true, plan: 'pro', sub, usage };
}

/** Creative research — Pro only + daily call quota (server-side; never trust client plan). */
export async function requireResearchAccess(user) {
  const sub = await getSubscription(user.id, user.email);
  if (sub.plan !== 'pro') {
    return { ok: false, status: 403, error: 'pro_required', plan: 'free', sub };
  }
  const usage = await bumpUsage(user.id, 'research_calls', RESEARCH_DAILY_CALLS);
  if (!usage.ok) {
    if (usage.error === 'quota_exceeded') {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'pro', sub };
    }
    /* usage_daily / research_calls missing — soft per-user cap until SQL migration runs */
    if (!rateLimitMemory('research-degraded:' + user.id, RESEARCH_DAILY_CALLS, 24 * 60 * 60 * 1000)) {
      return { ok: false, status: 429, error: 'quota_exceeded', plan: 'pro', sub };
    }
    return { ok: true, plan: 'pro', sub, degraded: true };
  }
  return { ok: true, plan: 'pro', sub, usage };
}

/* ── Distributed rate limiting (Supabase) with in-memory fallback ───────── */

const memoryBuckets = new Map();

/** Local fallback only — used when Supabase RPC unavailable, or degraded quotas. */
function rateLimitMemory(key, max, windowMs) {
  const now = Date.now();
  let b = memoryBuckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    memoryBuckets.set(key, b);
  }
  b.count += 1;
  const allowed = b.count <= max;
  const retryAfterSec = allowed
    ? 0
    : Math.max(1, Math.ceil((b.start + windowMs - now) / 1000));
  return { allowed, count: b.count, limit: max, retryAfterSec, degraded: true };
}

/**
 * Shared rate limit via Supabase RPC (atomic across serverless instances).
 * @returns {{ allowed: boolean, count?: number, limit?: number, retryAfterSec: number, degraded?: boolean }}
 */
export async function checkRateLimit(key, max, windowMs) {
  const safeKey = String(key || '').slice(0, 200);
  const safeMax = Math.max(1, parseInt(max, 10) || 1);
  const safeWindow = Math.max(1000, parseInt(windowMs, 10) || 60000);

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY || !safeKey) {
    return rateLimitMemory(safeKey || 'unknown', safeMax, safeWindow);
  }

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/check_rate_limit`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        p_key: safeKey,
        p_max: safeMax,
        p_window_ms: safeWindow
      })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || typeof data !== 'object') {
      return rateLimitMemory(safeKey, safeMax, safeWindow);
    }
    const retryMs = parseInt(data.retry_after_ms, 10) || 0;
    return {
      allowed: data.allowed === true,
      count: data.count,
      limit: data.limit || safeMax,
      retryAfterSec: data.allowed === true ? 0 : Math.max(1, Math.ceil(retryMs / 1000) || Math.ceil(safeWindow / 1000))
    };
  } catch (e) {
    return rateLimitMemory(safeKey, safeMax, safeWindow);
  }
}

/**
 * User-based when authenticated; IP-based otherwise (shared networks won't block peers).
 */
export async function gateRouteRateLimit(req, { route, max, windowMs, userId }) {
  const id = userId ? String(userId) : '';
  const key = id
    ? `${route}:u:${id}`
    : `${route}:ip:${clientIp(req)}`;
  return checkRateLimit(key, max, windowMs);
}

/**
 * @param {'error'|'errorMessage'|'promo'|'plain'} format
 */
export function sendRateLimitResponse(res, result, format = 'errorMessage') {
  const sec = Math.max(1, (result && result.retryAfterSec) || 60);
  const msg = `Too many requests. Please try again in ${sec} seconds.`;
  try {
    res.setHeader('Retry-After', String(sec));
  } catch (e) {
    /* ignore */
  }
  if (format === 'promo') {
    return res.status(429).json({ valid: false, error: 'Too many requests', message: msg });
  }
  if (format === 'plain') {
    return res.status(429).json({ error: 'Too many requests', message: msg });
  }
  if (format === 'error') {
    return res.status(429).json({ error: msg });
  }
  return res.status(429).json({ error: { message: msg } });
}

/** @deprecated Use checkRateLimit / gateRouteRateLimit — sync memory-only shim */
export function rateLimit(key, max, windowMs) {
  return rateLimitMemory(key, max, windowMs).allowed;
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) {
    const dummy = Buffer.alloc(aa.length);
    crypto.timingSafeEqual(aa, dummy);
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

export function sanitizePostgrestSearch(s) {
  return String(s || '')
    .replace(/[,.()']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Constrain client context injected into Director system prompt */
export function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== 'string') return '';
  return ctx.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 4000);
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function sanitizeImage(image) {
  if (!image || typeof image !== 'object') return null;
  const data = typeof image.data === 'string' ? image.data.replace(/\s/g, '') : '';
  if (!data || data.length < 100 || data.length > 500000) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  const mime = ALLOWED_MIME.has(image.mime) ? image.mime : 'image/jpeg';
  return { data, mime };
}
