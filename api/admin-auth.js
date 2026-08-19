// api/admin-auth.js — admin login / logout / session check (HttpOnly cookie)
import {
  setCors,
  handleOptions,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';
import {
  verifyAdminSecret,
  createAdminSession,
  requireAdminSession,
  revokeAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  adminSessionTtlSec
} from '../lib/admin-session.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await gateRouteRateLimit(req, {
    route: 'admin-auth',
    max: 40,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  const action = (req.body && req.body.action) || '';

  try {
    if (action === 'login') {
      const loginRl = await gateRouteRateLimit(req, {
        route: 'admin-login',
        max: 8,
        windowMs: 15 * 60 * 1000
      });
      if (!loginRl.allowed) return sendRateLimitResponse(res, loginRl, 'plain');
      const secret = req.body && req.body.secret;
      if (!secret || typeof secret !== 'string') {
        return res.status(400).json({ ok: false, error: 'password_required' });
      }
      if (!process.env.ADMIN_SECRET) {
        return res.status(500).json({ ok: false, error: 'admin_not_configured' });
      }
      if (!verifyAdminSecret(secret.trim())) {
        return res.status(401).json({ ok: false, error: 'invalid_password' });
      }

      const session = await createAdminSession();
      if (!session.ok) {
        return res.status(500).json({
          ok: false,
          error: session.error || 'session_create_failed',
          message: 'Admin sessions unavailable. Apply admin_sessions SQL migration.'
        });
      }

      setAdminSessionCookie(res, session.token, session.ttl || adminSessionTtlSec());
      return res.status(200).json({
        ok: true,
        expiresAt: session.expiresAt,
        ttlSec: session.ttl
      });
    }

    if (action === 'logout') {
      await revokeAdminSession(req);
      clearAdminSessionCookie(res);
      return res.status(200).json({ ok: true });
    }

    if (action === 'session') {
      const session = await requireAdminSession(req);
      if (!session.ok) {
        clearAdminSessionCookie(res);
        return res.status(session.status || 401).json({
          ok: false,
          error: session.error || 'auth_required'
        });
      }
      return res.status(200).json({
        ok: true,
        expiresAt: session.expiresAt
      });
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error('admin-auth error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'auth_failed' });
  }
}
