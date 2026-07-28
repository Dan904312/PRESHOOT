// api/check-plan.js — return plan for authenticated user only
import {
  setCors,
  handleOptions,
  requireUser,
  getSubscription,
  rateLimit,
  clientIp
} from '../lib/security.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!rateLimit('plan:' + clientIp(req), 60, 60 * 1000)) {
    return res.status(429).json({ plan: 'free', status: 'rate_limited' });
  }

  const auth = await requireUser(req);
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
