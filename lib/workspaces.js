/**
 * Collaborative Workspaces — Phase 1 server helpers.
 * Personal Studio stays in user_data; shared docs in workspace_data.
 * All workspace APIs must use these checks (service role bypasses RLS).
 */
import crypto from 'crypto';
import { serviceHeaders } from './security.js';

export const WORKSPACE_ROLES = ['owner', 'editor', 'commenter', 'viewer'];
export const EDIT_ROLES = ['owner', 'editor'];
export const INVITE_ROLES = ['editor', 'commenter', 'viewer'];

export const EMPTY_WORKSPACE_DOCUMENT = {
  version: 3,
  projects: [],
  continueProductionId: null
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_DOCUMENT_JSON = 450_000;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 320);
}

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function createInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token) };
}

export function roleCanEdit(role) {
  return EDIT_ROLES.includes(String(role || ''));
}

export function roleCanManageMembers(role) {
  return String(role || '') === 'owner';
}

export function validateStudioDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'invalid_document' };
  }
  let size;
  try {
    size = JSON.stringify(doc).length;
  } catch (e) {
    return { ok: false, error: 'invalid_document' };
  }
  if (size > MAX_DOCUMENT_JSON) {
    return { ok: false, error: 'document_too_large', max: MAX_DOCUMENT_JSON };
  }
  if (doc.projects != null && !Array.isArray(doc.projects)) {
    return { ok: false, error: 'invalid_document_projects' };
  }
  return { ok: true, size };
}

function restBase() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return null;
  return { url: SUPA_URL, headers: serviceHeaders() };
}

async function restJson(method, path, body) {
  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config', data: null };
  const opts = { method, headers: cfg.headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, opts);
  const text = await r.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
  }
  return { ok: r.ok, status: r.status, data, headers: r.headers };
}

export async function getWorkspaceMembership(userId, workspaceId) {
  if (!userId || !isUuid(workspaceId)) {
    return { ok: false, status: 400, error: 'invalid_request' };
  }
  const mem = await restJson(
    'GET',
    `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=workspace_id,user_id,role,created_at,updated_at&limit=1`
  );
  if (!mem.ok) {
    return { ok: false, status: 500, error: 'membership_lookup_failed' };
  }
  const row = Array.isArray(mem.data) ? mem.data[0] : null;
  if (!row) return { ok: false, status: 403, error: 'not_a_member' };

  const ws = await restJson(
    'GET',
    `workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=id,name,slug,owner_id,kind,created_at,updated_at,archived_at&limit=1`
  );
  const workspace = Array.isArray(ws.data) ? ws.data[0] : null;
  if (!workspace) return { ok: false, status: 404, error: 'workspace_not_found' };

  return {
    ok: true,
    membership: row,
    workspace,
    role: row.role,
    canEdit: roleCanEdit(row.role),
    canManageMembers: roleCanManageMembers(row.role)
  };
}

export async function assertWorkspaceMember(userId, workspaceId) {
  return getWorkspaceMembership(userId, workspaceId);
}

export async function assertWorkspaceRole(userId, workspaceId, allowedRoles) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m.ok) return m;
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!allowed.includes(m.role)) {
    return { ok: false, status: 403, error: 'insufficient_role', role: m.role };
  }
  return m;
}

export async function canEditWorkspace(userId, workspaceId) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m.ok) return { ...m, allowed: false };
  return { ...m, allowed: !!m.canEdit };
}

/** Ensure personal workspace metadata exists (never creates workspace_data). */
export async function ensurePersonalWorkspace(userId) {
  if (!userId) return { ok: false, status: 400, error: 'invalid_user' };
  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config' };

  const existing = await restJson(
    'GET',
    `workspaces?owner_id=eq.${encodeURIComponent(userId)}&kind=eq.personal&select=id,name,slug,owner_id,kind,created_at,updated_at,archived_at&limit=1`
  );
  let workspace = Array.isArray(existing.data) ? existing.data[0] : null;

  if (!workspace) {
    const withReturn = await fetch(`${cfg.url}/rest/v1/workspaces`, {
      method: 'POST',
      headers: {
        ...cfg.headers,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        name: 'Personal',
        owner_id: userId,
        kind: 'personal'
      })
    });
    const rows = await withReturn.json().catch(() => null);
    if (withReturn.ok && Array.isArray(rows) && rows[0]) {
      workspace = rows[0];
    } else {
      const again = await restJson(
        'GET',
        `workspaces?owner_id=eq.${encodeURIComponent(userId)}&kind=eq.personal&select=id,name,slug,owner_id,kind,created_at,updated_at,archived_at&limit=1`
      );
      workspace = Array.isArray(again.data) ? again.data[0] : null;
    }
  }

  if (!workspace) {
    return { ok: false, status: 500, error: 'personal_workspace_failed' };
  }

  await fetch(`${cfg.url}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      ...cfg.headers,
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner'
    })
  });

  return { ok: true, workspace };
}

export async function listUserWorkspaces(userId) {
  await ensurePersonalWorkspace(userId);
  const mem = await restJson(
    'GET',
    `workspace_members?user_id=eq.${encodeURIComponent(userId)}&select=workspace_id,role,created_at,updated_at`
  );
  if (!mem.ok || !Array.isArray(mem.data)) {
    return { ok: false, status: 500, error: 'list_failed', workspaces: [] };
  }
  const ids = mem.data.map((m) => m.workspace_id).filter(Boolean);
  if (!ids.length) return { ok: true, workspaces: [] };

  const inList = ids.map(encodeURIComponent).join(',');
  const ws = await restJson(
    'GET',
    `workspaces?id=in.(${inList})&select=id,name,slug,owner_id,kind,created_at,updated_at,archived_at&order=created_at.asc`
  );
  const byId = {};
  (Array.isArray(ws.data) ? ws.data : []).forEach((w) => {
    byId[w.id] = w;
  });
  const workspaces = mem.data
    .map((m) => {
      const w = byId[m.workspace_id];
      if (!w) return null;
      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        owner_id: w.owner_id,
        kind: w.kind,
        role: m.role,
        created_at: w.created_at,
        updated_at: w.updated_at,
        archived_at: w.archived_at,
        storage: w.kind === 'personal' ? 'user_data' : 'workspace_data'
      };
    })
    .filter(Boolean);

  return { ok: true, workspaces };
}

export async function createSharedWorkspace(userId, { name, slug } = {}) {
  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config' };
  const safeName = String(name || 'Untitled Workspace').trim().slice(0, 120) || 'Untitled Workspace';
  const safeSlug =
    slug != null
      ? String(slug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 64)
      : null;

  const createWs = await fetch(`${cfg.url}/rest/v1/workspaces`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: safeName,
      slug: safeSlug || null,
      owner_id: userId,
      kind: 'shared'
    })
  });
  const wsRows = await createWs.json().catch(() => null);
  if (!createWs.ok || !Array.isArray(wsRows) || !wsRows[0]) {
    return { ok: false, status: 500, error: 'create_failed', detail: wsRows };
  }
  const workspace = wsRows[0];

  const mem = await fetch(`${cfg.url}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner'
    })
  });
  if (!mem.ok) {
    await fetch(`${cfg.url}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspace.id)}`, {
      method: 'DELETE',
      headers: cfg.headers
    });
    return { ok: false, status: 500, error: 'member_create_failed' };
  }

  const doc = await fetch(`${cfg.url}/rest/v1/workspace_data`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: workspace.id,
      document: EMPTY_WORKSPACE_DOCUMENT,
      updated_by: userId,
      revision: 1
    })
  });
  if (!doc.ok) {
    await fetch(`${cfg.url}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspace.id)}`, {
      method: 'DELETE',
      headers: cfg.headers
    });
    return { ok: false, status: 500, error: 'document_create_failed' };
  }

  return {
    ok: true,
    workspace: {
      ...workspace,
      role: 'owner',
      storage: 'workspace_data'
    }
  };
}

export async function patchWorkspace(userId, workspaceId, patch) {
  const m = await assertWorkspaceRole(userId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal' && patch && patch.kind) {
    return { ok: false, status: 400, error: 'cannot_change_personal_kind' };
  }

  const updates = { updated_at: new Date().toISOString() };
  if (patch.name != null) updates.name = String(patch.name).trim().slice(0, 120);
  if (patch.slug != null) {
    updates.slug =
      String(patch.slug)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 64) || null;
  }
  if (patch.archived === true) updates.archived_at = new Date().toISOString();
  if (patch.archived === false) updates.archived_at = null;

  const cfg = restBase();
  const r = await fetch(
    `${cfg.url}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify(updates)
    }
  );
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) {
    return { ok: false, status: 500, error: 'patch_failed' };
  }
  return { ok: true, workspace: rows[0] };
}

export async function listMembers(userId, workspaceId) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  const rows = await restJson(
    'GET',
    `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=user_id,role,invited_by,created_at,updated_at&order=created_at.asc`
  );
  if (!rows.ok) return { ok: false, status: 500, error: 'list_members_failed' };
  return { ok: true, members: Array.isArray(rows.data) ? rows.data : [] };
}

export async function addMember(userId, workspaceId, { targetUserId, role }) {
  const m = await assertWorkspaceRole(userId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  if (!targetUserId || typeof targetUserId !== 'string') {
    return { ok: false, status: 400, error: 'user_id_required' };
  }
  if (!INVITE_ROLES.includes(role)) {
    return { ok: false, status: 400, error: 'invalid_role' };
  }

  const cfg = restBase();
  const r = await fetch(`${cfg.url}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      ...cfg.headers,
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      user_id: targetUserId,
      role,
      invited_by: userId,
      updated_at: new Date().toISOString()
    })
  });
  const rows = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, status: 500, error: 'add_member_failed', detail: rows };
  }
  return { ok: true, member: Array.isArray(rows) ? rows[0] : rows };
}

export async function updateMemberRole(actorId, workspaceId, targetUserId, role) {
  const m = await assertWorkspaceRole(actorId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  if (!INVITE_ROLES.includes(role)) {
    return { ok: false, status: 400, error: 'invalid_role' };
  }
  if (targetUserId === m.workspace.owner_id) {
    return { ok: false, status: 400, error: 'cannot_demote_owner' };
  }

  const cfg = restBase();
  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(targetUserId)}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify({ role, updated_at: new Date().toISOString() })
    }
  );
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) {
    return { ok: false, status: 404, error: 'member_not_found' };
  }
  return { ok: true, member: rows[0] };
}

export async function removeMember(actorId, workspaceId, targetUserId) {
  const m = await assertWorkspaceRole(actorId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  if (targetUserId === m.workspace.owner_id || targetUserId === actorId) {
    return {
      ok: false,
      status: 400,
      error: 'cannot_remove_owner',
      message: 'Ownership transfer is required before removing the owner.'
    };
  }

  const cfg = restBase();
  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE', headers: cfg.headers }
  );
  if (!r.ok) return { ok: false, status: 500, error: 'remove_failed' };
  return { ok: true };
}

export async function createInvite(actorId, workspaceId, { email, role, expiresInHours }) {
  const m = await assertWorkspaceRole(actorId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  const norm = normalizeEmail(email);
  if (!norm || norm.indexOf('@') < 1) {
    return { ok: false, status: 400, error: 'invalid_email' };
  }
  if (!INVITE_ROLES.includes(role)) {
    return { ok: false, status: 400, error: 'invalid_role' };
  }
  const hours = Math.min(168, Math.max(1, Number(expiresInHours) || 72));
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const cfg = restBase();
  const r = await fetch(`${cfg.url}/rest/v1/workspace_invites`, {
    method: 'POST',
    headers: { ...cfg.headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      email: norm,
      role,
      token_hash: tokenHash,
      invited_by: actorId,
      expires_at: expiresAt
    })
  });
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) {
    return { ok: false, status: 500, error: 'invite_failed', detail: rows };
  }
  const invite = rows[0];
  return {
    ok: true,
    invite: {
      id: invite.id,
      workspace_id: invite.workspace_id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      created_at: invite.created_at
    },
    token
  };
}

export async function acceptInvite(user, rawToken) {
  if (!user || !user.id) return { ok: false, status: 401, error: 'auth_required' };
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
    return { ok: false, status: 400, error: 'invalid_token' };
  }
  const tokenHash = hashInviteToken(rawToken);
  const found = await restJson(
    'GET',
    `workspace_invites?token_hash=eq.${encodeURIComponent(tokenHash)}&select=*&limit=1`
  );
  const invite = Array.isArray(found.data) ? found.data[0] : null;
  if (!invite) return { ok: false, status: 404, error: 'invite_not_found' };
  if (invite.revoked_at) return { ok: false, status: 410, error: 'invite_revoked' };
  if (invite.accepted_at) return { ok: false, status: 409, error: 'invite_already_accepted' };
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: 'invite_expired' };
  }

  const ws = await restJson(
    'GET',
    `workspaces?id=eq.${encodeURIComponent(invite.workspace_id)}&select=id,kind,name,owner_id&limit=1`
  );
  const workspace = Array.isArray(ws.data) ? ws.data[0] : null;
  if (!workspace || workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'invalid_workspace' };
  }

  if (user.email) {
    const userEmail = normalizeEmail(user.email);
    if (userEmail && invite.email && userEmail !== normalizeEmail(invite.email)) {
      return { ok: false, status: 403, error: 'email_mismatch' };
    }
  } else if (invite.email) {
    /* Invite is email-bound — require authenticated email to accept */
    return { ok: false, status: 403, error: 'email_required' };
  }

  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config' };

  /* Duplicate membership: safe no-op (do not escalate role via re-accept) */
  const existingMem = await getWorkspaceMembership(user.id, invite.workspace_id);
  if (existingMem.ok) {
    await fetch(`${cfg.url}/rest/v1/workspace_invites?id=eq.${encodeURIComponent(invite.id)}`, {
      method: 'PATCH',
      headers: cfg.headers,
      body: JSON.stringify({ accepted_at: new Date().toISOString() })
    }).catch(function () {});
    return {
      ok: true,
      workspace_id: invite.workspace_id,
      role: existingMem.role,
      workspace,
      already_member: true
    };
  }

  const mem = await fetch(`${cfg.url}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      ...cfg.headers,
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
      updated_at: new Date().toISOString()
    })
  });
  if (!mem.ok) {
    return { ok: false, status: 500, error: 'accept_member_failed' };
  }

  await fetch(`${cfg.url}/rest/v1/workspace_invites?id=eq.${encodeURIComponent(invite.id)}`, {
    method: 'PATCH',
    headers: cfg.headers,
    body: JSON.stringify({ accepted_at: new Date().toISOString() })
  });

  return {
    ok: true,
    workspace_id: invite.workspace_id,
    role: invite.role,
    workspace
  };
}

export async function revokeInvite(actorId, workspaceId, inviteId) {
  const m = await assertWorkspaceRole(actorId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  if (!isUuid(inviteId)) {
    return { ok: false, status: 400, error: 'invalid_invite_id' };
  }
  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config' };

  const found = await restJson(
    'GET',
    `workspace_invites?id=eq.${encodeURIComponent(inviteId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,accepted_at,revoked_at&limit=1`
  );
  const invite = Array.isArray(found.data) ? found.data[0] : null;
  if (!invite) return { ok: false, status: 404, error: 'invite_not_found' };
  if (invite.accepted_at) {
    return { ok: false, status: 409, error: 'invite_already_accepted' };
  }
  if (invite.revoked_at) {
    return { ok: true, already_revoked: true };
  }

  const r = await fetch(
    `${cfg.url}/rest/v1/workspace_invites?id=eq.${encodeURIComponent(inviteId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() })
    }
  );
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) {
    return { ok: false, status: 500, error: 'revoke_failed' };
  }
  return {
    ok: true,
    invite: {
      id: rows[0].id,
      workspace_id: rows[0].workspace_id,
      email: rows[0].email,
      role: rows[0].role,
      revoked_at: rows[0].revoked_at,
      expires_at: rows[0].expires_at
    }
  };
}

export async function loadWorkspaceDocument(userId, workspaceId) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return {
      ok: false,
      status: 400,
      error: 'personal_uses_user_data',
      message: 'Personal Studio is loaded via /api/sync, not workspace-sync.'
    };
  }

  const row = await restJson(
    'GET',
    `workspace_data?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=workspace_id,document,revision,updated_at,updated_by&limit=1`
  );
  const data = Array.isArray(row.data) ? row.data[0] : null;
  if (!data) {
    return { ok: false, status: 404, error: 'document_not_found' };
  }
  return {
    ok: true,
    workspace: m.workspace,
    role: m.role,
    canEdit: m.canEdit,
    document: data.document,
    revision: Number(data.revision) || 1,
    updated_at: data.updated_at,
    updated_by: data.updated_by
  };
}

/**
 * Optimistic concurrency save.
 * Accepts only when clientRevision === current revision; then increments.
 */
export async function saveWorkspaceDocument(userId, workspaceId, document, clientRevision) {
  const m = await assertWorkspaceRole(userId, workspaceId, EDIT_ROLES);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return {
      ok: false,
      status: 400,
      error: 'personal_uses_user_data',
      message: 'Personal Studio is saved via /api/sync, not workspace-sync.'
    };
  }
  if (m.workspace.archived_at) {
    return {
      ok: false,
      status: 403,
      error: 'workspace_archived',
      message: 'This workspace is archived. Unarchive it before editing.'
    };
  }

  const valid = validateStudioDocument(document);
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };

  const rev = Number(clientRevision);
  if (!Number.isFinite(rev) || rev < 1) {
    return { ok: false, status: 400, error: 'revision_required' };
  }

  const current = await restJson(
    'GET',
    `workspace_data?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=workspace_id,document,revision,updated_at,updated_by&limit=1`
  );
  const row = Array.isArray(current.data) ? current.data[0] : null;
  if (!row) return { ok: false, status: 404, error: 'document_not_found' };

  const dbRev = Number(row.revision) || 1;
  if (rev !== dbRev) {
    return {
      ok: false,
      status: 409,
      error: 'revision_conflict',
      revision: dbRev,
      document: row.document,
      updated_at: row.updated_at,
      updated_by: row.updated_by
    };
  }

  const nextRev = dbRev + 1;
  const cfg = restBase();
  const patch = await fetch(
    `${cfg.url}/rest/v1/workspace_data?workspace_id=eq.${encodeURIComponent(workspaceId)}&revision=eq.${dbRev}`,
    {
      method: 'PATCH',
      headers: { ...cfg.headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        document,
        revision: nextRev,
        updated_at: new Date().toISOString(),
        updated_by: userId
      })
    }
  );
  const patched = await patch.json().catch(() => null);
  if (!patch.ok || !Array.isArray(patched) || !patched[0]) {
    const again = await restJson(
      'GET',
      `workspace_data?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=workspace_id,document,revision,updated_at,updated_by&limit=1`
    );
    const latest = Array.isArray(again.data) ? again.data[0] : row;
    return {
      ok: false,
      status: 409,
      error: 'revision_conflict',
      revision: Number(latest.revision) || dbRev,
      document: latest.document,
      updated_at: latest.updated_at,
      updated_by: latest.updated_by
    };
  }

  await fetch(`${cfg.url}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}`, {
    method: 'PATCH',
    headers: cfg.headers,
    body: JSON.stringify({ updated_at: new Date().toISOString() })
  });

  return {
    ok: true,
    revision: nextRev,
    document: patched[0].document,
    updated_at: patched[0].updated_at,
    updated_by: patched[0].updated_by
  };
}

/** Storage path authorization for uploads */
export async function assertStoragePathAccess(userId, path, { needEdit } = {}) {
  const p = String(path || '');
  if (!userId || !p) return { ok: false, status: 403, error: 'forbidden_path' };
  if (p.indexOf(userId + '/') === 0) return { ok: true, scope: 'personal' };

  const m = p.match(
    /^workspaces\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\//i
  );
  if (!m) return { ok: false, status: 403, error: 'forbidden_path' };
  const workspaceId = m[1];
  if (needEdit) {
    return assertWorkspaceRole(userId, workspaceId, EDIT_ROLES);
  }
  return assertWorkspaceMember(userId, workspaceId);
}

export function detectDirectorMutationIntent(body, contextStr, messages) {
  if (body && (body.intent_mutates === true || body.mutates === true)) return true;
  const ctx = String(contextStr || '');
  if (/\bMODE:\s*Script mutation/i.test(ctx)) return true;
  if (/\[\[SCRIPT:/i.test(ctx) || /\[\[ACTION:/i.test(ctx)) return true;
  const joined = (Array.isArray(messages) ? messages : [])
    .map((msg) =>
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
    )
    .join('\n');
  if (/\[\[SCRIPT:/i.test(joined) || /\[\[ACTION:/i.test(joined)) return true;
  if (/\bEmit \[\[SCRIPT/i.test(joined)) return true;
  return false;
}

export { restJson, restBase, MAX_DOCUMENT_JSON };
