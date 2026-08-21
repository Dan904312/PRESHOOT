/**
 * Zero-cost public trend aggregation.
 * No LLM. No paid trend APIs. Frontend never scrapes.
 *
 * Sources that actually expose public data from this runtime:
 *   - Google Trends daily RSS (search / hashtag-like terms)
 *   - YouTube Data API videos.list chart=mostPopular (only if YOUTUBE_API_KEY is set)
 *   - Apple Music public RSS (top songs) — labeled Apple, never as YouTube
 *
 * Sources attempted but not fabricated when empty:
 *   - TikTok Creative Center public HTML (JS shell; no usable feed)
 *   - YouTube Charts HTML (JS shell; no chart rows in SSR)
 */

export const TREND_TTL_MS = 6 * 60 * 60 * 1000;
export const TREND_STALE_MS = 24 * 60 * 60 * 1000;
export const TREND_MAX_ITEMS = 80;

const ALLOWED_REGIONS = {
  US: { google: 'US', youtube: 'US', apple: 'us' },
  GB: { google: 'GB', youtube: 'GB', apple: 'gb' },
  AU: { google: 'AU', youtube: 'AU', apple: 'au' },
  CA: { google: 'CA', youtube: 'CA', apple: 'ca' },
  IN: { google: 'IN', youtube: 'IN', apple: 'in' }
};

export function allowedRegions() {
  return Object.keys(ALLOWED_REGIONS);
}

export function sanitizeRegion(raw) {
  const s = String(raw || 'US').trim().toUpperCase();
  return ALLOWED_REGIONS[s] ? s : 'US';
}

function clamp(s, n) {
  return String(s == null ? '' : s).slice(0, n);
}

export function trendId(platform, type, title, url) {
  const base = [platform, type, url || title].join('|').toLowerCase();
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return 'tr_' + h.toString(36);
}

export function normalizeTrendItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clamp(raw.title, 180).trim();
  const url = clamp(raw.url, 500).trim();
  if (!title) return null;
  const platform = clamp(raw.platform, 40) || 'web';
  const type = clamp(raw.type, 40) || 'other';
  return {
    id: clamp(raw.id, 80) || trendId(platform, type, title, url),
    platform,
    type,
    title,
    creator: clamp(raw.creator, 120),
    url: url || null,
    thumbnail: raw.thumbnail ? clamp(raw.thumbnail, 500) : null,
    rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : null,
    region: clamp(raw.region, 8) || 'US',
    category: clamp(raw.category, 40) || type,
    source: clamp(raw.source, 80),
    fetchedAt: raw.fetchedAt || null,
    expiresAt: raw.expiresAt || null,
    metric: clamp(raw.metric, 80),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}
  };
}

export function dedupeTrends(items) {
  const seen = {};
  const out = [];
  (Array.isArray(items) ? items : []).forEach((row) => {
    const it = normalizeTrendItem(row);
    if (!it) return;
    const key = (it.url || it.title).toLowerCase();
    if (seen[key] || seen[it.id]) return;
    seen[key] = true;
    seen[it.id] = true;
    out.push(it);
  });
  return out.slice(0, TREND_MAX_ITEMS);
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseGoogleTrendsRss(xml, region) {
  const text = String(xml || '');
  const items = [];
  const blocks = text.split(/<item>/i).slice(1);
  blocks.forEach((block, i) => {
    const titleM = block.match(/<title>([\s\S]*?)<\/title>/i);
    const trafficM = block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i);
    const picM = block.match(/<ht:picture>([\s\S]*?)<\/ht:picture>/i);
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/i);
    const title = decodeXml((titleM && titleM[1]) || '').trim();
    if (!title || /daily search trends/i.test(title)) return;
    const traffic = decodeXml((trafficM && trafficM[1]) || '').trim();
    const picture = decodeXml((picM && picM[1]) || '').trim();
    const link = decodeXml((linkM && linkM[1]) || '').trim();
    const q = encodeURIComponent(title);
    items.push(
      normalizeTrendItem({
        platform: 'google',
        type: 'hashtag',
        category: 'search',
        title,
        url: 'https://trends.google.com/trending?geo=' + region + '&q=' + q,
        thumbnail: picture && /^https:\/\//i.test(picture) ? picture : null,
        rank: i + 1,
        region,
        source: 'Google Trends RSS',
        metric: traffic ? traffic + ' searches' : '',
        metadata: { traffic, rssLink: link }
      })
    );
  });
  return items.filter(Boolean);
}

export function parseAppleMusicFeed(json, region) {
  const results =
    json && json.feed && Array.isArray(json.feed.results) ? json.feed.results : [];
  return results
    .map((row, i) =>
      normalizeTrendItem({
        platform: 'apple',
        type: 'music',
        category: 'music',
        title: row && (row.name || row.title),
        creator: row && (row.artistName || row.artist),
        url: row && (row.url || row.artistUrl),
        thumbnail: row && row.artworkUrl100,
        rank: i + 1,
        region,
        source: 'Apple Music charts',
        metric: row && row.genres && row.genres[0] && row.genres[0].name,
        metadata: { id: row && row.id }
      })
    )
    .filter(Boolean);
}

export function parseYouTubeMostPopular(json, region) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  return items
    .map((it, i) => {
      const sn = it.snippet || {};
      const st = it.statistics || {};
      const thumbs = sn.thumbnails || {};
      const thumb =
        (thumbs.medium && thumbs.medium.url) ||
        (thumbs.default && thumbs.default.url) ||
        null;
      const views = Number(st.viewCount) || 0;
      let metric = '';
      if (views >= 1e6) metric = (views / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
      else if (views >= 1e3) metric = (views / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
      else if (views) metric = views + ' views';
      return normalizeTrendItem({
        platform: 'youtube',
        type: 'video',
        category: 'video',
        title: sn.title,
        creator: sn.channelTitle,
        url: it.id ? 'https://www.youtube.com/watch?v=' + it.id : null,
        thumbnail: thumb,
        rank: i + 1,
        region,
        source: 'YouTube most popular',
        metric,
        metadata: { videoId: it.id, categoryId: sn.categoryId }
      });
    })
    .filter(Boolean);
}

export function isFresh(entry, now, ttlMs) {
  if (!entry || !entry.fetchedAt) return false;
  const t = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < (ttlMs || TREND_TTL_MS);
}

export function isUsableStale(entry, now) {
  if (!entry || !Array.isArray(entry.items) || !entry.items.length) return false;
  const t = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < TREND_STALE_MS;
}

const memCache = {};

export function memoryGet(region) {
  return memCache[sanitizeRegion(region)] || null;
}

export function memorySet(region, payload) {
  memCache[sanitizeRegion(region)] = payload;
  return payload;
}

export function memoryClear() {
  Object.keys(memCache).forEach((k) => {
    delete memCache[k];
  });
}

async function fetchText(url, timeoutMs, headers) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => {
    if (ctrl) ctrl.abort();
  }, timeoutMs || 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: Object.assign(
        {
          'User-Agent': 'PreShootTrendBot/1.0 (+https://preshoot.app)',
          Accept: 'application/rss+xml, application/xml, application/json, text/html;q=0.8'
        },
        headers || {}
      )
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String((e && e.message) || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, timeoutMs, headers) {
  const r = await fetchText(url, timeoutMs, headers);
  if (!r.ok) return r;
  try {
    return Object.assign({}, r, { json: JSON.parse(r.body) });
  } catch (e) {
    return Object.assign({}, r, { ok: false, error: 'invalid_json' });
  }
}

function sourceStatus(id, label, ok, detail, count) {
  return {
    id,
    label,
    ok: !!ok,
    count: count || 0,
    detail: clamp(detail, 200)
  };
}

export async function fetchGoogleTrends(region) {
  const geo = ALLOWED_REGIONS[sanitizeRegion(region)].google;
  const url = 'https://trends.google.com/trending/rss?geo=' + encodeURIComponent(geo);
  const r = await fetchText(url, 8000);
  if (!r.ok || !r.body || r.body.indexOf('<item>') < 0) {
    return {
      items: [],
      status: sourceStatus('google', 'Google Trends', false, r.error || 'rss_unavailable_' + r.status, 0)
    };
  }
  const items = parseGoogleTrendsRss(r.body, sanitizeRegion(region));
  return {
    items,
    status: sourceStatus(
      'google',
      'Google Trends',
      items.length > 0,
      items.length ? 'rss' : 'empty_feed',
      items.length
    )
  };
}

export async function fetchYouTubePopular(region, apiKey) {
  if (!apiKey) {
    return {
      items: [],
      status: sourceStatus(
        'youtube',
        'YouTube most popular',
        false,
        'youtube_api_key_not_configured',
        0
      )
    };
  }
  const cc = ALLOWED_REGIONS[sanitizeRegion(region)].youtube;
  const params = new URLSearchParams({
    part: 'snippet,statistics',
    chart: 'mostPopular',
    regionCode: cc,
    maxResults: '20',
    key: apiKey
  });
  const r = await fetchJson(
    'https://www.googleapis.com/youtube/v3/videos?' + params.toString(),
    8000
  );
  if (!r.ok || !r.json) {
    return {
      items: [],
      status: sourceStatus('youtube', 'YouTube most popular', false, r.error || 'http_' + r.status, 0)
    };
  }
  const items = parseYouTubeMostPopular(r.json, sanitizeRegion(region));
  return {
    items,
    status: sourceStatus(
      'youtube',
      'YouTube most popular',
      items.length > 0,
      items.length ? 'data_api' : 'empty',
      items.length
    )
  };
}

export async function fetchAppleMusic(region) {
  const cc = ALLOWED_REGIONS[sanitizeRegion(region)].apple;
  const url =
    'https://rss.applemarketingtools.com/api/v2/' + cc + '/music/most-played/20/songs.json';
  const r = await fetchJson(url, 8000);
  if (!r.ok || !r.json) {
    return {
      items: [],
      status: sourceStatus('apple', 'Apple Music charts', false, r.error || 'http_' + r.status, 0)
    };
  }
  const items = parseAppleMusicFeed(r.json, sanitizeRegion(region));
  return {
    items,
    status: sourceStatus(
      'apple',
      'Apple Music charts',
      items.length > 0,
      items.length ? 'public_rss' : 'empty',
      items.length
    )
  };
}

export async function probeTikTokCreativeCenter() {
  const url = 'https://ads.tiktok.com/creative/creativeCenter/trends';
  const r = await fetchText(url, 7000);
  const body = r.body || '';
  const hasItems =
    /hashtag_name|popularHashtag|trendingHashtag/i.test(body) && body.length > 50000;
  return sourceStatus(
    'tiktok',
    'TikTok Creative Center',
    false,
    hasItems ? 'html_present_but_unparsed' : 'public_feed_not_exposed',
    0
  );
}

export async function probeYouTubeCharts() {
  const url = 'https://charts.youtube.com/charts/TrendingVideos/us';
  const r = await fetchText(url, 7000);
  const body = r.body || '';
  const hasVideos = /"videoId":"[A-Za-z0-9_-]{11}"/.test(body);
  return sourceStatus(
    'youtube_charts',
    'YouTube Charts',
    false,
    hasVideos ? 'html_contains_ids' : 'ssr_shell_no_chart_rows',
    0
  );
}

export function assembleDataset(parts, region, nowIso, expiresIso) {
  const items = dedupeTrends(
    []
      .concat(parts.google && parts.google.items)
      .concat(parts.youtube && parts.youtube.items)
      .concat(parts.apple && parts.apple.items)
      .filter(Boolean)
      .map((it) =>
        Object.assign({}, it, {
          fetchedAt: nowIso,
          expiresAt: expiresIso,
          region: it.region || region
        })
      )
  );
  const sources = [
    parts.google && parts.google.status,
    parts.youtube && parts.youtube.status,
    parts.apple && parts.apple.status,
    parts.tiktok,
    parts.youtubeCharts
  ].filter(Boolean);
  return {
    region,
    fetchedAt: nowIso,
    expiresAt: expiresIso,
    ttlMs: TREND_TTL_MS,
    items,
    sources,
    limitations: [
      'TikTok Creative Center does not expose a usable public JSON/RSS feed from this server.',
      'YouTube Charts SSR HTML does not include chart rows; official most-popular videos require YOUTUBE_API_KEY.',
      'Instagram does not publish a free public trend API; it is omitted rather than faked.',
      'Google Trends RSS is search interest, not platform-native TikTok/Reels hashtags.',
      'Apple Music charts are official Apple RSS, not YouTube Charts.'
    ]
  };
}

/**
 * Cache strategy: return memory/persisted cache when fresh.
 * If stale, refresh. If refresh fails, return last usable cache.
 */
export async function getTrendDataset(opts) {
  opts = opts || {};
  const region = sanitizeRegion(opts.region);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const nowMs = now.getTime();
  const force = opts.force === true;
  const cached = (opts.readCache && (await opts.readCache(region))) || memoryGet(region);

  if (!force && isFresh(cached, nowMs, TREND_TTL_MS) && cached.items && cached.items.length) {
    return Object.assign({}, cached, { cache: 'hit' });
  }

  const youtubeKey = opts.youtubeKey || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || '';
  let google;
  let youtube;
  let apple;
  let tiktok;
  let youtubeCharts;
  try {
    const pair = await Promise.all([
      fetchGoogleTrends(region),
      fetchYouTubePopular(region, youtubeKey),
      fetchAppleMusic(region),
      probeTikTokCreativeCenter(),
      probeYouTubeCharts()
    ]);
    google = pair[0];
    youtube = pair[1];
    apple = pair[2];
    tiktok = pair[3];
    youtubeCharts = pair[4];
  } catch (e) {
    if (isUsableStale(cached, nowMs)) {
      return Object.assign({}, cached, { cache: 'stale', refreshError: String((e && e.message) || e).slice(0, 120) });
    }
    throw e;
  }

  const nowIso = now.toISOString();
  const expiresIso = new Date(nowMs + TREND_TTL_MS).toISOString();
  const dataset = assembleDataset(
    { google, youtube, apple, tiktok, youtubeCharts },
    region,
    nowIso,
    expiresIso
  );

  if (!dataset.items.length && isUsableStale(cached, nowMs)) {
    return Object.assign({}, cached, { cache: 'stale', sources: dataset.sources, limitations: dataset.limitations });
  }

  dataset.cache = 'miss';
  memorySet(region, dataset);
  if (opts.writeCache) {
    try {
      await opts.writeCache(region, dataset);
    } catch (e) {
      /* memory cache still holds */
    }
  }
  return dataset;
}
