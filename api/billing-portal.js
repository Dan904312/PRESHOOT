// api/billing-portal.js
// Creates a Stripe Customer Portal session so users can manage/cancel their subscription
// POST { user_id, email }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, email } = req.body || {};
  if (!user_id && !email) return res.status(400).json({ error: 'user_id or email required' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const stripe = require('stripe')(STRIPE_KEY);

    // Look up their Stripe customer ID from Supabase
    let stripeCustomerId = null;
    if (SUPA_URL && SUPA_KEY) {
      const param = user_id
        ? `user_id=eq.${encodeURIComponent(user_id)}`
        : `email=eq.${encodeURIComponent(email)}`;
      const r = await fetch(`${SUPA_URL}/rest/v1/subscriptions?${param}&select=stripe_customer_id&limit=1`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
      });
      const rows = await r.json();
      if (rows && rows[0] && rows[0].stripe_customer_id) {
        stripeCustomerId = rows[0].stripe_customer_id;
      }
    }

    // If no customer ID found, search Stripe directly by email
    if (!stripeCustomerId && email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
      }
    }

    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer found for this user' });
    }

    // Create billing portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${req.headers.origin || 'https://preshoot.vercel.app'}/?portal_return=true`
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Billing portal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
