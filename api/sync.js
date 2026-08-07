// api/sync.js — cross-device data sync (JWT-bound)
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse,
  serviceHeaders
} from '../lib/security.js';

const MAX_JSON = 900_000; // ~0.9MB serialized payload guard

function clipArray(arr, n) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'sync',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const user_id = auth.user.id;
  const { action, data } = req.body || {};

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ ok: false, error: 'no_config' });

  const h = serviceHeaders();

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
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });

      const historyClean = clipArray(data.history, 100).map(function (item) {
        return {
          sceneType: item.sceneType,
          sceneLabel: item.sceneLabel,
          ideas: item.ideas,
          ts: item.ts,
          image: typeof item.image === 'string' && item.image.length < 200000 ? item.image : null
        };
      });

      /* Studio (Phase 1) syncs via prefs.studio — works on existing DBs with no ALTER.
         Optional top-level `studio` column can be added later (see supabase_setup.sql). */
      const prefs =
        data.prefs && typeof data.prefs === 'object' ? Object.assign({}, data.prefs) : {};
      if (data.studio && typeof data.studio === 'object' && !prefs.studio) {
        prefs.studio = data.studio;
      }

      const payload = {
        user_id,
        history: historyClean,
        library: clipArray(data.library, 200),
        director_history: clipArray(data.director_history, 30),
        niche: data.niche && typeof data.niche === 'object' ? data.niche : {},
        platform_focus:
          data.platform_focus && typeof data.platform_focus === 'object'
            ? data.platform_focus
            : {},
        aesthetic: data.aesthetic && typeof data.aesthetic === 'object' ? data.aesthetic : {},
        gear: data.gear && typeof data.gear === 'object' ? data.gear : {},
        profile: data.profile && typeof data.profile === 'object' ? data.profile : {},
        prefs,
        updated_at: new Date().toISOString()
      };

      const serialized = JSON.stringify(payload);
      if (serialized.length > MAX_JSON) {
        /* Drop images from history if over size */
        payload.history = historyClean.map((item) => ({ ...item, image: null }));
      }

      await fetch(`${SUPA_URL}/rest/v1/user_data`, {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error('sync error:', err.message);
    return res.status(500).json({ error: 'sync_failed' });
  }
}
