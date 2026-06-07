// api/check-plan.js
// Called by the app on every load to verify plan server-side
// POST { user_id, email }
// Returns { plan: 'pro'|'free', status: string }

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email } = req.body || {};
  if (!user_id && !email) return res.status(200).json({ plan: 'free', status: 'none' });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let query = db.from('subscriptions').select('plan, status, billing_interval, started_at');
  if (user_id) query = query.eq('user_id', user_id);
  else query = query.eq('email', email);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return res.status(200).json({ plan: 'free', status: 'none' });

  const isPro = data.plan === 'pro' && (data.status === 'active' || data.status === 'promo' || data.status === 'trialing');
  return res.status(200).json({
    plan: isPro ? 'pro' : 'free',
    status: data.status,
    billing_interval: data.billing_interval || null
  });
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
