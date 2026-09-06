/**
 * Topic search, category chips, location, and relevance gating for Trending.
 * Run: node tests/trending-search.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import {
  expandTopicTerms,
  scoreTrendRelevance,
  parseGoogleNewsRss,
  searchTrendsByTopic,
  fetchGoogleNewsSearch
} from '../lib/trends.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ✓', name);
  } catch (e) {
    failed += 1;
    console.error('  ✗', name, '\n   ', e.message);
  }
}

function newsXml(title) {
  return (
    '<?xml version="1.0"?><rss><channel>' +
    '<item><title>' +
    title +
    '</title><link>https://example.com/a</link><source url="https://example.com">Example Press</source><pubDate>Sun, 06 Sep 2026 00:00:00 GMT</pubDate></item>' +
    '</channel></rss>'
  );
}

function loadTrending(opts) {
  opts = opts || {};
  const urls = [];
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Promise,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    document: {
      getElementById: function (id) {
        if (id === 'lib-grid') return { innerHTML: '' };
        if (id === 'lib-count') return { textContent: '' };
        return null;
      },
      querySelector: function () {
        return null;
      }
    },
    localStorage: {
      getItem: function () {
        return opts.region || null;
      },
      setItem: function () {}
    },
    apiFetch: async function (url) {
      urls.push(String(url));
      const items = typeof opts.items === 'function' ? opts.items(url) : opts.items || [];
      const delay = opts.delay || 0;
      if (delay) await new Promise(function (r) { setTimeout(r, delay); });
      return {
        json: async function () {
          return { ok: true, items: items, sources: [], fetchedAt: new Date().toISOString() };
        }
      };
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.S = { libTab: 'trending' };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/trending.js'), 'utf8'), sandbox, {
    filename: 'trending.js'
  });
  sandbox._urls = urls;
  return sandbox;
}

const research = fs.readFileSync(path.join(root, 'api/research.js'), 'utf8');
const trendingSrc = fs.readFileSync(path.join(root, 'js/trending.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const ctxSrc = fs.readFileSync(path.join(root, 'js/director-context.js'), 'utf8');

console.log('\n== Trending search / category ==');

test('cars lexicon expands beyond a literal title substring', () => {
  const terms = expandTopicTerms('cars', '');
  assert.ok(terms.includes('cars'));
  assert.ok(terms.includes('automotive') || terms.includes('motorsport'));
  assert.ok(scoreTrendRelevance({ title: 'Porsche 911 GT3 restomod' }, terms, 'cars') >= 0.32);
  assert.strictEqual(scoreTrendRelevance({ title: 'Celebrity couple split after awards show' }, terms, 'cars'), 0);
});

test('unknown niches still tokenize instead of requiring a hardcoded list', () => {
  const terms = expandTopicTerms('drone mapping', 'Education');
  assert.ok(terms.includes('drone'));
  assert.ok(terms.includes('mapping'));
  assert.ok(terms.includes('education') || terms.includes('tutorial'));
});

test('Google News RSS parser keeps a real news source label', () => {
  const items = parseGoogleNewsRss(newsXml('New EV battery plant in Detroit'), 'US', 'cars');
  assert.strictEqual(items.length, 1);
  assert.ok(/EV battery/i.test(items[0].title));
  assert.strictEqual(items[0].source, 'Google News RSS');
  assert.strictEqual(items[0].platform, 'news');
  assert.strictEqual(items[0].sourceType, 'news');
});

await testAsync('search query changes results and does not return the default feed', async () => {
  const orig = global.fetch;
  const urls = [];
  global.fetch = async function (url) {
    urls.push(String(url));
    const u = String(url);
    if (u.includes('news.google.com')) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]+)/) || [])[1] || '');
      const title = /cars|automotive|porsche/i.test(q)
        ? 'Porsche 911 GT3 RS track times'
        : /technology|camera/i.test(q)
          ? 'New cinema camera sensor announced'
          : 'Unrelated headline';
      return { ok: true, status: 200, text: async function () { return newsXml(title); } };
    }
    throw new Error('unexpected fetch ' + u);
  };
  try {
    const base = [
      { title: 'Celebrity couple breakup', platform: 'google', type: 'hashtag', source: 'Google Trends' },
      { title: 'Porsche 911 restomod', platform: 'google', type: 'hashtag', source: 'Google Trends' }
    ];
    const cars = await searchTrendsByTopic({
      query: 'cars',
      category: '',
      region: 'US',
      youtubeKey: '',
      baseItems: base
    });
    const tech = await searchTrendsByTopic({
      query: 'technology',
      category: '',
      region: 'US',
      youtubeKey: '',
      baseItems: base
    });
    const carTitles = (cars.items || []).map((it) => it.title).join(' | ');
    const techTitles = (tech.items || []).map((it) => it.title).join(' | ');
    assert.ok(/Porsche|EV|car|automotive/i.test(carTitles), carTitles);
    assert.ok(!/Celebrity couple/i.test(carTitles), 'default celebrity row must not leak into cars');
    assert.ok(/camera|technology|sensor/i.test(techTitles), techTitles);
    assert.notStrictEqual(carTitles, techTitles);
    assert.ok(urls.some((u) => /news\.google\.com/.test(u) && /cars/i.test(decodeURIComponent(u))));
    assert.ok(urls.some((u) => /news\.google\.com/.test(u) && /technology/i.test(decodeURIComponent(u))));
    assert.ok((cars.limitations || []).some((l) => /not Instagram or TikTok/i.test(l)));
  } finally {
    global.fetch = orig;
  }
});

await testAsync('search plus category both change the upstream query', async () => {
  const orig = global.fetch;
  const urls = [];
  global.fetch = async function (url) {
    urls.push(String(url));
    return { ok: true, status: 200, text: async function () { return newsXml('Cinema camera firmware update'); } };
  };
  try {
    const found = await searchTrendsByTopic({
      query: 'camera',
      category: 'Technology',
      region: 'AU',
      youtubeKey: '',
      baseItems: []
    });
    assert.ok(found.query === 'camera');
    assert.ok(found.category === 'Technology');
    const newsUrl = urls.find((u) => /news\.google\.com/.test(u));
    assert.ok(newsUrl, 'Google News must be queried');
    const q = decodeURIComponent((newsUrl.match(/[?&]q=([^&]+)/) || [])[1] || '');
    assert.ok(/camera/i.test(q));
    assert.ok(/Technology/i.test(q));
    assert.ok(/gl=AU/.test(newsUrl));
    assert.ok((found.items || []).some((it) => /camera/i.test(it.title)));
  } finally {
    global.fetch = orig;
  }
});

test('API and client pass both q and category', () => {
  const start = research.indexOf('async function handleTrends');
  const block = research.slice(start, research.indexOf('export default async function handler'));
  assert.ok(block.includes('const category'));
  assert.ok(block.includes('searchTrendsByTopic'));
  assert.ok(block.includes('if (topic || category)'));
  assert.ok(trendingSrc.includes("url += '&category='"));
  assert.ok(trendingSrc.includes("url += '&q='"));
  assert.ok(trendingSrc.includes('TREND_DEBOUNCE_MS'));
  assert.ok(trendingSrc.includes('function selectNiche'));
  assert.ok(trendingSrc.includes('function onSearchInput'));
  assert.ok(trendingSrc.includes('seq !== loadSeq'));
});

test('category chips are niches, not decorative type filters', () => {
  assert.ok(trendingSrc.includes("selectNiche("));
  assert.ok(trendingSrc.includes("onclick=\"PreShootTrending.selectNiche(\\'"));
  assert.ok(!/selectNiche\('\s*\+\s*JSON\.stringify/.test(trendingSrc));
  assert.ok(!/selectNiche\(" \+ JSON\.stringify/.test(trendingSrc));
  assert.ok(trendingSrc.includes("filters.niche === next"));
  assert.ok(trendingSrc.includes("'Technology'"));
  assert.ok(trendingSrc.includes("'Cars'"));
  assert.ok(trendingSrc.includes('aria-pressed'));
  assert.ok(trendingSrc.includes('trend-chip'));
  assert.ok(!trendingSrc.includes('Instagram Trends'));
  assert.ok(!trendingSrc.includes('TikTok Trends'));
});

await testAsync('client search and niche change the request key', async () => {
  const box = loadTrending({
    items: function (url) {
      if (/q=cars/.test(url) && /category=Technology/.test(url)) {
        return [{ id: 't1', title: 'EV firmware', platform: 'news', type: 'news' }];
      }
      if (/q=cars/.test(url)) return [{ id: 't2', title: 'Porsche restomod', platform: 'news', type: 'news' }];
      if (/category=Technology/.test(url)) return [{ id: 't3', title: 'AI chip', platform: 'news', type: 'news' }];
      return [{ id: 't0', title: 'Default daily trend', platform: 'google', type: 'hashtag' }];
    }
  });
  const T = box.PreShootTrending;
  const def = await T.load(false);
  assert.strictEqual(def.items[0].title, 'Default daily trend');
  T.searchTopic('cars');
  const cars = await T.load(false);
  assert.strictEqual(cars.items[0].title, 'Porsche restomod');
  T.selectNiche('Technology');
  const both = await T.load(false);
  assert.strictEqual(both.items[0].title, 'EV firmware');
  T.selectNiche('Technology');
  const carsOnly = await T.load(false);
  assert.strictEqual(carsOnly.items[0].title, 'Porsche restomod');
  T.clearSearch();
  const cleared = await T.load(false);
  assert.strictEqual(cleared.items[0].title, 'Default daily trend');
  assert.ok(box._urls.some((u) => u.includes('region=US')));
  assert.ok(box._urls.some((u) => /q=cars/.test(u)));
  assert.ok(box._urls.some((u) => /category=Technology/.test(u)));
});

await testAsync('stale responses cannot replace a newer search', async () => {
  let resolveSlow;
  const slow = new Promise(function (r) { resolveSlow = r; });
  let n = 0;
  const box = loadTrending({
    items: function (url) {
      n += 1;
      if (/q=cars/.test(url)) return [{ id: 'old', title: 'SLOW CARS' }];
      if (/q=music/.test(url)) return [{ id: 'new', title: 'FAST MUSIC' }];
      return [];
    },
    delay: 0
  });
  const origFetch = box.apiFetch;
  box.apiFetch = async function (url) {
    if (/q=cars/.test(url)) {
      await slow;
      return origFetch(url);
    }
    return origFetch(url);
  };
  const first = box.PreShootTrending.load(false);
  box.PreShootTrending.searchTopic('cars');
  const p1 = box.PreShootTrending.load(false);
  box.PreShootTrending.searchTopic('music');
  const p2 = box.PreShootTrending.load(false);
  const music = await p2;
  resolveSlow();
  const stale = await p1;
  await first;
  assert.strictEqual(music.items[0].title, 'FAST MUSIC');
  assert.ok(!stale || stale.items[0].title !== 'SLOW CARS' || box.PreShootTrending.peek()[0].title === 'FAST MUSIC');
  assert.strictEqual(box.PreShootTrending.peek()[0].title, 'FAST MUSIC');
});

await testAsync('idea injection is relevance-gated and search-empty returns nothing', async () => {
  const box = loadTrending({
    items: [{ title: 'Random celebrity trend', relevance: 0.99, platform: 'google', type: 'hashtag' }]
  });
  const T = box.PreShootTrending;
  await T.load(false);
  assert.strictEqual(T.peekRelevant({}).length, 0);
  assert.strictEqual(T.peekRelevant({ query: '' }).length, 0);
  assert.strictEqual(T.peekRelevant({ niche: 'Videography', subject: 'camera' }).length, 0);
  assert.ok(T.peekRelevant({ query: 'celebrity' }).length >= 1);
  assert.ok(appSrc.includes('peekRelevant'));
  assert.ok(ctxSrc.includes('peekRelevant'));
  assert.ok(trendingSrc.includes('score >= 0.34'));
  assert.ok(trendingSrc.includes('score: peekScore(it, query)'));
});

test('empty, timeout, and location copy stay user-facing', () => {
  assert.ok(trendingSrc.includes('No relevant trends found for '));
  assert.ok(trendingSrc.includes('Try a broader topic.'));
  assert.ok(trendingSrc.includes('We could not load trends right now. Try again.'));
  assert.ok(trendingSrc.includes('No public trends available for '));
  assert.ok(trendingSrc.includes('scout_trend_region'));
  assert.ok(!trendingSrc.includes('Trend feed timed out —'));
});

await testAsync('live Google News RSS accepts a real topic query', async () => {
  const found = await fetchGoogleNewsSearch('cars', 'US');
  if (!found.items.length) {
    console.log('    (live Google News RSS returned no items in this environment)');
    assert.ok(found.status);
    assert.strictEqual(found.status.label, 'Google News RSS');
    return;
  }
  assert.ok(found.items.some((it) => /car|auto|ev|motor|vehicle|tesla|ford|toyota|porsche/i.test(it.title)));
  assert.ok(found.items.every((it) => it.source === 'Google News RSS'));
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
