/**
 * POST /api/workspace-invites/accept
 * Body: { token: "..." }
 */
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';
import { acceptInvite } from '../lib/workspaces.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'workspace-invites',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const token = (req.body && (req.body.token || req.body.invite_token)) || '';
  const result = await acceptInvite(auth.user, token);
  if (!result.ok) {
    return res.status(result.status || 400).json({
      ok: false,
      error: result.error,
      message: result.message
    });
  }
  return res.status(200).json({
    ok: true,
    workspace_id: result.workspace_id,
    role: result.role,
    workspace: result.workspace
  });
}
