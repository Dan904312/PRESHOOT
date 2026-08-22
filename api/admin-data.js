// api/admin-data.js
import crypto from 'crypto';
import {
  setCors,
  handleOptions,
  sanitizePostgrestSearch,
  gateRouteRateLimit,
  sendRateLimitResponse,
  clientIp
} from '../lib/security.js';
import {
  requireAdminSession,
  clearAdminSessionCookie,
  verifyAdminSecret
} from '../lib/admin-session.js';
import { writeAdminAudit } from '../lib/admin-audit.js';
import {
  setAccountStatus,
  getAccountStatus,
  fetchAuthUserAdmin
} from '../lib/account-status.js';
import { sendTransactionalEmail, emailProviderStatus } from '../lib/email.js';
import {
  fetchSetting,
  fetchUsageRollup,
  aggregateRollup,
  countProductErrors,
  fetchAuthAudit,
  probeSystem,
  highUsageFlags,
  costAlerts,
  isoDaysAgo,
  startOfUtcDay,
  startOfUtcMonth,
  moneyUsd,
  spendThresholds,
  probeUsageLedger,
  estimatedProfit,
  buildUtcDayKeys,
  mergeDailySeries,
  fetchDailyUsageRpc,
  fetchDailyUsageFromTable,
  usageRowsToDailyMaps,
  utcDateKey,
  suspiciousSignals
} from '../lib/admin-console.js';

function rangeSince(range) {
  if (range === 'today') return startOfUtcDay();
  if (range === '7') return isoDaysAgo(7);
  if (range === '30') return isoDaysAgo(30);
  if (range === '90') return isoDaysAgo(90);
  return null;
}

function rangeDayCount(range) {
  if (range === 'today') return 1;
  if (range === '7') return 7;
  if (range === '90') return 90;
  if (range === 'all') return 180;
  return 30;
}

function isProSub(sub) {
  return sub && sub.plan === 'pro' && ['active', 'promo', 'trialing'].includes(sub.status);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = await gateRouteRateLimit(req, {
    route: 'admin',
    max: 60,
    windowMs: 60 * 1000
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  if (req.headers['x-admin-key']) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin password header is no longer accepted. Sign in to create a secure session.'
    });
  }

  const session = await requireAdminSession(req);
  if (!session.ok) {
    clearAdminSessionCookie(res);
    return res.status(session.status || 401).json({ error: 'Unauthorized' });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: 'DB not configured' });

  const h = {
    'Content-Type': 'application/json',
    apikey: SUPA_KEY,
    Authorization: 'Bearer ' + SUPA_KEY,
    Prefer: 'return=representation'
  };

  const body = req.body || {};
  const {
    action,
    user_id,
    email,
    reason,
    search,
    days,
    plan_filter,
    status_filter,
    segment,
    sort,
    range,
    subject,
    message,
    recipients,
    confirm_count,
    confirm_large,
    confirm_password
  } = body;
  const safeSearch = sanitizePostgrestSearch(search);
  const ip = clientIp(req);

  function buildDailyBuckets(numDays) {
    const buckets = {};
    const today = new Date();
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
    }
    return buckets;
  }

  async function jsonArr(url) {
    const r = await fetch(url, { headers: h });
    const data = await r.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  }

  try {
    switch (action) {
      case 'overview_stats': {
        const since = rangeSince(range || '30');
        const [
          usersR,
          subsR,
          eventsR,
          trackingStarted,
          rollAll,
          rollRange,
          rollToday,
          rollMonth,
          errors,
          ledger
        ] = await Promise.all([
          fetch(`${SUPA_URL}/rest/v1/users?select=user_id,first_seen,last_seen,total_scans,account_status`, { headers: h }),
          fetch(`${SUPA_URL}/rest/v1/subscriptions?select=plan,status,billing_interval,started_at,user_id,email`, { headers: h }),
          fetch(`${SUPA_URL}/rest/v1/subscription_events?select=event_type,amount,created_at`, { headers: h }),
          fetchSetting('usage_tracking_started_at'),
          fetchUsageRollup(null),
          fetchUsageRollup(since),
          fetchUsageRollup(startOfUtcDay()),
          fetchUsageRollup(startOfUtcMonth()),
          countProductErrors(since || isoDaysAgo(30)),
          probeUsageLedger()
        ]);
        const users = await usersR.json();
        const subs = await subsR.json();
        const events = await eventsR.json();

        if (!Array.isArray(users) || !Array.isArray(subs)) {
          return res.status(200).json({ error: 'DB error' });
        }

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);

        const totalUsers = users.length;
        const newToday = users.filter(u => u.first_seen && u.first_seen.slice(0, 10) === todayStr).length;
        const newThisWeek = users.filter(u => u.first_seen && new Date(u.first_seen) >= weekAgo).length;
        const newThisMonth = users.filter(u => u.first_seen && new Date(u.first_seen) >= monthAgo).length;
        const ninetyAgo = new Date(now); ninetyAgo.setUTCDate(ninetyAgo.getUTCDate() - 90);
        const newThis90 = users.filter(u => u.first_seen && new Date(u.first_seen) >= ninetyAgo).length;
        const activeToday = users.filter(u => u.last_seen && u.last_seen.slice(0, 10) === todayStr).length;
        const activeThisWeek = users.filter(u => u.last_seen && new Date(u.last_seen) >= weekAgo).length;
        const activeThis90 = users.filter(u => u.last_seen && new Date(u.last_seen) >= ninetyAgo).length;
        const suspendedAccounts = users.filter(u => u.account_status === 'suspended').length;

        const activeSubs = subs.filter(d => isProSub(d));
        const monthly = activeSubs.filter(d => d.billing_interval === 'monthly').length;
        const yearly = activeSubs.filter(d => d.billing_interval === 'yearly').length;
        const promoCount = subs.filter(d => d.status === 'promo').length;
        const cancelled = subs.filter(d => d.status === 'cancelled').length;
        const revoked = subs.filter(d => d.status === 'revoked').length;
        const pastDue = subs.filter(d => d.status === 'past_due').length;

        const mrr = monthly * 9 + yearly * (79 / 12);
        const arr = mrr * 12;

        const revenueEvents = Array.isArray(events) ? events.filter(e => (e.event_type === 'checkout.completed' || e.event_type === 'payment.succeeded') && e.amount) : [];
        const totalRevenue = revenueEvents.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueThisMonth = revenueEvents.filter(e => new Date(e.created_at) >= monthAgo).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueToday = revenueEvents.filter(e => e.created_at && e.created_at.slice(0, 10) === todayStr).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueThisWeek = revenueEvents.filter(e => e.created_at && new Date(e.created_at) >= weekAgo).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueThis90 = revenueEvents.filter(e => e.created_at && new Date(e.created_at) >= ninetyAgo).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const rangeRevenue =
          (range || '30') === 'today'
            ? revenueToday
            : (range || '30') === '7'
              ? revenueThisWeek
              : (range || '30') === '90'
                ? revenueThis90
                : (range || '30') === 'all'
                  ? totalRevenue
                  : revenueThisMonth;

        const conversionRate = totalUsers > 0 ? ((activeSubs.length / totalUsers) * 100).toFixed(1) : '0.0';
        const churnedCount = cancelled + revoked;
        const churnRate = (activeSubs.length + churnedCount) > 0 ? ((churnedCount / (activeSubs.length + churnedCount)) * 100).toFixed(1) : '0.0';
        const avgRevenuePerUser = totalUsers > 0 ? (totalRevenue / totalUsers).toFixed(2) : '0.00';

        const aggAll = aggregateRollup(rollAll);
        const aggRange = aggregateRollup(rollRange);
        const aggToday = aggregateRollup(rollToday);
        const aggMonth = aggregateRollup(rollMonth);
        const rangeCost = (range || '30') === 'all' ? aggAll.cost : aggRange.cost;
        const profit = estimatedProfit(rangeRevenue, rangeCost);
        const alerts = costAlerts(aggToday.cost, aggMonth.cost, aggMonth.byUser);

        return res.status(200).json({
          totalUsers, newToday, newThisWeek, newThisMonth, newThis90,
          activeToday, activeThisWeek, activeThis90,
          revenueThisWeek, revenueThis90, revenue_range: moneyUsd(rangeRevenue),
          estimated_profit: profit,
          freeUsers: totalUsers - activeSubs.length,
          proUsers: activeSubs.length,
          monthly, yearly, promo: promoCount, cancelled, revoked, past_due: pastDue,
          mrr: Math.round(mrr * 100) / 100,
          arr: Math.round(arr * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
          revenueToday: Math.round(revenueToday * 100) / 100,
          conversionRate, churnRate, avgRevenuePerUser,
          totalScansAllUsers: aggAll.scans,
          avgScansPerUser: totalUsers > 0 ? (aggAll.scans / totalUsers).toFixed(1) : '0.0',
          suspendedAccounts,
          usage_tracking_started_at: trackingStarted,
          usage: {
            range: range || '30',
            scans: aggRange.scans,
            director: aggRange.director,
            research: aggRange.research,
            ai_requests: aggRange.ai,
            api_cost: moneyUsd(aggRange.cost),
            scans_all_time: aggAll.scans,
            director_all_time: aggAll.director,
            ai_all_time: aggAll.ai,
            api_cost_all_time: moneyUsd(aggAll.cost),
            api_cost_today: moneyUsd(aggToday.cost),
            api_cost_month: moneyUsd(aggMonth.cost),
            avg_cost_per_scan: aggRange.scans > 0 ? moneyUsd(aggRange.cost / aggRange.scans) : null,
            avg_cost_per_active_user: (range || '30') === 'today' && activeToday > 0
              ? moneyUsd(aggRange.cost / activeToday)
              : null,
            failed_requests: errors.failed,
            rate_limited: errors.rate_limited,
            server_errors: errors.server
          },
          cost_alerts: alerts,
          ledger: ledger || { ok: false, error: 'unknown' }
        });
      }

      case 'signups_chart': {
        const numDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
        const since = new Date();
        since.setDate(since.getDate() - numDays);
        const r = await fetch(`${SUPA_URL}/rest/v1/users?select=first_seen&first_seen=gte.${since.toISOString()}`, { headers: h });
        const data = await r.json();
        const buckets = buildDailyBuckets(numDays);
        if (Array.isArray(data)) {
          data.forEach(u => {
            const key = (u.first_seen || '').slice(0, 10);
            if (key in buckets) buckets[key]++;
          });
        }
        return res.status(200).json({
          labels: Object.keys(buckets),
          values: Object.values(buckets)
        });
      }

      case 'revenue_chart': {
        const numDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
        const since = new Date();
        since.setDate(since.getDate() - numDays);
        const r = await fetch(`${SUPA_URL}/rest/v1/subscription_events?select=created_at,amount,event_type&created_at=gte.${since.toISOString()}`, { headers: h });
        const data = await r.json();
        const buckets = buildDailyBuckets(numDays);
        if (Array.isArray(data)) {
          data.forEach(e => {
            if ((e.event_type === 'checkout.completed' || e.event_type === 'payment.succeeded') && e.amount) {
              const key = (e.created_at || '').slice(0, 10);
              if (key in buckets) buckets[key] += parseFloat(e.amount);
            }
          });
        }
        return res.status(200).json({
          labels: Object.keys(buckets),
          values: Object.values(buckets).map(v => Math.round(v * 100) / 100)
        });
      }

      case 'daily_analytics': {
        const trackingStarted = await fetchSetting('usage_tracking_started_at');
        const days = rangeDayCount(range || days || '30');
        let since = rangeSince(range || (days === 7 ? '7' : days === 90 ? '90' : days === 1 ? 'today' : '30'));
        if (range === 'all' || (!range && parseInt(days, 10) > 90)) since = isoDaysAgo(180);
        if (trackingStarted) {
          const trackMs = new Date(trackingStarted).getTime();
          if (Number.isFinite(trackMs) && (!since || new Date(since).getTime() < trackMs)) {
            since = new Date(trackMs).toISOString();
          }
        }
        const keys = buildUtcDayKeys(days);
        const clipped = trackingStarted
          ? keys.filter((k) => k >= String(trackingStarted).slice(0, 10))
          : keys;
        const useKeys = clipped.length ? clipped : keys;

        const rpc = await fetchDailyUsageRpc(since);
        let usageMaps;
        if (rpc && rpc.length && rpc[0] && rpc[0].day != null) {
          const scans = {};
          const ai = {};
          const dau = {};
          const api_cost = {};
          rpc.forEach((row) => {
            const key = utcDateKey(row.day);
            if (!key) return;
            scans[key] = parseInt(row.scans, 10) || 0;
            ai[key] = parseInt(row.ai_requests, 10) || 0;
            dau[key] = parseInt(row.active_users, 10) || 0;
            api_cost[key] = parseFloat(row.cost_sum) || 0;
          });
          usageMaps = { scans, ai, dau, api_cost };
        } else {
          usageMaps = usageRowsToDailyMaps(await fetchDailyUsageFromTable(since));
        }

        const [userRows, payRows] = await Promise.all([
          jsonArr(
            `${SUPA_URL}/rest/v1/users?select=first_seen` +
              (since ? `&first_seen=gte.${encodeURIComponent(since)}` : '') +
              `&limit=4000`
          ),
          jsonArr(
            `${SUPA_URL}/rest/v1/subscription_events?select=created_at,amount,event_type` +
              (since ? `&created_at=gte.${encodeURIComponent(since)}` : '') +
              `&limit=4000`
          )
        ]);
        const signups = {};
        userRows.forEach((u) => {
          const key = utcDateKey(u.first_seen);
          if (key) signups[key] = (signups[key] || 0) + 1;
        });
        const revenue = {};
        payRows.forEach((e) => {
          if ((e.event_type === 'checkout.completed' || e.event_type === 'payment.succeeded') && e.amount) {
            const key = utcDateKey(e.created_at);
            if (key) revenue[key] = (revenue[key] || 0) + parseFloat(e.amount);
          }
        });
        const series = mergeDailySeries(useKeys, {
          scans: usageMaps.scans,
          ai: usageMaps.ai,
          dau: usageMaps.dau,
          signups,
          revenue,
          api_cost: usageMaps.api_cost
        });
        let dod = null;
        if (series.length >= 2) {
          const a = series[series.length - 2];
          const b = series[series.length - 1];
          dod = { prev: a.api_cost, today: b.api_cost };
        }
        return res.status(200).json({
          usage_tracking_started_at: trackingStarted,
          range: range || String(days),
          series,
          labels: series.map((p) => p.day),
          cost_alerts: costAlerts(dod ? dod.today : 0, 0, {}, dod ? { dod } : {}),
          note: trackingStarted
            ? 'Series start at the first day usage tracking was enabled. Earlier days are omitted, not reconstructed as zero.'
            : 'Usage tracking has not started. Run supabase_admin_console.sql. This series is not historical reconstruction.'
        });
      }

      case 'users_list': {
        let usersUrl = `${SUPA_URL}/rest/v1/users?select=*&order=first_seen.desc&limit=500`;
        if (safeSearch) {
          usersUrl += `&or=(email.ilike.*${encodeURIComponent(safeSearch)}*,name.ilike.*${encodeURIComponent(safeSearch)}*,user_id.ilike.*${encodeURIComponent(safeSearch)}*)`;
        }

        const [users, subs, members, rollAll, rollDay, trackingStarted] = await Promise.all([
          jsonArr(usersUrl),
          jsonArr(`${SUPA_URL}/rest/v1/subscriptions?select=*`),
          jsonArr(`${SUPA_URL}/rest/v1/workspace_members?select=user_id,workspace_id,role&limit=2000`),
          fetchUsageRollup(null),
          fetchUsageRollup(isoDaysAgo(1)),
          fetchSetting('usage_tracking_started_at')
        ]);

        const aggAll = aggregateRollup(rollAll);
        const aggDay = aggregateRollup(rollDay);
        const flags = highUsageFlags(aggDay.byUser, 24);
        const flagSet = new Set(flags.map((f) => f.user_id));

        const subsByUserId = {};
        const subsByEmail = {};
        subs.forEach(s => {
          if (s.user_id) subsByUserId[s.user_id] = s;
          if (s.email) subsByEmail[s.email] = s;
        });
        const wsCount = {};
        members.forEach((m) => {
          if (!m.user_id) return;
          wsCount[m.user_id] = (wsCount[m.user_id] || 0) + 1;
        });

        const now = Date.now();
        let merged = users.map(u => {
          const sub = subsByUserId[u.user_id] || subsByEmail[u.email] || null;
          const usage = aggAll.byUser[u.user_id] || { scans: 0, director: 0, research: 0, ai: 0, cost: 0 };
          const trialActive =
            (u.director_trial_ends_at && new Date(u.director_trial_ends_at).getTime() > now) ||
            (u.studio_trial_ends_at && new Date(u.studio_trial_ends_at).getTime() > now);
          return {
            user_id: u.user_id,
            email: u.email,
            name: u.name,
            avatar: u.avatar,
            provider: u.provider,
            first_seen: u.first_seen,
            last_seen: u.last_seen,
            total_scans: usage.scans,
            director_requests: usage.director,
            ai_requests: usage.ai,
            api_cost: moneyUsd(usage.cost),
            plan: isProSub(sub) ? 'pro' : 'free',
            status: sub ? sub.status : 'none',
            account_status: u.account_status === 'suspended' ? 'suspended' : 'active',
            account_status_reason: u.account_status_reason || null,
            account_status_at: u.account_status_at || null,
            account_status_by: u.account_status_by || null,
            billing_interval: sub ? sub.billing_interval : null,
            notes: sub ? sub.notes : null,
            onboarding_completed: u.onboarding_reward_granted === true,
            trial: !!trialActive,
            workspace_count: wsCount[u.user_id] || 0,
            high_usage: flagSet.has(u.user_id)
          };
        });

        const seenIds = new Set(users.map(u => u.user_id));
        const seenEmails = new Set(users.map(u => u.email).filter(Boolean));
        subs.forEach(s => {
          if (!seenIds.has(s.user_id) && !seenEmails.has(s.email)) {
            merged.push({
              user_id: s.user_id, email: s.email, name: null, avatar: null, provider: null,
              first_seen: s.started_at, last_seen: s.updated_at, total_scans: 0,
              director_requests: 0, ai_requests: 0, api_cost: 0,
              plan: isProSub(s) ? 'pro' : 'free', status: s.status,
              account_status: 'active',
              billing_interval: s.billing_interval, notes: s.notes,
              onboarding_completed: false, trial: false, workspace_count: 0, high_usage: false
            });
          }
        });

        if (plan_filter === 'pro') merged = merged.filter(m => m.plan === 'pro');
        if (plan_filter === 'free') merged = merged.filter(m => m.plan === 'free');
        if (status_filter === 'suspended') merged = merged.filter(m => m.account_status === 'suspended');
        if (status_filter === 'active') merged = merged.filter(m => m.account_status !== 'suspended');

        const weekAgo = Date.now() - 7 * 86400000;
        if (segment === 'new_7d') merged = merged.filter(m => m.first_seen && new Date(m.first_seen).getTime() >= weekAgo);
        if (segment === 'onboard_incomplete') merged = merged.filter(m => !m.onboarding_completed);
        if (segment === 'onboard_complete') merged = merged.filter(m => m.onboarding_completed);
        if (segment === 'no_scans') merged = merged.filter(m => !m.total_scans);
        if (segment === 'high_usage') merged = merged.filter(m => m.high_usage);
        if (segment === 'trial') merged = merged.filter(m => m.trial);
        if (segment === 'workspace') merged = merged.filter(m => m.workspace_count > 0);

        const sortKey = sort || 'newest';
        merged.sort((a, b) => {
          if (sortKey === 'oldest') return new Date(a.first_seen || 0) - new Date(b.first_seen || 0);
          if (sortKey === 'spend') return (b.api_cost || 0) - (a.api_cost || 0);
          if (sortKey === 'scans') return (b.total_scans || 0) - (a.total_scans || 0);
          if (sortKey === 'last_active') return new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
          return new Date(b.first_seen || 0) - new Date(a.first_seen || 0);
        });

        return res.status(200).json({
          users: merged,
          usage_tracking_started_at: trackingStarted,
          high_usage_flags: flags
        });
      }

      case 'user_detail': {
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        const uid = user_id.slice(0, 128);
        const [users, subs, members, events, usageRows, trackingStarted] = await Promise.all([
          jsonArr(`${SUPA_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(uid)}&select=*&limit=1`),
          jsonArr(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(uid)}&select=*&limit=1`),
          jsonArr(`${SUPA_URL}/rest/v1/workspace_members?user_id=eq.${encodeURIComponent(uid)}&select=workspace_id,role,created_at`),
          jsonArr(`${SUPA_URL}/rest/v1/subscription_events?user_id=eq.${encodeURIComponent(uid)}&select=event_type,amount,created_at&order=created_at.desc&limit=20`),
          jsonArr(`${SUPA_URL}/rest/v1/usage_events?user_id=eq.${encodeURIComponent(uid)}&select=id,event_type,provider,model,input_units,output_units,estimated_cost,status,created_at&order=created_at.desc&limit=40`),
          fetchSetting('usage_tracking_started_at')
        ]);
        const user = users[0] || null;
        const sub = subs[0] || null;
        const wsIds = members.map((m) => m.workspace_id).filter(Boolean);
        let workspaces = [];
        if (wsIds.length) {
          const ws = await jsonArr(
            `${SUPA_URL}/rest/v1/workspaces?id=in.(${wsIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,name,kind,created_at`
          );
          const byId = {};
          ws.forEach((w) => { byId[w.id] = w; });
          workspaces = members.map((m) => ({
            workspace_id: m.workspace_id,
            role: m.role,
            name: (byId[m.workspace_id] && byId[m.workspace_id].name) || null,
            kind: (byId[m.workspace_id] && byId[m.workspace_id].kind) || null,
            joined_at: m.created_at
          }));
        }
        const rollAll = aggregateRollup(await fetchUsageRollup(null));
        const rollMonth = aggregateRollup(await fetchUsageRollup(startOfUtcMonth()));
        const uAll = rollAll.byUser[uid] || { scans: 0, director: 0, ai: 0, cost: 0, research: 0 };
        const uMonth = rollMonth.byUser[uid] || { scans: 0, director: 0, ai: 0, cost: 0, research: 0 };
        const userBreakdown = {};
        usageRows.forEach((row) => {
          const key = [row.provider || 'unknown', row.model || 'unknown', row.event_type].join('|');
          if (!userBreakdown[key]) {
            userBreakdown[key] = {
              provider: row.provider || 'unknown',
              model: row.model || 'unknown',
              event_type: row.event_type,
              count: 0,
              cost: 0
            };
          }
          userBreakdown[key].count += 1;
          userBreakdown[key].cost += parseFloat(row.estimated_cost) || 0;
        });
        const account = await getAccountStatus(uid);
        const authUser = await fetchAuthUserAdmin(uid);
        const revenue = events
          .filter((e) => (e.event_type === 'checkout.completed' || e.event_type === 'payment.succeeded') && e.amount)
          .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const contribution = estimatedProfit(revenue, uAll.cost);
        const scanDays = {};
        usageRows.forEach((row) => {
          if (row.event_type !== 'scan') return;
          const key = utcDateKey(row.created_at);
          if (key) scanDays[key] = (scanDays[key] || 0) + 1;
        });
        await writeAdminAudit({
          action: 'user_viewed',
          targetUserId: uid,
          ip,
          metadata: { result: user ? 'ok' : 'not_found' }
        });
        return res.status(200).json({
          user: user
            ? {
                user_id: user.user_id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                provider: user.provider,
                first_seen: user.first_seen,
                last_seen: user.last_seen,
                onboarding_completed: user.onboarding_reward_granted === true,
                director_trial_ends_at: user.director_trial_ends_at || null,
                studio_trial_ends_at: user.studio_trial_ends_at || null
              }
            : { user_id: uid, email: sub && sub.email },
          account_status: account,
          subscription: sub
            ? {
                plan: isProSub(sub) ? 'pro' : 'free',
                status: sub.status,
                billing_interval: sub.billing_interval,
                started_at: sub.started_at,
                notes: sub.notes,
                revoked_at: sub.revoked_at || null,
                revoked_reason: sub.revoked_reason || null
              }
            : null,
          usage: {
            scans: uAll.scans,
            director_requests: uAll.director,
            research: uAll.research,
            ai_requests: uAll.ai,
            api_cost: moneyUsd(uAll.cost),
            scans_month: uMonth.scans,
            director_month: uMonth.director,
            api_cost_month: moneyUsd(uMonth.cost)
          },
          breakdown: Object.values(userBreakdown).sort((a, b) => b.cost - a.cost),
          workspaces,
          revenue: moneyUsd(revenue),
          estimated_contribution: contribution,
          scans_over_time: Object.keys(scanDays)
            .sort()
            .slice(-30)
            .map((day) => ({ day, scans: scanDays[day] })),
          billing_events: events.map((e) => ({
            event_type: e.event_type,
            amount: e.amount || null,
            created_at: e.created_at
          })),
          recent_usage: usageRows,
          auth: authUser
            ? {
                last_sign_in_at: authUser.last_sign_in_at || null,
                created_at: authUser.created_at || null,
                banned_until: authUser.banned_until || null,
                email_confirmed_at: authUser.email_confirmed_at || null,
                providers: (authUser.app_metadata && authUser.app_metadata.providers) || null
              }
            : null,
          usage_tracking_started_at: trackingStarted
        });
      }

      case 'usage_overview': {
        const since = rangeSince(range || '30');
        const [trackingStarted, roll, rollAll, errors] = await Promise.all([
          fetchSetting('usage_tracking_started_at'),
          fetchUsageRollup(since),
          fetchUsageRollup(null),
          countProductErrors(since || isoDaysAgo(30))
        ]);
        const agg = aggregateRollup(roll);
        const aggAll = aggregateRollup(rollAll);
        const usersInRange = Object.keys(agg.byUser).filter((id) => id !== '_').length;
        return res.status(200).json({
          usage_tracking_started_at: trackingStarted,
          range: range || '30',
          scans: agg.scans,
          director: agg.director,
          research: agg.research,
          ai_requests: agg.ai,
          api_cost: moneyUsd(agg.cost),
          avg_cost_per_scan: agg.scans > 0 ? moneyUsd(agg.cost / agg.scans) : null,
          avg_cost_per_active_user: usersInRange > 0 ? moneyUsd(agg.cost / usersInRange) : null,
          all_time: {
            scans: aggAll.scans,
            director: aggAll.director,
            ai_requests: aggAll.ai,
            api_cost: moneyUsd(aggAll.cost)
          },
          breakdown: agg.breakdown.map((row) => ({
            provider: row.provider,
            model: row.model,
            event_type: row.event_type,
            count: row.count,
            cost: moneyUsd(row.cost)
          })),
          errors,
          cost_alerts: costAlerts(
            aggregateRollup(await fetchUsageRollup(startOfUtcDay())).cost,
            aggregateRollup(await fetchUsageRollup(startOfUtcMonth())).cost,
            aggregateRollup(await fetchUsageRollup(startOfUtcMonth())).byUser
          )
        });
      }

      case 'list': {
        let url = `${SUPA_URL}/rest/v1/subscriptions?select=*&order=created_at.desc&limit=200`;
        if (safeSearch) url += `&or=(email.ilike.*${encodeURIComponent(safeSearch)}*,user_id.ilike.*${encodeURIComponent(safeSearch)}*)`;
        const r = await fetch(url, { headers: h });
        const data = await r.json();
        return res.status(200).json({ subscribers: Array.isArray(data) ? data : [] });
      }

      case 'stats': {
        const r = await fetch(`${SUPA_URL}/rest/v1/subscriptions?select=plan,status,billing_interval`, { headers: h });
        const data = await r.json();
        if (!Array.isArray(data)) return res.status(200).json({ error: 'DB error' });
        const active = data.filter(d => isProSub(d));
        const monthly = active.filter(d => d.billing_interval === 'monthly').length;
        const yearly = active.filter(d => d.billing_interval === 'yearly').length;
        return res.status(200).json({
          total: data.length,
          active: active.length,
          monthly, yearly,
          promo: data.filter(d => d.status === 'promo').length,
          cancelled: data.filter(d => d.status === 'cancelled').length,
          revoked: data.filter(d => d.status === 'revoked').length,
          past_due: data.filter(d => d.status === 'past_due').length,
          mrr: Math.round((monthly * 9 + yearly * (79 / 12)) * 100) / 100
        });
      }

      case 'events': {
        const r = await fetch(`${SUPA_URL}/rest/v1/subscription_events?select=*&order=created_at.desc&limit=50`, { headers: h });
        const data = await r.json();
        return res.status(200).json({ events: Array.isArray(data) ? data : [] });
      }

      case 'promo_log': {
        const r = await fetch(`${SUPA_URL}/rest/v1/promo_usage?select=*&order=used_at.desc&limit=100`, { headers: h });
        const data = await r.json();
        return res.status(200).json({ usage: Array.isArray(data) ? data : [] });
      }

      case 'revoke': {
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ plan: 'free', status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: String(reason || 'Admin revoke').slice(0, 500), updated_at: new Date().toISOString() })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id, event_type: 'admin.revoked', payload: { reason: String(reason || 'Admin revoke').slice(0, 500) } })
        });
        await writeAdminAudit({
          action: 'subscription_revoked',
          targetUserId: user_id,
          ip,
          metadata: { reason: String(reason || '').slice(0, 200) }
        });
        return res.status(200).json({ success: true });
      }

      case 'restore': {
        /* Subscription restore must NOT grant Pro. Clear revoke flags only. */
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({
            plan: 'free',
            status: 'cancelled',
            revoked_at: null,
            revoked_reason: null,
            updated_at: new Date().toISOString()
          })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id, event_type: 'admin.subscription_restore', payload: {} })
        });
        await writeAdminAudit({
          action: 'subscription_restore',
          targetUserId: user_id,
          ip,
          metadata: { granted_pro: false }
        });
        return res.status(200).json({ success: true, granted_pro: false });
      }

      case 'suspend_user': {
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        if (!confirm_password || !verifyAdminSecret(String(confirm_password))) {
          return res.status(403).json({ error: 'reauth_required', message: 'Re-enter the admin password to suspend an account.' });
        }
        const targetEmail = typeof email === 'string' ? email : null;
        const result = await setAccountStatus(user_id, 'suspended', {
          reason: String(reason || 'Admin suspend').slice(0, 500),
          by: 'admin',
          email: targetEmail
        });
        await writeAdminAudit({
          action: 'user_suspended',
          targetUserId: user_id,
          ip,
          metadata: { reason: String(reason || '').slice(0, 200) }
        });
        return res.status(200).json({ success: true, status: result.status });
      }

      case 'restore_user': {
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        const result = await setAccountStatus(user_id, 'active', {
          reason: String(reason || 'Admin restore').slice(0, 500),
          by: 'admin',
          email: typeof email === 'string' ? email : null
        });
        await writeAdminAudit({
          action: 'user_restored',
          targetUserId: user_id,
          ip,
          metadata: { granted_pro: false }
        });
        return res.status(200).json({ success: true, status: result.status, granted_pro: false });
      }

      case 'grant': {
        if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email required' });
        const uid = (typeof user_id === 'string' && user_id) ? user_id : ('manual_' + Date.now());
        await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
          method: 'POST',
          headers: { ...h, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ user_id: uid, email: email.slice(0, 320), plan: 'pro', status: 'promo', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id: uid, email: email.slice(0, 320), event_type: 'admin.granted', payload: { reason: String(reason || 'Manual grant').slice(0, 500) } })
        });
        await writeAdminAudit({
          action: 'plan_changed',
          targetUserId: uid,
          ip,
          metadata: { plan: 'pro', status: 'promo' }
        });
        return res.status(200).json({ success: true });
      }

      case 'note': {
        if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ notes: String(reason || '').slice(0, 2000), updated_at: new Date().toISOString() })
        });
        return res.status(200).json({ success: true });
      }

      case 'product_overview': {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const [evR, usersR] = await Promise.all([
          fetch(
            `${SUPA_URL}/rest/v1/product_events?select=user_id,event,meta,created_at&created_at=gte.${since.toISOString()}&order=created_at.desc&limit=5000`,
            { headers: h }
          ),
          fetch(`${SUPA_URL}/rest/v1/users?select=user_id,first_seen,last_seen`, { headers: h })
        ]);
        const events = await evR.json();
        const users = await usersR.json();
        const list = Array.isArray(events) ? events : [];
        const userList = Array.isArray(users) ? users : [];

        function countEvent(name) {
          return list.filter((e) => e.event === name).length;
        }
        function uniqueUsers(name) {
          const s = new Set();
          list.forEach((e) => {
            if (e.event === name && e.user_id) s.add(e.user_id);
          });
          return s.size;
        }

        const ideaUsers = new Set();
        const prodUsers = new Set();
        list.forEach((e) => {
          if (e.event === 'idea_generated' && e.user_id) ideaUsers.add(e.user_id);
          if (e.event === 'production_created' && e.user_id) prodUsers.add(e.user_id);
        });
        let activated = 0;
        ideaUsers.forEach((id) => {
          if (prodUsers.has(id)) activated += 1;
        });

        const dirOk = countEvent('director_action_success');
        const dirFail = countEvent('director_action_failure');
        const dirReq = countEvent('director_action_requested') || dirOk + dirFail;
        const actionSuccessRate =
          dirOk + dirFail > 0 ? ((dirOk / (dirOk + dirFail)) * 100).toFixed(1) : null;

        let aiCost = 0;
        let aiCalls = 0;
        list.forEach((e) => {
          if (e.event !== 'ai_request') return;
          aiCalls += 1;
          const c = e.meta && e.meta.cost_usd;
          if (typeof c === 'number') aiCost += c;
        });

        const now = Date.now();
        function retention(days) {
          const cohort = userList.filter((u) => {
            if (!u.first_seen) return false;
            const age = (now - new Date(u.first_seen).getTime()) / 86400000;
            return age >= days;
          });
          if (!cohort.length) return null;
          const returned = cohort.filter((u) => {
            if (!u.last_seen || !u.first_seen) return false;
            const gap =
              (new Date(u.last_seen).getTime() - new Date(u.first_seen).getTime()) / 86400000;
            return gap >= days;
          }).length;
          return {
            eligible: cohort.length,
            returned,
            rate: ((returned / cohort.length) * 100).toFixed(1)
          };
        }

        const mobile = list.filter((e) => e.meta && e.meta.surface === 'mobile').length;
        const desktop = list.filter((e) => e.meta && e.meta.surface === 'desktop').length;

        return res.status(200).json({
          ok: true,
          window_days: 30,
          events_sampled: list.length,
          funnel: {
            signups: uniqueUsers('signup') || countEvent('signup'),
            onboarding_completed: uniqueUsers('onboarding_completed'),
            scans_completed: countEvent('scan_completed'),
            ideas: countEvent('idea_generated'),
            productions: countEvent('production_created'),
            director_opened: countEvent('director_opened'),
            checkout_started: countEvent('checkout_started'),
            subscriptions_started: countEvent('subscription_started')
          },
          activation: {
            definition: 'idea_generated AND production_created',
            activated_users: activated,
            idea_users: ideaUsers.size,
            production_users: prodUsers.size
          },
          director: {
            requested: dirReq,
            success: dirOk,
            failure: dirFail,
            action_success_rate: actionSuccessRate
          },
          ai: {
            requests: aiCalls,
            estimated_cost_usd: Number(aiCost.toFixed(4))
          },
          retention: {
            d1: retention(1),
            d7: retention(7),
            d30: retention(30)
          },
          surface: { mobile, desktop },
          referrals: {
            clicked: countEvent('referral_clicked'),
            signups: countEvent('referral_signup'),
            activations: countEvent('referral_activation')
          }
        });
      }

      case 'security_overview': {
        const [suspended, audit, authAudit, errors, rollDay, trackingStarted] = await Promise.all([
          jsonArr(`${SUPA_URL}/rest/v1/users?account_status=eq.suspended&select=user_id,email,name,account_status_reason,account_status_at,account_status_by,last_seen&order=account_status_at.desc&limit=50`),
          jsonArr(`${SUPA_URL}/rest/v1/admin_audit_log?select=id,admin_id,action,target_user_id,ip,metadata,created_at&order=created_at.desc&limit=40`),
          fetchAuthAudit(40),
          countProductErrors(isoDaysAgo(7)),
          fetchUsageRollup(isoDaysAgo(1)),
          fetchSetting('usage_tracking_started_at')
        ]);
        const flags = highUsageFlags(aggregateRollup(rollDay).byUser, 24);
        const failedLogins = (authAudit.entries || []).filter((e) =>
          /login|token|user/i.test(String(e.payload_type || '')) &&
          /fail|error|unauthor/i.test(String(e.payload_type || ''))
        );
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recentSignups = await jsonArr(
          `${SUPA_URL}/rest/v1/users?select=user_id&first_seen=gte.${encodeURIComponent(hourAgo)}&limit=200`
        );
        const signals = suspiciousSignals({
          signupsLastHour: recentSignups.length,
          errors,
          highUsage: flags,
          failedInvites: 0
        });
        return res.status(200).json({
          usage_tracking_started_at: trackingStarted,
          suspended_accounts: suspended,
          recent_admin_actions: audit,
          auth_audit: authAudit,
          failed_login_signals: failedLogins,
          errors_7d: errors,
          high_usage: flags,
          signup_last_hour: recentSignups.length,
          signals,
          note: 'Auth history is sourced from Supabase Auth audit entries when available. This is not a SIEM. Flags are review-only and do not ban accounts. Invite-failure counts are not shown unless that event is recorded. Admin cannot read scan images, ideas, Studio documents, or Director conversations from these endpoints.'
        });
      }

      case 'system_health': {
        const health = await probeSystem();
        const errors = await countProductErrors(isoDaysAgo(7));
        return res.status(200).json({
          checks: health,
          errors_7d: errors,
          spend_thresholds: spendThresholds(),
          email: emailProviderStatus(),
          note: 'AI operational means a provider key is present. A live Anthropic call is not made from this check. Request latency lives in Vercel runtime logs.'
        });
      }

      case 'audit_log': {
        const rows = await jsonArr(
          `${SUPA_URL}/rest/v1/admin_audit_log?select=id,admin_id,action,target_user_id,ip,metadata,created_at&order=created_at.desc&limit=100`
        );
        return res.status(200).json({ entries: rows });
      }

      case 'message_log': {
        const rows = await jsonArr(
          `${SUPA_URL}/rest/v1/admin_email_log?select=id,campaign_id,admin_id,recipient_user_id,recipient_email,subject,status,provider,provider_message_id,error,sent_at&order=sent_at.desc&limit=100`
        );
        return res.status(200).json({
          entries: rows,
          provider: emailProviderStatus()
        });
      }

      case 'message_send': {
        const list = Array.isArray(recipients) ? recipients : [];
        const cleaned = [];
        const seen = new Set();
        list.forEach((item) => {
          const addr = String((item && item.email) || '').trim().slice(0, 320);
          const uid = item && item.user_id ? String(item.user_id).slice(0, 128) : null;
          if (!addr || !addr.includes('@')) return;
          const key = addr.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          cleaned.push({ email: addr, user_id: uid });
        });
        const subj = String(subject || '').trim().slice(0, 200);
        const text = String(message || '').trim().slice(0, 8000);
        if (!cleaned.length) return res.status(400).json({ error: 'no_recipients' });
        if (!subj || !text) return res.status(400).json({ error: 'subject_and_message_required' });
        if (Number(confirm_count) !== cleaned.length) {
          return res.status(400).json({
            error: 'confirm_count_mismatch',
            recipients: cleaned.length
          });
        }
        if (cleaned.length >= 20 && confirm_large !== true) {
          return res.status(400).json({
            error: 'large_batch_confirmation_required',
            recipients: cleaned.length
          });
        }
        if (cleaned.length > 50) {
          return res.status(400).json({ error: 'too_many_recipients', max: 50 });
        }

        const provider = emailProviderStatus();
        const campaignId = crypto.randomUUID();
        const results = [];
        for (let i = 0; i < cleaned.length; i++) {
          const rec = cleaned[i];
          let status = 'pending';
          let providerMessageId = null;
          let err = null;
          let sentProvider = null;
          if (!provider.configured) {
            status = 'failed';
            err = 'email_not_configured';
          } else {
            const sent = await sendTransactionalEmail({
              to: rec.email,
              subject: subj,
              text
            });
            if (sent.ok) {
              status = 'sent';
              providerMessageId = sent.provider_message_id || null;
              sentProvider = sent.provider || 'resend';
            } else {
              status = 'failed';
              err = String(sent.error || 'provider_failed').slice(0, 80);
            }
          }
          await fetch(`${SUPA_URL}/rest/v1/admin_email_log`, {
            method: 'POST',
            headers: { ...h, Prefer: 'return=minimal' },
            body: JSON.stringify({
              campaign_id: campaignId,
              admin_id: 'admin',
              recipient_user_id: rec.user_id,
              recipient_email: rec.email,
              subject: subj,
              status,
              provider: sentProvider,
              provider_message_id: providerMessageId,
              error: err,
              sent_at: new Date().toISOString()
            })
          });
          results.push({
            email: rec.email,
            user_id: rec.user_id,
            status,
            error: err
          });
        }
        const sentCount = results.filter((r) => r.status === 'sent').length;
        await writeAdminAudit({
          action: 'email_sent',
          ip,
          metadata: {
            campaign_id: campaignId,
            recipients: cleaned.length,
            sent: sentCount,
            configured: provider.configured
          }
        });
        return res.status(200).json({
          campaign_id: campaignId,
          configured: provider.configured,
          provider: provider.provider,
          recipients: cleaned.length,
          sent: sentCount,
          failed: results.length - sentCount,
          results,
          message: provider.configured
            ? null
            : 'No email provider is connected. Messages were recorded as failed. Set RESEND_API_KEY to enable delivery.'
        });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Admin error:', err.message);
    return res.status(500).json({ error: 'admin_failed' });
  }
}
