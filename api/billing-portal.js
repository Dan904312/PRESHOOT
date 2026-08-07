// api/billing-portal.js — Stripe Customer Portal for authenticated user
import {
  setCors,
  handleOptions,
  requireUser,
  getSubscription,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'portal',
    max: 10,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl, 'plain');

  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const allowOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  const returnBase =
    (origin && (allowOrigins.includes(origin) || /localhost|127\.0\.0\.1/.test(origin)))
      ? origin
      : 'https://preshoot.vercel.app';

  try {
    const stripe = require('stripe')(STRIPE_KEY);
    const sub = await getSubscription(auth.user.id, auth.user.email);
    let stripeCustomerId = sub.stripe_customer_id || null;

    if (!stripeCustomerId && auth.user.email) {
      const customers = await stripe.customers.list({ email: auth.user.email, limit: 1 });
      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
      }
    }

    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer found for this user' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${returnBase}/?portal_return=true`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err.message);
    return res.status(500).json({ error: 'portal_failed' });
  }
}
