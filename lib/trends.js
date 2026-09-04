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
export const TREND_SOURCE_TIMEOUT_MS = 3000;
export const TREND_UPSTREAM_BUDGET_MS = 3500;

const ALLOWED_REGIONS = {
  US: { google: 'US', youtube: 'US', apple: 'us' },
  GB: { google: 'GB', youtube: 'GB', apple: 'gb' },
  AU: { google: 'AU', youtube: 'AU', apple: 'au' },
  CA: { google: 'CA', youtube: 'CA', apple: 'ca' },
  IN: { google: 'IN', youtube: 'IN', apple: 'in' },
  SG: { google: 'SG', youtube: 'SG', apple: 'sg' },
  JP: { google: 'JP', youtube: 'JP', apple: 'jp' },
  CN: { google: 'CN', youtube: 'HK', apple: 'cn' },
  GLOBAL: { google: 'US', youtube: 'US', apple: 'us' }
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
    region: clamp(raw.region, 12) || 'US',
    category: clamp(raw.category, 40) || type,
    source: clamp(raw.source, 80),
    fetchedAt: raw.fetchedAt || null,
    expiresAt: raw.expiresAt || null,
    metric: clamp(raw.metric, 80),
    topic: clamp(raw.topic, 80),
    timestamp: raw.timestamp || raw.fetchedAt || null,
    relevance: Number.isFinite(Number(raw.relevance)) ? Number(raw.relevance) : null,
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
  const ms = Math.min(Math.max(timeoutMs || TREND_SOURCE_TIMEOUT_MS, 400), 4000);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl
    ? setTimeout(() => {
        ctrl.abort();
      }, ms)
    : null;
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
    let bodyTimer = null;
    const body = await Promise.race([
      r.text(),
      new Promise((_, reject) => {
        bodyTimer = setTimeout(() => reject(new Error('body_timeout')), Math.min(1500, ms));
      })
    ]);
    if (bodyTimer) clearTimeout(bodyTimer);
    return { ok: r.ok, status: r.status, body: String(body || '').slice(0, 250000) };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 120);
    return {
      ok: false,
      status: 0,
      body: '',
      error: msg,
      timedOut: /abort|timeout/i.test(msg)
    };
  } finally {
    if (t) clearTimeout(t);
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
  const r = await fetchText(url, TREND_SOURCE_TIMEOUT_MS);
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
    TREND_SOURCE_TIMEOUT_MS
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
  const r = await fetchJson(url, TREND_SOURCE_TIMEOUT_MS);
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
      'Apple Music charts are official Apple RSS, not YouTube Charts.',
      'China YouTube most-popular uses Hong Kong region codes because CN is often unavailable on the Data API.',
      'Global mixes United States YouTube charts with extra Google Trends markets. It is not a true worldwide ranking.'
    ]
  };
}

export function parseYouTubeSearchList(json, region, topic) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  return items
    .map((it, i) => {
      const sn = it.snippet || {};
      const id = it.id && it.id.videoId;
      const thumbs = sn.thumbnails || {};
      const thumb =
        (thumbs.medium && thumbs.medium.url) ||
        (thumbs.default && thumbs.default.url) ||
        null;
      return normalizeTrendItem({
        platform: 'youtube',
        type: 'video',
        category: 'video',
        title: sn.title,
        creator: sn.channelTitle,
        url: id ? 'https://www.youtube.com/watch?v=' + id : null,
        thumbnail: thumb,
        rank: i + 1,
        region,
        topic: topic || '',
        source: 'YouTube search',
        metadata: { videoId: id }
      });
    })
    .filter(Boolean);
}

export async function fetchYouTubeSearch(query, region, apiKey) {
  const q = clamp(query, 80).trim();
  if (!apiKey) {
    return {
      items: [],
      status: sourceStatus('youtube_search', 'YouTube topic search', false, 'youtube_api_key_not_configured', 0)
    };
  }
  if (!q) {
    return {
      items: [],
      status: sourceStatus('youtube_search', 'YouTube topic search', false, 'empty_query', 0)
    };
  }
  const cc = ALLOWED_REGIONS[sanitizeRegion(region)].youtube;
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '12',
    q,
    regionCode: cc,
    safeSearch: 'moderate',
    key: apiKey
  });
  const r = await fetchJson('https://www.googleapis.com/youtube/v3/search?' + params.toString(), TREND_SOURCE_TIMEOUT_MS);
  if (!r.ok || !r.json) {
    return {
      items: [],
      status: sourceStatus('youtube_search', 'YouTube topic search', false, r.error || 'http_' + r.status, 0)
    };
  }
  const items = parseYouTubeSearchList(r.json, sanitizeRegion(region), q);
  return {
    items,
    status: sourceStatus(
      'youtube_search',
      'YouTube topic search',
      items.length > 0,
      items.length ? 'data_api' : 'empty',
      items.length
    )
  };
}

function titleMatchesTopic(it, q) {
  const n = String(q || '').toLowerCase();
  if (!n) return true;
  const hay = ((it && it.title) || '') + ' ' + ((it && it.creator) || '') + ' ' + ((it && it.topic) || '');
  return hay.toLowerCase().indexOf(n) >= 0;
}

/**
 * Topic search uses live YouTube search when a key exists, plus filtered public
 * trend titles. Results are not written into the region TTL cache.
 */
export async function searchTrendsByTopic(opts) {
  opts = opts || {};
  const region = sanitizeRegion(opts.region);
  const q = clamp(opts.query, 80).trim();
  const youtubeKey = opts.youtubeKey || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || '';
  const base = Array.isArray(opts.baseItems) ? opts.baseItems : [];
  const filtered = base.filter((it) => titleMatchesTopic(it, q)).map((it) =>
    Object.assign({}, it, { topic: q, relevance: 1 })
  );
  const yt = await fetchYouTubeSearch(q, region, youtubeKey);
  const items = dedupeTrends(filtered.concat(yt.items || []));
  const limitations = [];
  if (!youtubeKey) {
    limitations.push(
      'Topic search is filtering public trend titles. Set YOUTUBE_API_KEY for YouTube topic videos.'
    );
  }
  if (!items.length) {
    limitations.push('No public matches for this topic. Nothing here is simulated.');
  }
  return {
    region,
    query: q,
    items,
    sources: [yt.status],
    limitations,
    fetchedAt: new Date().toISOString()
  };
}

export function skippedFragileSources() {
  return [
    sourceStatus('tiktok', 'TikTok Creative Center', false, 'not_fetched_on_request_path', 0),
    sourceStatus('youtube_charts', 'YouTube Charts', false, 'not_fetched_on_request_path', 0)
  ];
}

function budgetExceededParts() {
  const skipped = skippedFragileSources();
  return {
    google: {
      items: [],
      status: sourceStatus('google', 'Google Trends', false, 'budget_exceeded', 0)
    },
    youtube: {
      items: [],
      status: sourceStatus('youtube', 'YouTube most popular', false, 'budget_exceeded', 0)
    },
    apple: {
      items: [],
      status: sourceStatus('apple', 'Apple Music charts', false, 'budget_exceeded', 0)
    },
    tiktok: skipped[0],
    youtubeCharts: skipped[1]
  };
}

/**
 * Public RSS/JSON only. TikTok Creative Center and YouTube Charts HTML
 * are never fetched on the user request path (login walls / JS shells).
 */
async function fetchRegionParts(region, youtubeKey, budgetMs) {
  const skipped = skippedFragileSources();
  const work = Promise.all([
    fetchGoogleTrends(region),
    fetchYouTubePopular(region, youtubeKey),
    fetchAppleMusic(region)
  ]);
  const ms = Math.min(Math.max(budgetMs || TREND_UPSTREAM_BUDGET_MS, 800), 5000);
  const timed = await Promise.race([
    work.then((pair) => ({ pair })),
    new Promise((resolve) => {
      setTimeout(() => resolve({ timeout: true }), ms);
    })
  ]);
  if (!timed || timed.timeout || !timed.pair) {
    return budgetExceededParts();
  }
  return {
    google: timed.pair[0],
    youtube: timed.pair[1],
    apple: timed.pair[2],
    tiktok: skipped[0],
    youtubeCharts: skipped[1]
  };
}

/**
 * Prefer last-good cache (fresh or stale) so the request path does not wait
 * on upstream. Refresh only on cache miss or explicit force.
 */
export async function getTrendDataset(opts) {
  opts = opts || {};
  const region = sanitizeRegion(opts.region);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const nowMs = now.getTime();
  const force = opts.force === true;
  const budgetMs = opts.budgetMs || TREND_UPSTREAM_BUDGET_MS;
  const cached =
    opts.cached && Array.isArray(opts.cached.items)
      ? opts.cached
      : (opts.readCache && (await opts.readCache(region))) || memoryGet(region);

  if (!force && cached && Array.isArray(cached.items) && cached.items.length) {
    const fresh = isFresh(cached, nowMs, TREND_TTL_MS);
    return Object.assign({}, cached, { cache: fresh ? 'hit' : 'stale' });
  }

  const youtubeKey = opts.youtubeKey || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || '';
  let parts;
  try {
    if (region === 'GLOBAL') {
      const extra = await Promise.race([
        Promise.all([
          fetchRegionParts('US', youtubeKey, budgetMs),
          fetchGoogleTrends('GB'),
          fetchGoogleTrends('AU'),
          fetchGoogleTrends('SG')
        ]).then((rows) => ({ rows })),
        new Promise((resolve) => {
          setTimeout(() => resolve({ timeout: true }), budgetMs);
        })
      ]);
      if (!extra || extra.timeout || !extra.rows) {
        parts = budgetExceededParts();
      } else {
        const us = extra.rows[0];
        parts = {
          google: {
            items: []
              .concat(us.google && us.google.items)
              .concat(extra.rows[1] && extra.rows[1].items)
              .concat(extra.rows[2] && extra.rows[2].items)
              .concat(extra.rows[3] && extra.rows[3].items)
              .filter(Boolean),
            status: us.google && us.google.status
          },
          youtube: us.youtube,
          apple: us.apple,
          tiktok: us.tiktok,
          youtubeCharts: us.youtubeCharts
        };
      }
    } else {
      parts = await fetchRegionParts(region, youtubeKey, budgetMs);
    }
  } catch (e) {
    if (isUsableStale(cached, nowMs)) {
      return Object.assign({}, cached, {
        cache: 'stale',
        warning: 'refresh_failed',
        refreshError: String((e && e.message) || e).slice(0, 120)
      });
    }
    throw e;
  }

  const nowIso = now.toISOString();
  const expiresIso = new Date(nowMs + TREND_TTL_MS).toISOString();
  const dataset = assembleDataset(
    {
      google: parts.google,
      youtube: parts.youtube,
      apple: parts.apple,
      tiktok: parts.tiktok,
      youtubeCharts: parts.youtubeCharts
    },
    region,
    nowIso,
    expiresIso
  );

  if (!dataset.items.length && isUsableStale(cached, nowMs)) {
    return Object.assign({}, cached, {
      cache: 'stale',
      warning: 'refresh_failed',
      sources: dataset.sources,
      limitations: dataset.limitations
    });
  }

  if (!dataset.items.length) {
    dataset.cache = 'empty';
    dataset.warning = 'unavailable';
    return dataset;
  }

  dataset.cache = force ? 'refresh' : 'miss';
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
