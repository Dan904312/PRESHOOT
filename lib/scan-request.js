/**
 * Scan request sanitization + server-side timing helpers.
 * Imported by /api/chat.js — not a Serverless Function.
 */

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);

export const SCAN_DEFAULT_MAX_TOKENS = 2400;

export function publicScanErrorMessage(status, code) {
  if (status === 401 || code === 'auth_required' || code === 'invalid_token') {
    return 'Please sign in again, then try scanning.';
  }
  if (status === 429 || code === 'quota_exceeded') {
    return 'Daily free scan limit reached. Upgrade to Pro to keep turning scenes into shoot-ready ideas.';
  }
  if (status === 413) {
    return 'That photo is too large. Try another image.';
  }
  if (code === 'messages required' || status === 400) {
    return 'Something went wrong while analyzing your image. Please try again.';
  }
  return 'Something went wrong while analyzing your image. Please try again.';
}

function sanitizeSystem(raw) {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    const text = raw.slice(0, 14000);
    if (!text) return undefined;
    return [
      {
        type: 'text',
        text: text,
        cache_control: { type: 'ephemeral' }
      }
    ];
  }
  if (!Array.isArray(raw)) return undefined;
  const blocks = raw.slice(0, 4).map(function (part) {
    if (!part) return null;
    if (typeof part === 'string') {
      return { type: 'text', text: part.slice(0, 14000) };
    }
    if (typeof part === 'object' && (part.type === 'text' || !part.type)) {
      return { type: 'text', text: String(part.text || '').slice(0, 14000) };
    }
    return null;
  }).filter(Boolean);
  if (!blocks.length) return undefined;
  const last = blocks[blocks.length - 1];
  last.cache_control = { type: 'ephemeral' };
  return blocks;
}

export function buildSafeChatBody(raw, sanitizeImage) {
  raw = raw || {};
  const model = ALLOWED_MODELS.has(raw.model) ? raw.model : 'claude-sonnet-4-6';
  const max_tokens = Math.min(
    Math.max(parseInt(raw.max_tokens, 10) || SCAN_DEFAULT_MAX_TOKENS, 256),
    4096
  );
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

  const body = { model, max_tokens, stream, messages };
  const system = sanitizeSystem(raw.system);
  if (system) body.system = system;
  return body;
}

/** Server log only — never includes prompts, images, tokens, or user ids. */
export function logScanTiming(parts) {
  const payload = {
    prep_ms: Number(parts && parts.prep_ms) || 0,
    anthropic_ttfb_ms: Number(parts && parts.anthropic_ttfb_ms) || 0,
    anthropic_stream_ms: Number(parts && parts.anthropic_stream_ms) || 0,
    parse_ms: Number(parts && parts.parse_ms) || 0,
    post_ms: Number(parts && parts.post_ms) || 0,
    total_ms: Number(parts && parts.total_ms) || 0,
    model: parts && parts.model ? String(parts.model).slice(0, 48) : '',
    stream: !!(parts && parts.stream),
    ok: parts && parts.ok !== false
  };
  console.info('scan_timing', JSON.stringify(payload));
}
