// api/webhook.js
// Stripe webhook — writes subscription state to Supabase
// Add to Vercel env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function supa() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

async function logEvent(db, userId, email, eventType, payload, stripeEventId) {
  await db.from('subscription_events').insert({
    user_id: userId,
    email: email,
    event_type: eventType,
    payload: payload,
    stripe_event_id: stripeEventId
  }).on('conflict', 'stripe_event_id', 'ignore');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const db = supa();
  const obj = event.data.object;

  try {
    switch (event.type) {

      // ── USER PAID ──
      case 'checkout.session.completed': {
        const userId = obj.client_reference_id;
        const email = obj.customer_email || obj.customer_details?.email;
        const customerId = obj.customer;
        const subscriptionId = obj.subscription;
        const interval = obj.metadata?.interval || null;

        // Fetch subscription from Stripe to get billing interval
        let billingInterval = interval;
        if (!billingInterval && subscriptionId) {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
            billingInterval = stripeSub.items.data[0]?.plan?.interval === 'year' ? 'yearly' : 'monthly';
          } catch (e) {}
        }

        await db.from('subscriptions').upsert({
          user_id: userId,
          email,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan: 'pro',
          status: 'active',
          billing_interval: billingInterval,
          started_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

        await logEvent(db, userId, email, 'checkout.completed', { customerId, subscriptionId, billingInterval }, event.id);
        break;
      }

      // ── SUBSCRIPTION CANCELLED ──
      case 'customer.subscription.deleted': {
        const { data: sub } = await db.from('subscriptions')
          .select('user_id, email')
          .eq('stripe_subscription_id', obj.id)
          .single();

        await db.from('subscriptions')
          .update({
            plan: 'free',
            status: 'cancelled',
            cancelled_at: new Date().toISOString()
          })
          .eq('stripe_subscription_id', obj.id);

        await logEvent(db, sub?.user_id, sub?.email, 'subscription.cancelled', { id: obj.id }, event.id);
        break;
      }

      // ── SUBSCRIPTION STATUS CHANGED ──
      case 'customer.subscription.updated': {
        const statusMap = { active: 'active', past_due: 'past_due', canceled: 'cancelled', trialing: 'trialing' };
        const newStatus = statusMap[obj.status] || obj.status;
        const newPlan = newStatus === 'active' || newStatus === 'trialing' ? 'pro' : 'free';

        await db.from('subscriptions')
          .update({ status: newStatus, plan: newPlan })
          .eq('stripe_subscription_id', obj.id);

        await logEvent(db, null, null, 'subscription.updated', { id: obj.id, status: obj.status }, event.id);
        break;
      }

      // ── PAYMENT FAILED ──
      case 'invoice.payment_failed': {
        if (!obj.subscription) break;
        await db.from('subscriptions')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', obj.subscription);

        await logEvent(db, null, obj.customer_email, 'payment.failed', { amount: obj.amount_due, attempt: obj.attempt_count }, event.id);
        break;
      }

      // ── PAYMENT SUCCEEDED / RENEWAL ──
      case 'invoice.payment_succeeded': {
        if (!obj.subscription) break;
        await db.from('subscriptions')
          .update({ status: 'active', plan: 'pro' })
          .eq('stripe_subscription_id', obj.subscription);

        await logEvent(db, null, obj.customer_email, 'payment.succeeded', { amount: obj.amount_paid }, event.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}
