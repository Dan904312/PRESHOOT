/**
 * Creative research API — YouTube + CapCut (extensible platform registry).
 * Builds creative intent via Anthropic, then ranks platform results.
 */
import {
  setCors,
  handleOptions,
  requireUser,
  requireResearchAccess,
  gateRouteRateLimit,
  sendRateLimitResponse
} from '../lib/security.js';

const MAX_ITEMS = 5;

function clampStr(s, n) {
  return String(s || '').slice(0, n);
}

function sanitizeContext(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    title: clampStr(c.title, 160),
    hook: clampStr(c.hook, 280),
    whyItWorks: clampStr(c.whyItWorks, 400),
    shotAngle: clampStr(c.shotAngle, 400),
    editingStyle: clampStr(c.editingStyle, 240),
    audio: clampStr(c.audio, 160),
    category: clampStr(c.category, 40),
    sceneLabel: clampStr(c.sceneLabel, 120),
    sceneType: clampStr(c.sceneType, 60),
    niche: clampStr(c.niche, 120),
    creatorStyle: clampStr(c.creatorStyle, 120),
    goals: clampStr(c.goals, 160),
    platform: clampStr(c.platform, 80),
    pacing: clampStr(c.pacing, 60),
    transitionStyle: clampStr(c.transitionStyle, 60),
    format: clampStr(c.format, 40),
    formatExtra: clampStr(c.formatExtra, 160),
    ytSearch: clampStr(c.ytSearch, 80),
    capcutSearch: clampStr(c.capcutSearch, 80),
    contentStyles: Array.isArray(c.contentStyles)
      ? c.contentStyles.slice(0, 8).map((x) => clampStr(x, 40))
      : [],
    aesthetics: Array.isArray(c.aesthetics)
      ? c.aesthetics.slice(0, 8).map((x) => clampStr(x, 40))
      : []
  };
}

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

async function callClaude(system, user, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI not configured');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 900,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('AI error: ' + err.slice(0, 120));
  }
  const data = await r.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  return (block && block.text) || '';
}

function contextBlock(ctx) {
  return [
    `Title: ${ctx.title}`,
    `Hook: ${ctx.hook}`,
    `Scene: ${ctx.sceneLabel || ctx.sceneType || 'n/a'}`,
    `Niche / industry: ${ctx.niche || 'n/a'}`,
    `Format: ${ctx.format || ctx.category || 'n/a'} ${ctx.formatExtra || ''}`,
    `Editing style: ${ctx.editingStyle || 'n/a'}`,
    `Shot approach: ${ctx.shotAngle || 'n/a'}`,
    `Why it works: ${ctx.whyItWorks || 'n/a'}`,
    `Creator style: ${ctx.creatorStyle || 'n/a'}`,
    `Platform: ${ctx.platform || 'short-form'}`,
    `Pacing: ${ctx.pacing || 'n/a'}`,
    `Transitions: ${ctx.transitionStyle || 'n/a'}`,
    `Aesthetics: ${(ctx.aesthetics || []).join(', ') || 'n/a'}`,
    `Content styles: ${(ctx.contentStyles || []).join(', ') || 'n/a'}`,
    `Seed ytSearch: ${ctx.ytSearch || 'n/a'}`,
    `Seed capcutSearch: ${ctx.capcutSearch || 'n/a'}`
  ].join('\n');
}

async function buildYouTubeStrategy(ctx) {
  const system = `You are a senior content strategist and video researcher.
Build a PRECISION YouTube research plan for ONE specific video idea.
Rules:
- Match the subject tightly (cars ≠ bikes/planes; coffee ads ≠ random coffee vlogs; dentist ads ≠ lectures; restaurants ≠ food documentaries).
- Prefer commercial / social / reel / ad / cinematic references over lectures or unrelated vlogs.
- Prefer precision over recall. 2–3 sharp queries beat 10 vague ones.
- Include mustInclude subject terms and hardExclude off-topic terms.
- Output JSON only.`;

  const user = `Idea context:\n${contextBlock(ctx)}\n\nReturn JSON:
{
  "intent": "one sentence creative intent",
  "techniques": ["editing techniques to look for"],
  "pacing": "pacing note",
  "queries": ["precise search query 1", "query 2", "query 3"],
  "mustInclude": ["required subject tokens"],
  "hardExclude": ["off-topic tokens to avoid"],
  "prefer": ["ads", "reels", "commercial", "cinematic"]
}`;

  const text = await callClaude(system, user, 700);
  const parsed = extractJson(text) || {};
  return {
    intent: clampStr(parsed.intent, 200) || 'Find strong visual references for this idea.',
    techniques: Array.isArray(parsed.techniques)
      ? parsed.techniques.slice(0, 6).map((t) => clampStr(t, 40))
      : [],
    pacing: clampStr(parsed.pacing, 80),
    queries: Array.isArray(parsed.queries)
      ? parsed.queries.slice(0, 3).map((q) => clampStr(q, 90)).filter(Boolean)
      : [buildFallbackYtQuery(ctx)],
    mustInclude: Array.isArray(parsed.mustInclude)
      ? parsed.mustInclude.slice(0, 8).map((t) => clampStr(t, 30).toLowerCase())
      : [],
    hardExclude: Array.isArray(parsed.hardExclude)
      ? parsed.hardExclude.slice(0, 12).map((t) => clampStr(t, 30).toLowerCase())
      : [],
    prefer: Array.isArray(parsed.prefer)
      ? parsed.prefer.slice(0, 8).map((t) => clampStr(t, 30).toLowerCase())
      : ['commercial', 'reel', 'ad', 'cinematic']
  };
}

function buildFallbackYtQuery(ctx) {
  const bits = [
    ctx.niche,
    ctx.sceneLabel || ctx.title,
    ctx.format === 'advert' || /ad|promo|marketing/i.test(ctx.format + ctx.category)
      ? 'commercial advertisement'
      : 'cinematic reel',
    ctx.editingStyle ? ctx.editingStyle.split(/[,.]/)[0] : ''
  ].filter(Boolean);
  return bits.join(' ').slice(0, 80) || 'cinematic short form commercial';
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function relevanceScore(video, strategy, ctx) {
  const hay = (
    (video.title || '') +
    ' ' +
    (video.description || '') +
    ' ' +
    (video.channelTitle || '')
  ).toLowerCase();

  let score = 0;
  const must = strategy.mustInclude || [];
  const excl = strategy.hardExclude || [];
  const prefer = strategy.prefer || [];

  for (const ex of excl) {
    if (ex && hay.includes(ex)) score -= 4;
  }
  for (const m of must) {
    if (m && hay.includes(m)) score += 2.2;
    else if (m) score -= 0.8;
  }
  for (const p of prefer) {
    if (p && hay.includes(p)) score += 0.9;
  }

  const ideaTokens = tokenize(
    [ctx.title, ctx.hook, ctx.niche, ctx.sceneLabel, ctx.editingStyle].join(' ')
  );
  let hits = 0;
  for (const t of ideaTokens.slice(0, 18)) {
    if (hay.includes(t)) hits += 1;
  }
  score += Math.min(hits * 0.35, 3.5);

  const views = Number(video.viewCount) || 0;
  score += Math.min(Math.log10(views + 1) / 7, 1.4);

  const likes = Number(video.likeCount) || 0;
  if (views > 0 && likes > 0) {
    const ratio = likes / views;
    if (ratio > 0.02) score += 0.5;
    else if (ratio > 0.01) score += 0.25;
  }

  // Prefer mid/high view counts for references
  if (views < 1000) score -= 1.5;
  else if (views < 10000) score -= 0.4;
  else if (views > 100000) score += 0.35;

  const published = video.publishedAt ? Date.parse(video.publishedAt) : 0;
  if (published) {
    const ageDays = (Date.now() - published) / 86400000;
    if (ageDays < 365 * 2) score += 0.25;
    if (ageDays > 365 * 8) score -= 0.35;
  }

  return score;
}

function whyForVideo(video, strategy) {
  const hay = ((video.title || '') + ' ' + (video.description || '')).toLowerCase();
  const reasons = [];
  if ((strategy.techniques || []).some((t) => hay.includes(String(t).toLowerCase().split(' ')[0]))) {
    reasons.push('Editing techniques match your concept');
  }
  if (/hook|pov|wait|secret|nobody/i.test(video.title || '')) reasons.push('Strong opening hook energy');
  if (/cinematic|commercial|ad|promo|brand/i.test(hay)) reasons.push('Commercial / cinematic framing');
  if (/transition|speed ramp|montage|cut/i.test(hay)) reasons.push('Useful transition / pacing reference');
  if ((Number(video.viewCount) || 0) > 100000) reasons.push('Proven audience pull');
  if (!reasons.length) {
    reasons.push(
      strategy.intent
        ? 'Aligned with your creative intent'
        : 'Subject and style closely match this idea'
    );
  }
  return reasons[0];
}

function formatViews(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
  return v + ' views';
}

async function youtubeSearch(query, key) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '8',
    q: query,
    relevanceLanguage: 'en',
    safeSearch: 'moderate',
    videoEmbeddable: 'true',
    key
  });
  const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + params);
  if (!r.ok) throw new Error('YouTube search failed');
  const data = await r.json();
  return (data.items || [])
    .map((it) => ({
      videoId: it.id && it.id.videoId,
      title: it.snippet && it.snippet.title,
      description: it.snippet && it.snippet.description,
      channelTitle: it.snippet && it.snippet.channelTitle,
      publishedAt: it.snippet && it.snippet.publishedAt,
      thumbnail:
        (it.snippet &&
          it.snippet.thumbnails &&
          ((it.snippet.thumbnails.medium && it.snippet.thumbnails.medium.url) ||
            (it.snippet.thumbnails.default && it.snippet.thumbnails.default.url))) ||
        null
    }))
    .filter((v) => v.videoId);
}

async function youtubeVideos(ids, key) {
  if (!ids.length) return {};
  const params = new URLSearchParams({
    part: 'statistics,snippet,contentDetails',
    id: ids.join(','),
    key
  });
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?' + params);
  if (!r.ok) throw new Error('YouTube videos failed');
  const data = await r.json();
  const map = {};
  for (const it of data.items || []) {
    map[it.id] = {
      viewCount: it.statistics && it.statistics.viewCount,
      likeCount: it.statistics && it.statistics.likeCount,
      channelTitle: it.snippet && it.snippet.channelTitle,
      description: it.snippet && it.snippet.description,
      publishedAt: it.snippet && it.snippet.publishedAt,
      title: it.snippet && it.snippet.title
    };
  }
  return map;
}

async function researchYouTube(ctx) {
  const strategy = await buildYouTubeStrategy(ctx);
  const key = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY;
  const fallbackUrl =
    'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(strategy.queries[0] || buildFallbackYtQuery(ctx));

  if (!key) {
    // AI-curated search cards when Data API is not configured
    const items = strategy.queries.slice(0, MAX_ITEMS).map((q, i) => ({
      title: q,
      channel: 'Precision search',
      viewsLabel: null,
      thumbnail: null,
      styleTag: (strategy.techniques && strategy.techniques[i]) || strategy.pacing || 'Reference hunt',
      why:
        i === 0
          ? 'Primary research query — tight subject + style match'
          : 'Secondary angle to compare pacing and hooks',
      url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=CAMSAhAB',
      cta: 'Search YouTube'
    }));
    return {
      platform: 'youtube',
      mode: 'strategy_queries',
      strategy: {
        intent: strategy.intent,
        techniques: strategy.techniques
      },
      items,
      fallbackUrl,
      note: 'Add YOUTUBE_API_KEY for ranked video shortlists with thumbnails and view counts.'
    };
  }

  const seen = new Set();
  let candidates = [];
  for (const q of strategy.queries) {
    try {
      const found = await youtubeSearch(q, key);
      for (const v of found) {
        if (seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        candidates.push(v);
      }
    } catch (e) {
      /* continue other queries */
    }
  }

  const details = await youtubeVideos(
    candidates.slice(0, 24).map((c) => c.videoId),
    key
  );
  candidates = candidates.map((c) => {
    const d = details[c.videoId] || {};
    return Object.assign({}, c, d);
  });

  const ranked = candidates
    .map((v) => ({
      video: v,
      score: relevanceScore(v, strategy, ctx)
    }))
    .sort((a, b) => b.score - a.score)
    .filter((r) => r.score > -1)
    .slice(0, MAX_ITEMS);

  const items = ranked.map((r) => ({
    title: r.video.title,
    channel: r.video.channelTitle,
    viewsLabel: formatViews(r.video.viewCount),
    thumbnail: r.video.thumbnail,
    styleTag: strategy.techniques[0] || null,
    why: whyForVideo(r.video, strategy),
    url: 'https://www.youtube.com/watch?v=' + r.video.videoId,
    cta: 'Open on YouTube',
    score: Math.round(r.score * 100) / 100
  }));

  return {
    platform: 'youtube',
    mode: 'ranked_videos',
    strategy: {
      intent: strategy.intent,
      techniques: strategy.techniques
    },
    items,
    fallbackUrl,
    emptyMessage: items.length
      ? undefined
      : 'No strong YouTube matches passed the quality filter for this idea.'
  };
}

async function researchCapCut(ctx) {
  const system = `You are a CapCut template strategist for professional short-form editors.
Recommend HIGH-QUALITY CapCut template search targets for ONE specific video idea.
Rules:
- Match content STYLE (cinematic café promo, speed-ramp car edit, gym transformation montage) — not just the noun.
- Prefer popular, modern, commercially useful templates: product reveals, lifestyle reels, smooth food transitions, luxury automotive, fitness montages, etc.
- Avoid outdated/meme-only/low-effort suggestions unless the idea is explicitly meme format.
- Each recommendation needs a precise CapCut template-center keyword (3–7 words).
- Output JSON only.`;

  const user = `Idea context:\n${contextBlock(ctx)}\n\nReturn JSON:
{
  "intent": "one sentence editing intent",
  "techniques": ["transitions / effects / pacing cues"],
  "templates": [
    {
      "title": "Human label for the template type",
      "keyword": "capcut template center keyword",
      "styleTag": "e.g. Product reveal",
      "why": "why this helps THIS idea",
      "quality": "popular|cinematic|high-energy|lifestyle"
    }
  ]
}
Return 4–5 templates max.`;

  const text = await callClaude(system, user, 900);
  const parsed = extractJson(text) || {};
  const templates = Array.isArray(parsed.templates) ? parsed.templates : [];

  const items = templates.slice(0, MAX_ITEMS).map((t) => {
    const keyword = clampStr(t.keyword || t.title || ctx.capcutSearch || 'cinematic reel template', 80);
    return {
      title: clampStr(t.title || keyword, 100),
      channel: 'CapCut Template Center',
      viewsLabel: clampStr(t.quality || 'Curated', 40),
      thumbnail: null,
      styleTag: clampStr(t.styleTag || '', 40),
      why: clampStr(t.why || 'Matches the editing style of this idea', 160),
      url:
        'https://www.capcut.com/template-center?keyword=' +
        encodeURIComponent(keyword),
      cta: 'Open in CapCut'
    };
  });

  // Guarantee at least one useful deep link
  if (!items.length) {
    const keyword = [
      ctx.niche,
      ctx.sceneLabel,
      /ad|advert|promo/i.test(ctx.format + ctx.category) ? 'commercial promo' : 'cinematic',
      'reel template'
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 70);
    items.push({
      title: 'Best-match CapCut templates',
      channel: 'CapCut Template Center',
      viewsLabel: 'Curated',
      thumbnail: null,
      styleTag: ctx.editingStyle ? clampStr(ctx.editingStyle.split(/[,.]/)[0], 40) : 'Style match',
      why: 'Precision keyword built from your idea, niche, and edit style',
      url: 'https://www.capcut.com/template-center?keyword=' + encodeURIComponent(keyword),
      cta: 'Open in CapCut'
    });
  }

  return {
    platform: 'capcut',
    mode: 'template_strategy',
    strategy: {
      intent: clampStr(parsed.intent, 200) || 'Find CapCut templates that match this edit.',
      techniques: Array.isArray(parsed.techniques)
        ? parsed.techniques.slice(0, 6).map((t) => clampStr(t, 40))
        : []
    },
    items,
    fallbackUrl: items[0] && items[0].url
  };
}

const ADAPTERS = {
  youtube: researchYouTube,
  capcut: researchCapCut
  // Future: tiktok, instagram, vimeo, pinterest, behance
};

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return handleOptions(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const auth = await requireUser(req);
  const rl = await gateRouteRateLimit(req, {
    route: 'research',
    max: 40,
    windowMs: 60 * 1000,
    userId: auth.error ? null : auth.user.id
  });
  if (!rl.allowed) return sendRateLimitResponse(res, rl);

  if (auth.error) {
    return res.status(auth.status).json({ error: { message: 'Sign in to use creative research' } });
  }

  const access = await requireResearchAccess(auth.user);
  if (!access.ok) {
    const msg =
      access.error === 'pro_required'
        ? 'Creative research requires PreShoot Pro'
        : access.error === 'quota_exceeded'
          ? 'Daily research limit reached. Try again tomorrow.'
          : access.error || 'Access denied';
    return res.status(access.status || 403).json({ error: { message: msg } });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: { message: 'AI not configured' } });
  }

  const body = req.body || {};
  const platform = String(body.platform || '').toLowerCase();
  if (!ADAPTERS[platform]) {
    return res.status(400).json({
      error: {
        message: 'Unsupported platform. Use youtube or capcut.'
      }
    });
  }

  const ctx = sanitizeContext(body.context);

  try {
    const result = await ADAPTERS[platform](ctx);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({
      error: { message: (e && e.message ? e.message : 'Research failed').slice(0, 160) }
    });
  }
}
