// api/promo.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, user_id, email } = req.body || {};
  if (!code) return res.status(400).json({ valid: false });

  const rawCodes = process.env.PROMO_CODES || '';
  const validCodes = rawCodes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const isValid = validCodes.includes(code.trim().toUpperCase());

  if (!isValid) return res.status(200).json({ valid: false });

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (SUPA_URL && SUPA_KEY) {
    try {
      const h = {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Prefer': 'resolution=merge-duplicates'
      };

      await fetch(`${SUPA_URL}/rest/v1/promo_usage`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ code: code.trim().toUpperCase(), user_id: user_id || null, email: email || null })
      });

      await fetch(`${SUPA_URL}/rest/v1/subscriptions`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          user_id: user_id || ('promo_' + Date.now()),
          email: email || null,
          plan: 'pro',
          status: 'promo',
          promo_code: code.trim().toUpperCase(),
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      await fetch(`${SUPA_URL}/rest/v1/subscription_events`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          user_id: user_id || null, email: email || null,
          event_type: 'promo.applied',
          payload: { code: code.trim().toUpperCase() }
        })
      });
    } catch (err) {
      console.error('Promo DB error:', err.message);
    }
  }

  return res.status(200).json({ valid: true });
}
