/**
 * Zero-cost public trend aggregation.
 * No LLM. No paid trend APIs. Frontend never scrapes.
 *
 * Sources that actually expose public data from this runtime:
 *   - Google Trends daily RSS (search / hashtag-like terms)
 *   - Google News public RSS search (topic / category queries only)
 *   - YouTube Data API videos.list chart=mostPopular (only if YOUTUBE_API_KEY is set)
 *   - YouTube Data API search (topic queries only, if YOUTUBE_API_KEY is set)
 *   - Apple Music public RSS (top songs) - labeled Apple, never as YouTube
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
    sourceType: clamp(raw.sourceType, 40),
    related: Array.isArray(raw.related) ? raw.related.map((x) => clamp(x, 80)).filter(Boolean).slice(0, 8) : [],
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
        sourceType: 'search_interest',
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
        sourceType: 'music',
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
        sourceType: 'video',
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
        sourceType: 'video',
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

const NEWS_REGIONS = {
  US: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  GB: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  AU: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en' },
  CA: { hl: 'en-CA', gl: 'CA', ceid: 'CA:en' },
  IN: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  SG: { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
  JP: { hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
  CN: { hl: 'en-HK', gl: 'HK', ceid: 'HK:en' },
  GLOBAL: { hl: 'en-US', gl: 'US', ceid: 'US:en' }
};

/**
 * Extensible niche lexicon for scoring. Unknown queries still work via
 * tokenization plus live topic sources (Google News RSS, optional YouTube).
 */
export const TOPIC_LEXICON = {
  cars: ['car', 'cars', 'auto', 'automotive', 'vehicle', 'ev', 'tesla', 'suv', 'hypercar', 'supercar', 'motorsport', 'racing', 'formula', 'porsche', 'bmw', 'toyota'],
  motorsport: ['motorsport', 'racing', 'f1', 'formula', 'rally', 'nascar', 'motogp', 'grand prix', 'track', 'cars'],
  technology: ['technology', 'tech', 'ai', 'gadget', 'smartphone', 'software', 'startup', 'apple', 'google', 'camera', 'chip', 'robot', 'app'],
  startups: ['startup', 'startups', 'founder', 'venture', 'funding', 'seed', 'yc', 'entrepreneur'],
  entrepreneurship: ['entrepreneur', 'founder', 'startup', 'business', 'side hustle'],
  fitness: ['fitness', 'gym', 'workout', 'training', 'health', 'lifting', 'running', 'wellness'],
  fashion: ['fashion', 'style', 'outfit', 'runway', 'streetwear', 'beauty', 'lookbook'],
  music: ['music', 'song', 'album', 'artist', ' rap', 'pop', 'concert', 'playlist', 'audio'],
  art: ['art', 'artist', 'painting', 'illustration', 'gallery', 'design', 'creative'],
  photography: ['photography', 'photo', 'camera', 'lens', 'portrait', 'cinematic', 'shoot'],
  videography: ['videography', 'video', 'filmmaking', 'cinematic', 'camera', 'b-roll', 'director', 'edit'],
  gaming: ['gaming', 'game', 'esports', 'xbox', 'playstation', 'nintendo', 'steam', 'twitch'],
  education: ['education', 'learn', 'tutorial', 'explain', 'study', 'school', 'course'],
  business: ['business', 'brand', 'marketing', 'sales', 'company', 'startup', 'founder'],
  food: ['food', 'recipe', 'cooking', 'restaurant', 'chef', 'cuisine', 'eat'],
  travel: ['travel', 'trip', 'destination', 'flight', 'hotel', 'tourism', 'city']
};

const TOPIC_ALIASES = {
  tech: 'technology',
  automotive: 'cars',
  car: 'cars',
  ev: 'cars',
  auto: 'cars',
  racing: 'motorsport',
  f1: 'motorsport',
  gym: 'fitness',
  workout: 'fitness',
  photo: 'photography',
  film: 'videography',
  filmmaking: 'videography',
  video: 'videography',
  games: 'gaming',
  game: 'gaming',
  startup: 'startups',
  founder: 'entrepreneurship'
};

export function tokenizeTopic(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, ' ')
    .split(/[\s/+-]+/)
    .filter((t) => t.length > 1);
}

export function expandTopicTerms(query, category) {
  const raw = [query, category].filter(Boolean).join(' ');
  const tokens = tokenizeTopic(raw);
  const extra = [];
  function addLex(key) {
    const k = String(key || '').toLowerCase();
    const resolved = TOPIC_ALIASES[k] || k;
    if (TOPIC_LEXICON[resolved]) extra.push.apply(extra, TOPIC_LEXICON[resolved]);
  }
  tokens.forEach((t) => {
    addLex(t);
    Object.keys(TOPIC_LEXICON).forEach((k) => {
      if (TOPIC_LEXICON[k].indexOf(t) >= 0) extra.push.apply(extra, TOPIC_LEXICON[k]);
    });
  });
  addLex(category);
  const seen = {};
  return tokens.concat(extra).filter((t) => {
    if (seen[t]) return false;
    seen[t] = true;
    return t.length > 1;
  }).slice(0, 48);
}

export function scoreTrendRelevance(item, terms, query) {
  const hay = [
    (item && item.title) || '',
    (item && item.creator) || '',
    (item && item.topic) || '',
    (item && item.category) || '',
    (item && item.source) || ''
  ]
    .join(' ')
    .toLowerCase();
  const q = String(query || '').toLowerCase().trim();
  if (q && hay.indexOf(q) >= 0) return 1;
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length) return 0;
  let hits = 0;
  list.forEach((t) => {
    if (t && t.length > 1 && hay.indexOf(t) >= 0) hits += 1;
  });
  if (!hits) return 0;
  return Math.min(1, 0.26 + (hits / Math.min(list.length, 10)) * 0.74);
}

export function parseGoogleNewsRss(xml, region, topic) {
  const text = String(xml || '');
  const items = [];
  const blocks = text.split(/<item>/i).slice(1);
  blocks.forEach((block, i) => {
    const titleM = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/i);
    const srcM = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const dateM = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const title = decodeXml((titleM && titleM[1]) || '').trim();
    if (!title) return;
    const link = decodeXml((linkM && linkM[1]) || '').trim();
    const publisher = decodeXml((srcM && srcM[1]) || '').trim();
    items.push(
      normalizeTrendItem({
        platform: 'news',
        type: 'news',
        category: 'news',
        title,
        creator: publisher,
        url: link && /^https:\/\//i.test(link) ? link : null,
        rank: i + 1,
        region,
        topic: topic || '',
        source: 'Google News RSS',
        sourceType: 'news',
        timestamp: decodeXml((dateM && dateM[1]) || '').trim() || null,
        metadata: { publisher }
      })
    );
  });
  return items.filter(Boolean);
}

export async function fetchGoogleNewsSearch(query, region) {
  const q = clamp(query, 80).trim();
  if (!q) {
    return {
      items: [],
      status: sourceStatus('news', 'Google News RSS', false, 'empty_query', 0)
    };
  }
  const loc = NEWS_REGIONS[sanitizeRegion(region)] || NEWS_REGIONS.US;
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) +
    '&hl=' +
    encodeURIComponent(loc.hl) +
    '&gl=' +
    encodeURIComponent(loc.gl) +
    '&ceid=' +
    encodeURIComponent(loc.ceid);
  const r = await fetchText(url, TREND_SOURCE_TIMEOUT_MS);
  if (!r.ok || !r.body || r.body.indexOf('<item>') < 0) {
    return {
      items: [],
      status: sourceStatus('news', 'Google News RSS', false, r.error || 'rss_unavailable_' + r.status, 0)
    };
  }
  const items = parseGoogleNewsRss(r.body, sanitizeRegion(region), q);
  return {
    items,
    status: sourceStatus(
      'news',
      'Google News RSS',
      items.length > 0,
      items.length ? 'public_rss' : 'empty_feed',
      items.length
    )
  };
}

function titleMatchesTopic(it, q) {
  return scoreTrendRelevance(it, expandTopicTerms(q, ''), q) >= 0.32;
}

/**
 * Topic / category search. Google daily RSS has no query param, so we:
 *  1. score the cached regional feed against expanded terms
 *  2. fetch Google News RSS for the topic (public RSS, labeled as news)
 *  3. fetch YouTube search when a key exists
 * Results are not written into the region TTL cache.
 */
export async function searchTrendsByTopic(opts) {
  opts = opts || {};
  const region = sanitizeRegion(opts.region);
  const q = clamp(opts.query, 80).trim();
  const category = clamp(opts.category, 40).trim();
  const combined = [q, category].filter(Boolean).join(' ').trim();
  const youtubeKey = opts.youtubeKey || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || '';
  const base = Array.isArray(opts.baseItems) ? opts.baseItems : [];
  const terms = expandTopicTerms(q, category);
  const scoredBase = base
    .map((it) => {
      const relevance = scoreTrendRelevance(it, terms, combined || q);
      return Object.assign({}, it, { topic: combined || q, relevance });
    })
    .filter((it) => it.relevance >= 0.32)
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0));

  const searchQ = combined || q || category;
  const [yt, news] = await Promise.all([
    fetchYouTubeSearch(searchQ, region, youtubeKey),
    fetchGoogleNewsSearch(searchQ, region)
  ]);
  const live = []
    .concat(yt.items || [])
    .concat(news.items || [])
    .map((it) =>
      Object.assign({}, it, {
        topic: searchQ,
        relevance: Math.max(0.62, scoreTrendRelevance(it, terms, searchQ) || 0.62)
      })
    );
  const items = dedupeTrends(scoredBase.concat(live)).sort(
    (a, b) => (b.relevance || 0) - (a.relevance || 0)
  );
  const limitations = [];
  if (!youtubeKey) {
    limitations.push(
      'YouTube topic videos need YOUTUBE_API_KEY. Search still uses Google News RSS and scored Google Trends titles.'
    );
  }
  limitations.push(
    'Google News RSS is current news and search interest, not Instagram or TikTok trends.'
  );
  if (!items.length) {
    limitations.push('No public matches for this topic. Nothing here is simulated.');
  }
  return {
    region,
    query: q,
    category,
    items,
    sources: [yt.status, news.status],
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
