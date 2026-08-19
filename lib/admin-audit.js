import { serviceHeaders } from './security.js';

export async function writeAdminAudit({ action, targetUserId, ip, metadata }) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false };
  const row = {
    admin_id: 'admin',
    action: String(action || '').slice(0, 80),
    target_user_id: targetUserId ? String(targetUserId).slice(0, 128) : null,
    ip: ip ? String(ip).slice(0, 64) : null,
    metadata:
      metadata && typeof metadata === 'object'
        ? Object.keys(metadata)
            .slice(0, 8)
            .reduce((acc, k) => {
              const v = metadata[k];
              if (typeof v === 'string') acc[String(k).slice(0, 40)] = v.slice(0, 200);
              else if (typeof v === 'number' && Number.isFinite(v)) acc[String(k).slice(0, 40)] = v;
              else if (typeof v === 'boolean') acc[String(k).slice(0, 40)] = v;
              return acc;
            }, {})
        : {},
    created_at: new Date().toISOString()
  };
  try {
    await fetch(`${SUPA_URL}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}
