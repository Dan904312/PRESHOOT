// api/promo.js — apply promo code to authenticated user only
import {
  setCors,
  handleOptions,
  requireUser,
  rateLimit,
  clientIp,
  serviceHeaders
} from '../lib/security.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!rateLimit('promo:' + clientIp(req), 10, 60 * 1000)) {
    return res.status(429).json({ valid: false, error: 'Too many requests' });
  }

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ valid: false, error: auth.error });

  const code = (req.body && req.body.code) || '';
  if (!code || typeof code !== 'string') return res.status(400).json({ valid: false });

  const rawCodes = process.env.PROMO_CODES || '';
  const validCodes = rawCodes
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const normalized = code.trim().toUpperCase().slice(0, 64);
  const isValid = validCodes.includes(normalized);

  if (!isValid) return res.status(200).json({ valid: false });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const user_id = auth.user.id;
  const email = auth.user.email;

  if (SUPA_URL && SUPA_KEY) {
    try {
      const h = { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' };

      await fetch(`${SUPA_URL}/rest/v1/promo_usage`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ code: normalized, user_id, email })
      });

      await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          user_id,
          email,
          plan: 'pro',
          status: 'promo',
          promo_code: normalized,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          user_id,
          email,
          event_type: 'promo.applied',
          payload: { code: normalized }
        })
      });
    } catch (err) {
      console.error('Promo DB error:', err.message);
      return res.status(500).json({ valid: false, error: 'db_error' });
    }
  }

  return res.status(200).json({ valid: true });
}
