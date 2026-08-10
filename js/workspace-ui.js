/**
 * PreShoot Workspace UI — Phase 2 switcher, members, invites, conflict sheet.
 * Matches existing Studio / Menu design language (modal-sheet, menu-card).
 */
(function (global) {
  'use strict';

  function Ctx() {
    return global.PreShootWorkspace;
  }
  function API() {
    return global.PreShootWorkspaces;
  }
  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }
  function openM(id) {
    if (typeof global.openM === 'function') global.openM(id);
  }
  function closeM(id) {
    if (typeof global.closeM === 'function') global.closeM(id);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roleLabel(role) {
    var map = {
      owner: 'Owner',
      editor: 'Editor',
      commenter: 'Commenter',
      viewer: 'Viewer'
    };
    return map[role] || role || 'Member';
  }

  function workspaceSwitcherButtonHtml() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var name = (ctx && ctx.activeWorkspaceName) || 'Personal';
    var kind = (ctx && ctx.activeWorkspaceKind) || 'personal';
    var role = ctx && ctx.isShared ? roleLabel(ctx.activeWorkspaceRole) : '';
    var dirty = ctx && ctx.isShared && ctx.sharedDirty ? ' · Unsaved' : '';
    var sub =
      kind === 'shared'
        ? role + dirty
        : 'Personal Studio' + (ctx && ctx.sharedDirty ? '' : '');
    return (
      '<button type="button" class="ws-switch-btn" onclick="PreShootWorkspaceUI.openSwitcher()" aria-haspopup="dialog">' +
      '<span class="ws-switch-btn-kicker">' +
      (kind === 'shared' ? 'Workspace' : 'Personal') +
      '</span>' +
      '<span class="ws-switch-btn-name">' +
      esc(name) +
      '</span>' +
      (sub
        ? '<span class="ws-switch-btn-sub">' + esc(sub) + '</span>'
        : '') +
      '</button>'
    );
  }

  function studioHeaderActionsHtml() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var canEdit = !ctx || !ctx.isShared || ctx.canEdit;
    var h = '';
    h += workspaceSwitcherButtonHtml();
    if (ctx && ctx.isShared) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.openMembers()">Members</button>';
      if (ctx.remoteUpdate) {
        h +=
          '<button type="button" class="studio-btn ghost sm ws-remote-btn" onclick="PreShootWorkspaceUI.reviewRemoteUpdate()">Review update</button>';
      }
      if (ctx.sharedDirty || (global.PreShootStudio && PreShootStudio.isDirty && PreShootStudio.isDirty())) {
        h +=
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.saveShared()">Save</button>';
      }
    }
    h +=
      '<button type="button" class="studio-btn ghost" onclick="PreShootStudioUI.openSearch()">Search</button>';
    if (canEdit) {
      h +=
        '<button type="button" class="studio-btn primary" onclick="PreShootStudioUI.openCreateProject()">New Project</button>';
    } else {
      h +=
        '<span class="ws-readonly-pill" title="Commenter and viewer roles are read-only">Read-only</span>';
    }
    return h;
  }

  function refreshChrome() {
    var btn = document.getElementById('ws-menu-summary');
    if (btn) {
      var ctx = Ctx() ? Ctx().getContext() : null;
      btn.textContent = (ctx && ctx.activeWorkspaceName) || 'Personal';
    }
    applyReadonly();
  }

  function applyReadonly() {
    if (Ctx() && Ctx().applyReadOnlyClass) Ctx().applyReadOnlyClass();
  }

  function openSwitcher() {
    if (!global.S || !global.S.authUser) {
      toast('Sign in to manage workspaces');
      return;
    }
    var body = document.getElementById('ws-switcher-body');
    if (body) body.innerHTML = '<div class="ws-loading">Loading workspaces…</div>';
    openM('ws-switcher-modal');
    var ctx = Ctx();
    if (!ctx) return;
    ctx.refreshList(true).then(function (res) {
      renderSwitcherList((res && res.workspaces) || ctx.getContext().list || []);
    });
  }

  function renderSwitcherList(workspaces) {
    var body = document.getElementById('ws-switcher-body');
    if (!body) return;
    var ctx = Ctx() ? Ctx().getContext() : {};
    var personal = workspaces.filter(function (w) {
      return w.kind === 'personal';
    })[0];
    var shared = workspaces.filter(function (w) {
      return w.kind === 'shared' && !w.archived_at;
    });
    var h = '';
    h += '<div class="ws-sec-label">Personal</div>';
    h += '<div class="ws-list">';
    var personalActive = !ctx.isShared;
    h +=
      '<button type="button" class="ws-list-row' +
      (personalActive ? ' is-active' : '') +
      '" onclick="PreShootWorkspaceUI.choosePersonal()">' +
      '<div class="ws-list-main"><div class="ws-list-title">Personal</div>' +
      '<div class="ws-list-sub">Your private Studio</div></div>' +
      (personalActive ? '<div class="ws-list-check">✓</div>' : '') +
      '</button>';
    h += '</div>';

    h += '<div class="ws-sec-label">Shared Workspaces</div>';
    h += '<div class="ws-list">';
    if (!shared.length) {
      h += '<div class="ws-empty">No shared workspaces yet.</div>';
    }
    shared.forEach(function (w) {
      var active = ctx.isShared && ctx.activeWorkspaceId === w.id;
      h +=
        '<button type="button" class="ws-list-row' +
        (active ? ' is-active' : '') +
        '" onclick="PreShootWorkspaceUI.chooseShared(\'' +
        esc(w.id) +
        '\')">' +
        '<div class="ws-list-main"><div class="ws-list-title">' +
        esc(w.name || 'Workspace') +
        '</div>' +
        '<div class="ws-list-sub">' +
        esc(roleLabel(w.role)) +
        '</div></div>' +
        (active ? '<div class="ws-list-check">✓</div>' : '') +
        '</button>';
    });
    h += '</div>';

    h +=
      '<button type="button" class="studio-btn primary" style="width:100%;margin-top:14px" onclick="PreShootWorkspaceUI.openCreate()">Create Workspace</button>';
    if (personal) {
      /* keep reference unused warning free */
    }
    body.innerHTML = h;
  }

  function choosePersonal() {
    closeM('ws-switcher-modal');
    if (!Ctx()) return;
    Ctx().switchTo('personal').then(function () {
      refreshChrome();
      if (global.S) global.S.tab = 'studio';
      if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
    });
  }

  function chooseShared(id) {
    closeM('ws-switcher-modal');
    if (!Ctx()) return;
    Ctx().switchTo(id).then(function () {
      refreshChrome();
      if (global.goTab) global.goTab('studio');
      else if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
    });
  }

  function openCreate() {
    closeM('ws-switcher-modal');
    var inp = document.getElementById('ws-create-name');
    if (inp) inp.value = '';
    openM('ws-create-modal');
    setTimeout(function () {
      if (inp) inp.focus();
    }, 80);
  }

  function submitCreate() {
    var inp = document.getElementById('ws-create-name');
    var name = (inp && inp.value.trim()) || 'Untitled Workspace';
    closeM('ws-create-modal');
    if (!Ctx()) return;
    Ctx().createAndOpen(name).then(function (res) {
      if (res && res.ok) {
        if (global.goTab) global.goTab('studio');
        refreshChrome();
      }
    });
  }

  function saveShared() {
    if (!Ctx()) return;
    Ctx().saveNow().then(function (res) {
      if (res && res.ok && !res.skipped) toast('Workspace saved');
      refreshChrome();
      if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
    });
  }

  function openMembers() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    if (!ctx || !ctx.isShared) {
      toast('Open a shared workspace first');
      return;
    }
    var body = document.getElementById('ws-members-body');
    if (body) body.innerHTML = '<div class="ws-loading">Loading members…</div>';
    var title = document.getElementById('ws-members-title');
    if (title) title.textContent = (ctx.activeWorkspaceName || 'Workspace') + ' · Members';
    openM('ws-members-modal');
    renderMembersPanel(ctx.activeWorkspaceId, ctx);
  }

  function renderMembersPanel(workspaceId, ctx) {
    var api = API();
    if (!api) return;
    Promise.all([
      api.listMembers(workspaceId),
      ctx.canManageMembers ? api.listInvites(workspaceId) : Promise.resolve({ ok: true, invites: [] })
    ]).then(function (pack) {
      var memRes = pack[0];
      var invRes = pack[1];
      var body = document.getElementById('ws-members-body');
      if (!body) return;
      if (!memRes || !memRes.ok) {
        body.innerHTML = '<div class="ws-empty">Could not load members.</div>';
        return;
      }
      var h = '';
      h += '<div class="ws-sec-label">Members</div><div class="ws-list">';
      (memRes.members || []).forEach(function (m) {
        var label = m.name || m.email || String(m.user_id || '').slice(0, 8);
        var sub = (m.email && m.name ? m.email + ' · ' : '') + roleLabel(m.role);
        h += '<div class="ws-list-row static">';
        h +=
          '<div class="ws-list-main"><div class="ws-list-title">' +
          esc(label) +
          (m.is_owner ? ' · Owner' : '') +
          '</div><div class="ws-list-sub">' +
          esc(sub) +
          '</div></div>';
        if (ctx.canManageMembers && !m.is_owner) {
          h += '<div class="ws-member-actions">';
          h +=
            '<select class="ws-role-select" onchange="PreShootWorkspaceUI.changeRole(\'' +
            esc(m.user_id) +
            '\', this.value)">' +
            ['editor', 'commenter', 'viewer']
              .map(function (r) {
                return (
                  '<option value="' +
                  r +
                  '"' +
                  (m.role === r ? ' selected' : '') +
                  '>' +
                  roleLabel(r) +
                  '</option>'
                );
              })
              .join('') +
            '</select>';
          h +=
            '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.removeMember(\'' +
            esc(m.user_id) +
            '\')">Remove</button>';
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';

      if (ctx.canManageMembers) {
        h += '<div class="ws-sec-label" style="margin-top:16px">Invite</div>';
        h +=
          '<div class="ws-invite-form">' +
          '<input class="field-inp" id="ws-invite-email" type="email" placeholder="teammate@email.com" autocomplete="email">' +
          '<select class="field-inp" id="ws-invite-role">' +
          '<option value="editor">Editor</option>' +
          '<option value="commenter">Commenter</option>' +
          '<option value="viewer">Viewer</option>' +
          '</select>' +
          '<button type="button" class="studio-btn primary" onclick="PreShootWorkspaceUI.sendInvite()">Create invite link</button>' +
          '<div class="ws-invite-hint">Email delivery is not configured — copy the invite link and send it yourself.</div>' +
          '<div id="ws-invite-link-box" class="ws-invite-link-box" hidden></div>' +
          '</div>';

        var invites = (invRes && invRes.invites) || [];
        var pending = invites.filter(function (i) {
          return i.status === 'pending';
        });
        if (pending.length) {
          h += '<div class="ws-sec-label" style="margin-top:16px">Pending invites</div><div class="ws-list">';
          pending.forEach(function (inv) {
            h +=
              '<div class="ws-list-row static"><div class="ws-list-main"><div class="ws-list-title">' +
              esc(inv.email) +
              '</div><div class="ws-list-sub">' +
              esc(roleLabel(inv.role)) +
              ' · pending</div></div>' +
              '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.revokeInvite(\'' +
              esc(inv.id) +
              '\')">Revoke</button></div>';
          });
          h += '</div>';
        }
      }
      body.innerHTML = h;
    });
  }

  function changeRole(userId, role) {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !api) return;
    api.updateMemberRole(ctx.activeWorkspaceId, userId, role).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not update role');
        renderMembersPanel(ctx.activeWorkspaceId, ctx);
        return;
      }
      toast('Role updated');
    });
  }

  function removeMember(userId) {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !api) return;
    if (!confirm('Remove this member from the workspace?')) return;
    api.removeMember(ctx.activeWorkspaceId, userId).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not remove member');
        return;
      }
      toast('Member removed');
      renderMembersPanel(ctx.activeWorkspaceId, ctx);
    });
  }

  function sendInvite() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !api) return;
    var emailEl = document.getElementById('ws-invite-email');
    var roleEl = document.getElementById('ws-invite-role');
    var email = emailEl ? emailEl.value.trim() : '';
    var role = roleEl ? roleEl.value : 'editor';
    if (!email || email.indexOf('@') < 1) {
      toast('Enter a valid email');
      return;
    }
    api.inviteMember(ctx.activeWorkspaceId, email, role).then(function (res) {
      if (!res || !res.ok || !res.token) {
        toast((res && res.error) || 'Could not create invite');
        return;
      }
      var link =
        window.location.origin +
        window.location.pathname +
        '?invite=' +
        encodeURIComponent(res.token);
      var box = document.getElementById('ws-invite-link-box');
      if (box) {
        box.hidden = false;
        box.innerHTML =
          '<div class="ws-invite-link-label">Invite link (copy & send)</div>' +
          '<input class="field-inp" id="ws-invite-link-input" readonly value="' +
          esc(link) +
          '">' +
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.copyInviteLink()">Copy link</button>';
      }
      toast('Invite created');
      renderMembersPanel(ctx.activeWorkspaceId, ctx);
    });
  }

  function copyInviteLink() {
    var inp = document.getElementById('ws-invite-link-input');
    if (!inp) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(function () {
        toast('Invite link copied');
      });
    } else {
      inp.select();
      try {
        document.execCommand('copy');
        toast('Invite link copied');
      } catch (e) {
        toast('Copy the link manually');
      }
    }
  }

  function revokeInvite(inviteId) {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !api) return;
    api.revokeInvite(ctx.activeWorkspaceId, inviteId).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not revoke');
        return;
      }
      toast('Invite revoked');
      renderMembersPanel(ctx.activeWorkspaceId, ctx);
    });
  }

  function showConflict(conflict) {
    var msg = document.getElementById('ws-conflict-msg');
    if (msg) {
      msg.textContent =
        (conflict && conflict.message) ||
        'This workspace was updated by someone else. Your local edits were kept.';
    }
    openM('ws-conflict-modal');
  }

  function closeConflict() {
    closeM('ws-conflict-modal');
  }

  function conflictReload() {
    if (!Ctx()) return;
    Ctx().resolveConflictReload();
  }

  function conflictKeep() {
    if (!Ctx()) return;
    Ctx().resolveConflictKeepLocal();
  }

  function onRemoteUpdateAvailable(info) {
    refreshChrome();
    toast('Someone updated this workspace.');
    var banner = document.getElementById('ws-remote-banner');
    if (banner) {
      banner.hidden = false;
      var t = document.getElementById('ws-remote-banner-text');
      if (t) {
        t.textContent =
          'Someone updated this workspace' +
          (info && info.revision ? ' (revision ' + info.revision + ')' : '') +
          '. Your local edits were kept.';
      }
    }
  }

  function hideRemoteBanner() {
    var banner = document.getElementById('ws-remote-banner');
    if (banner) banner.hidden = true;
  }

  function reviewRemoteUpdate() {
    if (!Ctx()) return;
    Ctx().reviewRemoteUpdate().then(function (res) {
      if (res && res.ok && !res.deferred) {
        hideRemoteBanner();
        toast('Loaded latest version');
      }
      refreshChrome();
      if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
    });
  }

  function onSaveOk() {
    hideRemoteBanner();
    refreshChrome();
  }

  function consumeInviteFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var token = params.get('invite') || params.get('workspace_invite');
      if (!token && window.location.hash) {
        var hm = String(window.location.hash).match(/invite=([^&]+)/);
        if (hm) token = decodeURIComponent(hm[1]);
      }
      if (!token) return;
      if (!global.S || !global.S.authUser) {
        toast('Sign in to accept the workspace invite');
        return;
      }
      if (!Ctx()) return;
      Ctx().handleInviteToken(token).then(function () {
        try {
          var url = new URL(window.location.href);
          url.searchParams.delete('invite');
          url.searchParams.delete('workspace_invite');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch (e) {}
        if (global.goTab) global.goTab('studio');
      });
    } catch (e) {}
  }

  global.PreShootWorkspaceUI = {
    workspaceSwitcherButtonHtml: workspaceSwitcherButtonHtml,
    studioHeaderActionsHtml: studioHeaderActionsHtml,
    refreshChrome: refreshChrome,
    openSwitcher: openSwitcher,
    choosePersonal: choosePersonal,
    chooseShared: chooseShared,
    openCreate: openCreate,
    submitCreate: submitCreate,
    openMembers: openMembers,
    saveShared: saveShared,
    changeRole: changeRole,
    removeMember: removeMember,
    sendInvite: sendInvite,
    copyInviteLink: copyInviteLink,
    revokeInvite: revokeInvite,
    showConflict: showConflict,
    closeConflict: closeConflict,
    conflictReload: conflictReload,
    conflictKeep: conflictKeep,
    onSaveOk: onSaveOk,
    onRemoteUpdateAvailable: onRemoteUpdateAvailable,
    reviewRemoteUpdate: reviewRemoteUpdate,
    hideRemoteBanner: hideRemoteBanner,
    consumeInviteFromUrl: consumeInviteFromUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
