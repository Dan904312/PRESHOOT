/**
 * Phase 5C — Workspace comments, mentions, notifications.
 * Separate from workspace_data.document (Studio JSON remains authoritative for content).
 */
import {
  isUuid,
  assertWorkspaceMember,
  assertWorkspaceRole,
  loadWorkspaceDocument,
  restJson,
  restBase,
  workspaceRealtimeTopic,
  EDIT_ROLES
} from './workspaces.js';

export const COMMENT_TARGET_TYPES = [
  'project',
  'production',
  'script',
  'shot',
  'reference',
  'asset'
];

export const COMMENT_WRITE_ROLES = ['owner', 'editor', 'commenter'];
export const COMMENT_RESOLVE_ROLES = ['owner', 'editor', 'commenter'];
export const COMMENT_MODERATE_ROLES = ['owner', 'editor'];

export const REVIEW_STATUSES = ['draft', 'in_review', 'changes_requested', 'approved'];

const MAX_BODY = 4000;
const MAX_MENTIONS = 20;

export function roleCanComment(role) {
  return COMMENT_WRITE_ROLES.includes(String(role || ''));
}

export function roleCanResolveComments(role) {
  return COMMENT_RESOLVE_ROLES.includes(String(role || ''));
}

export function roleCanModerateComments(role) {
  return COMMENT_MODERATE_ROLES.includes(String(role || ''));
}

function projectsOf(doc) {
  return Array.isArray(doc && doc.projects) ? doc.projects : [];
}

/**
 * Verify target exists in the workspace Studio document.
 * script → target_id must be production id (no separate script UUID).
 */
export function validateCommentTarget(document, { targetType, targetId, projectId, productionId }) {
  const type = String(targetType || '');
  const tid = String(targetId || '');
  if (!COMMENT_TARGET_TYPES.includes(type)) {
    return { ok: false, status: 422, error: 'invalid_target_type' };
  }
  if (!tid || tid.length > 120) {
    return { ok: false, status: 422, error: 'invalid_target_id' };
  }

  const projects = projectsOf(document);

  function findProject(id) {
    return projects.find((p) => p && String(p.id) === String(id)) || null;
  }
  function findProduction(id) {
    for (let i = 0; i < projects.length; i++) {
      const prods = Array.isArray(projects[i].productions) ? projects[i].productions : [];
      for (let j = 0; j < prods.length; j++) {
        if (prods[j] && String(prods[j].id) === String(id)) {
          return { project: projects[i], production: prods[j] };
        }
      }
    }
    return null;
  }

  if (type === 'project') {
    const p = findProject(tid);
    if (!p) return { ok: false, status: 404, error: 'target_not_found' };
    return {
      ok: true,
      projectId: p.id,
      productionId: null,
      entityLabel: p.name || 'Untitled project'
    };
  }

  if (type === 'production' || type === 'script') {
    const hit = findProduction(tid);
    if (!hit) return { ok: false, status: 404, error: 'target_not_found' };
    return {
      ok: true,
      projectId: hit.project.id,
      productionId: hit.production.id,
      entityLabel:
        type === 'script'
          ? (hit.production.name || 'Script')
          : hit.production.name || 'Untitled production'
    };
  }

  /* Nested: shot / reference / asset — require production context */
  const prodId = productionId || null;
  if (!prodId) return { ok: false, status: 422, error: 'production_id_required' };
  const hit = findProduction(prodId);
  if (!hit) return { ok: false, status: 404, error: 'production_not_found' };
  const ws = hit.production.workspace || {};

  if (type === 'shot') {
    const shots = Array.isArray(ws.shotList) ? ws.shotList : [];
    const shot = shots.find((s) => s && String(s.id) === tid);
    if (!shot) return { ok: false, status: 404, error: 'target_not_found' };
    return {
      ok: true,
      projectId: hit.project.id,
      productionId: hit.production.id,
      entityLabel: 'Shot ' + (shot.order != null ? shot.order : shot.id)
    };
  }

  if (type === 'asset') {
    const assets = Array.isArray(ws.assets) ? ws.assets : [];
    const asset = assets.find((a) => a && String(a.id) === tid);
    if (!asset) return { ok: false, status: 404, error: 'target_not_found' };
    return {
      ok: true,
      projectId: hit.project.id,
      productionId: hit.production.id,
      entityLabel: asset.name || 'Asset'
    };
  }

  if (type === 'reference') {
    const refs = ws.references || {};
    const buckets = ['youtube', 'capcut', 'uploads', 'other', 'pinterest'];
    let found = null;
    for (let i = 0; i < buckets.length; i++) {
      const list = Array.isArray(refs[buckets[i]]) ? refs[buckets[i]] : [];
      found = list.find((r) => r && String(r.id) === tid) || null;
      if (found) break;
    }
    if (!found) return { ok: false, status: 404, error: 'target_not_found' };
    return {
      ok: true,
      projectId: hit.project.id,
      productionId: hit.production.id,
      entityLabel: found.title || found.name || 'Reference'
    };
  }

  return { ok: false, status: 422, error: 'invalid_target_type' };
}

export function parseMentionIds(body, clientMentionIds) {
  const fromClient = Array.isArray(clientMentionIds)
    ? clientMentionIds.map((id) => String(id || '')).filter(Boolean)
    : [];
  const fromBody = [];
  const re = /@\[([0-9a-f-]{8,})\]/gi;
  let m;
  const text = String(body || '');
  while ((m = re.exec(text))) fromBody.push(m[1]);
  /* Also accept plain UUIDs listed by client only — body @Name is display, IDs come structured */
  const merged = Array.from(new Set(fromClient.concat(fromBody))).slice(0, MAX_MENTIONS);
  return merged;
}

async function memberIdSet(workspaceId) {
  const rows = await restJson(
    'GET',
    `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=user_id`
  );
  const set = new Set();
  (Array.isArray(rows.data) ? rows.data : []).forEach((r) => {
    if (r && r.user_id) set.add(String(r.user_id));
  });
  return set;
}

export async function validateMentions(workspaceId, mentionIds) {
  const ids = Array.from(new Set((mentionIds || []).map(String).filter(Boolean))).slice(
    0,
    MAX_MENTIONS
  );
  if (!ids.length) return { ok: true, mentions: [] };
  const members = await memberIdSet(workspaceId);
  const valid = [];
  for (let i = 0; i < ids.length; i++) {
    if (members.has(ids[i])) valid.push(ids[i]);
  }
  return { ok: true, mentions: valid };
}

async function lookupName(userId) {
  if (!userId) return null;
  try {
    const cfg = restBase();
    if (!cfg) return null;
    const r = await fetch(`${cfg.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: cfg.headers
    });
    if (!r.ok) return null;
    const u = await r.json();
    const meta = (u && u.user_metadata) || {};
    return meta.full_name || meta.name || (u.email ? String(u.email).split('@')[0] : null);
  } catch (e) {
    return null;
  }
}

export async function broadcastCommentEvent({
  workspaceId,
  type,
  commentId,
  targetType,
  targetId,
  authorId,
  productionId,
  projectId
}) {
  if (!isUuid(workspaceId)) return { ok: false };
  const cfg = restBase();
  if (!cfg) return { ok: false };
  const payload = {
    type: type || 'comment.created',
    workspace_id: workspaceId,
    comment_id: commentId || null,
    target_type: targetType || null,
    target_id: targetId || null,
    author_id: authorId || null,
    production_id: productionId || null,
    project_id: projectId || null,
    at: new Date().toISOString()
  };
  try {
    const r = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { ...cfg.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            topic: workspaceRealtimeTopic(workspaceId),
            event: type || 'comment.created',
            payload,
            private: true
          }
        ]
      })
    });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false };
  }
}

async function createNotifications(rows) {
  if (!rows.length) return;
  const cfg = restBase();
  if (!cfg) return;
  await fetch(`${cfg.url}/rest/v1/workspace_notifications`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=minimal' },
    body: JSON.stringify(rows)
  }).catch(function () {});
}

function serializeComment(row, authorName) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    author_id: row.author_id,
    author_name: authorName || null,
    target_type: row.target_type,
    target_id: row.target_id,
    project_id: row.project_id,
    production_id: row.production_id,
    parent_id: row.parent_id,
    body: row.body,
    mentions: Array.isArray(row.mentions) ? row.mentions : [],
    resolved: !!row.resolved,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function listComments(
  userId,
  workspaceId,
  { productionId, targetType, targetId, unresolvedOnly, limit } = {}
) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 400, error: 'personal_uses_user_data' };
  }

  let q =
    `workspace_comments?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&deleted_at=is.null&select=*&order=created_at.asc`;
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  q += `&limit=${lim}`;
  if (productionId) q += `&production_id=eq.${encodeURIComponent(productionId)}`;
  if (targetType) q += `&target_type=eq.${encodeURIComponent(targetType)}`;
  if (targetId) q += `&target_id=eq.${encodeURIComponent(targetId)}`;
  if (unresolvedOnly) q += `&resolved=eq.false`;

  const rows = await restJson('GET', q);
  if (!rows.ok) return { ok: false, status: 500, error: 'list_comments_failed' };
  const list = Array.isArray(rows.data) ? rows.data : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const name = await lookupName(list[i].author_id);
    out.push(serializeComment(list[i], name));
  }
  return {
    ok: true,
    comments: out,
    role: m.role,
    canComment: roleCanComment(m.role),
    canResolve: roleCanResolveComments(m.role),
    canModerate: roleCanModerateComments(m.role)
  };
}

export async function createComment(userId, workspaceId, input) {
  const m = await assertWorkspaceRole(userId, workspaceId, COMMENT_WRITE_ROLES);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 400, error: 'personal_uses_user_data' };
  }

  const body = String((input && input.body) || '').trim();
  if (!body || body.length > MAX_BODY) {
    return { ok: false, status: 422, error: 'invalid_body' };
  }

  const loaded = await loadWorkspaceDocument(userId, workspaceId);
  if (!loaded.ok) return loaded;

  const target = validateCommentTarget(loaded.document, {
    targetType: input.target_type || input.targetType,
    targetId: input.target_id || input.targetId,
    projectId: input.project_id || input.projectId,
    productionId: input.production_id || input.productionId
  });
  if (!target.ok) return target;

  const targetType = String(input.target_type || input.targetType);
  const targetId = String(input.target_id || input.targetId);

  let parentId = input.parent_id || input.parentId || null;
  let parentAuthor = null;
  if (parentId) {
    if (!isUuid(parentId)) return { ok: false, status: 422, error: 'invalid_parent_id' };
    const parent = await restJson(
      'GET',
      `workspace_comments?id=eq.${encodeURIComponent(parentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&deleted_at=is.null&select=id,author_id,target_type,target_id,production_id,parent_id&limit=1`
    );
    const prow = Array.isArray(parent.data) ? parent.data[0] : null;
    if (!prow) return { ok: false, status: 404, error: 'parent_not_found' };
    if (
      String(prow.target_type) !== targetType ||
      String(prow.target_id) !== targetId
    ) {
      return { ok: false, status: 422, error: 'parent_target_mismatch' };
    }
    /* Shallow threads: replies only to top-level or one level deep → parent of reply must be root */
    if (prow.parent_id) parentId = prow.parent_id;
    parentAuthor = prow.author_id || null;
  }

  const mentionCheck = await validateMentions(
    workspaceId,
    parseMentionIds(body, input.mentions || input.mentionedUserIds)
  );
  const mentions = mentionCheck.mentions.filter((id) => id !== userId);

  const cfg = restBase();
  const insert = await fetch(`${cfg.url}/rest/v1/workspace_comments`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      author_id: userId,
      target_type: targetType,
      target_id: targetId,
      project_id: target.projectId,
      production_id: target.productionId,
      parent_id: parentId,
      body,
      mentions
    })
  });
  const created = await insert.json().catch(() => null);
  const row = Array.isArray(created) ? created[0] : created;
  if (!insert.ok || !row) {
    return { ok: false, status: 500, error: 'create_failed' };
  }

  const authorName = await lookupName(userId);
  const comment = serializeComment(row, authorName);

  /* Notifications: mentions + parent author + thread participants */
  const notifyRows = [];
  const titleBase = authorName || 'Collaborator';
  mentions.forEach((uid) => {
    notifyRows.push({
      workspace_id: workspaceId,
      user_id: uid,
      type: 'mention',
      comment_id: row.id,
      actor_id: userId,
      title: `${titleBase} mentioned you`,
      body: body.slice(0, 160)
    });
  });

  if (parentId) {
    const thread = await restJson(
      'GET',
      `workspace_comments?or=(id.eq.${encodeURIComponent(parentId)},parent_id.eq.${encodeURIComponent(parentId)})&workspace_id=eq.${encodeURIComponent(workspaceId)}&deleted_at=is.null&select=author_id`
    );
    const authors = new Set();
    (Array.isArray(thread.data) ? thread.data : []).forEach((t) => {
      if (t && t.author_id && t.author_id !== userId) authors.add(t.author_id);
    });
    authors.forEach((uid) => {
      if (mentions.includes(uid)) return;
      notifyRows.push({
        workspace_id: workspaceId,
        user_id: uid,
        type: parentAuthor && uid === parentAuthor ? 'comment_reply' : 'thread_reply',
        comment_id: row.id,
        actor_id: userId,
        title: `${titleBase} replied to a comment`,
        body: body.slice(0, 160)
      });
    });
  }

  await createNotifications(notifyRows);

  broadcastCommentEvent({
    workspaceId,
    type: parentId ? 'comment.replied' : 'comment.created',
    commentId: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    authorId: userId,
    productionId: row.production_id,
    projectId: row.project_id
  }).catch(function () {});

  return { ok: true, comment };
}

export async function updateComment(userId, workspaceId, commentId, patch) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (!isUuid(commentId)) return { ok: false, status: 400, error: 'invalid_comment_id' };

  const found = await restJson(
    'GET',
    `workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&deleted_at=is.null&select=*&limit=1`
  );
  const row = Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'not_found' };

  const isOwner = row.author_id === userId;
  const canMod = roleCanModerateComments(m.role);
  if (!isOwner && !canMod) {
    return { ok: false, status: 403, error: 'forbidden', role: m.role };
  }

  const body = patch && patch.body != null ? String(patch.body).trim() : null;
  if (body != null) {
    if (!body || body.length > MAX_BODY) {
      return { ok: false, status: 422, error: 'invalid_body' };
    }
    if (!isOwner) {
      return { ok: false, status: 403, error: 'edit_own_only' };
    }
  }

  let mentions = row.mentions;
  if (body != null) {
    const mentionCheck = await validateMentions(
      workspaceId,
      parseMentionIds(body, patch.mentions || patch.mentionedUserIds)
    );
    mentions = mentionCheck.mentions.filter((id) => id !== userId);
  }

  const cfg = restBase();
  const update = {
    updated_at: new Date().toISOString()
  };
  if (body != null) {
    update.body = body;
    update.mentions = mentions;
  }

  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify(update)
    }
  );
  const updated = await r.json().catch(() => null);
  const next = Array.isArray(updated) ? updated[0] : updated;
  if (!r.ok || !next) return { ok: false, status: 500, error: 'update_failed' };

  const name = await lookupName(next.author_id);
  broadcastCommentEvent({
    workspaceId,
    type: 'comment.updated',
    commentId: next.id,
    targetType: next.target_type,
    targetId: next.target_id,
    authorId: userId,
    productionId: next.production_id,
    projectId: next.project_id
  }).catch(function () {});

  return { ok: true, comment: serializeComment(next, name) };
}

export async function deleteComment(userId, workspaceId, commentId) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (!isUuid(commentId)) return { ok: false, status: 400, error: 'invalid_comment_id' };

  const found = await restJson(
    'GET',
    `workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&deleted_at=is.null&select=*&limit=1`
  );
  const row = Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'not_found' };

  const isOwner = row.author_id === userId;
  if (!isOwner && !roleCanModerateComments(m.role)) {
    return { ok: false, status: 403, error: 'forbidden', role: m.role };
  }

  const cfg = restBase();
  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: cfg.headers,
      body: JSON.stringify({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    }
  );
  if (!r.ok) return { ok: false, status: 500, error: 'delete_failed' };

  broadcastCommentEvent({
    workspaceId,
    type: 'comment.deleted',
    commentId,
    targetType: row.target_type,
    targetId: row.target_id,
    authorId: userId,
    productionId: row.production_id,
    projectId: row.project_id
  }).catch(function () {});

  return { ok: true };
}

export async function setCommentResolved(userId, workspaceId, commentId, resolved) {
  const m = await assertWorkspaceRole(userId, workspaceId, COMMENT_RESOLVE_ROLES);
  if (!m.ok) return m;
  if (!isUuid(commentId)) return { ok: false, status: 400, error: 'invalid_comment_id' };

  const found = await restJson(
    'GET',
    `workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&deleted_at=is.null&select=*&limit=1`
  );
  const row = Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'not_found' };

  const want = !!resolved;
  const cfg = restBase();
  const patch = {
    resolved: want,
    resolved_at: want ? new Date().toISOString() : null,
    resolved_by: want ? userId : null,
    updated_at: new Date().toISOString()
  };
  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_comments?id=eq.${encodeURIComponent(commentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    }
  );
  const updated = await r.json().catch(() => null);
  const next = Array.isArray(updated) ? updated[0] : updated;
  if (!r.ok || !next) return { ok: false, status: 500, error: 'resolve_failed' };

  if (want && row.author_id && row.author_id !== userId) {
    const actorName = await lookupName(userId);
    await createNotifications([
      {
        workspace_id: workspaceId,
        user_id: row.author_id,
        type: 'comment_resolved',
        comment_id: commentId,
        actor_id: userId,
        title: `${actorName || 'Collaborator'} resolved your comment`,
        body: String(row.body || '').slice(0, 160)
      }
    ]);
  }

  const name = await lookupName(next.author_id);
  broadcastCommentEvent({
    workspaceId,
    type: want ? 'comment.resolved' : 'comment.reopened',
    commentId,
    targetType: next.target_type,
    targetId: next.target_id,
    authorId: userId,
    productionId: next.production_id,
    projectId: next.project_id
  }).catch(function () {});

  return { ok: true, comment: serializeComment(next, name) };
}

export async function getProductionReviewSummary(userId, workspaceId, productionId) {
  const listed = await listComments(userId, workspaceId, {
    productionId,
    limit: 200
  });
  if (!listed.ok) return listed;
  const comments = listed.comments || [];
  const unresolved = comments.filter((c) => !c.resolved && !c.parent_id);
  const resolved = comments.filter((c) => c.resolved && !c.parent_id);
  return {
    ok: true,
    production_id: productionId,
    total: comments.length,
    unresolved_count: unresolved.length,
    resolved_count: resolved.length,
    unresolved: unresolved.map((c) => ({
      id: c.id,
      target_type: c.target_type,
      target_id: c.target_id,
      body: c.body,
      author_name: c.author_name,
      created_at: c.created_at
    })),
    role: listed.role,
    canComment: listed.canComment,
    canResolve: listed.canResolve
  };
}

/**
 * Set production.reviewStatus on shared document via optimistic concurrency.
 * Owners/editors only. Does not create a version reason beyond normal save path —
 * caller should use saveWorkspaceDocument from workspaces.js.
 */
export async function setProductionReviewStatus(
  userId,
  workspaceId,
  productionId,
  reviewStatus,
  clientRevision,
  saveWorkspaceDocument
) {
  if (!REVIEW_STATUSES.includes(String(reviewStatus || ''))) {
    return { ok: false, status: 422, error: 'invalid_review_status' };
  }
  const m = await assertWorkspaceRole(userId, workspaceId, EDIT_ROLES);
  if (!m.ok) return m;

  const loaded = await loadWorkspaceDocument(userId, workspaceId);
  if (!loaded.ok) return loaded;
  const doc = JSON.parse(JSON.stringify(loaded.document || {}));
  const projects = projectsOf(doc);
  let found = false;
  for (let i = 0; i < projects.length; i++) {
    const prods = Array.isArray(projects[i].productions) ? projects[i].productions : [];
    for (let j = 0; j < prods.length; j++) {
      if (prods[j] && String(prods[j].id) === String(productionId)) {
        prods[j].reviewStatus = reviewStatus;
        prods[j].updatedAt = Date.now();
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return { ok: false, status: 404, error: 'production_not_found' };

  const saved = await saveWorkspaceDocument(userId, workspaceId, doc, clientRevision, {
    changeHint: {
      type: 'production.updated',
      productionId,
      entityId: productionId,
      entityLabel: 'Review status'
    }
  });
  if (!saved.ok) return saved;
  return {
    ok: true,
    revision: saved.revision,
    review_status: reviewStatus,
    document: saved.document,
    change: saved.change
  };
}

export async function listNotifications(userId, { workspaceId, unreadOnly, limit } = {}) {
  if (!userId) return { ok: false, status: 401, error: 'unauthorized' };
  const lim = Math.min(50, Math.max(1, Number(limit) || 30));
  let q =
    `workspace_notifications?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=*&order=created_at.desc&limit=${lim}`;
  if (workspaceId) {
    if (!isUuid(workspaceId)) return { ok: false, status: 400, error: 'invalid_workspace_id' };
    const m = await assertWorkspaceMember(userId, workspaceId);
    if (!m.ok) return m;
    q += `&workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  }
  if (unreadOnly) q += `&read_at=is.null`;

  const rows = await restJson('GET', q);
  if (!rows.ok) return { ok: false, status: 500, error: 'list_notifications_failed' };
  return { ok: true, notifications: Array.isArray(rows.data) ? rows.data : [] };
}

export async function markNotificationRead(userId, notificationId) {
  if (!isUuid(notificationId)) return { ok: false, status: 400, error: 'invalid_id' };
  const cfg = restBase();
  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_notifications?id=eq.${encodeURIComponent(notificationId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: cfg.headers,
      body: JSON.stringify({ read_at: new Date().toISOString() })
    }
  );
  if (!r.ok) return { ok: false, status: 500, error: 'update_failed' };
  return { ok: true };
}

/** Compact comment activity for activity panel / Director */
export async function listCommentActivity(userId, workspaceId, { limit } = {}) {
  const listed = await listComments(userId, workspaceId, { limit: limit || 40 });
  if (!listed.ok) return listed;
  const items = (listed.comments || [])
    .filter((c) => !c.parent_id)
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit || 40)
    .map((c) => ({
      kind: 'comment',
      id: c.id,
      created_at: c.created_at,
      name: c.author_name,
      type_label: c.resolved ? 'Resolved a comment' : 'Commented',
      entity_label: c.target_type,
      target_type: c.target_type,
      target_id: c.target_id,
      production_id: c.production_id,
      body_preview: String(c.body || '').slice(0, 100),
      resolved: c.resolved
    }));
  return { ok: true, activity: items, role: listed.role };
}
