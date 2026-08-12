/**
 * Content performance feedback-loop boundary (Phase 7).
 * Accepts user-supplied metrics later — does not scrape social platforms.
 * No fabricated performance data.
 */

export const PERFORMANCE_METRICS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'watch_time',
  'retention'
];

/**
 * Normalize a user/import performance payload into safe metadata.
 * @param {object} raw
 * @returns {{ metrics: object, platform: string|null, production_id: string|null }}
 */
export function normalizePerformanceInput(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const metrics = {};
  PERFORMANCE_METRICS.forEach((key) => {
    const alt = key === 'watch_time' ? src.watchTime || src.watch_time : src[key];
    if (alt === undefined || alt === null || alt === '') return;
    const n = typeof alt === 'number' ? alt : Number(String(alt).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n >= 0) metrics[key] = n;
  });
  return {
    metrics,
    platform:
      typeof src.platform === 'string' ? src.platform.slice(0, 40) : null,
    production_id:
      typeof src.production_id === 'string'
        ? src.production_id.slice(0, 64)
        : typeof src.productionId === 'string'
          ? src.productionId.slice(0, 64)
          : null
  };
}
