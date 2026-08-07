// api/webhook.js — Stripe webhooks with size limits + idempotent processing
export const config = { api: { bodyParser: false } };

const MAX_WEBHOOK_BYTES = 256 * 1024; // 256KB — Stripe events are typically much smaller

async function getRawBodyLimited(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    function fail(err) {
      if (settled) return;
      settled = true;
      try {
        req.destroy();
      } catch (e) {
        /* ignore */
      }
      reject(err);
    }

    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        fail(Object.assign(new Error('payload_too_large'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

async function supaUpsert(url, key, table, data, conflictCol) {
  return fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: conflictCol ? 'resolution=merge-duplicates' : 'return=minimal'
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
      apikey: key,
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify(data)
  });
}

async function supaGet(url, key, table, match) {
  const [col, val] = Object.entries(match)[0];
  const r = await fetch(
    `${url}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}&select=user_id,email&limit=1`,
    { headers: { apikey: key, Authorization: 'Bearer ' + key } }
  );
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

async function claimStripeEvent(url, key, eventId, eventType) {
  const r = await fetch(`${url}/rest/v1/rpc/claim_stripe_event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify({ p_event_id: eventId, p_event_type: eventType })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    /* Fallback: unique insert into processed_stripe_events */
    const ins = await fetch(`${url}/rest/v1/processed_stripe_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ event_id: eventId, event_type: eventType })
    });
    if (ins.status === 409) return { claimed: false, duplicate: true };
    if (!ins.ok) return { claimed: false, error: 'claim_failed' };
    return { claimed: true };
  }
  if (data && data.claimed === true) return { claimed: true };
  if (data && data.duplicate === true) return { claimed: false, duplicate: true };
  return { claimed: false, error: 'claim_failed' };
}

async function releaseStripeEvent(url, key, eventId) {
  await fetch(
    `${url}/rest/v1/processed_stripe_events?event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    }
  ).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_KEY || !WEBHOOK_SECRET || !SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let rawBody;
  try {
    rawBody = await getRawBodyLimited(req, MAX_WEBHOOK_BYTES);
  } catch (err) {
    if (err && err.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    console.error('Webhook body read error');
    return res.status(400).json({ error: 'Invalid body' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing signature' });

  let event;
  try {
    const stripe = require('stripe')(STRIPE_KEY);
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature error');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const claim = await claimStripeEvent(SUPA_URL, SUPA_KEY, event.id, event.type);
  if (claim.duplicate) {
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (!claim.claimed) {
    console.error('Webhook claim failed for event', event.id);
    return res.status(500).json({ error: 'Could not claim event' });
  }

  const obj = event.data.object;
  const now = new Date().toISOString();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const userId = obj.client_reference_id || null;
        const email = obj.customer_email || obj.customer_details?.email || null;
        const amountTotal = obj.amount_total ? obj.amount_total / 100 : null;
        const bindId = userId || (email ? 'email:' + email.toLowerCase() : null);
        if (!bindId) {
          console.error('checkout.session.completed missing user binding', event.id);
          break;
        }
        await supaUpsert(
          SUPA_URL,
          SUPA_KEY,
          'subscriptions',
          {
            user_id: bindId,
            email,
            stripe_customer_id: obj.customer,
            stripe_subscription_id: obj.subscription,
            plan: 'pro',
            status: 'active',
            started_at: now,
            updated_at: now
          },
          'user_id'
        );
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          user_id: userId || null,
          email,
          event_type: 'checkout.completed',
          payload: {
            customer: obj.customer,
            subscription: obj.subscription,
            client_reference_id: userId
          },
          amount: amountTotal,
          stripe_event_id: event.id
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const row = await supaGet(SUPA_URL, SUPA_KEY, 'subscriptions', {
          stripe_subscription_id: obj.id
        });
        await supaPatch(
          SUPA_URL,
          SUPA_KEY,
          'subscriptions',
          { stripe_subscription_id: obj.id },
          {
            plan: 'free',
            status: 'cancelled',
            cancelled_at: now,
            updated_at: now
          }
        );
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          user_id: row?.user_id,
          email: row?.email,
          event_type: 'subscription.cancelled',
          payload: { id: obj.id },
          stripe_event_id: event.id
        });
        break;
      }

      case 'customer.subscription.updated': {
        const statusMap = {
          active: 'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          trialing: 'trialing'
        };
        const newStatus = statusMap[obj.status] || obj.status;
        await supaPatch(
          SUPA_URL,
          SUPA_KEY,
          'subscriptions',
          { stripe_subscription_id: obj.id },
          {
            status: newStatus,
            plan: ['active', 'trialing'].includes(newStatus) ? 'pro' : 'free',
            updated_at: now
          }
        );
        break;
      }

      case 'invoice.payment_failed': {
        if (!obj.subscription) break;
        await supaPatch(
          SUPA_URL,
          SUPA_KEY,
          'subscriptions',
          { stripe_subscription_id: obj.subscription },
          { status: 'past_due', updated_at: now }
        );
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          email: obj.customer_email,
          event_type: 'payment.failed',
          payload: { amount: obj.amount_due },
          stripe_event_id: event.id
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        if (!obj.subscription) break;
        const amountPaid = obj.amount_paid ? obj.amount_paid / 100 : null;
        await supaPatch(
          SUPA_URL,
          SUPA_KEY,
          'subscriptions',
          { stripe_subscription_id: obj.subscription },
          { status: 'active', plan: 'pro', updated_at: now }
        );
        await supaUpsert(SUPA_URL, SUPA_KEY, 'subscription_events', {
          email: obj.customer_email,
          event_type: 'payment.succeeded',
          payload: { subscription: obj.subscription },
          amount: amountPaid,
          stripe_event_id: event.id
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err && err.message ? err.message : 'unknown');
    await releaseStripeEvent(SUPA_URL, SUPA_KEY, event.id);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  return res.status(200).json({ received: true });
}
