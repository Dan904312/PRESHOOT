/**
 * Central Anthropic (and future provider) unit pricing.
 * Amounts are USD per 1,000,000 tokens unless unit is specified.
 * Update here only — never scatter rates across routes.
 */
export const AI_PRICING = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    input_cost_per_million: 3,
    output_cost_per_million: 15,
    effective_from: '2026-01-01'
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    input_cost_per_million: 0.8,
    output_cost_per_million: 4,
    effective_from: '2025-10-01'
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4',
    input_cost_per_million: 15,
    output_cost_per_million: 75,
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

export function estimateAiCostUsd(model, inputTokens, outputTokens, provider) {
  const row = lookupPricing(model, provider);
  const inT = Math.max(0, Number(inputTokens) || 0);
  const outT = Math.max(0, Number(outputTokens) || 0);
  const usd =
    (inT / 1e6) * row.input_cost_per_million +
    (outT / 1e6) * row.output_cost_per_million;
  return Number(usd.toFixed(6));
}

export const USAGE_EVENT_TYPES = [
  'scan',
  'director_request',
  'research',
  'other_billable_ai'
];
