/**
 * Content performance records. Supports public YouTube Data API lookups
 * server-side. Does not scrape TikTok or Instagram.
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

export function parseYouTubeVideoId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m =
    s.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i) ||
    s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

export function detectVideoPlatform(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/youtube\.com|youtu\.be/i.test(s) || parseYouTubeVideoId(s)) return 'youtube';
  if (/tiktok\.com/i.test(s)) return 'tiktok';
  if (/instagram\.com/i.test(s)) return 'instagram';
  return null;
}

/**
 * Normalize a user/import performance payload into safe metadata.
 * @param {object} raw
 * @returns {{ metrics: object, platform: string|null, production_id: string|null, url: string|null, title: string }}
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
  const url = typeof src.url === 'string' ? src.url.slice(0, 500) : null;
  return {
    metrics,
    platform:
      typeof src.platform === 'string'
        ? src.platform.slice(0, 40)
        : detectVideoPlatform(url),
    production_id:
      typeof src.production_id === 'string'
        ? src.production_id.slice(0, 64)
        : typeof src.productionId === 'string'
          ? src.productionId.slice(0, 64)
          : null,
    url,
    title: typeof src.title === 'string' ? src.title.slice(0, 180) : ''
  };
}
