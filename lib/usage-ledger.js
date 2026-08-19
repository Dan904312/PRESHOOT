/**
 * Server-side AI usage ledger. Records successful billable operations only.
 * Never stores prompts, images, or API keys.
 */
import { serviceHeaders } from './security.js';
import { estimateAiCostUsd, USAGE_EVENT_TYPES } from './ai-pricing.js';

export async function recordUsageEvent(entry) {
  const status = entry && entry.status === 'failed' ? 'failed' : 'success';
  if (status !== 'success') {
    /* Failed requests are not counted as completed usage. */
    return { ok: true, skipped: true };
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false, error: 'no_config' };

  const type = USAGE_EVENT_TYPES.indexOf(entry && entry.event_type) >= 0
    ? entry.event_type
    : 'other_billable_ai';

  const inputUnits = Math.max(0, parseInt(entry.input_units, 10) || 0);
  const outputUnits = Math.max(0, parseInt(entry.output_units, 10) || 0);
  const model = String((entry && entry.model) || '').slice(0, 80) || null;
  const provider = String((entry && entry.provider) || 'anthropic').slice(0, 40);
  const cost =
    inputUnits || outputUnits
      ? estimateAiCostUsd(model, inputUnits, outputUnits, provider)
      : 0;

  const meta = {};
  if (entry && entry.metadata && typeof entry.metadata === 'object') {
    Object.keys(entry.metadata)
      .slice(0, 8)
      .forEach((k) => {
        const key = String(k).slice(0, 40);
        if (/prompt|content|image|b64|token|key|secret|body|script/i.test(key)) return;
        const v = entry.metadata[k];
        if (typeof v === 'string' && v.length <= 80) meta[key] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) meta[key] = v;
        else if (typeof v === 'boolean') meta[key] = v;
      });
  }

  const row = {
    user_id: String((entry && entry.user_id) || '').slice(0, 128) || null,
    event_type: type,
    provider,
    model,
    request_id: entry && entry.request_id ? String(entry.request_id).slice(0, 128) : null,
    input_units: inputUnits || null,
    output_units: outputUnits || null,
    estimated_cost: cost,
    status: 'success',
    metadata: meta,
    created_at: new Date().toISOString()
  };

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/usage_events`, {
      method: 'POST',
      headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!r.ok) return { ok: false, error: 'insert_failed', status: r.status };

    if (type === 'scan' && row.user_id) {
      await fetch(`${SUPA_URL}/rest/v1/rpc/bump_user_scan_count`, {
        method: 'POST',
        headers: serviceHeaders(),
        body: JSON.stringify({ p_user_id: row.user_id })
      }).catch(function () {});
    }
    return { ok: true, estimated_cost: cost };
  } catch (e) {
    return { ok: false, error: 'insert_failed' };
  }
}
