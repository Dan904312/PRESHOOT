/**
 * Admin console helpers — usage rollups, ranges, spend flags.
 * All queries use the service role via caller-supplied headers.
 */
import { serviceHeaders } from './security.js';
import { emailProviderStatus } from './email.js';
import { formatApiCostUsd, formatRevenueUsd } from './ai-pricing.js';

export { formatApiCostUsd, formatRevenueUsd };

export function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfUtcMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function spendThresholds() {
  function num(name) {
    const n = parseFloat(process.env[name] || '');
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return {
    daily: num('ADMIN_DAILY_SPEND_WARN'),
    monthly: num('ADMIN_MONTHLY_SPEND_WARN'),
    per_user: num('ADMIN_USER_SPEND_WARN')
  };
}

export async function fetchSetting(key) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
      { headers: serviceHeaders() }
    );
    const rows = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(rows) || !rows[0]) return null;
    return rows[0].value || null;
  } catch (e) {
    return null;
  }
}

export async function fetchUsageRollup(sinceIso) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return [];

  const payload =
    sinceIso == null ? {} : { p_since: sinceIso };

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/admin_usage_rollup`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => null);
    if (r.ok && Array.isArray(data)) return data;
  } catch (e) {
    /* fall through to table scan */
  }

  return fetchUsageRollupFromTable(sinceIso);
}

async function fetchUsageRollupFromTable(sinceIso) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return [];
  let url =
    `${SUPA_URL}/rest/v1/usage_events?select=user_id,event_type,provider,model,estimated_cost&status=eq.success&order=created_at.desc&limit=8000`;
  if (sinceIso) url += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
  try {
    const r = await fetch(url, { headers: serviceHeaders() });
    const rows = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(rows)) return [];
    return rows.map((row) => ({
      user_id: row.user_id,
      event_type: row.event_type,
      provider: row.provider,
      model: row.model,
      event_count: 1,
      cost_sum: row.estimated_cost || 0
    }));
  } catch (e) {
    return [];
  }
}

export async function probeUsageLedger() {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return { ok: false, error: 'no_config' };
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/usage_events?select=id&limit=1`,
      { headers: { ...serviceHeaders(), Prefer: 'count=exact' } }
    );
    const body = await r.json().catch(() => null);
    if (r.status === 404 || (body && (body.code === 'PGRST205' || /does not exist/i.test(String(body.message || ''))))) {
      return { ok: false, error: 'missing_table' };
    }
    if (!r.ok) {
      return { ok: false, error: 'query_failed', status: r.status };
    }
    const range = r.headers.get('content-range') || '';
    const total = parseInt(String(range.split('/')[1] || ''), 10);
    return {
      ok: true,
      total_events: Number.isFinite(total) ? total : Array.isArray(body) ? body.length : 0
    };
  } catch (e) {
    return { ok: false, error: 'query_failed' };
  }
}

export function aggregateRollup(rows) {
  const byUser = {};
  const byOp = {};
  let scans = 0;
  let director = 0;
  let research = 0;
  let ai = 0;
  let cost = 0;
  (rows || []).forEach((row) => {
    const n = parseInt(row.event_count, 10) || 0;
    const c = parseFloat(row.cost_sum) || 0;
    const type = row.event_type || 'other';
    ai += n;
    cost += c;
    if (type === 'scan') scans += n;
    else if (type === 'director_request') director += n;
    else if (type === 'research') research += n;
    const uid = row.user_id || '_';
    if (!byUser[uid]) {
      byUser[uid] = { scans: 0, director: 0, research: 0, ai: 0, cost: 0 };
    }
    byUser[uid].ai += n;
    byUser[uid].cost += c;
    if (type === 'scan') byUser[uid].scans += n;
    if (type === 'director_request') byUser[uid].director += n;
    if (type === 'research') byUser[uid].research += n;
    const key = [row.provider || 'unknown', row.model || 'unknown', type].join('|');
    if (!byOp[key]) {
      byOp[key] = {
        provider: row.provider || 'unknown',
        model: row.model || 'unknown',
        event_type: type,
        count: 0,
        cost: 0
      };
    }
    byOp[key].count += n;
    byOp[key].cost += c;
  });
  return {
    scans,
    director,
    research,
    ai,
    cost: Number(cost.toFixed(6)),
    byUser,
    breakdown: Object.values(byOp).sort((a, b) => b.cost - a.cost)
  };
}

export function moneyUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Number(x.toFixed(8));
}

export function estimatedProfit(revenueUsd, apiCostUsd) {
  const revenue = moneyUsd(revenueUsd);
  const api_cost = moneyUsd(apiCostUsd);
  const profit = moneyUsd(revenue - api_cost);
  const margin = revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : null;
  return { revenue, api_cost, profit, margin };
}

export function utcDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

export function buildUtcDayKeys(numDays, endDate) {
  const end = endDate ? new Date(endDate) : new Date();
  end.setUTCHours(0, 0, 0, 0);
  const n = Math.min(Math.max(parseInt(numDays, 10) || 30, 1), 366);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

export function emptyDailyPoint() {
  return { scans: 0, ai: 0, dau: 0, signups: 0, revenue: 0, api_cost: 0 };
}

export function mergeDailySeries(keys, parts) {
  const out = {};
  keys.forEach((k) => {
    out[k] = emptyDailyPoint();
  });
  function add(map, field) {
    Object.keys(map || {}).forEach((k) => {
      if (!out[k]) return;
      out[k][field] = (out[k][field] || 0) + (Number(map[k]) || 0);
    });
  }
  add(parts.scans, 'scans');
  add(parts.ai, 'ai');
  add(parts.dau, 'dau');
  add(parts.signups, 'signups');
  add(parts.revenue, 'revenue');
  add(parts.api_cost, 'api_cost');
  return keys.map((day) => {
    const p = out[day];
    const profit = estimatedProfit(p.revenue, p.api_cost);
    return {
      day,
      scans: p.scans,
      ai: p.ai,
      dau: p.dau,
      signups: p.signups,
      revenue: moneyUsd(p.revenue),
      api_cost: moneyUsd(p.api_cost),
      profit: profit.profit
    };
  });
}

export async function fetchDailyUsageFromTable(sinceIso) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return [];
  let url =
    `${SUPA_URL}/rest/v1/usage_events?select=user_id,event_type,estimated_cost,created_at&status=eq.success&order=created_at.asc&limit=8000`;
  if (sinceIso) url += `&created_at=gte.${encodeURIComponent(sinceIso)}`;
  try {
    const r = await fetch(url, { headers: serviceHeaders() });
    const rows = await r.json().catch(() => null);
    return r.ok && Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

export async function fetchDailyUsageRpc(sinceIso) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return null;
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/admin_daily_usage`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify(sinceIso == null ? {} : { p_since: sinceIso })
    });
    const data = await r.json().catch(() => null);
    if (r.ok && Array.isArray(data)) return data;
  } catch (e) {
    /* fallback */
  }
  return null;
}

export function usageRowsToDailyMaps(rows) {
  const scans = {};
  const ai = {};
  const cost = {};
  const users = {};
  (rows || []).forEach((row) => {
    const key = utcDateKey(row.created_at || row.day);
    if (!key) return;
    ai[key] = (ai[key] || 0) + (parseInt(row.event_count, 10) || 1);
    cost[key] = (cost[key] || 0) + (parseFloat(row.cost_sum != null ? row.cost_sum : row.estimated_cost) || 0);
    if (row.event_type === 'scan') {
      scans[key] = (scans[key] || 0) + (parseInt(row.event_count, 10) || 1);
    }
    if (row.user_id) {
      if (!users[key]) users[key] = new Set();
      if (users[key] instanceof Set) users[key].add(row.user_id);
    }
    if (row.active_users != null) {
      users[key] = parseInt(row.active_users, 10) || 0;
    }
    if (row.scans != null && row.day) {
      scans[key] = parseInt(row.scans, 10) || 0;
    }
    if (row.ai_requests != null && row.day) {
      ai[key] = parseInt(row.ai_requests, 10) || 0;
    }
  });
  const dau = {};
  Object.keys(users).forEach((k) => {
    dau[k] = users[k] instanceof Set ? users[k].size : users[k] || 0;
  });
  return { scans, ai, dau, api_cost: cost };
}

export async function countProductErrors(sinceIso) {
  const SUPA_URL = process.env.SUPABASE_URL;
  if (!SUPA_URL) return { failed: 0, rate_limited: 0, server: 0, by_endpoint: [] };
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/product_events?select=meta,created_at&event=eq.api_error&created_at=gte.${encodeURIComponent(sinceIso)}&limit=2000`,
      { headers: serviceHeaders() }
    );
    const list = await r.json().catch(() => null);
    const rows = Array.isArray(list) ? list : [];
    let rateLimited = 0;
    let server = 0;
    const byEp = {};
    rows.forEach((e) => {
      const status = e.meta && e.meta.status;
      const ep = (e.meta && e.meta.endpoint) || 'unknown';
      if (!byEp[ep]) byEp[ep] = { endpoint: ep, count: 0, status_429: 0, status_5xx: 0 };
      byEp[ep].count += 1;
      if (status === 429) {
        rateLimited += 1;
        byEp[ep].status_429 += 1;
      }
      if (typeof status === 'number' && status >= 500) {
        server += 1;
        byEp[ep].status_5xx += 1;
      }
    });
    return {
      failed: rows.length,
      rate_limited: rateLimited,
      server,
      by_endpoint: Object.values(byEp).sort((a, b) => b.count - a.count)
    };
  } catch (e) {
    return { failed: 0, rate_limited: 0, server: 0, by_endpoint: [] };
  }
}

export async function fetchAuthAudit(limit) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !key) return { available: false, entries: [] };
  try {
    const r = await fetch(
      `${SUPA_URL}/auth/v1/admin/audit_log_entries?per_page=${Math.min(limit || 40, 80)}`,
      {
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key
        }
      }
    );
    const data = await r.json().catch(() => null);
    if (!r.ok) return { available: false, entries: [], status: r.status };
    const rows = Array.isArray(data) ? data : [];
    return {
      available: true,
      entries: rows.slice(0, 40).map((e) => ({
        id: e.id || null,
        payload_type: (e.payload && (e.payload.action || e.payload.type)) || null,
        created_at: e.created_at || e.timestamp || null,
        actor: e.payload && (e.payload.actor_username || e.payload.actor_id) ? String(e.payload.actor_username || e.payload.actor_id).slice(0, 80) : null
      }))
    };
  } catch (e) {
    return { available: false, entries: [] };
  }
}

export async function probeSystem() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const out = {
    database: { state: 'unavailable', detail: 'Not configured' },
    auth: { state: 'unavailable', detail: 'Not configured' },
    storage: { state: 'unavailable', detail: 'Not configured' },
    ai: {
      state: process.env.ANTHROPIC_API_KEY ? 'operational' : 'unavailable',
      detail: process.env.ANTHROPIC_API_KEY
        ? 'Anthropic key present (live model call not performed)'
        : 'ANTHROPIC_API_KEY missing'
    },
    email: emailProviderStatus().configured
      ? { state: 'operational', detail: 'Resend configured' }
      : { state: 'unavailable', detail: 'No email provider. Set RESEND_API_KEY.' }
  };
  if (!SUPA_URL || !key) return out;

  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/users?select=user_id&limit=1`,
      { headers: serviceHeaders() }
    );
    out.database = r.ok
      ? { state: 'operational', detail: 'PostgREST reachable' }
      : { state: 'degraded', detail: 'HTTP ' + r.status };
  } catch (e) {
    out.database = { state: 'unavailable', detail: 'Request failed' };
  }

  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/health`, {
      headers: { apikey: key }
    });
    out.auth = r.ok
      ? { state: 'operational', detail: 'GoTrue health OK' }
      : { state: 'degraded', detail: 'HTTP ' + r.status };
  } catch (e) {
    out.auth = { state: 'unavailable', detail: 'Request failed' };
  }

  try {
    const r = await fetch(`${SUPA_URL}/storage/v1/bucket`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    out.storage = r.ok
      ? { state: 'operational', detail: 'Storage API reachable' }
      : { state: 'degraded', detail: 'HTTP ' + r.status };
  } catch (e) {
    out.storage = { state: 'unavailable', detail: 'Request failed' };
  }

  return out;
}

export function highUsageFlags(byUser, hoursWindow) {
  const flags = [];
  const scanWarn = 200;
  const costWarn = 5;
  Object.keys(byUser || {}).forEach((uid) => {
    if (uid === '_') return;
    const row = byUser[uid];
    if (row.scans >= scanWarn) {
      flags.push({
        user_id: uid,
        kind: 'high_scans',
        scans: row.scans,
        window_hours: hoursWindow,
        message: 'User generated ' + row.scans + ' scans in ' + hoursWindow + ' hours'
      });
    }
    if (row.cost >= costWarn) {
      flags.push({
        user_id: uid,
        kind: 'high_spend',
        cost: moneyUsd(row.cost),
        window_hours: hoursWindow,
        message: 'User API cost ' + formatApiCostUsd(row.cost) + ' in ' + hoursWindow + ' hours'
      });
    }
  });
  return flags.sort((a, b) => (b.scans || 0) - (a.scans || 0)).slice(0, 40);
}

export function costAlerts(dailyCost, monthlyCost, userCosts, extras) {
  const t = spendThresholds();
  const alerts = [];
  extras = extras || {};
  if (t.daily != null && dailyCost >= t.daily) {
    alerts.push({
      kind: 'daily_spend',
      value: moneyUsd(dailyCost),
      threshold: t.daily,
      message: 'API spend today ' + formatApiCostUsd(dailyCost) + ' (warning $' + t.daily + ')'
    });
  }
  if (t.monthly != null && monthlyCost >= t.monthly) {
    alerts.push({
      kind: 'monthly_spend',
      value: moneyUsd(monthlyCost),
      threshold: t.monthly,
      message: 'API spend this month ' + formatApiCostUsd(monthlyCost) + ' (warning $' + t.monthly + ')'
    });
  }
  if (t.per_user != null) {
    Object.keys(userCosts || {}).forEach((uid) => {
      const c = userCosts[uid] && userCosts[uid].cost;
      if (c >= t.per_user) {
        alerts.push({
          kind: 'user_spend',
          user_id: uid,
          value: moneyUsd(c),
          threshold: t.per_user,
          message: 'User ' + uid.slice(0, 8) + '… spend ' + formatApiCostUsd(c) + ' this month'
        });
      }
    });
  }
  if (alerts.length < 30 && extras.dod) {
    const dod = extras.dod;
    if (dod && dod.prev > 0 && dod.today >= dod.prev * 3 && dod.today >= 0.5) {
      alerts.push({
        kind: 'cost_spike',
        value: moneyUsd(dod.today),
        threshold: moneyUsd(dod.prev * 3),
        message:
          'API cost ' +
          formatApiCostUsd(dod.today) +
          ' is 3× the previous day (' +
          formatApiCostUsd(dod.prev) +
          '). Review only — not an auto-ban.'
      });
    }
  }
  return { thresholds: t, alerts: alerts.slice(0, 30) };
}

export function suspiciousSignals({ signupsLastHour, errors, highUsage, failedInvites }) {
  const out = [];
  if ((signupsLastHour || 0) >= 15) {
    out.push({
      kind: 'signup_burst',
      value: signupsLastHour,
      message: signupsLastHour + ' new accounts in the last hour. Review only — not an auto-ban.'
    });
  }
  if (errors && errors.rate_limited >= 20) {
    out.push({
      kind: 'auth_or_rate_burst',
      value: errors.rate_limited,
      message: errors.rate_limited + ' rate-limited API errors in the sampled window.'
    });
  }
  if (errors && errors.failed >= 40) {
    out.push({
      kind: 'failed_api_burst',
      value: errors.failed,
      message: errors.failed + ' failed API events in the sampled window.'
    });
  }
  if ((failedInvites || 0) >= 10) {
    out.push({
      kind: 'invite_failures',
      value: failedInvites,
      message: failedInvites + ' failed invite attempts recorded.'
    });
  }
  (highUsage || []).slice(0, 8).forEach((f) => {
    out.push({
      kind: f.kind || 'high_usage',
      user_id: f.user_id,
      message: f.message
    });
  });
  return out.slice(0, 40);
}
