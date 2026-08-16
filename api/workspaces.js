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
  sendRateLimitResponse,
  logSupabaseConfigPresence
} from '../lib/security.js';
import {
  isUuid,
  listUserWorkspaces,
  createSharedWorkspace,
  assertWorkspaceMember,
  patchWorkspace,
  listMembers,
  listInvites,
  addMember,
  updateMemberRole,
  removeMember,
  createInvite,
  acceptInvite,
  revokeInvite,
  loadWorkspaceDocument,
  saveWorkspaceDocument,
  listWorkspaceVersions,
  getWorkspaceVersion,
  restoreWorkspaceVersion,
  summarizeDocumentDiff
} from '../lib/workspaces.js';
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  setCommentResolved,
  getProductionReviewSummary,
  setProductionReviewStatus,
  listNotifications,
  markNotificationRead,
  listCommentActivity
} from '../lib/workspace-comments.js';

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
      body.revision,
      { changeHint: body.change || body.changeHint || null }
    );
    if (!saved.ok) {
      const payload = {
        ok: false,
        error: saved.error,
        message: saved.message
      };
      if (saved.status === 409) {
        payload.revision = saved.revision;
        payload.client_revision = saved.client_revision;
        payload.document = saved.document;
        payload.updated_at = saved.updated_at;
        payload.updated_by = saved.updated_by;
        payload.change = saved.change || null;
      }
      return res.status(saved.status || 400).json(payload);
    }
    return res.status(200).json({
      ok: true,
      workspace_id: workspaceId,
      document: saved.document,
      revision: saved.revision,
      updated_at: saved.updated_at,
      updated_by: saved.updated_by,
      change: saved.change || null,
      changes: saved.changes || null,
      activity_label: saved.activity_label || null
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

  /* GET /api/workspaces/:id/invites — pending/history (no token_hash) */
  if (parts[1] === 'invites' && parts.length === 2 && req.method === 'GET') {
    const listed = await listInvites(userId, workspaceId);
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({ ok: true, invites: listed.invites });
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

  /* DELETE /api/workspaces/:id/invites/:inviteId — revoke */
  if (parts[1] === 'invites' && parts.length === 3 && req.method === 'DELETE') {
    const revoked = await revokeInvite(userId, workspaceId, parts[2]);
    if (!revoked.ok) return sendError(res, revoked);
    return res.status(200).json({
      ok: true,
      invite: revoked.invite || null,
      already_revoked: !!revoked.already_revoked
    });
  }

  /* GET /api/workspaces/:id/versions — metadata list (members) */
  if (parts[1] === 'versions' && parts.length === 2 && req.method === 'GET') {
    const listed = await listWorkspaceVersions(userId, workspaceId, {
      limit: body.limit || req.query.limit
    });
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({
      ok: true,
      versions: listed.versions,
      retention: listed.retention,
      role: listed.role,
      canRestore: listed.canRestore
    });
  }

  /* GET /api/workspaces/:id/versions/:versionId — full snapshot view */
  if (parts[1] === 'versions' && parts.length === 3 && req.method === 'GET') {
    const got = await getWorkspaceVersion(userId, workspaceId, parts[2]);
    if (!got.ok) return sendError(res, got);
    return res.status(200).json({
      ok: true,
      version: got.version,
      role: got.role,
      canRestore: got.canRestore
    });
  }

  /* POST /api/workspaces/:id/versions/:versionId/restore — new revision via concurrency */
  if (
    parts[1] === 'versions' &&
    parts.length === 4 &&
    parts[3] === 'restore' &&
    req.method === 'POST'
  ) {
    const restored = await restoreWorkspaceVersion(
      userId,
      workspaceId,
      parts[2],
      body.revision != null ? body.revision : body.expectedCurrentRevision
    );
    if (!restored.ok) {
      const payload = {
        ok: false,
        error: restored.error,
        message: restored.message
      };
      if (restored.status === 409) {
        payload.revision = restored.revision;
        payload.client_revision = restored.client_revision;
        payload.document = restored.document;
        payload.updated_at = restored.updated_at;
        payload.updated_by = restored.updated_by;
        payload.change = restored.change || null;
      }
      return res.status(restored.status || 400).json(payload);
    }
    return res.status(200).json({
      ok: true,
      revision: restored.revision,
      document: restored.document,
      updated_at: restored.updated_at,
      updated_by: restored.updated_by,
      restored_from_revision: restored.restored_from_revision,
      restored_from_version_id: restored.restored_from_version_id
    });
  }

  /* POST /api/workspaces/:id/compare — structured conflict summary (optional helper) */
  if (parts[1] === 'compare' && parts.length === 2 && req.method === 'POST') {
    const m = await assertWorkspaceMember(userId, workspaceId);
    if (!m.ok) return sendError(res, m);
    const diff = summarizeDocumentDiff(body.local, body.server);
    return res.status(200).json({ ok: true, diff });
  }

  /* Phase 5C — comments (separate from Studio JSON) */
  if (parts[1] === 'comments' && parts.length === 2 && req.method === 'GET') {
    const listed = await listComments(userId, workspaceId, {
      productionId: req.query.production_id || req.query.productionId || body.production_id,
      targetType: req.query.target_type || req.query.targetType || body.target_type,
      targetId: req.query.target_id || req.query.targetId || body.target_id,
      unresolvedOnly:
        String(req.query.unresolved || body.unresolved || '') === '1' ||
        body.unresolved_only === true,
      limit: req.query.limit || body.limit
    });
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({
      ok: true,
      comments: listed.comments,
      role: listed.role,
      canComment: listed.canComment,
      canResolve: listed.canResolve,
      canModerate: listed.canModerate
    });
  }

  if (parts[1] === 'comments' && parts.length === 2 && req.method === 'POST') {
    const rlComment = await gateRouteRateLimit(req, {
      route: 'workspace-comments',
      max: 30,
      windowMs: 60 * 1000,
      userId
    });
    if (!rlComment.allowed) return sendRateLimitResponse(res, rlComment, 'plain');

    const created = await createComment(userId, workspaceId, body);
    if (!created.ok) return sendError(res, created);
    return res.status(201).json({ ok: true, comment: created.comment });
  }

  if (parts[1] === 'comments' && parts.length === 3 && req.method === 'PATCH') {
    const updated = await updateComment(userId, workspaceId, parts[2], body);
    if (!updated.ok) return sendError(res, updated);
    return res.status(200).json({ ok: true, comment: updated.comment });
  }

  if (parts[1] === 'comments' && parts.length === 3 && req.method === 'DELETE') {
    const deleted = await deleteComment(userId, workspaceId, parts[2]);
    if (!deleted.ok) return sendError(res, deleted);
    return res.status(200).json({ ok: true });
  }

  if (
    parts[1] === 'comments' &&
    parts.length === 4 &&
    parts[3] === 'resolve' &&
    req.method === 'POST'
  ) {
    const resolved = await setCommentResolved(userId, workspaceId, parts[2], true);
    if (!resolved.ok) return sendError(res, resolved);
    return res.status(200).json({ ok: true, comment: resolved.comment });
  }

  if (
    parts[1] === 'comments' &&
    parts.length === 4 &&
    parts[3] === 'reopen' &&
    req.method === 'POST'
  ) {
    const reopened = await setCommentResolved(userId, workspaceId, parts[2], false);
    if (!reopened.ok) return sendError(res, reopened);
    return res.status(200).json({ ok: true, comment: reopened.comment });
  }

  /* GET /api/workspaces/:id/comment-activity */
  if (parts[1] === 'comment-activity' && parts.length === 2 && req.method === 'GET') {
    const listed = await listCommentActivity(userId, workspaceId, {
      limit: req.query.limit || body.limit
    });
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({ ok: true, activity: listed.activity, role: listed.role });
  }

  /* Production review summary + review status */
  if (
    parts[1] === 'productions' &&
    parts.length === 4 &&
    parts[3] === 'review' &&
    req.method === 'GET'
  ) {
    const summary = await getProductionReviewSummary(userId, workspaceId, parts[2]);
    if (!summary.ok) return sendError(res, summary);
    return res.status(200).json(summary);
  }

  if (
    parts[1] === 'productions' &&
    parts.length === 4 &&
    parts[3] === 'review-status' &&
    req.method === 'POST'
  ) {
    const saved = await setProductionReviewStatus(
      userId,
      workspaceId,
      parts[2],
      body.review_status || body.reviewStatus,
      body.revision,
      saveWorkspaceDocument
    );
    if (!saved.ok) {
      const payload = {
        ok: false,
        error: saved.error,
        message: saved.message
      };
      if (saved.status === 409) {
        payload.revision = saved.revision;
        payload.client_revision = saved.client_revision;
        payload.document = saved.document;
        payload.updated_at = saved.updated_at;
        payload.updated_by = saved.updated_by;
        payload.change = saved.change || null;
      }
      return res.status(saved.status || 400).json(payload);
    }
    return res.status(200).json({
      ok: true,
      revision: saved.revision,
      review_status: saved.review_status,
      document: saved.document,
      change: saved.change || null
    });
  }

  /* Notifications (workspace-scoped for the authenticated user) */
  if (parts[1] === 'notifications' && parts.length === 2 && req.method === 'GET') {
    const listed = await listNotifications(userId, {
      workspaceId,
      unreadOnly:
        String(req.query.unread || body.unread || '') === '1' || body.unread_only === true,
      limit: req.query.limit || body.limit
    });
    if (!listed.ok) return sendError(res, listed);
    return res.status(200).json({ ok: true, notifications: listed.notifications });
  }

  if (
    parts[1] === 'notifications' &&
    parts.length === 4 &&
    parts[3] === 'read' &&
    req.method === 'POST'
  ) {
    const m = await assertWorkspaceMember(userId, workspaceId);
    if (!m.ok) return sendError(res, m);
    const marked = await markNotificationRead(userId, parts[2]);
    if (!marked.ok) return sendError(res, marked);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  const auth = await requireUser(req);
  if (auth.error) {
    if (auth.error === 'server_misconfigured') {
      logSupabaseConfigPresence('workspace_create_config_missing');
    }
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

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
