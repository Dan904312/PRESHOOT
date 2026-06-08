// api/check-plan.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email } = req.body || {};
  if (!user_id && !email) return res.status(200).json({ plan: 'free', status: 'none' });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(200).json({ plan: 'free', status: 'no_config' });

  try {
    const param = user_id ? `user_id=eq.${encodeURIComponent(user_id)}` : `email=eq.${encodeURIComponent(email)}`;
    const r = await fetch(`${SUPA_URL}/rest/v1/subscriptions?${param}&select=plan,status&limit=1`, {
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY
      }
    });
    const rows = await r.json();
    if (!rows || !rows.length) return res.status(200).json({ plan: 'free', status: 'none' });
    const row = rows[0];
    const isPro = row.plan === 'pro' && ['active', 'promo', 'trialing'].includes(row.status);
    return res.status(200).json({ plan: isPro ? 'pro' : 'free', status: row.status });
  } catch (err) {
    console.error('check-plan error:', err.message);
    return res.status(200).json({ plan: 'free', status: 'error' });
  }
}
