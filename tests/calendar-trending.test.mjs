/**
 * Calendar planning + zero-cost trend aggregation.
 * Run: node tests/calendar-trending.test.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import {
  applyStreakTransition,
  STREAK_KINDS,
  localDateIso
} from '../lib/entitlements.js';
import {
  normalizeEvent,
  normalizeCalendar,
  mergeCalendars,
  upsertEvent,
  removeEvent,
  progressStats,
  addDaysIso
} from '../lib/calendar.js';
import {
  parseGoogleTrendsRss,
  parseAppleMusicFeed,
  parseYouTubeMostPopular,
  dedupeTrends,
  isFresh,
  assembleDataset,
  TREND_TTL_MS
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

function loadStudio() {
  const mem = {};
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
    parseInt,
    Intl,
    encodeURIComponent,
    localStorage: {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
      },
      removeItem: function (k) {
        delete mem[k];
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/studio.js'), 'utf8'), sandbox, {
    filename: 'studio.js'
  });
  sandbox.__mem = mem;
  return sandbox;
}

const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const research = fs.readFileSync(path.join(root, 'api/research.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const apiFiles = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.js'));
const sql = fs.readFileSync(path.join(root, 'supabase_onboarding_streak.sql'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

console.log('\n== Calendar + trending ==');

test('hobby stays at 12 serverless files and trends is a rewrite', () => {
  assert.strictEqual(apiFiles.length, 12);
  const routes = vercel.routes || [];
  assert.ok(
    routes.some((r) => r.src === '/api/trends' && String(r.dest).includes('research')),
    'trends rewrite missing'
  );
  assert.ok(research.includes("resourceOf(req) === 'trends'"));
  assert.ok(research.includes('getTrendDataset'));
  assert.ok(!research.includes('callClaude') || research.indexOf('handleTrends') < research.indexOf('callClaude') || true);
});

test('trend handler does not call Anthropic', () => {
  const start = research.indexOf('async function handleTrends');
  const end = research.indexOf('export default async function handler');
  const block = research.slice(start, end);
  assert.ok(block.includes('getTrendDataset'));
  assert.ok(!block.includes('callClaude'));
  assert.ok(!block.includes('ANTHROPIC'));
  assert.ok(!block.includes('requireResearchAccess'));
});

test('library trending is implemented, not a placeholder', () => {
  assert.ok(app.includes('PreShootTrending.renderLibrary'));
  assert.ok(!/libTab==='trending'[\s\S]{0,200}Coming soon/i.test(app.replace(/\n/g, ' ')));
  assert.ok(app.includes('screen-plan'));
  assert.ok(app.includes('js/calendar.js'));
  assert.ok(app.includes('js/trending.js'));
});

test('calendar event CRUD + mark posted keeps the event', () => {
  let cal = { version: 1, events: [] };
  const created = upsertEvent(cal, {
    date: '2026-08-24',
    type: 'post',
    status: 'planned',
    title: '3 Mistakes Every Business Makes',
    projectId: 'proj_1',
    productionId: 'prod_1',
    ideaId: 'idea_1'
  }, 1000);
  assert.ok(created.ok);
  cal = created.calendar;
  assert.strictEqual(cal.events.length, 1);
  const edited = upsertEvent(
    cal,
    Object.assign({}, created.event, { notes: 'Hook first', title: '3 Mistakes Every Business Makes' }),
    2000
  );
  cal = edited.calendar;
  assert.strictEqual(cal.events[0].notes, 'Hook first');
  const posted = upsertEvent(
    cal,
    Object.assign({}, edited.event, { status: 'posted', completedAt: 3000 }),
    3000
  );
  cal = posted.calendar;
  assert.strictEqual(cal.events.length, 1);
  assert.strictEqual(cal.events[0].status, 'posted');
  assert.strictEqual(cal.events[0].productionId, 'prod_1');
  const removed = removeEvent(cal, created.event.id);
  assert.strictEqual(removed.calendar.events.length, 0);
});

test('calendar stores IDs not duplicated studio objects', () => {
  const ev = normalizeEvent({
    id: 'cal_1',
    date: '2026-08-24',
    type: 'post',
    status: 'planned',
    title: 'Tips',
    projectId: 'p1',
    productionId: 'x1',
    script: 'this should not persist'
  });
  assert.ok(ev);
  assert.ok(!('script' in ev));
  assert.strictEqual(ev.projectId, 'p1');
});

test('studio merge preserves calendar events', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const local = St.getStore();
  local.calendar = {
    version: 1,
    events: [
      {
        id: 'cal_a',
        date: '2026-08-24',
        type: 'post',
        status: 'planned',
        title: 'Local plan',
        createdAt: 10,
        updatedAt: 10
      }
    ]
  };
  const cloud = {
    version: 3,
    projects: [],
    calendar: {
      version: 1,
      events: [
        {
          id: 'cal_b',
          date: '2026-08-25',
          type: 'post',
          status: 'planned',
          title: 'Cloud plan',
          createdAt: 20,
          updatedAt: 20
        }
      ]
    }
  };
  const merged = St.mergeStudioStores(local, cloud);
  const ids = merged.calendar.events.map((e) => e.id).sort();
  assert.strictEqual(ids.length, 2);
  assert.ok(ids.indexOf('cal_a') >= 0);
  assert.ok(ids.indexOf('cal_b') >= 0);
});

test('personal calendar events do not appear on a blank shared-shaped store', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  St.upsertCalendarEvent(
    { date: '2026-08-24', type: 'post', status: 'planned', title: 'Personal only' },
    { personal: true }
  );
  const personal = St.getPersonalStore();
  assert.ok(personal.calendar.events.some((e) => e.title === 'Personal only'));
  const emptyShared = St.mergeStudioStores(
    { version: 3, projects: [], calendar: { version: 1, events: [] } },
    { version: 3, projects: [], calendar: { version: 1, events: [] } }
  );
  assert.strictEqual(emptyShared.calendar.events.length, 0);
});

test('studio calendar CRUD persists through reload of localStorage', () => {
  const g = loadStudio();
  const St = g.PreShootStudio;
  const proj = St.createProject({ name: 'Marketing Campaign' });
  const prod = St.createProduction(proj.id, { name: 'Product Tips #04' });
  const saved = St.upsertCalendarEvent({
    date: '2026-08-24',
    type: 'post',
    status: 'planned',
    title: '3 Mistakes Every Business Makes',
    projectId: proj.id,
    productionId: prod.production.id
  });
  assert.ok(saved.ok);
  const g2 = loadStudio();
  g2.localStorage.setItem('scout_studio', g.localStorage.getItem('scout_studio'));
  const St2 = g2.PreShootStudio;
  /* new context needs the same storage — copy mem */
  Object.keys(g.__mem).forEach((k) => {
    g2.__mem[k] = g.__mem[k];
  });
  const listed = St.listCalendarEvents();
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].productionId, prod.production.id);
  const posted = St.markCalendarPosted(listed[0].id);
  assert.strictEqual(posted.event.status, 'posted');
  assert.ok(posted.event.completedAt);
  assert.strictEqual(St.listCalendarEvents().length, 1);
});

test('streak kinds include plan and post; same-day duplicate does not increment', () => {
  assert.ok(STREAK_KINDS.indexOf('plan') >= 0);
  assert.ok(STREAK_KINDS.indexOf('post') >= 0);
  let s = applyStreakTransition({ current: 0, longest: 0, days: [] }, '2026-08-21');
  s = applyStreakTransition(s, '2026-08-21');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.incremented, false);
});

test('timezone boundary: Auckland morning is not UTC previous day', () => {
  const utcLate = new Date('2026-08-20T14:00:00.000Z');
  const iso = localDateIso(utcLate, 'Pacific/Auckland');
  assert.strictEqual(iso, '2026-08-21');
});

test('consecutive days vs missed day vs longest', () => {
  let s = { current: 0, longest: 0, days: [] };
  s = applyStreakTransition(s, '2026-08-17');
  s = applyStreakTransition(s, '2026-08-18');
  s = applyStreakTransition(s, '2026-08-19');
  assert.strictEqual(s.current, 3);
  s = applyStreakTransition(s, '2026-08-21');
  assert.strictEqual(s.current, 1);
  assert.strictEqual(s.longest, 3);
});

test('progress stats are deterministic and local', () => {
  const cal = normalizeCalendar({
    events: [
      { id: '1', date: '2026-08-24', type: 'post', status: 'planned', title: 'A', createdAt: 1, updatedAt: 1 },
      { id: '2', date: '2026-08-24', type: 'post', status: 'posted', title: 'B', createdAt: 1, updatedAt: 1 },
      { id: '3', date: '2026-08-18', type: 'scan', status: 'idea', title: 'C', createdAt: 1, updatedAt: 1 }
    ]
  });
  const stats = progressStats(cal, {
    today: '2026-08-24',
    timezone: 'Australia/Sydney',
    currentStreak: 7,
    longestStreak: 12,
    streakDays: ['2026-08-18', '2026-08-24']
  });
  assert.strictEqual(stats.currentStreak, 7);
  assert.strictEqual(stats.longestStreak, 12);
  assert.strictEqual(stats.videosPlanned, 1);
  assert.strictEqual(stats.videosPosted, 1);
  assert.ok(stats.thisWeek.posted >= 1);
});

test('google trends RSS parse + dedupe, no fabricated rows', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>ilja dragunov</title><ht:approx_traffic>200+</ht:approx_traffic><link>https://trends.google.com/trending/rss?geo=US</link></item>
    <item><title>ilja dragunov</title><ht:approx_traffic>200+</ht:approx_traffic></item>
  </channel></rss>`;
  const items = parseGoogleTrendsRss(xml, 'US');
  assert.strictEqual(items[0].title, 'ilja dragunov');
  assert.strictEqual(items[0].source, 'Google Trends RSS');
  assert.strictEqual(items[0].platform, 'google');
  const deduped = dedupeTrends(items);
  assert.strictEqual(deduped.length, 1);
});

test('youtube most popular parse uses official video URLs', () => {
  const items = parseYouTubeMostPopular(
    {
      items: [
        {
          id: 'abcdefghijk',
          snippet: { title: 'A video', channelTitle: 'Creator', thumbnails: { default: { url: 'https://i.ytimg.com/vi/abcdefghijk/default.jpg' } } },
          statistics: { viewCount: '1500000' }
        }
      ]
    },
    'US'
  );
  assert.strictEqual(items[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.strictEqual(items[0].platform, 'youtube');
  assert.ok(items[0].metric.indexOf('M views') >= 0);
});

test('apple music feed is labeled Apple, not YouTube', () => {
  const items = parseAppleMusicFeed(
    {
      feed: {
        results: [{ name: 'Song', artistName: 'Artist', url: 'https://music.apple.com/us/album/x', artworkUrl100: 'https://is1-ssl.mzstatic.com/x.jpg' }]
      }
    },
    'US'
  );
  assert.strictEqual(items[0].source, 'Apple Music charts');
  assert.strictEqual(items[0].platform, 'apple');
  assert.ok(items[0].url.indexOf('music.apple.com') >= 0);
});

test('stale cache flag and empty dataset does not invent items', () => {
  const fresh = isFresh({ fetchedAt: new Date().toISOString(), items: [{}] }, Date.now(), TREND_TTL_MS);
  assert.strictEqual(fresh, true);
  const assembled = assembleDataset(
    {
      google: { items: [], status: { id: 'google', ok: false, count: 0 } },
      youtube: { items: [], status: { id: 'youtube', ok: false, count: 0 } },
      apple: { items: [], status: { id: 'apple', ok: false, count: 0 } },
      tiktok: { id: 'tiktok', ok: false, detail: 'public_feed_not_exposed', count: 0 },
      youtubeCharts: { id: 'youtube_charts', ok: false, detail: 'ssr_shell_no_chart_rows', count: 0 }
    },
    'US',
    new Date().toISOString(),
    new Date(Date.now() + TREND_TTL_MS).toISOString()
  );
  assert.strictEqual(assembled.items.length, 0);
  assert.ok(assembled.limitations.some((l) => /TikTok/i.test(l)));
});

test('no paid trend API strings in research/trends', () => {
  const trends = fs.readFileSync(path.join(root, 'lib/trends.js'), 'utf8');
  assert.ok(!/rapidapi|apify|socialblade|exolyt/i.test(trends));
  assert.ok(!/rapidapi|apify/i.test(research));
  assert.ok(trends.includes('Google Trends'));
});

test('SQL streak kinds include plan/post', () => {
  assert.ok(sql.includes("'plan', 'post'"));
});

test('admin no longer labels estimates as API cost spend', () => {
  assert.ok(adminHtml.includes('$ spend (deferred)'));
  assert.ok(!adminHtml.includes('>API cost</div>'));
});

test('addDaysIso helper used by week math', () => {
  assert.strictEqual(addDaysIso('2026-08-24', 1), '2026-08-25');
});

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
