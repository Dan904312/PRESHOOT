/**
 * Collaborative Workspaces — Phase 1–5A server helpers.
 * Personal Studio stays in user_data; shared docs in workspace_data.
 * All workspace APIs must use these checks (service role bypasses RLS).
 */
import crypto from 'crypto';
import { serviceHeaders } from './security.js';
import {
  detectDocumentChanges,
  primaryChange,
  reconcileClientChangeHint,
  changeActivityLabel,
  changeTypeLabel,
  normalizeChange
} from './workspace-changes.js';
export const WORKSPACE_ROLES = ['owner', 'editor', 'commenter', 'viewer'];
export const EDIT_ROLES = ['owner', 'editor'];
export const INVITE_ROLES = ['editor', 'commenter', 'viewer'];

export const EMPTY_WORKSPACE_DOCUMENT = {
  version: 3,
  projects: [],
  continueProductionId: null,
  updatedAt: 0,
  deletedProjects: {},
  deletedProductions: {}
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

async function restJson(method, path, body, opts = {}) {
  const cfg = restBase();
  if (!cfg) return { ok: false, status: 500, error: 'no_config', data: null };
  const headers = { ...cfg.headers };
  if (opts.prefer) headers.Prefer = opts.prefer;
  const request = { method, headers };
  if (body !== undefined) request.body = JSON.stringify(body);
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, request);
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

function postgrestMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string' && data.trim()) return data.slice(0, 240);
  if (typeof data === 'object') {
    const msg = data.message || data.error_description || data.error || data.hint;
    if (typeof msg === 'string' && msg.trim()) return msg.slice(0, 240);
    if (data.code) return String(fallback || 'database_error') + ' (' + data.code + ')';
  }
  return fallback;
}

function representationRow(data) {
  if (Array.isArray(data) && data[0]) return data[0];
  if (data && typeof data === 'object' && data.id) return data;
  return null;
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
  if (!cfg) {
    return {
      ok: false,
      status: 500,
      error: 'no_config',
      message: 'Server database is not configured'
    };
  }
  if (!userId) {
    return { ok: false, status: 401, error: 'auth_required', message: 'Sign in to create a workspace' };
  }

  const safeName = String(name || 'Untitled Workspace').trim().slice(0, 120) || 'Untitled Workspace';
  const safeSlug =
    slug != null && String(slug).trim()
      ? String(slug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 64)
      : null;

  /* Omit null slug — some DBs reject explicit nulls / unique-null quirks */
  const payload = {
    name: safeName,
    owner_id: userId,
    kind: 'shared'
  };
  if (safeSlug) payload.slug = safeSlug;

  /*
   * Prefer representation, but do not hard-fail if PostgREST returns 201 without a body
   * (missing SELECT privilege on return=representation). Fall back like ensurePersonalWorkspace.
   */
  const createWs = await restJson('POST', 'workspaces', payload, {
    prefer: 'return=representation'
  });
  let workspace = createWs.ok ? representationRow(createWs.data) : null;

  if (!createWs.ok) {
    return {
      ok: false,
      status: createWs.status >= 400 ? createWs.status : 500,
      error: 'create_failed',
      message: postgrestMessage(
        createWs.data,
        'Could not create workspace. Check that Phase 1 SQL was applied.'
      ),
      detail: createWs.data
    };
  }

  if (!workspace || !workspace.id) {
    /* Fallback: latest shared workspaces for owner, match name in-process */
    const again = await restJson(
      'GET',
      `workspaces?owner_id=eq.${encodeURIComponent(userId)}&kind=eq.shared&select=id,name,slug,owner_id,kind,created_at,updated_at,archived_at&order=created_at.desc&limit=5`
    );
    const rows = Array.isArray(again.data) ? again.data : [];
    workspace =
      rows.find((w) => w && w.name === safeName) ||
      rows[0] ||
      null;
  }

  if (!workspace || !workspace.id) {
    return {
      ok: false,
      status: 500,
      error: 'create_failed',
      message: 'Workspace insert did not return an id'
    };
  }

  /* Match personal ensure: minimal return + ignore duplicates (trigger-safe) */
  const mem = await restJson(
    'POST',
    'workspace_members',
    {
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner'
    },
    { prefer: 'resolution=ignore-duplicates,return=minimal' }
  );
  if (!mem.ok) {
    await restJson('DELETE', `workspaces?id=eq.${encodeURIComponent(workspace.id)}`);
    return {
      ok: false,
      status: mem.status >= 400 ? mem.status : 500,
      error: 'member_create_failed',
      message: postgrestMessage(mem.data, 'Could not add you as workspace owner'),
      detail: mem.data
    };
  }

  const doc = await restJson(
    'POST',
    'workspace_data',
    {
      workspace_id: workspace.id,
      document: EMPTY_WORKSPACE_DOCUMENT,
      updated_by: userId,
      revision: 1
    },
    { prefer: 'return=minimal' }
  );
  if (!doc.ok) {
    await restJson('DELETE', `workspaces?id=eq.${encodeURIComponent(workspace.id)}`);
    return {
      ok: false,
      status: doc.status >= 400 ? doc.status : 500,
      error: 'document_create_failed',
      message: postgrestMessage(
        doc.data,
        'Could not create workspace Studio document (workspace_data)'
      ),
      detail: doc.data
    };
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

async function lookupAuthProfile(userId) {
  const cfg = restBase();
  if (!cfg || !userId) return null;
  try {
    const r = await fetch(`${cfg.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: cfg.headers
    });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u) return null;
    const meta = u.user_metadata || {};
    return {
      email: u.email || null,
      name: meta.full_name || meta.name || null,
      avatar: meta.avatar_url || null
    };
  } catch (e) {
    return null;
  }
}

export async function listMembers(userId, workspaceId) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  const rows = await restJson(
    'GET',
    `workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=user_id,role,invited_by,created_at,updated_at&order=created_at.asc`
  );
  if (!rows.ok) return { ok: false, status: 500, error: 'list_members_failed' };
  const members = Array.isArray(rows.data) ? rows.data : [];
  const enriched = [];
  for (let i = 0; i < members.length; i++) {
    const row = members[i];
    const profile = await lookupAuthProfile(row.user_id);
    enriched.push({
      ...row,
      email: profile && profile.email ? profile.email : null,
      name: profile && profile.name ? profile.name : null,
      avatar: profile && profile.avatar ? profile.avatar : null,
      is_owner: row.user_id === m.workspace.owner_id || row.role === 'owner'
    });
  }
  return { ok: true, members: enriched, workspace: m.workspace, role: m.role };
}

/** Pending invites for a workspace (owner only). Never returns token_hash. */
export async function listInvites(userId, workspaceId) {
  const m = await assertWorkspaceRole(userId, workspaceId, ['owner']);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 403, error: 'personal_workspace_private' };
  }
  const rows = await restJson(
    'GET',
    `workspace_invites?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,email,role,expires_at,accepted_at,revoked_at,created_at,invited_by&order=created_at.desc`
  );
  if (!rows.ok) return { ok: false, status: 500, error: 'list_invites_failed' };
  const invites = (Array.isArray(rows.data) ? rows.data : []).map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expires_at: inv.expires_at,
    accepted_at: inv.accepted_at,
    revoked_at: inv.revoked_at,
    created_at: inv.created_at,
    invited_by: inv.invited_by,
    status: inv.accepted_at
      ? 'accepted'
      : inv.revoked_at
        ? 'revoked'
        : new Date(inv.expires_at).getTime() <= Date.now()
          ? 'expired'
          : 'pending'
  }));
  return { ok: true, invites };
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

  /* Insert only — never upsert/merge (would allow invite role to overwrite membership). */
  const mem = await fetch(`${cfg.url}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      ...cfg.headers,
      Prefer: 'return=representation'
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
    /* Concurrent accept race: membership may already exist */
    const raced = await getWorkspaceMembership(user.id, invite.workspace_id);
    if (raced.ok) {
      await fetch(`${cfg.url}/rest/v1/workspace_invites?id=eq.${encodeURIComponent(invite.id)}`, {
        method: 'PATCH',
        headers: cfg.headers,
        body: JSON.stringify({ accepted_at: new Date().toISOString() })
      }).catch(function () {});
      return {
        ok: true,
        workspace_id: invite.workspace_id,
        role: raced.role,
        workspace,
        already_member: true
      };
    }
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
export async function saveWorkspaceDocument(
  userId,
  workspaceId,
  document,
  clientRevision,
  opts
) {
  opts = opts || {};
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
    const conflictMeta = await latestVersionChangeMeta(workspaceId).catch(() => null);
    return {
      ok: false,
      status: 409,
      error: 'revision_conflict',
      revision: dbRev,
      client_revision: rev,
      document: row.document,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
      change: conflictMeta
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
    const conflictMeta = await latestVersionChangeMeta(workspaceId).catch(() => null);
    return {
      ok: false,
      status: 409,
      error: 'revision_conflict',
      revision: Number(latest.revision) || dbRev,
      client_revision: rev,
      document: latest.document,
      updated_at: latest.updated_at,
      updated_by: latest.updated_by,
      change: conflictMeta
    };
  }

  await fetch(`${cfg.url}/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}`, {
    method: 'PATCH',
    headers: cfg.headers,
    body: JSON.stringify({ updated_at: new Date().toISOString() })
  });

  const versionReason = opts.versionReason === 'restore' ? 'restore' : 'save';
  const detected = detectDocumentChanges(row.document, document, { reason: versionReason });
  const change = reconcileClientChangeHint(opts.changeHint, row.document, document, detected);
  const changes = detected.slice(0, 12).map(normalizeChange);

  const result = {
    ok: true,
    revision: nextRev,
    document: patched[0].document,
    updated_at: patched[0].updated_at,
    updated_by: patched[0].updated_by,
    change,
    changes,
    activity_label: changeActivityLabel(change)
  };

  /* Await snapshot so restore can rely on the row existing; never on 409/fail */
  try {
    await snapshotWorkspaceVersion({
      workspaceId,
      revision: nextRev,
      document,
      userId,
      reason: versionReason,
      change,
      changes
    });
  } catch (e) {
    /* Document save already succeeded — do not fail the request for snapshot errors */
  }
  pruneWorkspaceVersions(workspaceId, VERSION_RETENTION).catch(function () {});

  /* Fire-and-forget: realtime is a notification layer, not source of truth */
  broadcastWorkspaceUpdated({
    workspaceId,
    revision: nextRev,
    updatedBy: userId,
    updatedAt: patched[0].updated_at,
    change,
    changes
  }).catch(function () {});

  return result;
}

/** Retain latest N successful shared-save snapshots per workspace. */
export const VERSION_RETENTION = 12;

export async function snapshotWorkspaceVersion({
  workspaceId,
  revision,
  document,
  userId,
  reason,
  change,
  changes
}) {
  if (!isUuid(workspaceId)) return { ok: false, error: 'invalid_workspace_id' };
  const rev = Number(revision);
  if (!Number.isFinite(rev) || rev < 1) return { ok: false, error: 'invalid_revision' };
  const valid = validateStudioDocument(document);
  if (!valid.ok) return { ok: false, error: valid.error };
  const cfg = restBase();
  if (!cfg) return { ok: false, error: 'no_config' };

  const primary =
    change && change.type
      ? normalizeChange(change)
      : primaryChange(changes || [{ type: reason === 'restore' ? 'workspace.restored' : 'workspace.updated' }]);
  const changeList = Array.isArray(changes) ? changes.slice(0, 12).map(normalizeChange) : [primary];

  const r = await fetch(`${cfg.url}/rest/v1/workspace_document_versions`, {
    method: 'POST',
    headers: {
      ...cfg.headers,
      Prefer: 'return=representation,resolution=ignore-duplicates'
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      revision: rev,
      document,
      created_by: userId || null,
      reason: reason === 'restore' ? 'restore' : 'save',
      change_type: primary.type,
      entity_id: primary.entityId,
      entity_label: primary.entityLabel,
      project_id: primary.projectId,
      production_id: primary.productionId,
      changes: changeList
    })
  });
  if (!r.ok) {
    /* Fallback without Phase 5A columns if migration not applied yet */
    const legacy = await fetch(`${cfg.url}/rest/v1/workspace_document_versions`, {
      method: 'POST',
      headers: {
        ...cfg.headers,
        Prefer: 'return=representation,resolution=ignore-duplicates'
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        revision: rev,
        document,
        created_by: userId || null,
        reason: reason === 'restore' ? 'restore' : 'save'
      })
    });
    if (!legacy.ok) {
      const detail = await legacy.text().catch(() => '');
      return { ok: false, error: 'snapshot_failed', detail: detail.slice(0, 200) };
    }
  }
  return { ok: true, change: primary };
}

async function latestVersionChangeMeta(workspaceId) {
  if (!isUuid(workspaceId)) return null;
  const rows = await restJson(
    'GET',
    `workspace_document_versions?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=revision,change_type,entity_id,entity_label,project_id,production_id,created_by,created_at,changes&order=revision.desc&limit=1`
  );
  const row = Array.isArray(rows.data) ? rows.data[0] : null;
  if (!row) return null;
  let name = null;
  if (row.created_by) {
    const profile = await lookupAuthProfile(row.created_by);
    if (profile) name = profile.name || null;
  }
  const change = normalizeChange({
    type: row.change_type || 'workspace.updated',
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    projectId: row.project_id,
    productionId: row.production_id
  });
  return {
    ...change,
    revision: Number(row.revision) || null,
    updated_by: row.created_by || null,
    updated_at: row.created_at || null,
    name,
    activity_label: changeActivityLabel(change),
    type_label: changeTypeLabel(change.type)
  };
}

export async function pruneWorkspaceVersions(workspaceId, retainN) {
  if (!isUuid(workspaceId)) return { ok: false, error: 'invalid_workspace_id' };
  const keep = Math.max(1, Number(retainN) || VERSION_RETENTION);
  const cfg = restBase();
  if (!cfg) return { ok: false, error: 'no_config' };

  const listed = await restJson(
    'GET',
    `workspace_document_versions?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,revision&order=revision.desc`
  );
  const rows = Array.isArray(listed.data) ? listed.data : [];
  if (rows.length <= keep) return { ok: true, pruned: 0 };

  const drop = rows.slice(keep);
  let pruned = 0;
  for (let i = 0; i < drop.length; i++) {
    const id = drop[i].id;
    const del = await fetch(
      `${cfg.url}/rest/v1/workspace_document_versions?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: cfg.headers }
    );
    if (del.ok) pruned += 1;
  }
  return { ok: true, pruned };
}

/** Members can list version metadata (no full document). */
export async function listWorkspaceVersions(userId, workspaceId, { limit } = {}) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 400, error: 'personal_uses_user_data' };
  }
  const lim = Math.min(50, Math.max(1, Number(limit) || VERSION_RETENTION));
  const rows = await restJson(
    'GET',
    `workspace_document_versions?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,workspace_id,revision,created_by,created_at,reason,change_type,entity_id,entity_label,project_id,production_id,changes&order=revision.desc&limit=${lim}`
  );
  if (!rows.ok) {
    /* Pre-migration fallback */
    const legacy = await restJson(
      'GET',
      `workspace_document_versions?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,workspace_id,revision,created_by,created_at,reason&order=revision.desc&limit=${lim}`
    );
    if (!legacy.ok) return { ok: false, status: 500, error: 'list_versions_failed' };
    rows.ok = true;
    rows.data = legacy.data;
  }
  if (!rows.ok) return { ok: false, status: 500, error: 'list_versions_failed' };
  const versions = Array.isArray(rows.data) ? rows.data : [];

  const enriched = [];
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    let name = null;
    let email = null;
    if (v.created_by) {
      const profile = await lookupAuthProfile(v.created_by);
      if (profile) {
        name = profile.name || null;
        email = profile.email || null;
      }
    }
    const change = normalizeChange({
      type: v.change_type || (v.reason === 'restore' ? 'workspace.restored' : 'workspace.updated'),
      entityId: v.entity_id,
      entityLabel: v.entity_label,
      projectId: v.project_id,
      productionId: v.production_id
    });
    enriched.push({
      id: v.id,
      workspace_id: v.workspace_id,
      revision: Number(v.revision),
      created_by: v.created_by,
      created_at: v.created_at,
      reason: v.reason || 'save',
      change,
      changes: Array.isArray(v.changes) ? v.changes : [change],
      change_type: change.type,
      entity_label: change.entityLabel,
      activity_label: changeActivityLabel(change),
      type_label: changeTypeLabel(change.type),
      name,
      email
    });
  }
  return {
    ok: true,
    versions: enriched,
    retention: VERSION_RETENTION,
    role: m.role,
    canRestore: roleCanEdit(m.role)
  };
}

/** Members can view a full snapshot (does not mutate active document). */
export async function getWorkspaceVersion(userId, workspaceId, versionId) {
  const m = await assertWorkspaceMember(userId, workspaceId);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 400, error: 'personal_uses_user_data' };
  }
  if (!isUuid(versionId)) return { ok: false, status: 400, error: 'invalid_version_id' };

  const found = await restJson(
    'GET',
    `workspace_document_versions?id=eq.${encodeURIComponent(versionId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,workspace_id,revision,document,created_by,created_at,reason,change_type,entity_id,entity_label,project_id,production_id,changes&limit=1`
  );
  const row = Array.isArray(found.data) ? found.data[0] : null;
  if (!row) {
    const legacy = await restJson(
      'GET',
      `workspace_document_versions?id=eq.${encodeURIComponent(versionId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,workspace_id,revision,document,created_by,created_at,reason&limit=1`
    );
    const leg = Array.isArray(legacy.data) ? legacy.data[0] : null;
    if (!leg) return { ok: false, status: 404, error: 'version_not_found' };
    return asyncVersionRow(leg, m);
  }

  return asyncVersionRow(row, m);
}

function asyncVersionRow(row, m) {
  return (async () => {
    let name = null;
    let email = null;
    if (row.created_by) {
      const profile = await lookupAuthProfile(row.created_by);
      if (profile) {
        name = profile.name || null;
        email = profile.email || null;
      }
    }
    const change = normalizeChange({
      type: row.change_type || (row.reason === 'restore' ? 'workspace.restored' : 'workspace.updated'),
      entityId: row.entity_id,
      entityLabel: row.entity_label,
      projectId: row.project_id,
      productionId: row.production_id
    });
    return {
      ok: true,
      version: {
        id: row.id,
        workspace_id: row.workspace_id,
        revision: Number(row.revision),
        document: row.document,
        created_by: row.created_by,
        created_at: row.created_at,
        reason: row.reason || 'save',
        change,
        changes: Array.isArray(row.changes) ? row.changes : [change],
        activity_label: changeActivityLabel(change),
        type_label: changeTypeLabel(change.type),
        name,
        email
      },
      role: m.role,
      canRestore: roleCanEdit(m.role)
    };
  })();
}

/**
 * Restore: write snapshot as a NEW revision via optimistic concurrency.
 * Never deletes intermediate history.
 */
export async function restoreWorkspaceVersion(
  userId,
  workspaceId,
  versionId,
  clientRevision
) {
  const m = await assertWorkspaceRole(userId, workspaceId, EDIT_ROLES);
  if (!m.ok) return m;
  if (m.workspace.kind === 'personal') {
    return { ok: false, status: 400, error: 'personal_uses_user_data' };
  }
  if (!isUuid(versionId)) return { ok: false, status: 400, error: 'invalid_version_id' };

  const found = await restJson(
    'GET',
    `workspace_document_versions?id=eq.${encodeURIComponent(versionId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,revision,document&limit=1`
  );
  const snap = Array.isArray(found.data) ? found.data[0] : null;
  if (!snap) return { ok: false, status: 404, error: 'version_not_found' };

  /* Reuse save path: optimistic concurrency, snapshot, broadcast. New revision only. */
  const saved = await saveWorkspaceDocument(
    userId,
    workspaceId,
    snap.document,
    clientRevision,
    {
      versionReason: 'restore',
      changeHint: {
        type: 'workspace.restored',
        entityLabel: 'Revision ' + snap.revision
      }
    }
  );
  if (!saved.ok) return saved;

  return {
    ok: true,
    revision: saved.revision,
    document: saved.document,
    updated_at: saved.updated_at,
    updated_by: saved.updated_by,
    change: saved.change || null,
    restored_from_revision: Number(snap.revision),
    restored_from_version_id: snap.id
  };
}

/**
 * Structured document compare for conflict UI — not a merge engine.
 * Summarizes project/production/shot deltas between local draft and server.
 */
export function summarizeDocumentDiff(localDoc, serverDoc) {
  const local = localDoc && typeof localDoc === 'object' ? localDoc : { projects: [] };
  const server = serverDoc && typeof serverDoc === 'object' ? serverDoc : { projects: [] };
  const lp = Array.isArray(local.projects) ? local.projects : [];
  const sp = Array.isArray(server.projects) ? server.projects : [];
  const lMap = new Map(lp.filter((p) => p && p.id).map((p) => [p.id, p]));
  const sMap = new Map(sp.filter((p) => p && p.id).map((p) => [p.id, p]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, p] of lMap) {
    if (!sMap.has(id)) added.push({ type: 'project', id, name: p.name || 'Untitled' });
  }
  for (const [id, p] of sMap) {
    if (!lMap.has(id)) removed.push({ type: 'project', id, name: p.name || 'Untitled' });
  }
  for (const [id, lpj] of lMap) {
    const spj = sMap.get(id);
    if (!spj) continue;
    const lProds = Array.isArray(lpj.productions) ? lpj.productions : [];
    const sProds = Array.isArray(spj.productions) ? spj.productions : [];
    const lPm = new Map(lProds.filter((x) => x && x.id).map((x) => [x.id, x]));
    const sPm = new Map(sProds.filter((x) => x && x.id).map((x) => [x.id, x]));
    let projectTouched = String(lpj.name || '') !== String(spj.name || '');
    for (const [pid, prod] of lPm) {
      if (!sPm.has(pid)) {
        added.push({
          type: 'production',
          id: pid,
          name: prod.name || 'Untitled',
          project: lpj.name || 'Project'
        });
        projectTouched = true;
      } else {
        const sprod = sPm.get(pid);
        const lShots = Array.isArray(prod.shots) ? prod.shots.length : 0;
        const sShots = Array.isArray(sprod.shots) ? sprod.shots.length : 0;
        const scriptChanged =
          String((prod.script && prod.script.body) || prod.script || '') !==
          String((sprod.script && sprod.script.body) || sprod.script || '');
        if (lShots !== sShots || scriptChanged || String(prod.name || '') !== String(sprod.name || '')) {
          changed.push({
            type: 'production',
            id: pid,
            name: prod.name || sprod.name || 'Untitled',
            detail:
              (scriptChanged ? 'script' : '') +
              (lShots !== sShots ? (scriptChanged ? ', shots' : 'shots') : '')
          });
          projectTouched = true;
        }
      }
    }
    for (const [pid, prod] of sPm) {
      if (!lPm.has(pid)) {
        removed.push({
          type: 'production',
          id: pid,
          name: prod.name || 'Untitled',
          project: spj.name || 'Project'
        });
        projectTouched = true;
      }
    }
    if (projectTouched && String(lpj.name || '') !== String(spj.name || '')) {
      changed.push({ type: 'project', id, name: lpj.name || spj.name || 'Untitled', detail: 'name' });
    }
  }

  return {
    localProjects: lp.length,
    serverProjects: sp.length,
    added,
    removed,
    changed,
    summary:
      added.length || removed.length || changed.length
        ? `${added.length} added · ${removed.length} removed · ${changed.length} changed`
        : 'Same project/production structure (deeper field diffs may still exist)'
  };
}

/**
 * Private Broadcast notification after authoritative save.
 * Payload is metadata-only — never the Studio document.
 */
export function workspaceRealtimeTopic(workspaceId) {
  return 'workspace:' + String(workspaceId || '');
}

export async function broadcastWorkspaceUpdated({
  workspaceId,
  revision,
  updatedBy,
  updatedAt,
  change,
  changes
}) {
  if (!isUuid(workspaceId)) return { ok: false, error: 'invalid_workspace_id' };
  const cfg = restBase();
  if (!cfg) return { ok: false, error: 'no_config' };

  const primary = change && change.type ? normalizeChange(change) : null;
  const payload = {
    type: 'workspace.updated',
    workspace_id: workspaceId,
    revision: Number(revision) || null,
    updated_by: updatedBy || null,
    updated_at: updatedAt || new Date().toISOString(),
    /* Phase 5A metadata — never the document */
    change: primary,
    change_type: primary ? primary.type : null,
    entity_id: primary ? primary.entityId : null,
    entity_label: primary ? primary.entityLabel : null,
    project_id: primary ? primary.projectId : null,
    production_id: primary ? primary.productionId : null,
    activity_label: primary ? changeActivityLabel(primary) : null,
    changes: Array.isArray(changes) ? changes.slice(0, 8).map(normalizeChange) : undefined
  };

  try {
    const r = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        ...cfg.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            topic: workspaceRealtimeTopic(workspaceId),
            event: 'workspace.updated',
            payload,
            private: true
          }
        ]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, error: 'broadcast_failed', status: r.status, detail: detail.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'broadcast_network', message: String(e && e.message) };
  }
}

/** Reject path traversal / absolute / empty segments before ACL match. */
export function isSafeStorageObjectPath(path) {
  const p = String(path || '');
  if (!p || p.length > 240) return false;
  if (p[0] === '/' || p.indexOf('\\') >= 0) return false;
  if (p.indexOf('..') >= 0) return false;
  if (p.indexOf('//') >= 0) return false;
  if (/\s/.test(p)) return false;
  return true;
}

/** Storage path authorization for uploads */
export async function assertStoragePathAccess(userId, path, { needEdit } = {}) {
  const p = String(path || '');
  if (!userId || !isSafeStorageObjectPath(p)) {
    return { ok: false, status: 403, error: 'forbidden_path' };
  }
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
  /* Imperative mutate asks only — do not flag advice like "how should I rewrite the script" */
  if (
    /\b(please\s+)?(rename|delete|archive|move|rebuild)\b[\s\S]{0,40}\b(project|production|script|shot|asset|reference)\b/i.test(
      joined
    ) ||
    /\b(add|remove)\s+(a\s+)?(new\s+)?shot\b/i.test(joined) ||
    /\bcreate\s+(a\s+)?(new\s+)?(project|production)\b/i.test(joined) ||
    /\b(change|set)\s+(the\s+)?(production\s+)?status\b/i.test(joined) ||
    /\bupdate\s+(the\s+)?(script|shot\s*list|production name|project name)\b/i.test(joined)
  ) {
    return true;
  }
  return false;
}

export { restJson, restBase, MAX_DOCUMENT_JSON };
