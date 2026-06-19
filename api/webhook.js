// api/webhook.js
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function supaUpsert(url, key, table, data, conflictCol) {
  return fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': conflictCol ? `resolution=merge-duplicates` : 'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

async function supaPatch(url, key, table, match, data) {
  const [col, val] = Object.entries(match)[0];
  return fetch(`${url}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify(data)
  });
}

async function supaGet(url, key, table, match) {
  const [col, val] = Object.entries(match)[0];
  const r = await fetch(`${url}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}&select=user_id,email&limit=1`, {
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
  });
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_KEY || !WEBHOOK_SECRET || !SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: 'Missing env variables' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const stripe = require('stripe')(STRIPE_KEY);
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const obj = event.data.object;
  const now = new Date().toISOString();

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const userId = obj.client_reference_id;
        const email = obj.customer_email || obj.customer_details?.email;
        const amountTotal = obj.amount_total ? obj.amount_total / 100 : null;
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscriptions', {
          user_id: userId, email,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.subscription,
          plan: 'pro', status: 'active',
          started_at: now, updated_at: now
        }, 'user_id');
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          user_id: userId, email, event_type: 'checkout.completed',
          payload: { customer: obj.customer, subscription: obj.subscription },
          amount: amountTotal,
          stripe_event_id: event.id
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const row = await supaGet(SUPA_URL, SUPA_KEY, 'subscriptions', { stripe_subscription_id: obj.id });
        await supaPatch(SUPA_URL, SUPA_KEY, 'subscriptions', { stripe_subscription_id: obj.id }, {
          plan: 'free', status: 'cancelled', cancelled_at: now, updated_at: now
        });
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          user_id: row?.user_id, email: row?.email,
          event_type: 'subscription.cancelled',
          payload: { id: obj.id }, stripe_event_id: event.id
        });
        break;
      }

      case 'customer.subscription.updated': {
        const statusMap = { active: 'active', past_due: 'past_due', canceled: 'cancelled', trialing: 'trialing' };
        const newStatus = statusMap[obj.status] || obj.status;
        await supaPatch(SUPA_URL, SUPA_KEY, 'subscriptions', { stripe_subscription_id: obj.id }, {
          status: newStatus, plan: ['active','trialing'].includes(newStatus) ? 'pro' : 'free', updated_at: now
        });
        break;
      }

      case 'invoice.payment_failed': {
        if (!obj.subscription) break;
        await supaPatch(SUPA_URL, SUPA_KEY, 'subscriptions', { stripe_subscription_id: obj.subscription }, {
          status: 'past_due', updated_at: now
        });
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          email: obj.customer_email, event_type: 'payment.failed',
          payload: { amount: obj.amount_due }, stripe_event_id: event.id
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        if (!obj.subscription) break;
        const amountPaid = obj.amount_paid ? obj.amount_paid / 100 : null;
        await supaPatch(SUPA_URL, SUPA_KEY, 'subscriptions', { stripe_subscription_id: obj.subscription }, {
          status: 'active', plan: 'pro', updated_at: now
        });
        // Log revenue event so the admin revenue chart has real data
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          email: obj.customer_email, event_type: 'payment.succeeded',
          payload: { subscription: obj.subscription },
          amount: amountPaid,
          stripe_event_id: event.id
        });
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}
