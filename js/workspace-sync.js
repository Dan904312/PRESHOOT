/**
 * Shared workspace data layer — no Workspace UI.
 * Personal Studio continues to use PreShootStudioSync + /api/sync.
 *
 * Conflict rule: on HTTP 409, preserve the caller's unsaved local document
 * in `localDraft` and return the server's latest document/revision.
 * Never silently overwrite local work.
 */
(function (global) {
  'use strict';

  function apiFetch(url, opts) {
    if (typeof global.apiFetch === 'function') return global.apiFetch(url, opts);
    return fetch(url, opts || {});
  }

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
   * @param {string} workspaceId
   * @param {object} document - local document being saved
   * @param {number} revision
   * @returns {Promise<object>} On conflict: conflict=true, localDraft=document, document=server latest
   */
  function saveSharedWorkspace(workspaceId, document, revision) {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    }
    var localDraft = document;
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
          var conflict = res.status === 409 || (data && data.error === 'revision_conflict');
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            conflict: conflict,
            /* Preserve caller's unsaved work — UI must warn, not discard */
            localDraft: conflict ? localDraft : null,
            document: data && data.document,
            revision: data && data.revision,
            updated_at: data && data.updated_at,
            updated_by: data && data.updated_by,
            error: data && data.error,
            message:
              (data && data.message) ||
              (conflict
                ? 'Someone else saved this workspace. Your local edits were kept — reload the latest version or merge carefully.'
                : null)
          };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          error: 'network_error',
          message: String(err && err.message),
          localDraft: localDraft
        };
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

  function createWorkspace(name, slug) {
    return apiFetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, slug: slug })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            workspace: data && data.workspace,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function inviteMember(workspaceId, email, role) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, role: role || 'editor' })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            invite: data && data.invite,
            token: data && data.token,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function acceptInvite(token) {
    return apiFetch('/api/workspace-invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            workspace_id: data && data.workspace_id,
            role: data && data.role,
            already_member: !!(data && data.already_member),
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function revokeInvite(workspaceId, inviteId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/invites/' +
        encodeURIComponent(inviteId),
      { method: 'DELETE' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  /**
   * Role helpers for future UI — backend remains authoritative.
   */
  function canEditRole(role) {
    return role === 'owner' || role === 'editor';
  }
  function canManageMembersRole(role) {
    return role === 'owner';
  }

  global.PreShootWorkspaces = {
    loadSharedWorkspace: loadSharedWorkspace,
    saveSharedWorkspace: saveSharedWorkspace,
    listWorkspaces: listWorkspaces,
    createWorkspace: createWorkspace,
    inviteMember: inviteMember,
    acceptInvite: acceptInvite,
    revokeInvite: revokeInvite,
    canEditRole: canEditRole,
    canManageMembersRole: canManageMembersRole
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
