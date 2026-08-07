// api/check-plan.js — return plan for authenticated user only
import {
  setCors,
  handleOptions,
  requireUser,
  getSubscription,
  gateRouteRateLimit
} from '../lib/security.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'plan',
    max: 60,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) {
    const sec = Math.max(1, rl.retryAfterSec || 60);
    try { res.setHeader('Retry-After', String(sec)); } catch (e) { /* ignore */ }
    return res.status(429).json({
      plan: 'free',
      status: 'rate_limited',
      message: `Too many requests. Please try again in ${sec} seconds.`
    });
  }

  if (auth.error) {
    return res.status(auth.status).json({ plan: 'free', status: auth.error });
  }

  try {
    const sub = await getSubscription(auth.user.id, auth.user.email);
    return res.status(200).json({ plan: sub.plan, status: sub.status });
  } catch (err) {
    console.error('check-plan error:', err.message);
    return res.status(200).json({ plan: 'free', status: 'error' });
  }
}
