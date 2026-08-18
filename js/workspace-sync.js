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

  function loadSharedWorkspace(workspaceId, opts) {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    }
    opts = opts || {};
    return apiFetch('/api/workspace-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'load', workspace_id: workspaceId }),
      signal: opts.signal
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
        if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
          return { ok: false, error: 'aborted' };
        }
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  /**
   * @param {string} workspaceId
   * @param {object} document - local document being saved
   * @param {number} revision
   * @returns {Promise<object>} On conflict: conflict=true, localDraft=document, document=server latest
   */
  function saveSharedWorkspace(workspaceId, document, revision, changeHint) {
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'workspace_id_required' });
    }
    var localDraft = document;
    var body = {
      action: 'save',
      workspace_id: workspaceId,
      document: document,
      revision: revision
    };
    if (changeHint && typeof changeHint === 'object') body.change = changeHint;
    return apiFetch('/api/workspace-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().then(function (data) {
          var conflict = res.status === 409 || (data && data.error === 'revision_conflict');
          var status = res.status;
          var error = data && data.error;
          if (conflict) {
            error = error || 'revision_conflict';
          } else if (!res.ok) {
            if (status === 401) error = error || 'unauthorized';
            else if (status === 403) error = error || 'forbidden';
            else if (status === 404) error = error || 'not_found';
            else if (status === 422) error = error || 'invalid';
            else if (status === 429) error = error || 'rate_limited';
            else if (status >= 500) error = error || 'server_error';
          }
          return {
            ok: !!(res.ok && data && data.ok),
            status: status,
            conflict: conflict,
            /* Preserve caller's unsaved work — UI must warn, not discard */
            localDraft: conflict || !res.ok ? localDraft : null,
            document: data && data.document,
            revision: data && data.revision,
            client_revision: data && data.client_revision,
            updated_at: data && data.updated_at,
            updated_by: data && data.updated_by,
            change: data && data.change,
            changes: data && data.changes,
            activity_label: data && data.activity_label,
            error: error,
            message:
              (data && data.message) ||
              (conflict
                ? 'This workspace changed while you were editing. Your local edits were kept.'
                : status === 429
                  ? 'Too many save requests. Try again shortly.'
                  : status === 403
                    ? 'You do not have permission to save this workspace.'
                    : status >= 500
                      ? 'Server error while saving. Your changes are still local.'
                      : null)
          };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          status: 0,
          error: 'network_error',
          offline: typeof navigator !== 'undefined' && navigator.onLine === false,
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

  function joinByCode(code) {
    return apiFetch('/api/workspaces/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            already_member: !!(data && data.already_member),
            workspace_id: data && data.workspace_id,
            role: data && data.role,
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

  function getJoinCode(workspaceId) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/join-code', {
      method: 'GET'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            join_code: data && data.join_code,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function regenerateJoinCode(workspaceId, role) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/join-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role || 'editor' })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            code: data && data.code,
            join_code: data && data.join_code,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function listMembers(workspaceId) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/members', {
      method: 'GET'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            members: (data && data.members) || [],
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function updateMemberRole(workspaceId, userId, role) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/members/' +
        encodeURIComponent(userId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: role })
      }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            member: data && data.member,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function removeMember(workspaceId, userId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/members/' +
        encodeURIComponent(userId),
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

  function listInvites(workspaceId) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/invites', {
      method: 'GET'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            invites: (data && data.invites) || [],
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function patchWorkspace(workspaceId, patch) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch || {})
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            workspace: data && data.workspace,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  /**
   * Role helpers for UI — backend remains authoritative.
   */
  function canEditRole(role) {
    return role === 'owner' || role === 'editor';
  }
  function canManageMembersRole(role) {
    return role === 'owner';
  }

  function listComments(workspaceId, opts) {
    opts = opts || {};
    var q = [];
    if (opts.productionId) q.push('production_id=' + encodeURIComponent(opts.productionId));
    if (opts.targetType) q.push('target_type=' + encodeURIComponent(opts.targetType));
    if (opts.targetId) q.push('target_id=' + encodeURIComponent(opts.targetId));
    if (opts.unresolvedOnly) q.push('unresolved=1');
    if (opts.limit) q.push('limit=' + encodeURIComponent(opts.limit));
    var qs = q.length ? '?' + q.join('&') : '';
    return apiFetch(
      '/api/workspaces/' + encodeURIComponent(workspaceId) + '/comments' + qs,
      { method: 'GET' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            comments: (data && data.comments) || [],
            canComment: !!(data && data.canComment),
            canResolve: !!(data && data.canResolve),
            canModerate: !!(data && data.canModerate),
            role: data && data.role,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function createComment(workspaceId, payload) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            comment: data && data.comment,
            error: data && data.error,
            message: data && data.message
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function updateComment(workspaceId, commentId, payload) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/comments/' +
        encodeURIComponent(commentId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            comment: data && data.comment,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function deleteComment(workspaceId, commentId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/comments/' +
        encodeURIComponent(commentId),
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

  function resolveComment(workspaceId, commentId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/comments/' +
        encodeURIComponent(commentId) +
        '/resolve',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            comment: data && data.comment,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function reopenComment(workspaceId, commentId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/comments/' +
        encodeURIComponent(commentId) +
        '/reopen',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            comment: data && data.comment,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function getProductionReview(workspaceId, productionId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/productions/' +
        encodeURIComponent(productionId) +
        '/review',
      { method: 'GET' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return Object.assign(
            {
              ok: !!(res.ok && data && data.ok),
              status: res.status,
              error: data && data.error
            },
            data || {}
          );
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function setReviewStatus(workspaceId, productionId, reviewStatus, revision) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/productions/' +
        encodeURIComponent(productionId) +
        '/review-status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_status: reviewStatus,
          revision: revision
        })
      }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            revision: data && data.revision,
            review_status: data && data.review_status,
            document: data && data.document,
            conflict: res.status === 409,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function listNotifications(workspaceId, opts) {
    opts = opts || {};
    var q = [];
    if (opts.unreadOnly) q.push('unread=1');
    if (opts.limit) q.push('limit=' + encodeURIComponent(opts.limit));
    var qs = q.length ? '?' + q.join('&') : '';
    return apiFetch(
      '/api/workspaces/' + encodeURIComponent(workspaceId) + '/notifications' + qs,
      { method: 'GET' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            notifications: (data && data.notifications) || [],
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function markNotificationRead(workspaceId, notificationId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/notifications/' +
        encodeURIComponent(notificationId) +
        '/read',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
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

  function listCommentActivity(workspaceId, opts) {
    opts = opts || {};
    var qs = opts.limit ? '?limit=' + encodeURIComponent(opts.limit) : '';
    return apiFetch(
      '/api/workspaces/' + encodeURIComponent(workspaceId) + '/comment-activity' + qs,
      { method: 'GET' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            activity: (data && data.activity) || [],
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function listVersions(workspaceId) {
    return apiFetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/versions', {
      method: 'GET'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            versions: (data && data.versions) || [],
            retention: data && data.retention,
            canRestore: !!(data && data.canRestore),
            role: data && data.role,
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function getVersion(workspaceId, versionId) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/versions/' +
        encodeURIComponent(versionId),
      { method: 'GET' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            version: data && data.version,
            canRestore: !!(data && data.canRestore),
            error: data && data.error
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: 'network_error', message: String(err && err.message) };
      });
  }

  function restoreVersion(workspaceId, versionId, expectedCurrentRevision) {
    return apiFetch(
      '/api/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/versions/' +
        encodeURIComponent(versionId) +
        '/restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: expectedCurrentRevision })
      }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          var conflict = res.status === 409 || (data && data.error === 'revision_conflict');
          return {
            ok: !!(res.ok && data && data.ok),
            status: res.status,
            conflict: conflict,
            revision: data && data.revision,
            document: data && data.document,
            updated_at: data && data.updated_at,
            updated_by: data && data.updated_by,
            restored_from_revision: data && data.restored_from_revision,
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
   * Structured compare for conflict UI — not a merge engine.
   */
  function summarizeDocumentDiff(localDoc, serverDoc) {
    var local = localDoc && typeof localDoc === 'object' ? localDoc : { projects: [] };
    var server = serverDoc && typeof serverDoc === 'object' ? serverDoc : { projects: [] };
    var lp = Array.isArray(local.projects) ? local.projects : [];
    var sp = Array.isArray(server.projects) ? server.projects : [];
    var lMap = {};
    var sMap = {};
    lp.forEach(function (p) {
      if (p && p.id) lMap[p.id] = p;
    });
    sp.forEach(function (p) {
      if (p && p.id) sMap[p.id] = p;
    });
    var added = [];
    var removed = [];
    var changed = [];
    Object.keys(lMap).forEach(function (id) {
      if (!sMap[id]) added.push({ type: 'project', id: id, name: lMap[id].name || 'Untitled' });
    });
    Object.keys(sMap).forEach(function (id) {
      if (!lMap[id]) removed.push({ type: 'project', id: id, name: sMap[id].name || 'Untitled' });
    });
    Object.keys(lMap).forEach(function (id) {
      if (!sMap[id]) return;
      var lpj = lMap[id];
      var spj = sMap[id];
      var lProds = Array.isArray(lpj.productions) ? lpj.productions : [];
      var sProds = Array.isArray(spj.productions) ? spj.productions : [];
      var lPm = {};
      var sPm = {};
      lProds.forEach(function (x) {
        if (x && x.id) lPm[x.id] = x;
      });
      sProds.forEach(function (x) {
        if (x && x.id) sPm[x.id] = x;
      });
      Object.keys(lPm).forEach(function (pid) {
        if (!sPm[pid]) {
          added.push({
            type: 'production',
            id: pid,
            name: lPm[pid].name || 'Untitled',
            project: lpj.name || 'Project'
          });
          return;
        }
        var prod = lPm[pid];
        var sprod = sPm[pid];
        var lShots = Array.isArray(prod.shots) ? prod.shots.length : 0;
        var sShots = Array.isArray(sprod.shots) ? sprod.shots.length : 0;
        var lScript = String((prod.script && prod.script.body) || prod.script || '');
        var sScript = String((sprod.script && sprod.script.body) || sprod.script || '');
        if (lShots !== sShots || lScript !== sScript || String(prod.name || '') !== String(sprod.name || '')) {
          changed.push({
            type: 'production',
            id: pid,
            name: prod.name || sprod.name || 'Untitled',
            detail:
              (lScript !== sScript ? 'script' : '') +
              (lShots !== sShots ? (lScript !== sScript ? ', shots' : 'shots') : '')
          });
        }
      });
      Object.keys(sPm).forEach(function (pid) {
        if (!lPm[pid]) {
          removed.push({
            type: 'production',
            id: pid,
            name: sPm[pid].name || 'Untitled',
            project: spj.name || 'Project'
          });
        }
      });
    });
    return {
      localProjects: lp.length,
      serverProjects: sp.length,
      added: added,
      removed: removed,
      changed: changed,
      summary:
        added.length || removed.length || changed.length
          ? added.length + ' added · ' + removed.length + ' removed · ' + changed.length + ' changed'
          : 'Same project/production structure (deeper field diffs may still exist)'
    };
  }

  global.PreShootWorkspaces = {
    loadSharedWorkspace: loadSharedWorkspace,
    saveSharedWorkspace: saveSharedWorkspace,
    listWorkspaces: listWorkspaces,
    createWorkspace: createWorkspace,
    inviteMember: inviteMember,
    joinByCode: joinByCode,
    getJoinCode: getJoinCode,
    regenerateJoinCode: regenerateJoinCode,
    acceptInvite: acceptInvite,
    revokeInvite: revokeInvite,
    listMembers: listMembers,
    listInvites: listInvites,
    updateMemberRole: updateMemberRole,
    removeMember: removeMember,
    patchWorkspace: patchWorkspace,
    listVersions: listVersions,
    getVersion: getVersion,
    restoreVersion: restoreVersion,
    summarizeDocumentDiff: summarizeDocumentDiff,
    canEditRole: canEditRole,
    canManageMembersRole: canManageMembersRole,
    listComments: listComments,
    createComment: createComment,
    updateComment: updateComment,
    deleteComment: deleteComment,
    resolveComment: resolveComment,
    reopenComment: reopenComment,
    getProductionReview: getProductionReview,
    setReviewStatus: setReviewStatus,
    listNotifications: listNotifications,
    markNotificationRead: markNotificationRead,
    listCommentActivity: listCommentActivity
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
