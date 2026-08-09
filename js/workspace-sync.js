/**
 * Shared workspace data layer (Phase 1) — no UI.
 * Personal Studio continues to use PreShootStudioSync + /api/sync.
 */
(function (global) {
  'use strict';

  function apiFetch(url, opts) {
    if (typeof global.apiFetch === 'function') return global.apiFetch(url, opts);
    return fetch(url, opts || {});
  }

  /**
   * Load a shared workspace Studio document.
   * @returns {Promise<{ok, document, revision, role, canEdit, workspace, error?}>}
   */
  function loadSharedWorkspace(workspaceId) {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    }
    return apiFetch('/api/workspace-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load', workspace_id: workspaceId })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            document: data && data.document,
            revision: data && data.revision,
            role: data && data.role,
            canEdit: data && data.canEdit,
            workspace: data && data.workspace,
            updated_at: data && data.updated_at,
            updated_by: data && data.updated_by,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  /**
   * Save a shared workspace Studio document with optimistic concurrency.
   * On 409, returns latest document/revision — caller must not overwrite blindly.
   */
  function saveSharedWorkspace(workspaceId, document, revision) {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    }
    return apiFetch('/api/workspace-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        workspace_id: workspaceId,
        document: document,
        revision: revision
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            conflict: res.status === 409,
            document: data && data.document,
            revision: data && data.revision,
            updated_at: data && data.updated_at,
            updated_by: data && data.updated_by,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function listWorkspaces() {
    return apiFetch('/api/workspaces', { method: 'GET' })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            workspaces: (data && data.workspaces) || [],
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  global.PreShootWorkspaces = {
    loadSharedWorkspace: loadSharedWorkspace,
    saveSharedWorkspace: saveSharedWorkspace,
    listWorkspaces: listWorkspaces
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
