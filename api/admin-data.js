// api/admin-data.js
// All admin operations — protected by ADMIN_SECRET env variable
// POST { action, ...params } with header x-admin-key: YOUR_SECRET

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { action, user_id, email, reason, search, limit = 100, offset = 0 } = req.body || {};

  try {
    switch (action) {

      // List all subscribers
      case 'list': {
        let query = db.from('subscriptions').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (search) query = query.or(`email.ilike.%${search}%,user_id.ilike.%${search}%`);
        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json({ subscribers: data });
      }

      // Summary stats
      case 'stats': {
        const { data, error } = await db.from('subscriptions').select('plan, status, billing_interval, started_at');
        if (error) throw error;
        const active = data.filter(d => d.plan === 'pro' && (d.status === 'active' || d.status === 'promo' || d.status === 'trialing'));
        const monthly = active.filter(d => d.billing_interval === 'monthly').length;
        const yearly = active.filter(d => d.billing_interval === 'yearly').length;
        const promo = data.filter(d => d.status === 'promo').length;
        return res.status(200).json({
          total: data.length,
          active: active.length,
          monthly,
          yearly,
          promo,
          cancelled: data.filter(d => d.status === 'cancelled').length,
          revoked: data.filter(d => d.status === 'revoked').length,
          past_due: data.filter(d => d.status === 'past_due').length,
          mrr: (monthly * 10) + (yearly * 5)
        });
      }

      // Recent events
      case 'events': {
        const { data, error } = await db.from('subscription_events')
          .select('*').order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        return res.status(200).json({ events: data });
      }

      // Revoke pro access
      case 'revoke': {
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        const { error } = await db.from('subscriptions').update({
          plan: 'free',
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_reason: reason || 'Admin revoke'
        }).eq('user_id', user_id);
        if (error) throw error;
        await db.from('subscription_events').insert({
          user_id, event_type: 'admin.revoked', payload: { reason: reason || 'Admin revoke' }
        });
        return res.status(200).json({ success: true });
      }

      // Restore pro access
      case 'restore': {
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        const { error } = await db.from('subscriptions').update({
          plan: 'pro',
          status: 'active',
          revoked_at: null,
          revoked_reason: null
        }).eq('user_id', user_id);
        if (error) throw error;
        await db.from('subscription_events').insert({
          user_id, event_type: 'admin.restored', payload: { by: 'admin' }
        });
        return res.status(200).json({ success: true });
      }

      // Manually grant pro (for gifting, support, etc.)
      case 'grant': {
        if (!email) return res.status(400).json({ error: 'email required' });
        const { error } = await db.from('subscriptions').upsert({
          user_id: user_id || 'manual_' + Date.now(),
          email,
          plan: 'pro',
          status: 'promo',
          started_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) throw error;
        await db.from('subscription_events').insert({
          user_id: user_id || null, email, event_type: 'admin.granted', payload: { reason: reason || 'Manual grant' }
        });
        return res.status(200).json({ success: true });
      }

      // Add/update notes on a subscriber
      case 'note': {
        if (!user_id) return res.status(400).json({ error: 'user_id required' });
        const { error } = await db.from('subscriptions').update({ notes: reason }).eq('user_id', user_id);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      // Promo code usage log
      case 'promo_log': {
        const { data, error } = await db.from('promo_usage').select('*').order('used_at', { ascending: false }).limit(100);
        if (error) throw error;
        return res.status(200).json({ usage: data });
      }

      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
