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

  const { action, user_id, email, reason, search } = req.body || {};

  try {
    switch (action) {

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

      case 'list': {
        let url = `${SUPA_URL}/rest/v1/subscriptions?select=*&order=created_at.desc&limit=200`;
        if (search) url += `&or=(email.ilike.*${encodeURIComponent(search)}*,user_id.ilike.*${encodeURIComponent(search)}*)`;
        const r = await fetch(url, { headers: h });
        const data = await r.json();
        return res.status(200).json({ subscribers: Array.isArray(data) ? data : [] });
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
