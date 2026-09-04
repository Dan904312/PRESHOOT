/**
 * Authoritative account access status. Subscription revoke is not the same
 * as suspending the account — this module gates API use and Auth sessions.
 *
 * Schema is required in production (users.account_status). A missing column
 * is an operator error, not an implicit "active" grant.
 */
import { serviceHeaders, fetchJsonWithTimeout } from './security.js';

export const ACCOUNT_ACTIVE = 'active';
export const ACCOUNT_SUSPENDED = 'suspended';

const AUTH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_SELECT =
  'account_status,account_status_reason,account_status_at,account_status_by,email,name';

export function isAuthUserId(userId) {
  return AUTH_UUID.test(String(userId || ''));
}

export function isAccountStatusSchemaError(status, body) {
  const code = body && (body.code || body.error);
  const raw =
    typeof body === 'string'
      ? body
      : body
        ? JSON.stringify(body)
        : '';
  if (code === '42703' || code === 'PGRST204') return true;
  if (/42703|PGRST204/i.test(raw)) return true;
  if (/column .*account_status/i.test(raw)) return true;
  if (status === 400 && /account_status/i.test(raw) && /does not exist|schema cache/i.test(raw)) {
    return true;
  }
  return false;
}

export async function getAccountStatus(userId) {
  if (!userId) return { status: ACCOUNT_ACTIVE, missing: true };
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    return { status: null, misconfigured: true, error: 'no_config' };
  }

  const pack = await fetchJsonWithTimeout(
    `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=${STATUS_SELECT}&limit=1`,
    { headers: serviceHeaders() },
    5000
  );

  if (pack.timedOut) {
    return { status: null, unavailable: true, error: 'timeout' };
  }
  if (isAccountStatusSchemaError(pack.status, pack.data || pack.text)) {
    return { status: null, misconfigured: true, error: 'schema_missing' };
  }
  if (!pack.ok || !Array.isArray(pack.data)) {
    return { status: null, unavailable: true, error: 'lookup_failed' };
  }
  if (!pack.data[0]) {
    /* Authenticated user with no users row yet (first request). Not suspended. */
    return { status: ACCOUNT_ACTIVE, missing: true };
  }
  const row = pack.data[0];
  const status =
    row.account_status === ACCOUNT_SUSPENDED ? ACCOUNT_SUSPENDED : ACCOUNT_ACTIVE;
  return {
    status,
    reason: row.account_status_reason || null,
    at: row.account_status_at || null,
    by: row.account_status_by || null,
    email: row.email || null,
    name: row.name || null
  };
}

export function isAccountBlocked(row) {
  return row && row.status === ACCOUNT_SUSPENDED;
}

async function authAdmin(path, method, body) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !key) return { ok: false, error: 'no_config', status: 0 };
  const pack = await fetchJsonWithTimeout(
    `${SUPA_URL}/auth/v1/admin${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key
      },
      body: body ? JSON.stringify(body) : undefined
    },
    6000
  );
  if (pack.timedOut) return { ok: false, error: 'timeout', status: 0 };
  return { ok: pack.ok, status: pack.status, data: pack.data, error: pack.ok ? null : 'auth_admin_failed' };
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
  if (!SUPA_URL || !SUPA_KEY || !userId) {
    return { ok: false, error: 'invalid', misconfigured: !SUPA_URL || !SUPA_KEY };
  }
  const next = status === ACCOUNT_SUSPENDED ? ACCOUNT_SUSPENDED : ACCOUNT_ACTIVE;
  const payload = {
    account_status: next,
    account_status_reason: String((meta && meta.reason) || '').slice(0, 500) || null,
    account_status_at: new Date().toISOString(),
    account_status_by: String((meta && meta.by) || 'admin').slice(0, 80),
    last_seen: new Date().toISOString()
  };

  const patch = await fetchJsonWithTimeout(
    `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    },
    6000
  );
  if (patch.timedOut) {
    return { ok: false, error: 'timeout', persisted: false };
  }
  if (isAccountStatusSchemaError(patch.status, patch.data || patch.text)) {
    return { ok: false, error: 'schema_missing', misconfigured: true, persisted: false };
  }

  let rows = Array.isArray(patch.data) ? patch.data : null;
  if (!patch.ok || !rows || !rows.length) {
    const upsert = await fetchJsonWithTimeout(
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
      },
      6000
    );
    if (upsert.timedOut) {
      return { ok: false, error: 'timeout', persisted: false };
    }
    if (isAccountStatusSchemaError(upsert.status, upsert.data || upsert.text)) {
      return { ok: false, error: 'schema_missing', misconfigured: true, persisted: false };
    }
    rows = Array.isArray(upsert.data) ? upsert.data : null;
    if (!upsert.ok || !rows || !rows.length) {
      return {
        ok: false,
        error: 'db_write_failed',
        persisted: false,
        detail: writeErrorSnippet(upsert.status || patch.status, upsert.data || patch.data)
      };
    }
  }

  const written = rows[0];
  if (written && written.account_status !== next) {
    return { ok: false, error: 'db_write_failed', persisted: false, detail: 'status_mismatch' };
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
    persisted: true,
    status: next,
    authOk: auth.skipped ? true : !!auth.ok,
    authSkipped: !!auth.skipped,
    authError: auth.ok || auth.skipped ? null : auth.error || 'auth_admin_failed'
  };
}
