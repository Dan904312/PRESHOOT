// api/admin-data.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const h = {
    'Content-Type': 'application/json',
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY,
    'Prefer': 'return=representation'
  };

  const { action, user_id, email, reason, search, days, plan_filter } = req.body || {};

  // Helper: build a map of date string -> count for the last N days
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

  try {
    switch (action) {

      // ── OVERVIEW STATS — much richer than before ──
      case 'overview_stats': {
        const [usersR, subsR, eventsR] = await Promise.all([
          fetch(`${SUPA_URL}/rest/v1/users?select=user_id,first_seen,last_seen,total_scans`, { headers: h }),
          fetch(`${SUPA_URL}/rest/v1/subscriptions?select=plan,status,billing_interval,started_at,user_id,email`, { headers: h }),
          fetch(`${SUPA_URL}/rest/v1/subscription_events?select=event_type,amount,created_at`, { headers: h })
        ]);
        const users = await usersR.json();
        const subs = await subsR.json();
        const events = await eventsR.json();

        if (!Array.isArray(users) || !Array.isArray(subs)) {
          return res.status(200).json({ error: 'DB error', usersRaw: users, subsRaw: subs });
        }

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);

        const totalUsers = users.length;
        const newToday = users.filter(u => u.first_seen && u.first_seen.slice(0,10) === todayStr).length;
        const newThisWeek = users.filter(u => u.first_seen && new Date(u.first_seen) >= weekAgo).length;
        const newThisMonth = users.filter(u => u.first_seen && new Date(u.first_seen) >= monthAgo).length;
        const activeToday = users.filter(u => u.last_seen && u.last_seen.slice(0,10) === todayStr).length;
        const activeThisWeek = users.filter(u => u.last_seen && new Date(u.last_seen) >= weekAgo).length;

        const activeSubs = subs.filter(d => d.plan === 'pro' && ['active','promo','trialing'].includes(d.status));
        const monthly = activeSubs.filter(d => d.billing_interval === 'monthly').length;
        const yearly = activeSubs.filter(d => d.billing_interval === 'yearly').length;
        const promoCount = subs.filter(d => d.status === 'promo').length;
        const cancelled = subs.filter(d => d.status === 'cancelled').length;
        const revoked = subs.filter(d => d.status === 'revoked').length;
        const pastDue = subs.filter(d => d.status === 'past_due').length;

        const mrr = (monthly * 10) + (yearly * (60/12));
        const arr = mrr * 12;

        // Total revenue ever collected (sum of amount on payment events, Array safe)
        const revenueEvents = Array.isArray(events) ? events.filter(e => (e.event_type === 'checkout.completed' || e.event_type === 'payment.succeeded') && e.amount) : [];
        const totalRevenue = revenueEvents.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueThisMonth = revenueEvents.filter(e => new Date(e.created_at) >= monthAgo).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
        const revenueToday = revenueEvents.filter(e => e.created_at.slice(0,10) === todayStr).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

        const conversionRate = totalUsers > 0 ? ((activeSubs.length / totalUsers) * 100).toFixed(1) : '0.0';
        const churnedCount = cancelled + revoked;
        const churnRate = (activeSubs.length + churnedCount) > 0 ? ((churnedCount / (activeSubs.length + churnedCount)) * 100).toFixed(1) : '0.0';
        const avgRevenuePerUser = totalUsers > 0 ? (totalRevenue / totalUsers).toFixed(2) : '0.00';
        const totalScansAllUsers = users.reduce((sum, u) => sum + (u.total_scans || 0), 0);
        const avgScansPerUser = totalUsers > 0 ? (totalScansAllUsers / totalUsers).toFixed(1) : '0.0';

        return res.status(200).json({
          // Users
          totalUsers, newToday, newThisWeek, newThisMonth,
          activeToday, activeThisWeek,
          freeUsers: totalUsers - activeSubs.length,
          proUsers: activeSubs.length,
          // Subscriptions
          monthly, yearly, promo: promoCount, cancelled, revoked, past_due: pastDue,
          // Revenue
          mrr: Math.round(mrr * 100) / 100,
          arr: Math.round(arr * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
          revenueToday: Math.round(revenueToday * 100) / 100,
          // Rates
          conversionRate, churnRate, avgRevenuePerUser,
          // Usage
          totalScansAllUsers, avgScansPerUser
        });
      }

      // ── SIGNUPS CHART — daily new users for last N days ──
      case 'signups_chart': {
        const numDays = days || 30;
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

      // ── REVENUE CHART — daily revenue for last N days ──
      case 'revenue_chart': {
        const numDays = days || 30;
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

      // ── ALL USERS — free + pro, joined with subscription data ──
      case 'users_list': {
        let usersUrl = `${SUPA_URL}/rest/v1/users?select=*&order=first_seen.desc&limit=500`;
        if (search) usersUrl += `&or=(email.ilike.*${encodeURIComponent(search)}*,name.ilike.*${encodeURIComponent(search)}*,user_id.ilike.*${encodeURIComponent(search)}*)`;

        const [usersR, subsR] = await Promise.all([
          fetch(usersUrl, { headers: h }),
          fetch(`${SUPA_URL}/rest/v1/subscriptions?select=*`, { headers: h })
        ]);
        const users = await usersR.json();
        const subs = await subsR.json();

        if (!Array.isArray(users)) return res.status(200).json({ error: 'DB error', raw: users });

        const subsByUserId = {};
        const subsByEmail = {};
        if (Array.isArray(subs)) {
          subs.forEach(s => {
            if (s.user_id) subsByUserId[s.user_id] = s;
            if (s.email) subsByEmail[s.email] = s;
          });
        }

        let merged = users.map(u => {
          const sub = subsByUserId[u.user_id] || subsByEmail[u.email] || null;
          const isPro = sub && sub.plan === 'pro' && ['active','promo','trialing'].includes(sub.status);
          return {
            user_id: u.user_id,
            email: u.email,
            name: u.name,
            avatar: u.avatar,
            provider: u.provider,
            first_seen: u.first_seen,
            last_seen: u.last_seen,
            total_scans: u.total_scans || 0,
            plan: isPro ? 'pro' : 'free',
            status: sub ? sub.status : 'none',
            billing_interval: sub ? sub.billing_interval : null,
            notes: sub ? sub.notes : null
          };
        });

        // Also include subscribers who paid but somehow aren't in `users` table yet (edge case safety)
        const seenIds = new Set(users.map(u => u.user_id));
        const seenEmails = new Set(users.map(u => u.email).filter(Boolean));
        if (Array.isArray(subs)) {
          subs.forEach(s => {
            if (!seenIds.has(s.user_id) && !seenEmails.has(s.email)) {
              const isPro = s.plan === 'pro' && ['active','promo','trialing'].includes(s.status);
              merged.push({
                user_id: s.user_id, email: s.email, name: null, avatar: null, provider: null,
                first_seen: s.started_at, last_seen: s.updated_at, total_scans: 0,
                plan: isPro ? 'pro' : 'free', status: s.status, billing_interval: s.billing_interval, notes: s.notes
              });
            }
          });
        }

        if (plan_filter === 'pro') merged = merged.filter(m => m.plan === 'pro');
        if (plan_filter === 'free') merged = merged.filter(m => m.plan === 'free');

        merged.sort((a, b) => new Date(b.first_seen || 0) - new Date(a.first_seen || 0));

        return res.status(200).json({ users: merged });
      }

      // ── Legacy: paying subscribers only (kept for compatibility) ──
      case 'list': {
        let url = `${SUPA_URL}/rest/v1/subscriptions?select=*&order=created_at.desc&limit=200`;
        if (search) url += `&or=(email.ilike.*${encodeURIComponent(search)}*,user_id.ilike.*${encodeURIComponent(search)}*)`;
        const r = await fetch(url, { headers: h });
        const data = await r.json();
        return res.status(200).json({ subscribers: Array.isArray(data) ? data : [] });
      }

      case 'stats': {
        const r = await fetch(`${SUPA_URL}/rest/v1/subscriptions?select=plan,status,billing_interval`, { headers: h });
        const data = await r.json();
        if (!Array.isArray(data)) return res.status(200).json({ error: 'DB error', raw: data });
        const active = data.filter(d => d.plan === 'pro' && ['active','promo','trialing'].includes(d.status));
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
          mrr: (monthly * 10) + (yearly * 5)
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
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ plan: 'free', status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: reason || 'Admin revoke', updated_at: new Date().toISOString() })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id, event_type: 'admin.revoked', payload: { reason: reason || 'Admin revoke' } })
        });
        return res.status(200).json({ success: true });
      }

      case 'restore': {
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ plan: 'pro', status: 'active', revoked_at: null, revoked_reason: null, updated_at: new Date().toISOString() })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id, event_type: 'admin.restored', payload: {} })
        });
        return res.status(200).json({ success: true });
      }

      case 'grant': {
        if (!email) return res.status(400).json({ error: 'email required' });
        const uid = user_id || ('manual_' + Date.now());
        await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
          method: 'POST',
          headers: { ...h, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ user_id: uid, email, plan: 'pro', status: 'promo', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
          method: 'POST', headers: h,
          body: JSON.stringify({ user_id: uid, email, event_type: 'admin.granted', payload: { reason: reason || 'Manual grant' } })
        });
        return res.status(200).json({ success: true });
      }

      case 'note': {
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        await fetch(`${SUPA_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user_id)}`, {
          method: 'PATCH', headers: h,
          body: JSON.stringify({ notes: reason, updated_at: new Date().toISOString() })
        });
        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Admin error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
