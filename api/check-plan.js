/**
 * Account helpers — single Serverless Function for:
 *   POST /api/check-plan   (default)
 *   POST /api/track-user   → rewritten to ?__resource=track
 *
 * Public URL contracts unchanged via vercel.json.
 */
import {
  setCors,
  handleOptions,
  requireUser,
  getSubscription,
  gateRouteRateLimit,
  serviceHeaders
} from '../lib/security.js';

function resourceOf(req) {
  const q = req.query || {};
  if (q.__resource) return String(q.__resource);
  const raw = String(req.url || '');
  if (raw.indexOf('/api/track-user') >= 0) return 'track';
  return 'plan';
}

async function handlePlan(req, res, auth) {
  const rl = await gateRouteRateLimit(req, {
    route: 'plan',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) {
    const sec = Math.max(1, rl.retryAfterSec || 60);
    try {
      res.setHeader('Retry-After', String(sec));
    } catch (e) {
      /* ignore */
    }
    return res.status(429).json({
      plan: 'free',
      status: 'rate_limited',
      message: `Too many requests. Please try again in ${sec} seconds.`
    });
  }

  if (auth.error) {
    return res.status(auth.status).json({ plan: 'free', status: auth.error });
  }

  try {
    const sub = await getSubscription(auth.user.id, auth.user.email);
    return res.status(200).json({ plan: sub.plan, status: sub.status });
  } catch (err) {
    console.error('check-plan error:', err.message);
    return res.status(200).json({ plan: 'free', status: 'error' });
  }
}

async function handleTrack(req, res, auth) {
  const rl = await gateRouteRateLimit(req, {
    route: 'track',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) {
    const sec = Math.max(1, rl.retryAfterSec || 60);
    try {
      res.setHeader('Retry-After', String(sec));
    } catch (e) {
      /* ignore */
    }
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: `Too many requests. Please try again in ${sec} seconds.`
    });
  }

  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const user_id = auth.user.id;
  const email = auth.user.email;
  const body = req.body || {};
  const name =
    typeof body.name === 'string' ? body.name.slice(0, 120) : auth.user.name;
  const avatar =
    typeof body.avatar === 'string' && body.avatar.length < 500000
      ? body.avatar
      : auth.user.avatar;
  const provider =
    typeof body.provider === 'string'
      ? body.provider.slice(0, 40)
      : auth.user.provider || 'google';

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ ok: false });

  const h = serviceHeaders();

  try {
    const checkR = await fetch(
      `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(user_id)}&select=user_id&limit=1`,
      { headers: h }
    );
    const existing = await checkR.json();

    if (Array.isArray(existing) && existing.length > 0) {
      await fetch(`${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(user_id)}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({
          last_seen: new Date().toISOString(),
          email,
          name,
          avatar
        })
      });
    } else {
      await fetch(`${SUPA_URL}/rest/v1/users`, {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id,
          email,
          name,
          avatar,
          provider,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString()
        })
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('track-user error:', err.message);
    return res.status(200).json({ ok: false });
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const resource = resourceOf(req);

  if (resource === 'track') return handleTrack(req, res, auth);
  return handlePlan(req, res, auth);
}
