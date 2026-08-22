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
  trackProductEventServer
} from '../lib/product-events.js';
import {
  refundOnboardingScan,
  recordCreationActivity
} from '../lib/entitlements.js';
import { recordUsageEvent } from '../lib/usage-ledger.js';
import {
  parseAnthropicStreamUsage,
  normalizeAnthropicUsage,
  estimateAiCostFromUsage
} from '../lib/ai-pricing.js';
import {
  buildSafeChatBody,
  logScanTiming,
  publicScanErrorMessage
} from '../lib/scan-request.js';

function anthropicHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31'
  };
}

async function persistScanSuccess(userId, timezone, model, usage, stream) {
  try {
    await recordCreationActivity(userId, 'scan', timezone);
  } catch (e) {
    console.error('streak_record_failed', 'scan', e && e.message);
  }
  const recorded = await recordUsageEvent({
    user_id: userId,
    event_type: 'scan',
    provider: 'anthropic',
    model: model,
    input_units: usage && usage.input_tokens,
    output_units: usage && usage.output_tokens,
    cache_creation_units: usage && usage.cache_creation_tokens,
    cache_read_units: usage && usage.cache_read_tokens,
    status: 'success',
    metadata: { stream: !!stream }
  });
  if (!recorded || !recorded.ok) {
    console.error('scan_usage_record_failed', recorded && recorded.error, recorded && recorded.status);
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();
  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'chat',
    max: 30,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl);

  if (auth.error) {
    return res.status(auth.status).json({
      error: { message: publicScanErrorMessage(auth.status, auth.error) }
    });
  }

  const access = await requireScanAccess(auth.user);
  if (!access.ok) {
    return res.status(access.status || 403).json({
      error: { message: publicScanErrorMessage(access.status, access.error) }
    });
  }

  const prepMs = Date.now() - t0;

  async function undoOnboardingCredit() {
    if (access.scanSource === 'onboarding') {
      await refundOnboardingScan(auth.user.id).catch(function () {});
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await undoOnboardingCredit();
    return res.status(500).json({
      error: { message: publicScanErrorMessage(500, 'ai_not_configured') }
    });
  }

  try {
    const safe = buildSafeChatBody(req.body || {}, sanitizeImage);
    if (safe.error) {
      await undoOnboardingCredit();
      return res.status(400).json({
        error: { message: publicScanErrorMessage(400, safe.error) }
      });
    }

    res.setHeader('Access-Control-Expose-Headers', 'X-Scan-Prep-Ms');
    res.setHeader('X-Scan-Prep-Ms', String(prepMs));

    const tAi = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(),
      body: JSON.stringify(safe)
    });
    const ttfbMs = Date.now() - tAi;

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
      const decoder = new TextDecoder();
      let tail = '';
      const tStream = Date.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        try {
          tail = (tail + decoder.decode(value, { stream: true })).slice(-8000);
        } catch (e) {
          /* ignore decode errors */
        }
      }
      const streamMs = Date.now() - tStream;
      const tParse = Date.now();
      const streamUsage = response.ok ? parseAnthropicStreamUsage(tail) : {};
      const parseMs = Date.now() - tParse;
      /* Close the HTTP stream before ledger writes so the client is not blocked. */
      res.end();
      const tPost = Date.now();
      if (response.ok) {
        await persistScanSuccess(
          auth.user.id,
          req.body && req.body.timezone,
          safe.model,
          streamUsage,
          true
        );
      }
      logScanTiming({
        prep_ms: prepMs,
        anthropic_ttfb_ms: ttfbMs,
        anthropic_stream_ms: streamMs,
        parse_ms: parseMs,
        post_ms: Date.now() - tPost,
        total_ms: Date.now() - t0,
        model: safe.model,
        stream: true,
        ok: response.ok
      });
      return;
    }

    const tParse = Date.now();
    const data = await response.json();
    const parseMs = Date.now() - tParse;
    if (response.ok) {
      const usage = data && data.usage ? normalizeAnthropicUsage(data.usage) : {};
      trackProductEventServer(auth.user.id, 'ai_request', {
        endpoint: 'chat',
        model: safe.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: estimateAiCostFromUsage(safe.model, usage)
      }).catch(function () {});
      res.status(response.status).json(data);
      const tPost = Date.now();
      await persistScanSuccess(
        auth.user.id,
        req.body && req.body.timezone,
        safe.model,
        usage,
        false
      );
      logScanTiming({
        prep_ms: prepMs,
        anthropic_ttfb_ms: ttfbMs,
        anthropic_stream_ms: 0,
        parse_ms: parseMs,
        post_ms: Date.now() - tPost,
        total_ms: Date.now() - t0,
        model: safe.model,
        stream: false,
        ok: true
      });
      return;
    }

    trackProductEventServer(auth.user.id, 'api_error', {
      endpoint: 'chat',
      status: response.status,
      category: 'upstream'
    }).catch(function () {});
    logScanTiming({
      prep_ms: prepMs,
      anthropic_ttfb_ms: ttfbMs,
      anthropic_stream_ms: 0,
      parse_ms: parseMs,
      post_ms: 0,
      total_ms: Date.now() - t0,
      model: safe.model,
      stream: false,
      ok: false
    });
    return res.status(response.status).json({
      error: { message: publicScanErrorMessage(response.status, 'upstream') }
    });
  } catch (error) {
    console.error('Proxy error:', error && error.message);
    await undoOnboardingCredit();
    logScanTiming({
      prep_ms: prepMs,
      total_ms: Date.now() - t0,
      model: '',
      stream: false,
      ok: false
    });
    return res.status(500).json({
      error: { message: publicScanErrorMessage(500, 'upstream') }
    });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' }, responseLimit: false }
};
