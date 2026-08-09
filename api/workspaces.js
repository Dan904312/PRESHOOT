/**
 * Collaborative Workspaces API — single Serverless Function entry.
 *
 * Public URL contracts preserved via vercel.json rewrites:
 *   /api/workspaces[...]
 *   /api/workspace-sync              → ?__resource=sync
 *   /api/workspace-invites/accept    → ?__resource=invite-accept
 *
 * Personal Studio remains on /api/sync (separate function).
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
  createInvite,
  acceptInvite,
  loadWorkspaceDocument,
  saveWorkspaceDocument
} from '../lib/workspaces.js';

function resourceOf(req) {
  const q = req.query || {};
  if (q.__resource) return String(q.__resource);
  const raw = String(req.url || '');
  if (raw.indexOf('/api/workspace-sync') >= 0) return 'sync';
  if (raw.indexOf('/api/workspace-invites/accept') >= 0) return 'invite-accept';
  return 'crud';
}

function parsePath(req) {
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

async function handleSync(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await gateRouteRateLimit(req, {
    route: 'workspace-sync',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  const body = req.body || {};
  const action = body.action;
  const workspaceId = body.workspace_id || body.workspaceId;
  if (!isUuid(workspaceId)) {
    return res.status(400).json({ ok: false, error: 'workspace_id required' });
  }

  if (action === 'load') {
    const loaded = await loadWorkspaceDocument(auth.user.id, workspaceId);
    if (!loaded.ok) {
      return res.status(loaded.status || 400).json({
        ok: false,
        error: loaded.error,
        message: loaded.message
      });
    }
    return res.status(200).json({
      ok: true,
      workspace_id: workspaceId,
      workspace: loaded.workspace,
      role: loaded.role,
      canEdit: loaded.canEdit,
      document: loaded.document,
      revision: loaded.revision,
      updated_at: loaded.updated_at,
      updated_by: loaded.updated_by
    });
  }

  if (action === 'save') {
    const saved = await saveWorkspaceDocument(
      auth.user.id,
      workspaceId,
      body.document,
      body.revision
    );
    if (!saved.ok) {
      const payload = {
        ok: false,
        error: saved.error,
        message: saved.message
      };
      if (saved.status === 409) {
        payload.revision = saved.revision;
        payload.document = saved.document;
        payload.updated_at = saved.updated_at;
        payload.updated_by = saved.updated_by;
      }
      return res.status(saved.status || 400).json(payload);
    }
    return res.status(200).json({
      ok: true,
      workspace_id: workspaceId,
      document: saved.document,
      revision: saved.revision,
      updated_at: saved.updated_at,
      updated_by: saved.updated_by
    });
  }

  return res.status(400).json({ ok: false, error: 'action must be load or save' });
}

async function handleInviteAccept(req, res, auth) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await gateRouteRateLimit(req, {
    route: 'workspace-invites',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

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

async function handleCrud(req, res, auth) {
  const rl = await gateRouteRateLimit(req, {
    route: 'workspaces',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  const userId = auth.user.id;
  const parts = parsePath(req);
  const body = req.body || {};

  if (parts.length === 0 && req.method === 'GET') {
    const listed = await listUserWorkspaces(userId);
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({ ok: true, workspaces: listed.workspaces });
  }

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

  if (parts.length === 1 && req.method === 'PATCH') {
    const patched = await patchWorkspace(userId, workspaceId, body);
    if (!patched.ok) return sendError(res, patched);
    return res.status(200).json({ ok: true, workspace: patched.workspace });
  }

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
      const updated = await updateMemberRole(userId, workspaceId, parts[2], body.role);
      if (!updated.ok) return sendError(res, updated);
      return res.status(200).json({ ok: true, member: updated.member });
    }
    if (parts.length === 3 && req.method === 'DELETE') {
      const removed = await removeMember(userId, workspaceId, parts[2]);
      if (!removed.ok) return sendError(res, removed);
      return res.status(200).json({ ok: true });
    }
  }

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
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const resource = resourceOf(req);
  try {
    if (resource === 'sync') return await handleSync(req, res, auth);
    if (resource === 'invite-accept') return await handleInviteAccept(req, res, auth);
    return await handleCrud(req, res, auth);
  } catch (err) {
    console.error('workspaces api error', err && err.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
