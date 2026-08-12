// api/billing-portal.js — Stripe Customer Portal for authenticated user
import {
  setCors,
  handleOptions,
  requireUser,
  getSubscription,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';

function portalReturnBase(req) {
  const allowOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin || '';
  const isProd =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const localhostOk =
    !isProd && origin && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  if (origin && (allowOrigins.includes(origin) || localhostOk)) return origin;
  return process.env.APP_ORIGIN || 'https://preshoot.vercel.app';
}

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

  const returnBase = portalReturnBase(req);

  try {
    const stripe = require('stripe')(STRIPE_KEY);
    /* Bind only to this user_id — never open another customer's portal via email list */
    const sub = await getSubscription(auth.user.id, auth.user.email);
    const stripeCustomerId = sub.stripe_customer_id || null;

    if (!stripeCustomerId) {
      return res.status(404).json({
        error: 'No Stripe customer found for this user',
        message: 'Subscribe first, then manage billing from here.'
      });
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
