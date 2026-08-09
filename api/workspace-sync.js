/**
 * POST /api/workspace-sync
 * Shared workspace Studio documents with optimistic concurrency.
 * Personal Studio continues to use /api/sync — rejected here.
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
  loadWorkspaceDocument,
  saveWorkspaceDocument
} from '../lib/workspaces.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'workspace-sync',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const body = req.body || {};
  const action = body.action;
  const workspaceId = body.workspace_id || body.workspaceId;

  if (!isUuid(workspaceId)) {
    return res.status(400).json({ ok: false, error: 'workspace_id required' });
  }

  try {
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
  } catch (err) {
    console.error('workspace-sync error', err && err.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
