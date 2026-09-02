/**
 * Authoritative account access status. Subscription revoke is not the same
 * as suspending the account — this module gates API use and Auth sessions.
 */
import { serviceHeaders } from './security.js';

export const ACCOUNT_ACTIVE = 'active';
export const ACCOUNT_SUSPENDED = 'suspended';

const AUTH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuthUserId(userId) {
  return AUTH_UUID.test(String(userId || ''));
}

export async function getAccountStatus(userId) {
  if (!userId) return { status: ACCOUNT_ACTIVE, missing: true };
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { status: ACCOUNT_ACTIVE, missing: true };

  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=account_status,account_status_reason,account_status_at,account_status_by,email,name&limit=1`,
      { headers: serviceHeaders() }
    );
    const rows = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(rows)) {
      /* Column missing until SQL applied — do not lock every user out. */
      return { status: ACCOUNT_ACTIVE, unknown: true };
    }
    if (!rows[0]) return { status: ACCOUNT_ACTIVE, missing: true };
    const status =
      rows[0].account_status === ACCOUNT_SUSPENDED
        ? ACCOUNT_SUSPENDED
        : ACCOUNT_ACTIVE;
    return {
      status,
      reason: rows[0].account_status_reason || null,
      at: rows[0].account_status_at || null,
      by: rows[0].account_status_by || null,
      email: rows[0].email || null,
      name: rows[0].name || null
    };
  } catch (e) {
    return { status: ACCOUNT_ACTIVE, unknown: true };
  }
}

export function isAccountBlocked(row) {
  return row && row.status === ACCOUNT_SUSPENDED;
}

async function authAdmin(path, method, body) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !key) return { ok: false, error: 'no_config', status: 0 };
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/admin${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text().catch(() => '');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, error: 'auth_admin_failed', status: 0 };
  }
}

export async function banAuthUser(userId) {
  if (!isAuthUserId(userId)) {
    return { ok: false, skipped: true, error: 'not_auth_user' };
  }
  await authAdmin('/users/' + encodeURIComponent(userId) + '/logout', 'POST', {
    scope: 'global'
  });
  /* Official Auth admin API: PUT + ban_duration. PATCH is a fallback. */
  let r = await authAdmin('/users/' + encodeURIComponent(userId), 'PUT', {
    ban_duration: '876000h'
  });
  if (!r.ok) {
    r = await authAdmin('/users/' + encodeURIComponent(userId), 'PATCH', {
      ban_duration: '876000h'
    });
  }
  const verify = await fetchAuthUserAdmin(userId);
  const banned = !!(verify && verify.banned_until);
  return {
    ok: r.ok && banned,
    status: r.status,
    banned,
    error: r.ok && banned ? null : 'auth_ban_failed'
  };
}

export async function unbanAuthUser(userId) {
  if (!isAuthUserId(userId)) {
    return { ok: false, skipped: true, error: 'not_auth_user' };
  }
  let r = await authAdmin('/users/' + encodeURIComponent(userId), 'PUT', {
    ban_duration: 'none'
  });
  if (!r.ok) {
    r = await authAdmin('/users/' + encodeURIComponent(userId), 'PATCH', {
      ban_duration: 'none'
    });
  }
  return { ok: r.ok, status: r.status, error: r.ok ? null : 'auth_unban_failed' };
}

export async function fetchAuthUserAdmin(userId) {
  if (!userId) return null;
  const r = await authAdmin('/users/' + encodeURIComponent(userId), 'GET');
  if (!r.ok) return null;
  return r.data;
}

function writeErrorSnippet(status, body) {
  const raw =
    typeof body === 'string'
      ? body
      : body && body.message
        ? String(body.message)
        : body && body.code
          ? String(body.code)
          : '';
  return String(status || '') + (raw ? ':' + raw.replace(/https?:\/\/\S+/g, '').slice(0, 80) : '');
}

export async function setAccountStatus(userId, status, meta) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY || !userId) return { ok: false, error: 'invalid' };
  const next = status === ACCOUNT_SUSPENDED ? ACCOUNT_SUSPENDED : ACCOUNT_ACTIVE;
  const payload = {
    account_status: next,
    account_status_reason: String((meta && meta.reason) || '').slice(0, 500) || null,
    account_status_at: new Date().toISOString(),
    account_status_by: String((meta && meta.by) || 'admin').slice(0, 80),
    last_seen: new Date().toISOString()
  };

  const patch = await fetch(
    `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    }
  );
  let rows = await patch.json().catch(() => null);
  if (!patch.ok || !Array.isArray(rows) || !rows.length) {
    const upsert = await fetch(
      `${SUPA_URL}/rest/v1/users?on_conflict=user_id`,
      {
        method: 'POST',
        headers: {
          ...serviceHeaders(),
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({
          user_id: userId,
          email: (meta && meta.email) || null,
          ...payload
        })
      }
    );
    rows = await upsert.json().catch(() => null);
    if (!upsert.ok || !Array.isArray(rows) || !rows.length) {
      return {
        ok: false,
        error: 'db_write_failed',
        detail: writeErrorSnippet(upsert.status || patch.status, rows)
      };
    }
  }

  let auth = { ok: true, skipped: true };
  try {
    auth =
      next === ACCOUNT_SUSPENDED
        ? await banAuthUser(userId)
        : await unbanAuthUser(userId);
  } catch (e) {
    auth = { ok: false, error: 'auth_admin_failed' };
  }

  return {
    ok: true,
    status: next,
    authOk: auth.skipped ? true : !!auth.ok,
    authSkipped: !!auth.skipped,
    authError: auth.ok || auth.skipped ? null : auth.error || 'auth_admin_failed'
  };
}
