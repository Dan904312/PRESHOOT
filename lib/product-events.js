/**
 * Shared product-event allowlist + server-side writer (Phase 7).
 * Metadata only — never scripts, conversations, or media.
 */
import { serviceHeaders } from './security.js';

export const PRODUCT_EVENTS = [
  'signup',
  'onboarding_started',
  'onboarding_completed',
  'scan_started',
  'scan_completed',
  'idea_generated',
  'project_created',
  'production_created',
  'script_created',
  'shotlist_created',
  'director_opened',
  'director_used',
  'director_action_requested',
  'director_action_success',
  'director_action_failure',
  'asset_uploaded',
  'reference_added',
  'workspace_created',
  'workspace_invited',
  'workspace_joined',
  'comment_created',
  'production_reviewed',
  'production_performance_updated',
  'pricing_viewed',
  'checkout_started',
  'subscription_started',
  'subscription_cancelled',
  'referral_created',
  'referral_clicked',
  'referral_signup',
  'referral_activation',
  'hook_structure_used',
  'ai_request',
  'api_error',
  'perf_timing'
];

export const PRODUCT_EVENT_SET = new Set(PRODUCT_EVENTS);

/** Activation = idea_generated + production_created (after signup). */
export const ACTIVATION_EVENTS = ['idea_generated', 'production_created'];

export function sanitizeEventMeta(meta) {
  const safe = {};
  if (!meta || typeof meta !== 'object') return safe;
  Object.keys(meta)
    .slice(0, 10)
    .forEach((k) => {
      const key = String(k).slice(0, 40);
      if (
        /^(body|script|messages|document|prompt|content|image|b64|token)$/i.test(key)
      ) {
        return;
      }
      const v = meta[k];
      if (typeof v === 'string' && v.length <= 80) safe[key] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) safe[key] = v;
      else if (typeof v === 'boolean') safe[key] = v;
    });
  return safe;
}

export async function trackProductEventServer(userId, eventName, meta) {
  const name = String(eventName || '');
  if (!userId || !PRODUCT_EVENT_SET.has(name)) return { ok: false };
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return { ok: false };
  try {
    await fetch(`${SUPA_URL}/rest/v1/product_events`, {
      method: 'POST',
      headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify([
        {
          user_id: userId,
          event: name,
          meta: sanitizeEventMeta(meta),
          created_at: new Date().toISOString()
        }
      ])
    });
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

export { estimateAiCostUsd } from './ai-pricing.js';
