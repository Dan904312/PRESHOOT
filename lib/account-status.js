/**
 * Authoritative account access status. Subscription revoke is not the same
 * as suspending the account — this module gates API use.
 */
import { serviceHeaders } from './security.js';

export const ACCOUNT_ACTIVE = 'active';
export const ACCOUNT_SUSPENDED = 'suspended';

export async function getAccountStatus(userId) {
  if (!userId) return { status: ACCOUNT_ACTIVE, missing: true };
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { status: ACCOUNT_ACTIVE, missing: true };

  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=account_status,account_status_reason,account_status_at,account_status_by&limit=1`,
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
      by: rows[0].account_status_by || null
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
  if (!SUPA_URL || !key) return { ok: false, error: 'no_config' };
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
    data = { raw: text.slice(0, 200) };
  }
  return { ok: r.ok, status: r.status, data };
}

export async function banAuthUser(userId) {
  if (!userId) return { ok: false };
  await authAdmin('/users/' + encodeURIComponent(userId) + '/logout', 'POST', {
    scope: 'global'
  }).catch(function () {});
  return authAdmin('/users/' + encodeURIComponent(userId), 'PUT', {
    ban_duration: '876000h'
  });
}

export async function unbanAuthUser(userId) {
  if (!userId) return { ok: false };
  return authAdmin('/users/' + encodeURIComponent(userId), 'PUT', {
    ban_duration: 'none'
  });
}

export async function fetchAuthUserAdmin(userId) {
  if (!userId) return null;
  const r = await authAdmin('/users/' + encodeURIComponent(userId), 'GET');
  if (!r.ok) return null;
  return r.data;
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
  const r = await fetch(
    `${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(payload)
    }
  );
  if (r.status === 404 || !r.ok) {
    await fetch(`${SUPA_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: userId,
        email: (meta && meta.email) || null,
        ...payload
      })
    }).catch(function () {});
  }
  if (next === ACCOUNT_SUSPENDED) await banAuthUser(userId);
  else await unbanAuthUser(userId);
  return { ok: true, status: next };
}
