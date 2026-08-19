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
import {
  PRODUCT_EVENT_SET,
  sanitizeEventMeta,
  trackProductEventServer
} from '../lib/product-events.js';
import {
  loadEntitlement,
  grantOnboardingReward,
  recordCreationActivity,
  sanitizeTimezone,
  STREAK_KINDS
} from '../lib/entitlements.js';

function resourceOf(req) {
  const q = req.query || {};
  if (q.__resource) return String(q.__resource);
  const raw = String(req.url || '');
  if (raw.indexOf('/api/track-user') >= 0) return 'track';
  const action = req.body && req.body.action;
  if (action === 'grant_onboarding_reward') return 'reward';
  if (action === 'record_activity') return 'activity';
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
    if (auth.error === 'account_suspended') {
      return res.status(403).json({
        plan: 'free',
        status: 'account_suspended',
        error: 'account_suspended',
        blocked: true
      });
    }
    return res.status(auth.status).json({ plan: 'free', status: auth.error });
  }

  try {
    const ent = await loadEntitlement(auth.user.id, auth.user.email, getSubscription);
    return res.status(200).json(ent);
  } catch (err) {
    console.error('check-plan error:', err.message);
    return res.status(200).json({ plan: 'free', status: 'error' });
  }
}

function clientTimezone(req) {
  const body = req.body || {};
  return sanitizeTimezone(
    body.timezone || req.headers['x-timezone'] || 'UTC'
  );
}

async function handleReward(req, res, auth) {
  const rl = await gateRouteRateLimit(req, {
    route: 'onboarding-reward',
    max: 8,
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

  /* Never trust client hasCompletedOnboarding / localStorage. Grant is once-per-account. */
  const granted = await grantOnboardingReward(auth.user.id, clientTimezone(req));
  if (!granted || granted.ok === false) {
    return res.status(granted && granted.status === 404 ? 503 : 500).json({
      ok: false,
      error: (granted && granted.error) || 'grant_failed',
      message: 'Welcome reward is not available yet. Try again in a moment.'
    });
  }

  const ent = await loadEntitlement(auth.user.id, auth.user.email, getSubscription);
  if (granted.granted) {
    trackProductEventServer(auth.user.id, 'onboarding_completed', {
      reward: true
    }).catch(function () {});
  }
  return res.status(200).json({
    ok: true,
    already_granted: granted.already_granted === true,
    granted: granted.granted === true,
    entitlement: ent
  });
}

async function handleActivity(req, res, auth) {
  const rl = await gateRouteRateLimit(req, {
    route: 'creation-activity',
    max: 20,
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
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const kind = String((req.body && req.body.kind) || '');
  if (STREAK_KINDS.indexOf(kind) < 0) {
    return res.status(400).json({ ok: false, error: 'invalid_kind' });
  }

  const result = await recordCreationActivity(auth.user.id, kind, clientTimezone(req));
  if (!result || result.ok === false) {
    return res.status(200).json({ ok: false, error: (result && result.error) || 'activity_failed' });
  }
  return res.status(200).json({
    ok: true,
    incremented: result.incremented === true,
    current: result.current,
    longest: result.longest,
    lastActiveDate: result.last_active_date,
    days: result.days,
    milestone: result.milestone || null
  });
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
  const avatarRaw =
    typeof body.avatar === 'string' ? body.avatar : auth.user.avatar;
  const avatar =
    typeof avatarRaw === 'string' &&
    /^https?:\/\//i.test(avatarRaw) &&
    avatarRaw.length <= 2048
      ? avatarRaw
      : null;
  const provider =
    typeof body.provider === 'string'
      ? body.provider.slice(0, 40)
      : auth.user.provider || 'google';

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ ok: false });

  const h = serviceHeaders();

  try {
    if (body.action === 'events' && Array.isArray(body.events)) {
      const rows = body.events
        .slice(0, 20)
        .map((ev) => {
          const name = String((ev && ev.event) || '');
          if (!PRODUCT_EVENT_SET.has(name)) return null;
          return {
            user_id,
            event: name,
            meta: sanitizeEventMeta(ev && ev.meta),
            created_at: new Date().toISOString()
          };
        })
        .filter(Boolean);
      if (rows.length) {
        await fetch(`${SUPA_URL}/rest/v1/product_events`, {
          method: 'POST',
          headers: { ...h, Prefer: 'return=minimal' },
          body: JSON.stringify(rows)
        }).catch(function () {});
      }
      /* Referral signup attribution (once) */
      const ref =
        (typeof body.ref === 'string' && body.ref.slice(0, 40)) ||
        (rows.find((r) => r.meta && r.meta.ref) &&
          rows.find((r) => r.meta && r.meta.ref).meta.ref) ||
        null;
      if (ref && rows.some((r) => r.event === 'signup' || r.event === 'onboarding_completed')) {
        await trackProductEventServer(userId, 'referral_signup', { ref }).catch(function () {});
      }
      return res.status(200).json({ ok: true, tracked: rows.length });
    }

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
      /* Best-effort signup event */
      await fetch(`${SUPA_URL}/rest/v1/product_events`, {
        method: 'POST',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify([
          {
            user_id,
            event: 'signup',
            meta: { provider: provider || 'unknown' },
            created_at: new Date().toISOString()
          }
        ])
      }).catch(function () {});
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
  if (resource === 'reward') return handleReward(req, res, auth);
  if (resource === 'activity') return handleActivity(req, res, auth);
  return handlePlan(req, res, auth);
}
