/**
 * Phase 5C — Comment / mention / review UI (shared workspaces only).
 * Comments are collaborative metadata — never written into Studio JSON.
 */
(function (global) {
  'use strict';

  var _sheet = {
    productionId: null,
    targetType: null,
    targetId: null,
    parentId: null,
    members: []
  };

  function ico(name, size) {
    return global.ICO && typeof ICO.html === 'function' ? ICO.html(name, size) : '';
  }
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
    if (typeof global.openM === 'function') return global.openM(id);
    var el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function closeM(id) {
    if (typeof global.closeM === 'function') return global.closeM(id);
    var el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function myId() {
    return global.S && global.S.authUser && global.S.authUser.id;
  }
  function isShared() {
    return Ctx() && Ctx().isShared && Ctx().isShared();
  }

  function REVIEW_LABELS() {
    return {
      draft: 'Draft',
      in_review: 'In Review',
      changes_requested: 'Changes Requested',
      approved: 'Approved'
    };
  }

  function countForTarget(comments, targetType, targetId) {
    return (comments || []).filter(function (c) {
      return (
        !c.parent_id &&
        String(c.target_type) === String(targetType) &&
        String(c.target_id) === String(targetId)
      );
    }).length;
  }

  function commentChipHtml(productionId, targetType, targetId, label) {
    if (!isShared()) return '';
    var ctx = Ctx().getContext();
    var cache = (ctx.commentCache && ctx.commentCache[productionId]) || {};
    var n = countForTarget(cache.comments, targetType, targetId);
    var text = n ? ico('chat', 14) + ' ' + n : ico('chat', 14);
    return (
      '<button type="button" class="ws-comment-chip" title="' +
      esc(label || 'Comments') +
      '" onclick="PreShootWorkspaceComments.openSheet(\'' +
      esc(productionId) +
      "','" +
      esc(targetType) +
      "','" +
      esc(targetId) +
      '\')">' +
      text +
      (n ? ' comments' : '') +
      '</button>'
    );
  }

  function reviewCardHtml(productionId, prod) {
    if (!isShared() || !productionId) return '';
    var ctx = Ctx().getContext();
    var cache = (ctx.commentCache && ctx.commentCache[productionId]) || {};
    var summary = cache.summary || {};
    var unresolved = summary.unresolved_count || 0;
    var resolved = summary.resolved_count || 0;
    var total = summary.total || 0;
    var reviewStatus = (prod && prod.reviewStatus) || 'draft';
    var labels = REVIEW_LABELS();
    var canEdit = ctx.canEdit;
    var h = '<div class="pw-card ws-review-card">';
    h += '<div class="pw-card-kicker">Review</div>';
    h +=
      '<div class="ws-review-stats">' +
      esc(String(total)) +
      ' comments · ' +
      esc(String(unresolved)) +
      ' unresolved · ' +
      esc(String(resolved)) +
      ' resolved</div>';
    h += '<div class="ws-review-status-row">';
    h += '<span class="pw-fact-l">Review status</span>';
    if (canEdit) {
      h += '<select class="st-input ws-review-select" onchange="PreShootWorkspaceComments.setReviewStatus(\'' +
        esc(productionId) +
        "',this.value)\">";
      Object.keys(labels).forEach(function (k) {
        h +=
          '<option value="' +
          esc(k) +
          '"' +
          (k === reviewStatus ? ' selected' : '') +
          '>' +
          esc(labels[k]) +
          '</option>';
      });
      h += '</select>';
    } else {
      h += '<span class="pw-fact-v">' + esc(labels[reviewStatus] || reviewStatus) + '</span>';
    }
    h += '</div>';
    if (unresolved && summary.unresolved && summary.unresolved.length) {
      h += '<div class="ws-review-unresolved"><div class="pw-fact-l">Unresolved</div>';
      summary.unresolved.slice(0, 6).forEach(function (c) {
        h +=
          '<button type="button" class="ws-review-item" onclick="PreShootWorkspaceComments.jumpToComment(\'' +
          esc(productionId) +
          "','" +
          esc(c.target_type) +
          "','" +
          esc(c.target_id) +
          '\')"><span class="ws-review-dot"></span>' +
          esc((c.body || '').slice(0, 80)) +
          '</button>';
      });
      h += '</div>';
    }
    h +=
      '<button type="button" class="studio-btn ghost sm" style="margin-top:10px" onclick="PreShootWorkspaceComments.openSheet(\'' +
      esc(productionId) +
      "','production','" +
      esc(productionId) +
      '\')">Open comments</button>';
    h += '</div>';
    return h;
  }

  function ensureLoaded(productionId) {
    if (!Ctx() || !Ctx().loadProductionComments) return Promise.resolve({ ok: false });
    return Ctx().loadProductionComments(productionId, false).then(function (res) {
      if (global.PreShootStudioUI && PreShootStudioUI.renderStudio) {
        /* soft refresh only when on this production */
        var view = global.S && global.S.studioView;
        if (view && view.productionId === productionId) {
          PreShootStudioUI.renderStudio();
        }
      }
      return res;
    });
  }

  function openSheet(productionId, targetType, targetId, parentId) {
    if (!isShared()) {
      toast('Comments are available in shared workspaces');
      return;
    }
    _sheet.productionId = productionId;
    _sheet.targetType = targetType;
    _sheet.targetId = targetId;
    _sheet.parentId = parentId || null;
    openM('ws-comments-modal');
    var body = document.getElementById('ws-comments-body');
    if (body) body.innerHTML = '<div class="pw-section-sub">Loading…</div>';
    var api = API();
    var ctx = Ctx().getContext();
    var membersP =
      api && api.listMembers
        ? api.listMembers(ctx.activeWorkspaceId)
        : Promise.resolve({ ok: false });
    Promise.all([
      Ctx().loadProductionComments(productionId, true),
      membersP
    ]).then(function (pair) {
      _sheet.members = (pair[1] && pair[1].members) || [];
      renderSheet();
    });
  }

  function threadForTarget(comments) {
    var roots = (comments || []).filter(function (c) {
      return (
        !c.parent_id &&
        String(c.target_type) === String(_sheet.targetType) &&
        String(c.target_id) === String(_sheet.targetId)
      );
    });
    var byParent = {};
    (comments || []).forEach(function (c) {
      if (!c.parent_id) return;
      if (!byParent[c.parent_id]) byParent[c.parent_id] = [];
      byParent[c.parent_id].push(c);
    });
    return { roots: roots, byParent: byParent };
  }

  function renderSheet() {
    var body = document.getElementById('ws-comments-body');
    var ttl = document.getElementById('ws-comments-ttl');
    if (!body) return;
    var ctx = Ctx().getContext();
    var cache = (ctx.commentCache && ctx.commentCache[_sheet.productionId]) || {};
    var caps = cache.caps || {};
    var thread = threadForTarget(cache.comments || []);
    if (ttl) {
      ttl.textContent =
        'Comments · ' +
        (_sheet.targetType || 'item') +
        (thread.roots.length ? ' (' + thread.roots.length + ')' : '');
    }
    var h = '';
    if (!thread.roots.length) {
      h += '<div class="pw-section-sub">No comments yet on this item.</div>';
    }
    thread.roots.forEach(function (c) {
      h += renderCommentBlock(c, thread.byParent[c.id] || [], caps);
    });
    if (caps.canComment) {
      h += '<div class="ws-comment-compose">';
      h += '<div class="pw-fact-l">' + (_sheet.parentId ? 'Reply' : 'Add comment') + '</div>';
      h +=
        '<textarea id="ws-comment-input" class="st-input st-notes" rows="3" placeholder="Write feedback… Use @Name to mention"></textarea>';
      h += '<div id="ws-mention-suggest" class="ws-mention-suggest" hidden></div>';
      h +=
        '<button type="button" class="studio-btn primary" style="margin-top:10px;width:100%" onclick="PreShootWorkspaceComments.submitComment()">Submit</button>';
      h += '</div>';
    } else {
      h += '<div class="pw-section-sub" style="margin-top:12px">View only — viewers cannot comment.</div>';
    }
    body.innerHTML = h;
    var inp = document.getElementById('ws-comment-input');
    if (inp) {
      inp.addEventListener('input', onComposeInput);
    }
  }

  function renderCommentBlock(c, replies, caps) {
    var me = myId();
    var h = '<div class="ws-comment-block' + (c.resolved ? ' resolved' : '') + '">';
    h += '<div class="ws-comment-hd"><strong>' + esc(c.author_name || 'Collaborator') + '</strong>';
    if (c.resolved) h += '<span class="ws-comment-resolved">Resolved</span>';
    h += '</div>';
    h += '<div class="ws-comment-body">' + esc(c.body) + '</div>';
    h += '<div class="ws-comment-actions">';
    if (caps.canComment) {
      h +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceComments.replyTo(\'' +
        esc(c.id) +
        '\')">Reply</button>';
    }
    if (caps.canResolve) {
      if (c.resolved) {
        h +=
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceComments.reopen(\'' +
          esc(c.id) +
          '\')">Re-open</button>';
      } else {
        h +=
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceComments.resolve(\'' +
          esc(c.id) +
          '\')">Resolve</button>';
      }
    }
    if (c.author_id === me || caps.canModerate) {
      if (c.author_id === me) {
        h +=
          '<button type="button" class="studio-btn ghost sm" onclick="PreShootWorkspaceComments.editPrompt(\'' +
          esc(c.id) +
          '\')">Edit</button>';
      }
      h +=
        '<button type="button" class="studio-btn ghost sm danger" onclick="PreShootWorkspaceComments.remove(\'' +
        esc(c.id) +
        '\')">Delete</button>';
    }
    h += '</div>';
    (replies || []).forEach(function (r) {
      h += '<div class="ws-comment-reply">';
      h += '<div class="ws-comment-hd"><strong>' + esc(r.author_name || 'Collaborator') + '</strong></div>';
      h += '<div class="ws-comment-body">' + esc(r.body) + '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function onComposeInput() {
    var inp = document.getElementById('ws-comment-input');
    var box = document.getElementById('ws-mention-suggest');
    if (!inp || !box) return;
    var val = inp.value || '';
    var m = val.match(/@([^\s@]*)$/);
    if (!m) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var q = String(m[1] || '').toLowerCase();
    var hits = (_sheet.members || [])
      .filter(function (mem) {
        if (!mem || !mem.user_id) return false;
        if (mem.user_id === myId()) return false;
        var name = String(mem.name || mem.email || '').toLowerCase();
        return !q || name.indexOf(q) === 0 || name.indexOf(q) >= 0;
      })
      .slice(0, 6);
    if (!hits.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = hits
      .map(function (mem) {
        var label = mem.name || mem.email || 'Member';
        return (
          '<button type="button" class="ws-mention-opt" onclick="PreShootWorkspaceComments.insertMention(\'' +
          esc(mem.user_id) +
          "','" +
          esc(label) +
          '\')">@' +
          esc(label) +
          '</button>'
        );
      })
      .join('');
  }

  function insertMention(userId, label) {
    var inp = document.getElementById('ws-comment-input');
    var box = document.getElementById('ws-mention-suggest');
    if (!inp) return;
    var val = inp.value || '';
    var next = val.replace(/@([^\s@]*)$/, '@' + label + ' ');
    inp.value = next;
    if (!inp._mentionIds) inp._mentionIds = [];
    if (inp._mentionIds.indexOf(userId) < 0) inp._mentionIds.push(userId);
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    inp.focus();
  }

  function submitComment() {
    var api = API();
    var ctx = Ctx().getContext();
    var inp = document.getElementById('ws-comment-input');
    if (!api || !ctx || !inp) return;
    var body = String(inp.value || '').trim();
    if (!body) {
      toast('Write a comment first');
      return;
    }
    var mentions = inp._mentionIds || [];
    api
      .createComment(ctx.activeWorkspaceId, {
        target_type: _sheet.targetType,
        target_id: _sheet.targetId,
        production_id: _sheet.productionId,
        parent_id: _sheet.parentId || null,
        body: body,
        mentions: mentions
      })
      .then(function (res) {
        if (!res || !res.ok) {
          toast(
            res && res.status === 403
              ? 'No permission to comment'
              : (res && res.error) || 'Could not post comment'
          );
          return;
        }
        _sheet.parentId = null;
        toast('Comment posted');
        if (global.PreShootAnalytics) PreShootAnalytics.track('comment_created', { target: _sheet.targetType });
        return Ctx().loadProductionComments(_sheet.productionId, true).then(renderSheet);
      });
  }

  function replyTo(parentId) {
    _sheet.parentId = parentId;
    renderSheet();
    var inp = document.getElementById('ws-comment-input');
    if (inp) inp.focus();
  }

  function resolve(commentId) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx) return;
    api.resolveComment(ctx.activeWorkspaceId, commentId).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not resolve');
        return;
      }
      return Ctx().loadProductionComments(_sheet.productionId, true).then(renderSheet);
    });
  }

  function reopen(commentId) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx) return;
    api.reopenComment(ctx.activeWorkspaceId, commentId).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not re-open');
        return;
      }
      return Ctx().loadProductionComments(_sheet.productionId, true).then(renderSheet);
    });
  }

  function editPrompt(commentId) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx) return;
    var cache = (ctx.commentCache && ctx.commentCache[_sheet.productionId]) || {};
    var c = (cache.comments || []).find(function (x) {
      return x.id === commentId;
    });
    var next = window.prompt('Edit comment', (c && c.body) || '');
    if (next == null) return;
    next = String(next).trim();
    if (!next) {
      toast('Comment cannot be empty');
      return;
    }
    api.updateComment(ctx.activeWorkspaceId, commentId, { body: next }).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not edit');
        return;
      }
      return Ctx().loadProductionComments(_sheet.productionId, true).then(renderSheet);
    });
  }

  function remove(commentId) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx) return;
    if (!window.confirm('Delete this comment?')) return;
    api.deleteComment(ctx.activeWorkspaceId, commentId).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || 'Could not delete');
        return;
      }
      return Ctx().loadProductionComments(_sheet.productionId, true).then(renderSheet);
    });
  }

  function jumpToComment(productionId, targetType, targetId) {
    if (global.PreShootStudioUI && PreShootStudioUI.openProduction) {
      PreShootStudioUI.openProduction(productionId);
      if (targetType === 'script' && PreShootStudioUI.setProdSection) {
        PreShootStudioUI.setProdSection(productionId, 'script');
      } else if (targetType === 'shot' && PreShootStudioUI.setProdSection) {
        PreShootStudioUI.setProdSection(productionId, 'shots');
      } else if (targetType === 'reference' && PreShootStudioUI.setProdSection) {
        PreShootStudioUI.setProdSection(productionId, 'refs');
      } else if (targetType === 'asset' && PreShootStudioUI.setProdSection) {
        PreShootStudioUI.setProdSection(productionId, 'assets');
      }
    }
    setTimeout(function () {
      openSheet(productionId, targetType, targetId);
    }, 200);
  }

  function setReviewStatus(productionId, status) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx || !ctx.canEdit) {
      toast('Only owners and editors can change review status');
      return;
    }
    api
      .setReviewStatus(ctx.activeWorkspaceId, productionId, status, ctx.activeWorkspaceRevision)
      .then(function (res) {
        if (!res || !res.ok) {
          if (res && res.conflict) toast('Conflict — reload and try again');
          else toast((res && res.error) || 'Could not update status');
          return;
        }
        if (res.document && Ctx().setSharedDocument) {
          Ctx().setSharedDocument(res.document, res.revision);
        }
        toast('Review status updated');
        if (global.PreShootAnalytics) {
          PreShootAnalytics.track('production_reviewed', {
            status: String(status || '').slice(0, 40)
          });
        }
        if (global.PreShootStudioUI) PreShootStudioUI.renderStudio();
      });
  }

  function openNotifications() {
    if (!isShared()) return;
    var api = API();
    var ctx = Ctx().getContext();
    openM('ws-notifications-modal');
    var body = document.getElementById('ws-notifications-body');
    if (body) body.innerHTML = '<div class="pw-section-sub">Loading…</div>';
    api.listNotifications(ctx.activeWorkspaceId, { limit: 30 }).then(function (res) {
      if (!body) return;
      var rows = (res && res.notifications) || [];
      if (!rows.length) {
        body.innerHTML = '<div class="pw-section-sub">No notifications yet.</div>';
        return;
      }
      var h = '';
      rows.forEach(function (n) {
        h +=
          '<button type="button" class="ws-notif-row' +
          (n.read_at ? '' : ' unread') +
          '" onclick="PreShootWorkspaceComments.markRead(\'' +
          esc(n.id) +
          '\')"><div class="ws-notif-title">' +
          esc(n.title || 'Notification') +
          '</div><div class="ws-notif-body">' +
          esc(n.body || '') +
          '</div></button>';
      });
      body.innerHTML = h;
    });
  }

  function markRead(notificationId) {
    var api = API();
    var ctx = Ctx().getContext();
    if (!api || !ctx) return;
    api.markNotificationRead(ctx.activeWorkspaceId, notificationId).then(function () {
      if (Ctx().refreshNotifications) Ctx().refreshNotifications();
      openNotifications();
    });
  }

  function onRemoteEvent(evt) {
    var view = global.S && global.S.studioView;
    if (view && view.productionId && evt && evt.production_id === view.productionId) {
      ensureLoaded(view.productionId);
    }
    var modal = document.getElementById('ws-comments-modal');
    if (modal && modal.classList.contains('open') && _sheet.productionId) {
      Ctx()
        .loadProductionComments(_sheet.productionId, true)
        .then(renderSheet);
    }
    if (Ctx().refreshNotifications) Ctx().refreshNotifications();
  }

  global.PreShootWorkspaceComments = {
    commentChipHtml: commentChipHtml,
    reviewCardHtml: reviewCardHtml,
    ensureLoaded: ensureLoaded,
    openSheet: openSheet,
    submitComment: submitComment,
    replyTo: replyTo,
    resolve: resolve,
    reopen: reopen,
    editPrompt: editPrompt,
    remove: remove,
    jumpToComment: jumpToComment,
    setReviewStatus: setReviewStatus,
    openNotifications: openNotifications,
    markRead: markRead,
    insertMention: insertMention,
    onRemoteEvent: onRemoteEvent,
    REVIEW_LABELS: REVIEW_LABELS
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
