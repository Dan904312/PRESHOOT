/**
 * Central Anthropic (and future provider) unit pricing.
 * Amounts are USD per 1,000,000 tokens unless unit is specified.
 * Update here only — never scatter rates across routes.
 *
 * Cost is computed in integer micros (1e-6 USD) then converted,
 * so tiny requests do not collapse to 0.00 in accounting.
 */
export const AI_PRICING = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    input_cost_per_million: 3,
    output_cost_per_million: 15,
    cache_write_cost_per_million: 3.75,
    cache_read_cost_per_million: 0.3,
    effective_from: '2026-01-01'
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    input_cost_per_million: 0.8,
    output_cost_per_million: 4,
    cache_write_cost_per_million: 1,
    cache_read_cost_per_million: 0.08,
    effective_from: '2025-10-01'
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4',
    input_cost_per_million: 15,
    output_cost_per_million: 75,
    cache_write_cost_per_million: 18.75,
    cache_read_cost_per_million: 1.5,
    effective_from: '2025-01-01'
  }
];

function normalizeModel(model) {
  return String(model || '').toLowerCase();
}

export function lookupPricing(model, provider) {
  const m = normalizeModel(model);
  const p = String(provider || 'anthropic').toLowerCase();
  const exact = AI_PRICING.find(
    (row) => row.provider === p && normalizeModel(row.model) === m
  );
  if (exact) return exact;
  if (/haiku/i.test(m)) {
    return AI_PRICING.find((row) => /haiku/i.test(row.model)) || AI_PRICING[1];
  }
  if (/opus/i.test(m)) {
    return AI_PRICING.find((row) => /opus/i.test(row.model)) || AI_PRICING[2];
  }
  return AI_PRICING[0];
}

export function normalizeAnthropicUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  return {
    input_tokens: Math.max(0, parseInt(u.input_tokens, 10) || 0),
    output_tokens: Math.max(0, parseInt(u.output_tokens, 10) || 0),
    cache_creation_tokens: Math.max(
      0,
      parseInt(u.cache_creation_input_tokens != null ? u.cache_creation_input_tokens : u.cache_creation_tokens, 10) || 0
    ),
    cache_read_tokens: Math.max(
      0,
      parseInt(u.cache_read_input_tokens != null ? u.cache_read_input_tokens : u.cache_read_tokens, 10) || 0
    )
  };
}

function tokensToMicros(tokens, usdPerMillion) {
  const t = Math.max(0, Number(tokens) || 0);
  const rate = Number(usdPerMillion) || 0;
  return Math.round(t * rate);
}

export function estimateAiCostMicros(model, usage, provider) {
  const u = normalizeAnthropicUsage(usage);
  const row = lookupPricing(model, provider);
  return (
    tokensToMicros(u.input_tokens, row.input_cost_per_million) +
    tokensToMicros(u.output_tokens, row.output_cost_per_million) +
    tokensToMicros(
      u.cache_creation_tokens,
      row.cache_write_cost_per_million != null
        ? row.cache_write_cost_per_million
        : row.input_cost_per_million * 1.25
    ) +
    tokensToMicros(
      u.cache_read_tokens,
      row.cache_read_cost_per_million != null
        ? row.cache_read_cost_per_million
        : row.input_cost_per_million * 0.1
    )
  );
}

export function microsToUsd(micros) {
  const n = Math.round(Number(micros) || 0);
  return n / 1e6;
}

export function estimateAiCostFromUsage(model, usage, provider) {
  return microsToUsd(estimateAiCostMicros(model, usage, provider));
}

export function estimateAiCostUsd(model, inputTokens, outputTokens, provider, extras) {
  return estimateAiCostFromUsage(
    model,
    {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: extras && extras.cache_creation_tokens,
      cache_read_input_tokens: extras && extras.cache_read_tokens
    },
    provider
  );
}

export function parseAnthropicStreamUsage(text) {
  const s = String(text || '');
  const found = [];
  const re = /"usage"\s*:\s*\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(s))) {
    try {
      found.push(JSON.parse('{' + m[1] + '}'));
    } catch (e) {
      /* ignore partial SSE */
    }
  }
  if (!found.length) return normalizeAnthropicUsage(null);
  const merged = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };
  found.forEach((u) => {
    const n = normalizeAnthropicUsage(u);
    merged.input_tokens = Math.max(merged.input_tokens, n.input_tokens);
    merged.output_tokens = Math.max(merged.output_tokens, n.output_tokens);
    merged.cache_creation_input_tokens = Math.max(
      merged.cache_creation_input_tokens,
      n.cache_creation_tokens
    );
    merged.cache_read_input_tokens = Math.max(merged.cache_read_input_tokens, n.cache_read_tokens);
  });
  return normalizeAnthropicUsage(merged);
}

export function formatApiCostUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '$0.00000';
  const sign = x < 0 ? '-' : '';
  return sign + '$' + Math.abs(x).toFixed(5);
}

export function formatRevenueUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '$0.00';
  const sign = x < 0 ? '-' : '';
  return sign + '$' + Math.abs(x).toFixed(2);
}

export const USAGE_EVENT_TYPES = [
  'scan',
  'director_request',
  'research',
  'other_billable_ai'
];
