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
    var statusLabel = '';
    var peopleLabel = '';
    if (ctx && ctx.isShared) {
      var st = ctx.saveStatus || (ctx.sharedDirty ? 'dirty' : 'saved');
      if (st === 'saving') statusLabel = ' · Saving…';
      else if (st === 'dirty') statusLabel = ' · Unsaved';
      else if (st === 'conflict') statusLabel = ' · Conflict';
      else if (st === 'offline') statusLabel = ' · Offline';
      else if (st === 'error') statusLabel = ' · Save failed';
      var n = (ctx.presence && ctx.presence.length) || 0;
      if (n > 0) peopleLabel = ' · ' + n + (n === 1 ? ' person' : ' people');
    }
    var sub =
      kind === 'shared'
        ? 'Shared · ' + role + peopleLabel + statusLabel
        : 'Personal Studio';
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

  function presenceChipHtml() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    if (!ctx || !ctx.isShared) return '';
    var list = ctx.presence || [];
    var me = global.S && global.S.authUser && global.S.authUser.id;
    var others = list.filter(function (p) {
      return p && p.userId && p.userId !== me;
    });
    var total = list.length || 1;
    var names = others.slice(0, 2).map(function (p) {
      return p.displayName || 'Someone';
    });
    var extra = others.length > 2 ? ' +' + (others.length - 2) : '';
    var label =
      names.length
        ? names.join(' · ') + extra
        : total <= 1
          ? 'Just you'
          : total + ' here';
    return (
      '<button type="button" class="ws-presence-chip" onclick="PreShootWorkspaceUI.openPeople()" title="People here">' +
      '<span class="ws-presence-dot" aria-hidden="true"></span>' +
      '<span class="ws-presence-label">' +
      esc(label) +
      '</span></button>'
    );
  }

  function productionPresenceHtml(productionId) {
    if (!Ctx() || !Ctx().presenceOnProduction || !productionId) return '';
    var peers = Ctx().presenceOnProduction(productionId);
    if (!peers.length) return '';
    var lines = peers.slice(0, 3).map(function (p) {
      var verb = p.editing ? 'editing' : 'viewing';
      return esc(p.displayName || 'Collaborator') + ' is ' + verb + ' this production';
    });
    return (
      '<div class="ws-prod-presence">' +
      lines.map(function (l) {
        return '<div class="ws-prod-presence-line">' + l + '</div>';
      }).join('') +
      '</div>'
    );
  }

  function productionActivityHtml(productionId) {
    var ctx = Ctx() ? Ctx().getContext() : null;
    if (!ctx || !ctx.isShared || !productionId) return '';
    var rows = (ctx.recentActivity || []).filter(function (v) {
      var pid =
        (v.change && v.change.productionId) ||
        v.production_id ||
        (v.change && v.change.production_id);
      return pid && String(pid) === String(productionId);
    }).slice(0, 4);
    if (!rows.length) return '';
    var h =
      '<div class="ws-prod-activity"><div class="ws-prod-activity-hd">Recent activity</div>';
    rows.forEach(function (v) {
      var who = v.name || 'Collaborator';
      var type =
        v.type_label ||
        (v.change &&
          global.PreShootWorkspaceChanges &&
          PreShootWorkspaceChanges.changeTypeLabel &&
          PreShootWorkspaceChanges.changeTypeLabel(v.change.type)) ||
        'Updated';
      h +=
        '<div class="ws-prod-activity-row">' +
        esc(who) +
        ' · ' +
        esc(type) +
        ' · ' +
        esc(relativeTime(v.created_at) || '') +
        '</div>';
    });
    h += '</div>';
    return h;
  }

  function saveStatusLabel(status) {
    switch (status) {
      case 'saving':
        return 'Saving…';
      case 'dirty':
        return 'Unsaved changes';
      case 'conflict':
        return 'Conflict — review required';
      case 'offline':
        return 'Offline — changes stored locally';
      case 'error':
        return 'Save failed — retry';
      case 'saved':
      default:
        return 'Saved';
    }
  }

  function saveStatusIndicatorHtml() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    if (!ctx || !ctx.isShared) return '';
    var st = ctx.saveStatus || 'saved';
    return (
      '<span class="ws-save-status ws-save-' +
      esc(st) +
      '" id="ws-save-status" title="' +
      esc(saveStatusLabel(st)) +
      '">' +
      esc(saveStatusLabel(st)) +
      '</span>'
    );
  }

  function studioHeaderActionsHtml() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var canEdit = !ctx || !ctx.isShared || ctx.canEdit;
    var h = '';
    h += workspaceSwitcherButtonHtml();
    if (ctx && ctx.isShared) {
      h += presenceChipHtml();
      h += saveStatusIndicatorHtml();
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.openActivity()">Activity</button>';
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceComments.openNotifications()">Notifications' +
        (ctx.unreadNotifications
          ? ' · ' + ctx.unreadNotifications
          : '') +
        '</button>';
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.openMembers()">Members</button>';
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.openHistory()">History</button>';
      if (ctx.remoteUpdate) {
        h +=
          '<button type="button" class="studio-btn ghost sm ws-remote-btn" onclick="PreShootWorkspaceUI.reviewRemoteUpdate()">Review update</button>';
      }
      if (
        ctx.saveStatus === 'dirty' ||
        ctx.saveStatus === 'error' ||
        ctx.saveStatus === 'offline' ||
        ctx.sharedDirty ||
        (global.PreShootStudio && PreShootStudio.isDirty && PreShootStudio.isDirty())
      ) {
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
        '<span class="ws-readonly-pill" title="Commenter and viewer roles are read-only">Read only</span>';
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
        if (global.PreShootAnalytics) PreShootAnalytics.track('workspace_created');
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
    var meta = document.getElementById('ws-conflict-meta');
    var cmp = document.getElementById('ws-conflict-compare');
    var change = conflict && conflict.change;
    var who =
      (change && change.name) ||
      (conflict && (conflict.name || conflict.updated_by)) ||
      null;
    var when = conflict && conflict.updated_at ? relativeTime(conflict.updated_at) : '';
    if (msg) {
      msg.textContent =
        (conflict && conflict.message) ||
        'This workspace changed while you were editing. Your local edits were kept.';
    }
    if (meta) {
      var entityLine = '';
      if (change) {
        var typeLabel =
          change.type_label ||
          (global.PreShootWorkspaceChanges &&
            PreShootWorkspaceChanges.changeTypeLabel &&
            PreShootWorkspaceChanges.changeTypeLabel(change.type)) ||
          change.type ||
          '';
        entityLine =
          '<br>Changed: <strong style="color:var(--text2)">' +
          esc(typeLabel) +
          (change.entityLabel || change.entity_label
            ? ' — ' + esc(change.entityLabel || change.entity_label)
            : '') +
          '</strong>';
      }
      meta.innerHTML =
        '<div style="font-size:12px;color:var(--text3);line-height:1.5;margin:0 0 12px">' +
        'Your revision: <strong style="color:var(--text2)">' +
        esc(
          conflict && conflict.client_revision != null ? conflict.client_revision : '—'
        ) +
        '</strong><br>' +
        'Latest revision: <strong style="color:var(--text2)">' +
        esc(conflict && conflict.revision != null ? conflict.revision : '—') +
        '</strong>' +
        entityLine +
        (who ? '<br>Changed by: ' + esc(String(who).slice(0, 48)) : '') +
        (when ? '<br>' + esc(when) : '') +
        '</div>';
    }
    if (cmp) {
      var api = API();
      var diff =
        api && api.summarizeDocumentDiff
          ? api.summarizeDocumentDiff(
              conflict && conflict.localDraft,
              conflict && conflict.serverDocument
            )
          : null;
      if (diff) {
        cmp.innerHTML =
          '<div style="font-size:12px;color:var(--text2);margin:0 0 14px;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px">' +
          '<div style="font-weight:600;margin-bottom:4px">Compare summary</div>' +
          '<div>' +
          esc(diff.summary) +
          '</div>' +
          '<div style="margin-top:6px;color:var(--text3)">Your projects: ' +
          diff.localProjects +
          ' · Server projects: ' +
          diff.serverProjects +
          '</div></div>';
      } else {
        cmp.innerHTML = '';
      }
    }
    openM('ws-conflict-modal');
  }

  function relativeTime(iso) {
    try {
      var t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return '';
      var sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
      if (sec < 60) return 'just now';
      if (sec < 3600) return Math.floor(sec / 60) + ' minutes ago';
      if (sec < 86400) return Math.floor(sec / 3600) + ' hours ago';
      return new Date(t).toLocaleString();
    } catch (e) {
      return '';
    }
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

  function conflictCompare() {
    /* Compare summary is already rendered in showConflict */
    var cmp = document.getElementById('ws-conflict-compare');
    if (cmp) cmp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openHistory() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !ctx.isShared || !api) return;
    var body = document.getElementById('ws-history-body');
    if (body) body.innerHTML = '<div class="pw-section-sub">Loading…</div>';
    openM('ws-history-modal');
    api.listVersions(ctx.activeWorkspaceId).then(function (res) {
      if (!body) return;
      if (!res || !res.ok) {
        body.innerHTML =
          '<div class="pw-section-sub">' + esc((res && res.error) || 'Could not load history') + '</div>';
        return;
      }
      var versions = res.versions || [];
      var canRestore = !!res.canRestore;
      var act = ctx.lastActivity;
      var h = '';
      if (act && act.revision) {
        h +=
          '<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Current revision ' +
          esc(String(act.revision)) +
          (act.updated_at ? ' · ' + esc(relativeTime(act.updated_at)) : '') +
          '</div>';
      }
      if (!versions.length) {
        h += '<div class="pw-section-sub">No saved versions yet. Versions appear after successful saves.</div>';
        body.innerHTML = h;
        return;
      }
      versions.forEach(function (v) {
        var who = v.name || (v.email ? String(v.email).split('@')[0] : null) || 'Collaborator';
        var typeLabel =
          v.type_label ||
          (v.change &&
            global.PreShootWorkspaceChanges &&
            PreShootWorkspaceChanges.changeTypeLabel &&
            PreShootWorkspaceChanges.changeTypeLabel(v.change.type)) ||
          (v.reason === 'restore' ? 'Version restored' : '');
        var entity = v.entity_label || (v.change && v.change.entityLabel) || '';
        h +=
          '<div class="ws-history-row" style="padding:12px 0;border-bottom:1px solid var(--border)">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
          '<div style="min-width:0">' +
          '<div style="font-family:var(--fd);font-weight:700;font-size:14px">Revision ' +
          esc(String(v.revision)) +
          '</div>' +
          '<div style="font-size:12px;color:var(--text2);margin-top:3px">' +
          esc(who) +
          (typeLabel ? ' · ' + esc(typeLabel) : '') +
          (entity ? ' · "' + esc(entity) + '"' : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:2px">' +
          esc(relativeTime(v.created_at) || '') +
          '</div></div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">' +
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.viewHistoryVersion(\'' +
          esc(v.id) +
          '\')">View</button>' +
          (canRestore
            ? '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceUI.restoreHistoryVersion(\'' +
              esc(v.id) +
              '\')">Restore</button>'
            : '') +
          '</div></div></div>';
      });
      h +=
        '<div style="font-size:11px;color:var(--text3);margin-top:12px">Keeps the latest ' +
        esc(String(res.retention || 12)) +
        ' successful saves.</div>';
      body.innerHTML = h;
    });
  }

  function viewHistoryVersion(versionId) {
    if (!Ctx()) return;
    Ctx().viewVersion(versionId);
  }

  function showVersionPreview(preview) {
    var body = document.getElementById('ws-version-preview-body');
    if (!body || !preview) return;
    var doc = preview.document || {};
    var projects = Array.isArray(doc.projects) ? doc.projects : [];
    var prodCount = 0;
    projects.forEach(function (p) {
      prodCount += (p.productions && p.productions.length) || 0;
    });
    var who = preview.name || 'Collaborator';
    body.innerHTML =
      '<div style="padding:10px 12px;margin-bottom:12px;background:rgba(212,168,83,.12);border:1px solid rgba(212,168,83,.35);border-radius:8px;font-size:13px;color:var(--text2);line-height:1.5">' +
      'Viewing an older version. Your current workspace has not been changed.' +
      '</div>' +
      '<div style="font-family:var(--fd);font-weight:700;font-size:16px;margin-bottom:4px">Revision ' +
      esc(String(preview.revision)) +
      '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">' +
      esc(who) +
      (preview.created_at ? ' — ' + esc(relativeTime(preview.created_at)) : '') +
      (preview.reason === 'restore' ? ' · restore snapshot' : '') +
      '</div>' +
      '<div style="font-size:13px;color:var(--text2);line-height:1.6">' +
      esc(String(projects.length)) +
      ' projects · ' +
      esc(String(prodCount)) +
      ' productions</div>' +
      (projects.length
        ? '<ul style="margin:12px 0 0;padding-left:18px;font-size:13px;color:var(--text2)">' +
          projects
            .slice(0, 12)
            .map(function (p) {
              return '<li>' + esc(p.name || 'Untitled') + '</li>';
            })
            .join('') +
          (projects.length > 12 ? '<li>…</li>' : '') +
          '</ul>'
        : '') +
      '<div style="display:flex;gap:8px;margin-top:18px">' +
      '<button type="button" class="studio-btn ghost" style="flex:1" onclick="PreShootWorkspaceUI.closeVersionPreview()">Close</button>' +
      (preview.canRestore
        ? '<button type="button" class="studio-btn primary" style="flex:1" onclick="PreShootWorkspaceUI.restoreHistoryVersion(\'' +
          esc(preview.id) +
          '\')">Restore</button>'
        : '') +
      '</div>';
    openM('ws-version-preview-modal');
  }

  function hideVersionPreview() {
    closeM('ws-version-preview-modal');
  }

  function closeVersionPreview() {
    if (Ctx() && Ctx().clearVersionPreview) Ctx().clearVersionPreview();
    hideVersionPreview();
  }

  function restoreHistoryVersion(versionId) {
    if (!Ctx()) return;
    var ok = confirm(
      'Restore this version as a new revision? Previous revisions stay in history.'
    );
    if (!ok) return;
    Ctx().restoreVersion(versionId).then(function (res) {
      if (res && res.ok) {
        closeM('ws-history-modal');
        closeVersionPreview();
        if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
      }
    });
  }

  function showRecoveryPrompt(info) {
    var el = document.getElementById('ws-recovery-banner');
    var t = document.getElementById('ws-recovery-banner-text');
    if (!el) return;
    el.hidden = false;
    if (t) {
      t.textContent =
        'Unsaved changes from your previous session were found' +
        (info && info.savedAt ? ' (' + relativeTime(new Date(info.savedAt).toISOString()) + ')' : '') +
        '.';
    }
  }

  function hideRecoveryPrompt() {
    var el = document.getElementById('ws-recovery-banner');
    if (el) el.hidden = true;
  }

  function recoverSessionDraft() {
    if (!Ctx()) return;
    Ctx().recoverPendingDraft();
    hideRecoveryPrompt();
    refreshChrome();
    if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
  }

  function discardSessionDraft() {
    if (!Ctx()) return;
    Ctx().discardPendingRecovery();
    hideRecoveryPrompt();
  }

  function onSaveStatus() {
    refreshChrome();
    if (global.S && global.S.tab === 'studio' && global.PreShootStudioUI && PreShootStudioUI.renderStudio) {
      /* Light refresh of chrome only via render is heavy — refreshChrome covers indicator */
    }
  }

  function onRemoteUpdateAvailable(info) {
    refreshChrome();
    toast('This workspace was updated by another collaborator.');
    syncRemoteBanner(info || (Ctx() && Ctx().getContext && Ctx().getContext().remoteUpdate));
    /* Refresh Studio chrome so list/detail headers reflect Review update */
    if (global.S && global.S.tab === 'studio' && global.PreShootStudioUI && PreShootStudioUI.renderStudio) {
      PreShootStudioUI.renderStudio();
    }
  }

  function syncRemoteBanner(info) {
    var banner = document.getElementById('ws-remote-banner');
    if (!banner) return;
    if (!info) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    var t = document.getElementById('ws-remote-banner-text');
    var reviewBtn = banner.querySelector('[data-ws-review]');
    var keepBtn = banner.querySelector('[data-ws-keep]');
    if (reviewBtn) reviewBtn.textContent = info.sameEntity ? 'Review Changes' : 'Review latest';
    if (keepBtn) keepBtn.textContent = info.sameEntity ? 'Keep Editing' : 'Keep my changes';
    if (t) {
      var change = info.change;
      var label =
        (change &&
          global.PreShootWorkspaceChanges &&
          PreShootWorkspaceChanges.changeTypeLabel &&
          PreShootWorkspaceChanges.changeTypeLabel(change.type)) ||
        info.activity_label ||
        '';
      var entity = (change && (change.entityLabel || change.entity_label)) || '';
      if (info.sameEntity && info.reason === 'same_entity_dirty') {
        t.textContent =
          'A collaborator updated this production while you have unsaved changes' +
          (info.revision ? ' (revision ' + info.revision + ')' : '') +
          '. Your local edits were kept.';
      } else if (info.sameEntity) {
        t.textContent =
          'Another collaborator changed this production while you were editing it' +
          (info.revision ? ' (revision ' + info.revision + ')' : '') +
          '. Your local edits were kept.';
      } else if (label) {
        t.textContent =
          label +
          (entity ? ' — "' + entity + '"' : '') +
          (info.revision ? ' (revision ' + info.revision + ')' : '') +
          '. Your local edits were kept.';
      } else {
        t.textContent =
          'This workspace was updated by another collaborator' +
          (info.revision ? ' (revision ' + info.revision + ')' : '') +
          '. Your local edits were kept.';
      }
    }
  }

  function openPeople() {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var body = document.getElementById('ws-people-body');
    if (!ctx || !ctx.isShared) return;
    openM('ws-people-modal');
    var list = ctx.presence || [];
    var me = global.S && global.S.authUser && global.S.authUser.id;
    if (!list.length) {
      if (body) {
        body.innerHTML =
          '<div class="pw-section-sub">You’re here. Presence appears when collaborators join this workspace.</div>';
      }
      return;
    }
    var h = '';
    list.forEach(function (p) {
      var self = me && p.userId === me;
      var where = '';
      if (p.activeProductionId) {
        where =
          (p.editing ? 'Editing' : 'Viewing') +
          (p.activeSection ? ' · ' + p.activeSection : '');
      } else if (p.activeProjectId) {
        where = 'In a project';
      } else {
        where = 'In workspace';
      }
      if (self && ctx.sharedDirty) where = 'You · Unsaved changes';
      else if (self) where = 'You · ' + where;
      h +=
        '<div class="ws-people-row">' +
        '<div class="ws-people-main">' +
        '<div class="ws-people-name">' +
        esc(p.displayName || 'Collaborator') +
        (self ? ' (you)' : '') +
        '</div>' +
        '<div class="ws-people-meta">' +
        esc(roleLabel(p.role || (self ? ctx.activeWorkspaceRole : ''))) +
        ' · ' +
        esc(where) +
        '</div></div>' +
        '<span class="ws-presence-dot" aria-hidden="true"></span></div>';
    });
    if (body) body.innerHTML = h;
  }

  function openActivity(filter) {
    var ctx = Ctx() ? Ctx().getContext() : null;
    var api = API();
    if (!ctx || !ctx.isShared || !api) return;
    var body = document.getElementById('ws-activity-body');
    var tabs = document.getElementById('ws-activity-filters');
    openM('ws-activity-modal');
    if (tabs) {
      var filters = [
        ['all', 'All'],
        ['comments', 'Comments'],
        ['projects', 'Projects'],
        ['productions', 'Productions'],
        ['scripts', 'Scripts'],
        ['shotlists', 'Shot Lists'],
        ['assets', 'Assets']
      ];
      var active = filter || 'all';
      tabs.innerHTML = filters
        .map(function (f) {
          return (
            '<button type="button" class="ws-activity-filter' +
            (f[0] === active ? ' active' : '') +
            '" onclick="PreShootWorkspaceUI.openActivity(\'' +
            f[0] +
            '\')">' +
            f[1] +
            '</button>'
          );
        })
        .join('');
    }
    if (body) body.innerHTML = '<div class="pw-section-sub">Loading…</div>';
    var load = Ctx().refreshActivity
      ? Ctx().refreshActivity(ctx.activeWorkspaceId)
      : api.listVersions(ctx.activeWorkspaceId);
    load.then(function (res) {
      var versions =
        (Ctx().getContext && Ctx().getContext().recentActivity) ||
        (res && res.versions) ||
        [];
      renderActivityList(body, versions, filter || 'all');
    });
  }

  function activityMatchesFilter(v, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'comments') return v.kind === 'comment' || v.target_type;
    var type = (v.change && v.change.type) || v.change_type || '';
    if (filter === 'projects') return type.indexOf('project.') === 0;
    if (filter === 'productions') return type.indexOf('production.') === 0;
    if (filter === 'scripts') return type === 'script.updated';
    if (filter === 'shotlists') return type === 'shotlist.updated';
    if (filter === 'assets') return type === 'assets.updated' || type === 'references.updated';
    return true;
  }

  function renderActivityList(body, versions, filter) {
    if (!body) return;
    var rows = (versions || []).filter(function (v) {
      return activityMatchesFilter(v, filter);
    });
    if (!rows.length) {
      body.innerHTML = '<div class="pw-section-sub">No activity yet for this filter.</div>';
      return;
    }
    var h = '';
    rows.forEach(function (v) {
      var who = v.name || 'Collaborator';
      var type =
        v.type_label ||
        (v.change &&
          global.PreShootWorkspaceChanges &&
          PreShootWorkspaceChanges.changeTypeLabel &&
          PreShootWorkspaceChanges.changeTypeLabel(v.change.type)) ||
        (v.reason === 'restore' ? 'Version restored' : 'Workspace updated');
      var entity = v.entity_label || (v.change && v.change.entityLabel) || '';
      h +=
        '<div class="ws-activity-row">' +
        '<span class="ws-presence-dot" aria-hidden="true"></span>' +
        '<div class="ws-activity-main">' +
        '<div class="ws-activity-text">' +
        esc(who) +
        ' · ' +
        esc(type) +
        (entity ? ' · "' + esc(entity) + '"' : '') +
        '</div>' +
        '<div class="ws-activity-time">' +
        esc(relativeTime(v.created_at) || '') +
        '</div></div></div>';
    });
    body.innerHTML = h;
  }

  function refreshPresence() {
    refreshChrome();
    if (global.S && global.S.tab === 'studio' && global.PreShootStudioUI && PreShootStudioUI.renderStudio) {
      /* Presence chip is in header — chrome refresh is enough for most views */
    }
  }

  function onPresenceChanged() {
    refreshPresence();
  }

  function hideRemoteBanner() {
    var banner = document.getElementById('ws-remote-banner');
    if (banner) banner.hidden = true;
  }

  function dismissRemoteUpdate() {
    if (Ctx() && Ctx().keepLocalRemoteUpdate) {
      Ctx().keepLocalRemoteUpdate();
    } else {
      hideRemoteBanner();
    }
  }

  function keepLocalChanges() {
    if (!Ctx() || !Ctx().keepLocalRemoteUpdate) return;
    Ctx().keepLocalRemoteUpdate();
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
    saveStatusIndicatorHtml: saveStatusIndicatorHtml,
    presenceChipHtml: presenceChipHtml,
    productionPresenceHtml: productionPresenceHtml,
    productionActivityHtml: productionActivityHtml,
    refreshChrome: refreshChrome,
    refreshPresence: refreshPresence,
    onPresenceChanged: onPresenceChanged,
    openSwitcher: openSwitcher,
    choosePersonal: choosePersonal,
    chooseShared: chooseShared,
    openCreate: openCreate,
    submitCreate: submitCreate,
    openMembers: openMembers,
    openPeople: openPeople,
    openActivity: openActivity,
    openHistory: openHistory,
    viewHistoryVersion: viewHistoryVersion,
    restoreHistoryVersion: restoreHistoryVersion,
    showVersionPreview: showVersionPreview,
    hideVersionPreview: hideVersionPreview,
    closeVersionPreview: closeVersionPreview,
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
    conflictCompare: conflictCompare,
    onSaveOk: onSaveOk,
    onSaveStatus: onSaveStatus,
    onRemoteUpdateAvailable: onRemoteUpdateAvailable,
    syncRemoteBanner: syncRemoteBanner,
    reviewRemoteUpdate: reviewRemoteUpdate,
    keepLocalChanges: keepLocalChanges,
    dismissRemoteUpdate: dismissRemoteUpdate,
    hideRemoteBanner: hideRemoteBanner,
    showRecoveryPrompt: showRecoveryPrompt,
    hideRecoveryPrompt: hideRecoveryPrompt,
    recoverSessionDraft: recoverSessionDraft,
    discardSessionDraft: discardSessionDraft,
    consumeInviteFromUrl: consumeInviteFromUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
