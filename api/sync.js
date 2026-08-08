// api/sync.js — cross-device data sync (JWT-bound) with payload guards
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse,
  serviceHeaders
} from '../lib/security.js';

const MAX_JSON = 900_000; // ~0.9MB final stored payload
const MAX_REQUEST_JSON = 1_200_000; // reject raw save data above this
const MAX_FIELD_JSON = 450_000; // prefs / studio / large objects
const MAX_PROFILE_JSON = 80_000;
const MAX_HISTORY = 100;
const MAX_LIBRARY = 200;
const MAX_DIRECTOR = 30;
const MAX_IMAGE = 200_000;

function clipArray(arr, n) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

function jsonSize(value) {
  try {
    return JSON.stringify(value == null ? null : value).length;
  } catch (e) {
    return Number.MAX_SAFE_INTEGER;
  }
}

function clampObject(value, maxBytes) {
  if (!value || typeof value !== 'object') return {};
  if (jsonSize(value) <= maxBytes) return value;
  return null;
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

      const incomingSize = jsonSize(data);
      if (incomingSize > MAX_REQUEST_JSON) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: 'Sync payload exceeds the maximum allowed size.'
        });
      }

      const historyClean = clipArray(data.history, MAX_HISTORY).map(function (item) {
        return {
          sceneType: item.sceneType,
          sceneLabel: item.sceneLabel,
          ideas: item.ideas,
          ts: item.ts,
          image:
            typeof item.image === 'string' && item.image.length < MAX_IMAGE ? item.image : null
        };
      });

      const prefs =
        data.prefs && typeof data.prefs === 'object' ? Object.assign({}, data.prefs) : {};
      if (data.studio && typeof data.studio === 'object' && !prefs.studio) {
        prefs.studio = data.studio;
      }
      /* Persist Director chats + connected accounts inside prefs (no extra SQL columns) */
      if (Array.isArray(data.director_convs)) {
        prefs.director_convs = clipArray(data.director_convs, 20);
      }
      if (data.active_dir_conv) prefs.active_dir_conv = String(data.active_dir_conv).slice(0, 80);
      if (data.connected_accounts && typeof data.connected_accounts === 'object') {
        prefs.connected_accounts = data.connected_accounts;
      }

      const prefsClamped = clampObject(prefs, MAX_FIELD_JSON);
      if (prefsClamped === null) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: 'Studio/prefs data exceeds the maximum allowed size.'
        });
      }

      const profile = clampObject(
        data.profile && typeof data.profile === 'object' ? data.profile : {},
        MAX_PROFILE_JSON
      );
      if (profile === null) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: 'Profile data exceeds the maximum allowed size.'
        });
      }

      const niche = clampObject(
        data.niche && typeof data.niche === 'object' ? data.niche : {},
        40_000
      );
      const platform_focus = clampObject(
        data.platform_focus && typeof data.platform_focus === 'object'
          ? data.platform_focus
          : {},
        40_000
      );
      const aesthetic = clampObject(
        data.aesthetic && typeof data.aesthetic === 'object' ? data.aesthetic : {},
        40_000
      );
      const gear = clampObject(
        data.gear && typeof data.gear === 'object' ? data.gear : {},
        40_000
      );
      if ([niche, platform_focus, aesthetic, gear].some((v) => v === null)) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: 'Personalization data exceeds the maximum allowed size.'
        });
      }

      const updatedAt = new Date().toISOString();
      const payload = {
        user_id,
        history: historyClean,
        library: clipArray(data.library, MAX_LIBRARY),
        director_history: clipArray(data.director_history, MAX_DIRECTOR),
        niche,
        platform_focus,
        aesthetic,
        gear,
        profile,
        prefs: prefsClamped,
        updated_at: updatedAt
      };

      let serialized = JSON.stringify(payload);
      if (serialized.length > MAX_JSON) {
        payload.history = historyClean.map((item) => ({ ...item, image: null }));
        serialized = JSON.stringify(payload);
      }
      if (serialized.length > MAX_JSON) {
        return res.status(413).json({
          error: 'payload_too_large',
          message: 'Sync payload still exceeds the maximum after stripping images.'
        });
      }

      const write = await fetch(`${SUPA_URL}/rest/v1/user_data`, {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates' },
        body: serialized
      });
      if (!write.ok) {
        return res.status(500).json({ error: 'sync_failed' });
      }
      return res.status(200).json({ ok: true, updated_at: updatedAt });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error('sync error');
    return res.status(500).json({ error: 'sync_failed' });
  }
}
