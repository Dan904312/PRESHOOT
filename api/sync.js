// api/sync.js — cross-device data sync
// POST { action: 'load', user_id }
// POST { action: 'save', user_id, data: {...} }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, user_id, data } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ ok: false, error: 'no_config' });

  const h = {
    'Content-Type': 'application/json',
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY
  };

  try {
    if (action === 'load') {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(user_id)}&limit=1`,
        { headers: h }
      );
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return res.status(200).json({ ok: true, data: null });
      return res.status(200).json({ ok: true, data: rows[0] });
    }

    if (action === 'save') {
      if (!data) return res.status(400).json({ error: 'data required' });
      const historyClean = (data.history || []).map(function(h) {
        return { sceneType: h.sceneType, sceneLabel: h.sceneLabel, ideas: h.ideas, ts: h.ts };
      });
      const payload = {
        user_id,
        history: historyClean,
        library: data.library || [],
        director_history: (data.director_history || []).slice(-30),
        niche: data.niche || {},
        platform_focus: data.platform_focus || {},
        aesthetic: data.aesthetic || {},
        gear: data.gear || {},
        profile: data.profile || {},
        prefs: data.prefs || {},
        updated_at: new Date().toISOString()
      };
      await fetch(`${SUPA_URL}/rest/v1/user_data`, {
        method: 'POST',
        headers: { ...h, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error('sync error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
