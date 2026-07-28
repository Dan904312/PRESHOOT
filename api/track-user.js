// api/track-user.js — upsert signed-in user profile (JWT-bound)
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

  if (!rateLimit('track:' + clientIp(req), 30, 60 * 1000)) {
    return res.status(429).json({ ok: false });
  }

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });

  const user_id = auth.user.id;
  const email = auth.user.email;
  const body = req.body || {};
  /* Only accept display fields from client; identity from JWT */
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
      await fetch(
        `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(user_id)}`,
        {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({
            last_seen: new Date().toISOString(),
            email,
            name,
            avatar
          })
        }
      );
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
