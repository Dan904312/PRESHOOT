// api/track-user.js
// Called on every sign-in. Upserts into `users` table so EVERY user
// is tracked, not just paying subscribers.
// POST { user_id, email, name, avatar, provider }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email, name, avatar, provider } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ ok: false });

  const h = {
    'Content-Type': 'application/json',
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY
  };

  try {
    // Check if user already exists — only set first_seen on first insert
    const checkR = await fetch(`${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(user_id)}&select=user_id&limit=1`, { headers: h });
    const existing = await checkR.json();

    if (Array.isArray(existing) && existing.length > 0) {
      // Existing user — just bump last_seen
      await fetch(`${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(user_id)}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({
          last_seen: new Date().toISOString(),
          email, name, avatar
        })
      });
    } else {
      // New user — insert with first_seen = now
      await fetch(`${SUPA_URL}/rest/v1/users`, {
        method: 'POST',
        headers: { ...h, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id, email, name, avatar,
          provider: provider || 'google',
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
