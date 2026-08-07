// api/promo.js — apply promo code with server-side redemption controls
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse,
  serviceHeaders
} from '../lib/security.js';

const ERROR_MESSAGES = {
  invalid_code: 'Invalid code. Try again',
  inactive: 'This promo code is no longer active',
  expired: 'This promo code has expired',
  limit_reached: 'This promo code has reached its redemption limit',
  already_redeemed: 'You have already redeemed this promo code',
  invalid_request: 'Invalid promo request',
  db_error: 'Promo system unavailable',
  unavailable: 'Promo system unavailable'
};

function envPromoList() {
  return (process.env.PROMO_CODES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

function defaultMaxRedemptions() {
  const n = parseInt(process.env.PROMO_DEFAULT_MAX_REDEMPTIONS || '50', 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function defaultExpiresAt() {
  const raw = (process.env.PROMO_DEFAULT_EXPIRES_AT || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function callRedeem(code, userId, email) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/redeem_promo_code`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_code: code,
      p_user_id: userId,
      p_email: email || ''
    })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, error: 'db_error', status: r.status, raw: data };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'db_error' };
  }
  return data;
}

/** Bootstrap env PROMO_CODES into limited promo_codes rows (never unlimited). */
async function ensureEnvPromoRow(code) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const h = serviceHeaders();
  const existing = await fetch(
    `${SUPA_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=id&limit=1`,
    { headers: h }
  );
  const rows = await existing.json().catch(() => null);
  if (Array.isArray(rows) && rows.length > 0) return true;

  const r = await fetch(`${SUPA_URL}/rest/v1/promo_codes`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify({
      code,
      max_redemptions: defaultMaxRedemptions(),
      redemption_count: 0,
      active: true,
      expires_at: defaultExpiresAt()
    })
  });
  if (r.ok || r.status === 409) return true;

  const again = await fetch(
    `${SUPA_URL}/rest/v1/promo_codes?code=eq.${encodeURIComponent(code)}&select=id&limit=1`,
    { headers: h }
  );
  const rows2 = await again.json().catch(() => null);
  return Array.isArray(rows2) && rows2.length > 0;
}

function reject(res, status, errorKey) {
  return res.status(status).json({
    valid: false,
    error: errorKey,
    message: ERROR_MESSAGES[errorKey] || ERROR_MESSAGES.invalid_code
  });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ valid: false, error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'promo',
    max: 10,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'promo');

  if (auth.error) return res.status(auth.status).json({ valid: false, error: auth.error });

  const code = (req.body && req.body.code) || '';
  if (!code || typeof code !== 'string') {
    return reject(res, 400, 'invalid_request');
  }

  const normalized = code.trim().toUpperCase().slice(0, 64);
  if (!normalized) return reject(res, 400, 'invalid_request');

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return reject(res, 500, 'unavailable');
  }

  const user_id = auth.user.id;
  const email = auth.user.email || '';

  try {
    let result = await callRedeem(normalized, user_id, email);

    /* Env codes still work, but only after seeding a limited DB row */
    if (!result.ok && result.error === 'invalid_code' && envPromoList().includes(normalized)) {
      const seeded = await ensureEnvPromoRow(normalized);
      if (!seeded) return reject(res, 500, 'db_error');
      result = await callRedeem(normalized, user_id, email);
    }

    if (result.ok) {
      return res.status(200).json({ valid: true, code: result.code || normalized });
    }

    const err = result.error || 'invalid_code';
    const status =
      err === 'already_redeemed' || err === 'limit_reached' || err === 'expired' || err === 'inactive'
        ? 403
        : err === 'db_error'
          ? 500
          : 200;
    return reject(res, status, ERROR_MESSAGES[err] ? err : 'invalid_code');
  } catch (err) {
    console.error('Promo redeem error:', err && err.message ? err.message : err);
    return reject(res, 500, 'db_error');
  }
}
