// api/promo.js
// Validates promo codes and records usage in Supabase
// POST { code, user_id, email }

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, user_id, email } = req.body || {};
  if (!code) return res.status(400).json({ valid: false });

  // Validate code against env variable
  const rawCodes = process.env.PROMO_CODES || '';
  const validCodes = rawCodes.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const isValid = validCodes.includes(code.trim().toUpperCase());

  if (!isValid) return res.status(200).json({ valid: false });

  // Write to Supabase
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Log promo usage
    await db.from('promo_usage').insert({
      code: code.trim().toUpperCase(),
      user_id: user_id || null,
      email: email || null
    });

    // Upsert subscription as promo pro
    if (user_id || email) {
      await db.from('subscriptions').upsert({
        user_id: user_id || 'promo_' + Date.now(),
        email: email || null,
        plan: 'pro',
        status: 'promo',
        promo_code: code.trim().toUpperCase(),
        started_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      await db.from('subscription_events').insert({
        user_id: user_id || null,
        email: email || null,
        event_type: 'promo.applied',
        payload: { code: code.trim().toUpperCase() }
      });
    }
  } catch (err) {
    console.error('Promo Supabase error:', err);
    // Still return valid — don't block user if DB write fails
  }

  return res.status(200).json({ valid: true });
}
