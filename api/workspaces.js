/**
 * Workspace CRUD + members + invites.
 * Routes (parsed from URL — works with Vercel flat rewrite):
 *   GET    /api/workspaces
 *   POST   /api/workspaces
 *   GET    /api/workspaces/:id
 *   PATCH  /api/workspaces/:id
 *   GET    /api/workspaces/:id/members
 *   POST   /api/workspaces/:id/members
 *   PATCH  /api/workspaces/:id/members/:userId
 *   DELETE /api/workspaces/:id/members/:userId
 *   POST   /api/workspaces/:id/invites
 */
import {
  setCors,
  handleOptions,
  requireUser,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';
import {
  isUuid,
  listUserWorkspaces,
  createSharedWorkspace,
  assertWorkspaceMember,
  patchWorkspace,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
  createInvite
} from '../lib/workspaces.js';

function parsePath(req) {
  /* Vercel rewrite: /api/workspaces/:rest → /api/workspaces?__path=:rest */
  const qp = req.query && (req.query.__path || req.query.path);
  if (qp != null && String(qp).length) {
    return String(qp)
      .split('/')
      .map((s) => decodeURIComponent(s))
      .filter(Boolean);
  }
  const raw = String(req.url || '').split('?')[0];
  const idx = raw.indexOf('/api/workspaces');
  const rest = idx >= 0 ? raw.slice(idx + '/api/workspaces'.length) : '';
  return rest
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);
}

function sendError(res, result) {
  const status = result.status || 400;
  return res.status(status).json({
    ok: false,
    error: result.error || 'error',
    message: result.message || undefined,
    role: result.role || undefined
  });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'workspaces',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const userId = auth.user.id;
  const parts = parsePath(req);
  const body = req.body || {};

  try {
    /* GET /api/workspaces */
    if (parts.length === 0 && req.method === 'GET') {
      const listed = await listUserWorkspaces(userId);
      if (!listed.ok) return sendError(res, listed);
      return res.status(200).json({ ok: true, workspaces: listed.workspaces });
    }

    /* POST /api/workspaces — create shared */
    if (parts.length === 0 && req.method === 'POST') {
      const created = await createSharedWorkspace(userId, {
        name: body.name,
        slug: body.slug
      });
      if (!created.ok) return sendError(res, created);
      return res.status(201).json({ ok: true, workspace: created.workspace });
    }

    const workspaceId = parts[0];
    if (!isUuid(workspaceId)) {
      return res.status(400).json({ ok: false, error: 'invalid_workspace_id' });
    }

    /* GET /api/workspaces/:id */
    if (parts.length === 1 && req.method === 'GET') {
      const m = await assertWorkspaceMember(userId, workspaceId);
      if (!m.ok) return sendError(res, m);
      return res.status(200).json({
        ok: true,
        workspace: {
          ...m.workspace,
          role: m.role,
          canEdit: m.canEdit,
          canManageMembers: m.canManageMembers,
          storage: m.workspace.kind === 'personal' ? 'user_data' : 'workspace_data'
        }
      });
    }

    /* PATCH /api/workspaces/:id */
    if (parts.length === 1 && req.method === 'PATCH') {
      const patched = await patchWorkspace(userId, workspaceId, body);
      if (!patched.ok) return sendError(res, patched);
      return res.status(200).json({ ok: true, workspace: patched.workspace });
    }

    /* Members */
    if (parts[1] === 'members') {
      if (parts.length === 2 && req.method === 'GET') {
        const listed = await listMembers(userId, workspaceId);
        if (!listed.ok) return sendError(res, listed);
        return res.status(200).json({ ok: true, members: listed.members });
      }
      if (parts.length === 2 && req.method === 'POST') {
        const added = await addMember(userId, workspaceId, {
          targetUserId: body.user_id || body.userId,
          role: body.role
        });
        if (!added.ok) return sendError(res, added);
        return res.status(201).json({ ok: true, member: added.member });
      }
      if (parts.length === 3 && req.method === 'PATCH') {
        const targetUserId = parts[2];
        const updated = await updateMemberRole(userId, workspaceId, targetUserId, body.role);
        if (!updated.ok) return sendError(res, updated);
        return res.status(200).json({ ok: true, member: updated.member });
      }
      if (parts.length === 3 && req.method === 'DELETE') {
        const targetUserId = parts[2];
        const removed = await removeMember(userId, workspaceId, targetUserId);
        if (!removed.ok) return sendError(res, removed);
        return res.status(200).json({ ok: true });
      }
    }

    /* Invites */
    if (parts[1] === 'invites' && parts.length === 2 && req.method === 'POST') {
      const invited = await createInvite(userId, workspaceId, {
        email: body.email,
        role: body.role || 'editor',
        expiresInHours: body.expires_in_hours || body.expiresInHours
      });
      if (!invited.ok) return sendError(res, invited);
      return res.status(201).json({
        ok: true,
        invite: invited.invite,
        token: invited.token
      });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('workspaces api error', err && err.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
