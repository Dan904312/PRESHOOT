/**
 * Phase 1 Collaborative Workspaces — security & regression test matrix.
 * Run: node tests/workspaces-phase1.test.mjs
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const WS_PERSONAL = '33333333-3333-4333-8333-333333333333';
const USER_OWNER = 'user-owner';
const USER_EDITOR = 'user-editor';
const USER_VIEWER = 'user-viewer';
const USER_STRANGER = 'user-stranger';
const USER_COMMENTER = 'user-commenter';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => {
          passed += 1;
          console.log('  ✓', name);
        })
        .catch((e) => {
          failed += 1;
          console.error('  ✗', name, '\n   ', e.message);
        });
    }
    passed += 1;
    console.log('  ✓', name);
    return Promise.resolve();
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
    return Promise.resolve();
  }
}

const db = {
  workspaces: {
    [WS_A]: {
      id: WS_A,
      name: 'Teach Flip',
      owner_id: USER_OWNER,
      kind: 'shared',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      archived_at: null,
      slug: null
    },
    [WS_B]: {
      id: WS_B,
      name: 'Other Team',
      owner_id: USER_STRANGER,
      kind: 'shared',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      archived_at: null,
      slug: null
    },
    [WS_PERSONAL]: {
      id: WS_PERSONAL,
      name: 'Personal',
      owner_id: USER_OWNER,
      kind: 'personal',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      archived_at: null,
      slug: null
    }
  },
  members: {
    [`${WS_A}:${USER_OWNER}`]: { workspace_id: WS_A, user_id: USER_OWNER, role: 'owner' },
    [`${WS_A}:${USER_EDITOR}`]: { workspace_id: WS_A, user_id: USER_EDITOR, role: 'editor' },
    [`${WS_A}:${USER_VIEWER}`]: { workspace_id: WS_A, user_id: USER_VIEWER, role: 'viewer' },
    [`${WS_A}:${USER_COMMENTER}`]: {
      workspace_id: WS_A,
      user_id: USER_COMMENTER,
      role: 'commenter'
    },
    [`${WS_B}:${USER_STRANGER}`]: {
      workspace_id: WS_B,
      user_id: USER_STRANGER,
      role: 'owner'
    },
    [`${WS_PERSONAL}:${USER_OWNER}`]: {
      workspace_id: WS_PERSONAL,
      user_id: USER_OWNER,
      role: 'owner'
    }
  },
  data: {
    [WS_A]: {
      workspace_id: WS_A,
      document: {
        version: 3,
        projects: [{ id: 'p1', name: 'Campaign' }],
        continueProductionId: null
      },
      revision: 10,
      updated_at: '2026-01-01',
      updated_by: USER_OWNER
    }
  },
  invites: {}
};

function parseEq(qs, key) {
  const m = qs.match(new RegExp(key + '=eq\\.([^&]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  const path = u.replace(/^https?:\/\/[^/]+\/rest\/v1\//, '');
  const table = path.split('?')[0];
  const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
  const body = opts.body ? JSON.parse(opts.body) : null;

  const ok = (data, status = 200) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => data,
      text: async () => JSON.stringify(data)
    });

  if (table.startsWith('workspace_members')) {
    if (method === 'GET') {
      const wid = parseEq(qs, 'workspace_id');
      const uid = parseEq(qs, 'user_id');
      if (wid && uid) {
        const row = db.members[`${wid}:${uid}`];
        return ok(row ? [row] : []);
      }
      if (wid) return ok(Object.values(db.members).filter((m) => m.workspace_id === wid));
      if (uid) return ok(Object.values(db.members).filter((m) => m.user_id === uid));
    }
    if (method === 'POST') {
      const key = `${body.workspace_id}:${body.user_id}`;
      db.members[key] = {
        workspace_id: body.workspace_id,
        user_id: body.user_id,
        role: body.role,
        invited_by: body.invited_by || null
      };
      return ok([db.members[key]], 201);
    }
    if (method === 'PATCH') {
      const wid = parseEq(qs, 'workspace_id');
      const uid = parseEq(qs, 'user_id');
      const key = `${wid}:${uid}`;
      if (!db.members[key]) return ok([], 404);
      Object.assign(db.members[key], body);
      return ok([db.members[key]]);
    }
    if (method === 'DELETE') {
      const wid = parseEq(qs, 'workspace_id');
      const uid = parseEq(qs, 'user_id');
      delete db.members[`${wid}:${uid}`];
      return ok(null, 204);
    }
  }

  if (table.startsWith('workspaces')) {
    if (method === 'GET') {
      const id = parseEq(qs, 'id');
      const owner = parseEq(qs, 'owner_id');
      const kind = parseEq(qs, 'kind');
      let rows = Object.values(db.workspaces);
      if (id) rows = rows.filter((w) => w.id === id);
      if (owner) rows = rows.filter((w) => w.owner_id === owner);
      if (kind) rows = rows.filter((w) => w.kind === kind);
      if (qs.includes('id=in.(')) {
        const inn = qs.match(/id=in\.\(([^)]+)\)/);
        const ids = inn ? inn[1].split(',').map(decodeURIComponent) : [];
        rows = rows.filter((w) => ids.includes(w.id));
      }
      return ok(rows);
    }
    if (method === 'POST') {
      const id = crypto.randomUUID();
      const row = {
        id,
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        slug: null,
        ...body
      };
      db.workspaces[id] = row;
      return ok([row], 201);
    }
    if (method === 'PATCH') {
      const id = parseEq(qs, 'id');
      if (!db.workspaces[id]) return ok([], 404);
      Object.assign(db.workspaces[id], body);
      return ok([db.workspaces[id]]);
    }
    if (method === 'DELETE') {
      const id = parseEq(qs, 'id');
      delete db.workspaces[id];
      delete db.data[id];
      return ok(null, 204);
    }
  }

  if (table.startsWith('workspace_data')) {
    if (method === 'GET') {
      const wid = parseEq(qs, 'workspace_id');
      return ok(db.data[wid] ? [db.data[wid]] : []);
    }
    if (method === 'POST') {
      db.data[body.workspace_id] = {
        workspace_id: body.workspace_id,
        document: body.document,
        revision: body.revision || 1,
        updated_at: new Date().toISOString(),
        updated_by: body.updated_by || null
      };
      return ok([db.data[body.workspace_id]], 201);
    }
    if (method === 'PATCH') {
      const wid = parseEq(qs, 'workspace_id');
      const revEq = parseEq(qs, 'revision');
      const row = db.data[wid];
      if (!row) return ok([], 404);
      if (revEq != null && String(row.revision) !== String(revEq)) return ok([], 200);
      Object.assign(row, body);
      return ok([row]);
    }
  }

  if (table.startsWith('workspace_invites')) {
    if (method === 'GET') {
      const hash = parseEq(qs, 'token_hash');
      const id = parseEq(qs, 'id');
      const wid = parseEq(qs, 'workspace_id');
      let rows = Object.values(db.invites);
      if (hash) rows = rows.filter((i) => i.token_hash === hash);
      if (id) rows = rows.filter((i) => i.id === id);
      if (wid) rows = rows.filter((i) => i.workspace_id === wid);
      return ok(rows);
    }
    if (method === 'POST') {
      const id = crypto.randomUUID();
      const row = {
        id,
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
        ...body
      };
      db.invites[id] = row;
      return ok([row], 201);
    }
    if (method === 'PATCH') {
      const id = parseEq(qs, 'id');
      const wid = parseEq(qs, 'workspace_id');
      let row = id ? db.invites[id] : null;
      if (row && wid && row.workspace_id !== wid) row = null;
      if (!row) return ok([], 404);
      Object.assign(row, body);
      return ok([row]);
    }
  }

  return ok({ error: 'unhandled ' + method + ' ' + path }, 500);
}

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
globalThis.fetch = fakeFetch;

const ws = await import('../lib/workspaces.js');
const {
  isUuid,
  normalizeEmail,
  hashInviteToken,
  createInviteToken,
  roleCanEdit,
  roleCanManageMembers,
  validateStudioDocument,
  detectDirectorMutationIntent,
  EDIT_ROLES,
  INVITE_ROLES,
  EMPTY_WORKSPACE_DOCUMENT
} = ws;

console.log('\n== Pure helpers ==');
await test('isUuid accepts valid uuid', () => {
  assert.strictEqual(isUuid(WS_A), true);
  assert.strictEqual(isUuid('not-a-uuid'), false);
});

await test('normalizeEmail lowercases + trims', () => {
  assert.strictEqual(normalizeEmail('  Dan@Example.COM '), 'dan@example.com');
});

await test('invite token hashes are one-way', () => {
  const { token, tokenHash } = createInviteToken();
  assert.ok(token.length >= 64);
  assert.strictEqual(tokenHash, hashInviteToken(token));
  assert.notStrictEqual(token, tokenHash);
});

await test('roleCanEdit owner/editor only', () => {
  assert.strictEqual(roleCanEdit('owner'), true);
  assert.strictEqual(roleCanEdit('editor'), true);
  assert.strictEqual(roleCanEdit('commenter'), false);
  assert.strictEqual(roleCanEdit('viewer'), false);
  assert.strictEqual(roleCanManageMembers('owner'), true);
  assert.strictEqual(roleCanManageMembers('editor'), false);
});

await test('validateStudioDocument rejects bad shapes', () => {
  assert.strictEqual(validateStudioDocument(EMPTY_WORKSPACE_DOCUMENT).ok, true);
  assert.strictEqual(validateStudioDocument(null).ok, false);
  assert.strictEqual(validateStudioDocument({ projects: 'nope' }).ok, false);
});

await test('detectDirectorMutationIntent', () => {
  assert.strictEqual(
    detectDirectorMutationIntent({}, 'MODE: Script mutation. Emit [[SCRIPT:', []),
    true
  );
  assert.strictEqual(
    detectDirectorMutationIntent({}, 'MODE: Studio advice only.', [
      { role: 'user', content: 'What should I film?' }
    ]),
    false
  );
});

console.log('\n== Membership / IDOR ==');
await test('member can read workspace', async () => {
  const m = await ws.assertWorkspaceMember(USER_EDITOR, WS_A);
  assert.strictEqual(m.ok, true);
  assert.strictEqual(m.role, 'editor');
});

await test('non-member cannot read workspace', async () => {
  const m = await ws.assertWorkspaceMember(USER_STRANGER, WS_A);
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.status, 403);
});

await test('member cannot access another workspace by UUID', async () => {
  const m = await ws.assertWorkspaceMember(USER_OWNER, WS_B);
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.status, 403);
});

console.log('\n== Roles ==');
await test('owner can edit', async () => {
  assert.strictEqual((await ws.assertWorkspaceRole(USER_OWNER, WS_A, EDIT_ROLES)).ok, true);
});
await test('editor can edit', async () => {
  assert.strictEqual((await ws.assertWorkspaceRole(USER_EDITOR, WS_A, EDIT_ROLES)).ok, true);
});
await test('commenter cannot edit', async () => {
  const m = await ws.assertWorkspaceRole(USER_COMMENTER, WS_A, EDIT_ROLES);
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.status, 403);
});
await test('viewer cannot edit', async () => {
  assert.strictEqual((await ws.assertWorkspaceRole(USER_VIEWER, WS_A, EDIT_ROLES)).ok, false);
});
await test('commenter/viewer membership allows Director advice path', async () => {
  const v = await ws.assertWorkspaceMember(USER_VIEWER, WS_A);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(roleCanEdit(v.role), false);
});

console.log('\n== Personal workspace ==');
await test('personal workspace is private (no invites)', async () => {
  const inv = await ws.createInvite(USER_OWNER, WS_PERSONAL, {
    email: 'friend@example.com',
    role: 'editor'
  });
  assert.strictEqual(inv.ok, false);
  assert.strictEqual(inv.error, 'personal_workspace_private');
});
await test('cannot add members to personal', async () => {
  const add = await ws.addMember(USER_OWNER, WS_PERSONAL, {
    targetUserId: USER_EDITOR,
    role: 'editor'
  });
  assert.strictEqual(add.ok, false);
  assert.strictEqual(add.error, 'personal_workspace_private');
});
await test('workspace-sync rejects personal (uses user_data)', async () => {
  const load = await ws.loadWorkspaceDocument(USER_OWNER, WS_PERSONAL);
  assert.strictEqual(load.ok, false);
  assert.strictEqual(load.error, 'personal_uses_user_data');
});

console.log('\n== Optimistic concurrency ==');
await test('save with matching revision increments', async () => {
  assert.strictEqual(db.data[WS_A].revision, 10);
  const saved = await ws.saveWorkspaceDocument(
    USER_EDITOR,
    WS_A,
    { version: 3, projects: [{ id: 'p1', name: 'Campaign v2' }], continueProductionId: null },
    10
  );
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.revision, 11);
  assert.strictEqual(db.data[WS_A].revision, 11);
});
await test('stale revision returns 409 and does not overwrite', async () => {
  const stale = await ws.saveWorkspaceDocument(
    USER_OWNER,
    WS_A,
    { version: 3, projects: [{ id: 'p1', name: 'STALE OVERWRITE' }], continueProductionId: null },
    10
  );
  assert.strictEqual(stale.ok, false);
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.revision, 11);
  assert.strictEqual(db.data[WS_A].document.projects[0].name, 'Campaign v2');
});
await test('viewer cannot save shared document', async () => {
  const denied = await ws.saveWorkspaceDocument(USER_VIEWER, WS_A, EMPTY_WORKSPACE_DOCUMENT, 11);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.status, 403);
});

console.log('\n== Invites ==');
await test('owner can invite; token not stored plaintext', async () => {
  const inv = await ws.createInvite(USER_OWNER, WS_A, {
    email: 'new@example.com',
    role: 'editor'
  });
  assert.strictEqual(inv.ok, true);
  assert.ok(inv.token);
  const stored = Object.values(db.invites).find((i) => i.email === 'new@example.com');
  assert.ok(stored);
  assert.notStrictEqual(stored.token_hash, inv.token);
  assert.strictEqual(stored.token_hash, hashInviteToken(inv.token));
});
await test('expired invite rejected', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'late@example.com',
    role: 'viewer',
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() - 1000).toISOString(),
    accepted_at: null,
    revoked_at: null
  };
  const acc = await ws.acceptInvite({ id: 'user-late', email: 'late@example.com' }, token);
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'invite_expired');
});
await test('email mismatch rejected', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'right@example.com',
    role: 'viewer',
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: null,
    revoked_at: null
  };
  const acc = await ws.acceptInvite({ id: 'user-x', email: 'wrong@example.com' }, token);
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'email_mismatch');
});
await test('cannot remove owner without transfer', async () => {
  const rem = await ws.removeMember(USER_OWNER, WS_A, USER_OWNER);
  assert.strictEqual(rem.ok, false);
  assert.strictEqual(rem.error, 'cannot_remove_owner');
});
await test('editor cannot invite', async () => {
  const inv = await ws.createInvite(USER_EDITOR, WS_A, {
    email: 'x@example.com',
    role: 'viewer'
  });
  assert.strictEqual(inv.ok, false);
  assert.strictEqual(inv.status, 403);
});

await test('revoked invitation rejected', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'revoked@example.com',
    role: 'editor',
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: null,
    revoked_at: new Date().toISOString()
  };
  const acc = await ws.acceptInvite({ id: 'user-r', email: 'revoked@example.com' }, token);
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'invite_revoked');
});

await test('already-accepted invitation rejected', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'done@example.com',
    role: 'editor',
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: new Date().toISOString(),
    revoked_at: null
  };
  const acc = await ws.acceptInvite({ id: 'user-d', email: 'done@example.com' }, token);
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'invite_already_accepted');
});

await test('invalid token rejected', async () => {
  const acc = await ws.acceptInvite({ id: 'u', email: 'a@b.com' }, 'short');
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'invalid_token');
});

await test('accept without auth email rejected when invite is email-bound', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'needmail@example.com',
    role: 'viewer',
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: null,
    revoked_at: null
  };
  const acc = await ws.acceptInvite({ id: 'user-nomail', email: null }, token);
  assert.strictEqual(acc.ok, false);
  assert.strictEqual(acc.error, 'email_required');
});

await test('already-member accept is safe no-op (no role escalation)', async () => {
  const { token, tokenHash } = createInviteToken();
  const id = crypto.randomUUID();
  db.invites[id] = {
    id,
    workspace_id: WS_A,
    email: 'editor@example.com',
    role: 'viewer', /* attempt escalate editor→viewer invite should not demote either */
    token_hash: tokenHash,
    invited_by: USER_OWNER,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: null,
    revoked_at: null
  };
  const acc = await ws.acceptInvite({ id: USER_EDITOR, email: 'editor@example.com' }, token);
  assert.strictEqual(acc.ok, true);
  assert.strictEqual(acc.already_member, true);
  assert.strictEqual(acc.role, 'editor');
  assert.strictEqual(db.members[`${WS_A}:${USER_EDITOR}`].role, 'editor');
});

await test('owner can revoke invite; token_hash never returned', async () => {
  const created = await ws.createInvite(USER_OWNER, WS_A, {
    email: 'temp@example.com',
    role: 'commenter'
  });
  assert.strictEqual(created.ok, true);
  assert.ok(created.token);
  assert.ok(!('token_hash' in created.invite));
  const revoked = await ws.revokeInvite(USER_OWNER, WS_A, created.invite.id);
  assert.strictEqual(revoked.ok, true);
  const stored = db.invites[created.invite.id];
  assert.ok(stored.revoked_at);
});

await test('cannot assign owner via addMember', async () => {
  const add = await ws.addMember(USER_OWNER, WS_A, {
    targetUserId: 'user-new',
    role: 'owner'
  });
  assert.strictEqual(add.ok, false);
  assert.strictEqual(add.error, 'invalid_role');
});

await test('editor cannot change roles', async () => {
  const upd = await ws.updateMemberRole(USER_EDITOR, WS_A, USER_VIEWER, 'editor');
  assert.strictEqual(upd.ok, false);
  assert.strictEqual(upd.status, 403);
});

await test('editor cannot remove members', async () => {
  const rem = await ws.removeMember(USER_EDITOR, WS_A, USER_VIEWER);
  assert.strictEqual(rem.ok, false);
  assert.strictEqual(rem.status, 403);
});

console.log('\n== Workspace sync load/save matrix ==');
await test('member can load shared document', async () => {
  const loaded = await ws.loadWorkspaceDocument(USER_EDITOR, WS_A);
  assert.strictEqual(loaded.ok, true);
  assert.ok(loaded.document);
  assert.ok(loaded.revision >= 1);
});

await test('non-member cannot load shared document', async () => {
  const loaded = await ws.loadWorkspaceDocument(USER_STRANGER, WS_A);
  assert.strictEqual(loaded.ok, false);
  assert.strictEqual(loaded.status, 403);
});

await test('commenter cannot save shared document', async () => {
  const denied = await ws.saveWorkspaceDocument(
    USER_COMMENTER,
    WS_A,
    EMPTY_WORKSPACE_DOCUMENT,
    db.data[WS_A].revision
  );
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.status, 403);
});

await test('archived workspace rejects saves', async () => {
  db.workspaces[WS_A].archived_at = new Date().toISOString();
  const denied = await ws.saveWorkspaceDocument(
    USER_OWNER,
    WS_A,
    EMPTY_WORKSPACE_DOCUMENT,
    db.data[WS_A].revision
  );
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.error, 'workspace_archived');
  db.workspaces[WS_A].archived_at = null;
});

await test('save updates revision, updated_by', async () => {
  const rev = db.data[WS_A].revision;
  const saved = await ws.saveWorkspaceDocument(
    USER_OWNER,
    WS_A,
    {
      version: 3,
      projects: [{ id: 'p1', name: 'Verify Persist' }],
      continueProductionId: null
    },
    rev
  );
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.revision, rev + 1);
  assert.strictEqual(saved.updated_by, USER_OWNER);
  assert.strictEqual(db.data[WS_A].document.projects[0].name, 'Verify Persist');
});

await test('create shared workspace seeds workspace_data only', async () => {
  const created = await ws.createSharedWorkspace(USER_OWNER, { name: 'Verify Create' });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.workspace.kind, 'shared');
  assert.strictEqual(created.workspace.role, 'owner');
  assert.ok(db.data[created.workspace.id]);
  assert.strictEqual(db.data[created.workspace.id].revision, 1);
  assert.ok(!db.data[WS_PERSONAL]);
});

console.log('\n== Director authorization helpers ==');
await test('Director mutate intent blocked for viewer/commenter roles', () => {
  const mutate = detectDirectorMutationIntent(
    {},
    'MODE: Script mutation',
    [{ role: 'user', content: 'Emit [[SCRIPT:{"mode":"replace","body":"x"}]]' }]
  );
  assert.strictEqual(mutate, true);
  assert.strictEqual(roleCanEdit('viewer'), false);
  assert.strictEqual(roleCanEdit('commenter'), false);
  assert.strictEqual(roleCanEdit('editor'), true);
  assert.strictEqual(roleCanEdit('owner'), true);
});

await test('Director advice intent is not treated as mutation', () => {
  const advice = detectDirectorMutationIntent({}, 'MODE: Studio advice only.', [
    { role: 'user', content: 'What shot should I film first?' }
  ]);
  assert.strictEqual(advice, false);
});

console.log('\n== Personal sync isolation (source + architecture) ==');
await test('personal sync rejects shared workspace payloads', () => {
  const syncSrc = fs.readFileSync(path.join(root, 'api/sync.js'), 'utf8');
  assert.ok(syncSrc.includes('workspace_id') || syncSrc.includes('workspaceId'));
  assert.ok(syncSrc.includes('workspace-sync'));
  assert.ok(syncSrc.includes('invalid_payload'));
});

await test('studio-ui uses PreShootWorkspace UI without CRDT/cursors', () => {
  const ui = fs.readFileSync(path.join(root, 'js/studio-ui.js'), 'utf8');
  assert.ok(ui.includes('PreShootWorkspaceUI') || ui.includes('studioHeaderActionsHtml'));
  assert.ok(!/CRDT|live.?cursor|character-level/i.test(ui));
});

console.log('\n== Storage path ACL ==');
await test('personal path allowed for matching user id', async () => {
  const a = await ws.assertStoragePathAccess(USER_OWNER, `${USER_OWNER}/prod1/a1.jpg`, {
    needEdit: true
  });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.scope, 'personal');
});
await test('shared path requires membership', async () => {
  assert.strictEqual(
    (
      await ws.assertStoragePathAccess(USER_EDITOR, `workspaces/${WS_A}/prod1/a1.jpg`, {
        needEdit: true
      })
    ).ok,
    true
  );
  assert.strictEqual(
    (
      await ws.assertStoragePathAccess(USER_STRANGER, `workspaces/${WS_A}/prod1/a1.jpg`, {
        needEdit: true
      })
    ).ok,
    false
  );
});
await test('viewer cannot upload to shared path', async () => {
  assert.strictEqual(
    (
      await ws.assertStoragePathAccess(USER_VIEWER, `workspaces/${WS_A}/prod1/a1.jpg`, {
        needEdit: true
      })
    ).ok,
    false
  );
});
await test('cross-user personal path forbidden', async () => {
  assert.strictEqual(
    (
      await ws.assertStoragePathAccess(USER_EDITOR, `${USER_OWNER}/prod1/a1.jpg`, {
        needEdit: true
      })
    ).ok,
    false
  );
});
await test('path traversal rejected', async () => {
  assert.strictEqual(ws.isSafeStorageObjectPath(`${USER_OWNER}/../${USER_EDITOR}/x.jpg`), false);
  assert.strictEqual(
    (
      await ws.assertStoragePathAccess(USER_OWNER, `workspaces/${WS_A}/../${WS_B}/x.jpg`, {
        needEdit: true
      })
    ).ok,
    false
  );
});

console.log('\n== Migration invariants ==');
await test('personal workspaces must not require workspace_data', () => {
  assert.strictEqual(db.data[WS_PERSONAL], undefined);
  assert.strictEqual(db.workspaces[WS_PERSONAL].kind, 'personal');
});
await test('INVITE_ROLES never includes owner', () => {
  assert.ok(!INVITE_ROLES.includes('owner'));
});
await test('SQL: no authenticated workspace_data UPDATE; invites not SELECT-granted', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase_workspaces_phase1.sql'), 'utf8');
  assert.ok(sql.includes('DROP POLICY IF EXISTS workspace_data_update_editor'));
  assert.ok(!/CREATE POLICY workspace_data_update_editor/i.test(sql));
  assert.ok(!/GRANT SELECT ON TABLE workspace_invites TO authenticated/i.test(sql));
  assert.ok(sql.includes('token_hash must not leak'));
});

console.log('\n────────────────────────────');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed) process.exit(1);
console.log('ALL WORKSPACE PHASE 1 TESTS PASSED');
