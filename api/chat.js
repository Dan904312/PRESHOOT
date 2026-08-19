import {
  setCors,
  handleOptions,
  requireUser,
  requireScanAccess,
  gateRouteRateLimit,
  sendRateLimitResponse,
  sanitizeImage
} from '../lib/security.js';
import {
  trackProductEventServer,
  estimateAiCostUsd
} from '../lib/product-events.js';
import {
  refundOnboardingScan,
  recordCreationActivity
} from '../lib/entitlements.js';
import { recordUsageEvent } from '../lib/usage-ledger.js';

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);

function buildSafeBody(raw) {
  const model = ALLOWED_MODELS.has(raw.model) ? raw.model : 'claude-sonnet-4-6';
  const max_tokens = Math.min(Math.max(parseInt(raw.max_tokens, 10) || 2000, 256), 4096);
  const stream = raw.stream === true;

  if (!Array.isArray(raw.messages) || !raw.messages.length) {
    return { error: 'messages required' };
  }

  const messages = raw.messages.slice(0, 8).map((m) => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = m.content;

    if (typeof content === 'string') {
      content = content.slice(0, 12000);
    } else if (Array.isArray(content)) {
      content = content.slice(0, 6).map((part) => {
        if (!part || typeof part !== 'object') return null;
        if (part.type === 'text') {
          return { type: 'text', text: String(part.text || '').slice(0, 12000) };
        }
        if (part.type === 'image' && part.source && part.source.type === 'base64') {
          const img = sanitizeImage({
            data: part.source.data,
            mime: part.source.media_type
          });
          if (!img) return null;
          return {
            type: 'image',
            source: { type: 'base64', media_type: img.mime, data: img.data }
          };
        }
        return null;
      }).filter(Boolean);
    } else {
      content = '';
    }

    return { role, content };
  });

  return { model, max_tokens, stream, messages };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'chat',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl);

  if (auth.error) {
    return res.status(auth.status).json({ error: { message: auth.error } });
  }

  const access = await requireScanAccess(auth.user);
  if (!access.ok) {
    const msg =
      access.error === 'quota_exceeded'
        ? 'Daily free scan limit reached. Upgrade to Pro to keep turning scenes into shoot-ready ideas.'
        : access.error || 'Access denied';
    return res.status(access.status || 403).json({ error: { message: msg } });
  }

  async function undoOnboardingCredit() {
    if (access.scanSource === 'onboarding') {
      await refundOnboardingScan(auth.user.id).catch(function () {});
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await undoOnboardingCredit();
    return res.status(500).json({ error: { message: 'AI not configured' } });
  }

  try {
    const safe = buildSafeBody(req.body || {});
    if (safe.error) {
      await undoOnboardingCredit();
      return res.status(400).json({ error: { message: safe.error } });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(safe)
    });

    if (!response.ok) {
      await undoOnboardingCredit();
    }

    if (safe.stream) {
      trackProductEventServer(auth.user.id, 'ai_request', {
        endpoint: 'chat',
        model: safe.model,
        stream: true
      }).catch(function () {});
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(response.status);
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      if (response.ok) {
        recordCreationActivity(auth.user.id, 'scan', req.body && req.body.timezone).catch(
          function () {}
        );
        const recorded = await recordUsageEvent({
          user_id: auth.user.id,
          event_type: 'scan',
          provider: 'anthropic',
          model: safe.model,
          status: 'success',
          metadata: { stream: true }
        });
        if (!recorded || !recorded.ok) {
          console.error('scan_usage_record_failed', recorded && recorded.error, recorded && recorded.status);
        }
      }
      res.end();
      return;
    }

    const data = await response.json();
    if (response.ok && data && data.usage) {
      const inTok = data.usage.input_tokens || 0;
      const outTok = data.usage.output_tokens || 0;
      trackProductEventServer(auth.user.id, 'ai_request', {
        endpoint: 'chat',
        model: safe.model,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: estimateAiCostUsd(safe.model, inTok, outTok)
      }).catch(function () {});
      recordCreationActivity(auth.user.id, 'scan', req.body && req.body.timezone).catch(
        function () {}
      );
      const recorded = await recordUsageEvent({
        user_id: auth.user.id,
        event_type: 'scan',
        provider: 'anthropic',
        model: safe.model,
        input_units: inTok,
        output_units: outTok,
        status: 'success'
      });
      if (!recorded || !recorded.ok) {
        console.error('scan_usage_record_failed', recorded && recorded.error, recorded && recorded.status);
      }
    } else if (response.ok) {
      recordCreationActivity(auth.user.id, 'scan', req.body && req.body.timezone).catch(
        function () {}
      );
      const recorded = await recordUsageEvent({
        user_id: auth.user.id,
        event_type: 'scan',
        provider: 'anthropic',
        model: safe.model,
        status: 'success'
      });
      if (!recorded || !recorded.ok) {
        console.error('scan_usage_record_failed', recorded && recorded.error, recorded && recorded.status);
      }
    } else if (!response.ok) {
      trackProductEventServer(auth.user.id, 'api_error', {
        endpoint: 'chat',
        status: response.status,
        category: 'upstream'
      }).catch(function () {});
    }
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    await undoOnboardingCredit();
    return res.status(500).json({ error: { message: 'Upstream error' } });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' }, responseLimit: false }
};
