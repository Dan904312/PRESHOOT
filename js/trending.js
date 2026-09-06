/**
 * Library + Studio trending UI.
 * Reads the server-cached public trend dataset. Never scrapes in the browser.
 */
(function (global) {
  'use strict';

  var cache = null;
  var cacheKey = '';
  var inflight = null;
  var inflightKey = '';
  var loadSeq = 0;
  var searchTimer = null;
  var TREND_FETCH_MS = 8000;
  var TREND_DEBOUNCE_MS = 420;
  var filters = { platform: 'all', kind: 'all', niche: '', region: 'US', q: '' };

  var REGION_OPTIONS = [
    ['US', 'United States'],
    ['AU', 'Australia'],
    ['GB', 'United Kingdom'],
    ['CA', 'Canada'],
    ['SG', 'Singapore'],
    ['JP', 'Japan'],
    ['CN', 'China'],
    ['IN', 'India'],
    ['GLOBAL', 'Global']
  ];

  var TOPIC_SUGGESTIONS = [
    'Cars',
    'Motorsport',
    'Technology',
    'Startups',
    'Entrepreneurship',
    'Fitness',
    'Fashion',
    'Music',
    'Art',
    'Photography',
    'Videography',
    'Gaming',
    'Education',
    'Business',
    'Food',
    'Travel'
  ];

  try {
    var savedRegion = localStorage.getItem('scout_trend_region');
    if (savedRegion) {
      var allowed = REGION_OPTIONS.some(function (r) { return r[0] === savedRegion; });
      if (allowed) filters.region = savedRegion;
    }
  } catch (e) {}

  function regionLabel(code) {
    var c = code || filters.region || 'US';
    for (var i = 0; i < REGION_OPTIONS.length; i++) {
      if (REGION_OPTIONS[i][0] === c) return REGION_OPTIONS[i][1];
    }
    return c;
  }

  function currentKey() {
    return (filters.region || 'US') + '|' + (filters.q || '') + '|' + (filters.niche || '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiFetch(url, opts) {
    if (typeof global.apiFetch === 'function') return global.apiFetch(url, opts);
    return fetch(url, opts || {});
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var err = new Error('timeout');
        err.name = 'AbortError';
        reject(err);
      }, ms);
      promise.then(
        function (v) {
          clearTimeout(timer);
          resolve(v);
        },
        function (e) {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  function load(force) {
    var key = currentKey();
    if (!force && cache && cache.items && cacheKey === key) return Promise.resolve(cache);
    if (inflight && inflightKey === key) return inflight;
    var seq = ++loadSeq;
    var url = '/api/trends?region=' + encodeURIComponent(filters.region || 'US');
    if (filters.q) url += '&q=' + encodeURIComponent(filters.q);
    if (filters.niche) url += '&category=' + encodeURIComponent(filters.niche);
    if (force) url += '&refresh=1';
    inflightKey = key;
    inflight = withTimeout(apiFetch(url, { method: 'GET' }), TREND_FETCH_MS)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (inflightKey === key) {
          inflight = null;
          inflightKey = '';
        }
        if (seq !== loadSeq || currentKey() !== key) return cache;
        cacheKey = key;
        if (data && Array.isArray(data.items)) cache = data;
        else {
          cache = {
            ok: true,
            items: [],
            sources: (data && data.sources) || [],
            limitations: (data && data.limitations) || [],
            warning: (data && (data.warning || (data.error && data.error.message))) || 'empty'
          };
        }
        return cache;
      })
      .catch(function (e) {
        if (inflightKey === key) {
          inflight = null;
          inflightKey = '';
        }
        if (seq !== loadSeq || currentKey() !== key) return cache;
        if (cache && cacheKey === key && cache.items && cache.items.length) return cache;
        var timedOut = !!(e && (e.name === 'AbortError' || /timeout|abort/i.test(String(e && e.message || e))));
        cacheKey = key;
        cache = {
          ok: false,
          items: [],
          sources: [],
          limitations: [
            timedOut
              ? 'Trend feed timed out. Try Refresh.'
              : 'Trend feed could not be reached. No placeholder data is shown.'
          ],
          warning: timedOut ? 'timeout' : 'network'
        };
        return cache;
      });
    return inflight;
  }

  function filteredItems() {
    var items = (cache && cache.items) || [];
    return items.filter(function (it) {
      if (filters.platform !== 'all' && it.platform !== filters.platform) return false;
      if (filters.kind === 'all' || !filters.kind) return true;
      if (filters.kind === 'video') return it.type === 'video';
      if (filters.kind === 'music') return it.type === 'music';
      if (filters.kind === 'news') return it.type === 'news' || it.platform === 'news';
      if (filters.kind === 'search') return it.type === 'hashtag' || it.category === 'search' || it.sourceType === 'search_interest';
      return it.type === filters.kind || it.category === filters.kind;
    });
  }

  function sourceNote() {
    var sources = (cache && cache.sources) || [];
    if (cache && (cache.warning === 'timeout' || cache.warning === 'network')) {
      return 'Trend feed timed out. Try Refresh.';
    }
    if (cache && cache.warning === 'refresh_rate_limited') {
      return 'Refresh is rate-limited. Showing the last cached feed.';
    }
    if (!sources.length) {
      if (cache && cache.warning === 'unavailable') return 'Public sources returned no items.';
      return 'No public sources available.';
    }
    return sources
      .map(function (s) {
        return s.label + (s.ok ? ' · ' + s.count : ' · unavailable');
      })
      .join('  ·  ');
  }

  function renderCard(it, productionId) {
    var html = '<article class="trend-card">';
    if (it.thumbnail) {
      html +=
        '<img class="trend-thumb" src="' +
        esc(it.thumbnail) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    } else {
      html +=
        '<div class="trend-thumb ph">' + esc((it.platform || 'TR').slice(0, 2).toUpperCase()) + '</div>';
    }
    html += '<div class="trend-body">';
    html += '<div class="trend-kicker">';
    if (it.rank) html += '<span>#' + esc(it.rank) + '</span>';
    html += '<span>' + esc((it.platform || '').toUpperCase()) + '</span>';
    html += '<span>' + esc(it.source || '') + '</span></div>';
    html += '<div class="trend-title">' + esc(it.title) + '</div>';
    var meta = [];
    if (it.creator) meta.push(it.creator);
    if (it.metric) meta.push(it.metric);
    if (it.region) meta.push(it.region);
    if (meta.length) html += '<div class="trend-meta">' + esc(meta.join(' · ')) + '</div>';
    html += '<div class="trend-actions">';
    if (it.url) {
      html +=
        '<a class="studio-btn ghost sm" href="' +
        esc(it.url) +
        '" target="_blank" rel="noopener noreferrer">Open source</a>';
    }
    html +=
      '<button type="button" class="studio-btn sm" onclick=\'PreShootTrending.inspire(' +
      JSON.stringify(it.id) +
      ')\'>Use as inspiration</button>';
    if (productionId) {
      html +=
        '<button type="button" class="studio-btn primary sm" onclick=\'PreShootTrending.saveToProduction(' +
        JSON.stringify(productionId) +
        ',' +
        JSON.stringify(it.id) +
        ')\'>Save reference</button>';
    }
    html += '</div></div></article>';
    return html;
  }

  function ico(name, size) {
    return global.ICO && typeof ICO.html === 'function' ? ICO.html(name, size) : '';
  }

  function section(title, items, productionId, rawTitle) {
    var html = '<div class="trend-sec"><div class="trend-sec-hd">' + (rawTitle ? title : esc(title)) + '</div>';
    if (!items.length) {
      html += '<div class="trend-empty">No public items in this section right now.</div></div>';
      return html;
    }
    items.slice(0, 12).forEach(function (it) {
      html += renderCard(it, productionId);
    });
    html += '</div>';
    return html;
  }

  function filterBar() {
    var html = '<div class="trend-loc">';
    html += '<div class="trend-loc-k">Trending</div>';
    html +=
      '<div class="trend-loc-row">Location: <strong>' +
      esc(regionLabel()) +
      '</strong> <label class="trend-change">Change<select onchange="PreShootTrending.setFilter(\'region\',this.value)" aria-label="Trend location">';
    REGION_OPTIONS.forEach(function (o) {
      html +=
        '<option value="' +
        o[0] +
        '"' +
        (filters.region === o[0] ? ' selected' : '') +
        '>' +
        esc(o[1]) +
        '</option>';
    });
    html += '</select></label></div></div>';
    html += '<div class="trend-search">';
    html +=
      '<input type="search" id="trend-q" class="trend-q" placeholder="Search a topic or niche" value="' +
      esc(filters.q || '') +
      '" aria-label="Topic search" oninput="PreShootTrending.onSearchInput(this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();PreShootTrending.searchTopic(this.value);}">';
    html +=
      '<button type="button" class="studio-btn primary sm" onclick="PreShootTrending.searchTopic(document.getElementById(\'trend-q\').value)">Search</button>';
    if (filters.q || filters.niche) {
      html +=
        '<button type="button" class="studio-btn ghost sm" onclick="PreShootTrending.clearSearch()">Clear</button>';
    }
    html += '</div>';
    html += '<div class="trend-chips" aria-label="Categories">';
    TOPIC_SUGGESTIONS.forEach(function (t) {
      html +=
        '<button type="button" class="trend-chip' +
        (filters.niche === t ? ' on' : '') +
        '" aria-pressed="' +
        (filters.niche === t ? 'true' : 'false') +
        '" onclick="PreShootTrending.selectNiche(\'' +
        String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'") +
        '\')">' +
        esc(t) +
        '</button>';
    });
    html += '</div>';
    if (filters.q || filters.niche) {
      html +=
        '<div class="trend-note">Searching ' +
        esc(filters.q || 'all topics') +
        (filters.niche ? ' in ' + esc(filters.niche) : '') +
        ' · ' +
        esc(regionLabel()) +
        '</div>';
    }
    html += '<div class="trend-filters">';
    html += '<label>Platform<select onchange="PreShootTrending.setFilter(\'platform\',this.value)">';
    [
      ['all', 'All'],
      ['google', 'Google Trends'],
      ['news', 'Google News'],
      ['youtube', 'YouTube'],
      ['apple', 'Apple Music']
    ].forEach(function (o) {
      html +=
        '<option value="' +
        o[0] +
        '"' +
        (filters.platform === o[0] ? ' selected' : '') +
        '>' +
        o[1] +
        '</option>';
    });
    html += '</select></label>';
    html += '<label>Kind<select onchange="PreShootTrending.setFilter(\'kind\',this.value)">';
    [
      ['all', 'All'],
      ['news', 'News'],
      ['video', 'Videos'],
      ['music', 'Music'],
      ['search', 'Search interest']
    ].forEach(function (o) {
      html +=
        '<option value="' +
        o[0] +
        '"' +
        (filters.kind === o[0] ? ' selected' : '') +
        '>' +
        o[1] +
        '</option>';
    });
    html += '</select></label>';
    html +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootTrending.refresh()">Refresh</button>';
    html += '</div>';
    return html;
  }

  function publicFeedWarning(warning) {
    var w = String(warning || '').toLowerCase();
    return (
      w === 'timeout' ||
      w === 'network' ||
      w === 'unavailable' ||
      w === 'empty' ||
      /sign in|auth|unauthorized|401/.test(w)
    );
  }

  function emptyHeroHtml(opts) {
    opts = opts || {};
    var html = '<div class="trend-empty-hero">';
    html += '<div class="trend-empty-ttl">No public trends right now</div>';
    html +=
      '<div class="trend-empty">Public sources are empty or offline. This is not your Library. Personal ideas come from a scan.</div>';
    html +=
      '<div class="trend-empty-actions"><button type="button" class="studio-btn primary" onclick="startHomeCapture(\'cam\')">Scan for personal ideas</button>';
    if (opts.retry) {
      html +=
        '<button type="button" class="studio-btn ghost" onclick="PreShootTrending.refresh()">Refresh</button>';
    }
    html += '</div></div>';
    return html;
  }

  function bodyHtml(productionId) {
    var items = filteredItems();
    var videos = items.filter(function (i) { return i.type === 'video'; });
    var music = items.filter(function (i) { return i.type === 'music'; });
    var news = items.filter(function (i) { return i.type === 'news' || i.platform === 'news'; });
    var tags = items.filter(function (i) { return i.sourceType === 'search_interest' || i.type === 'hashtag' || i.category === 'search'; });
    var html = filterBar();
    html += '<div class="trend-note">' + esc(sourceNote());
    if (cache && cache.fetchedAt) {
      html += ' · Updated ' + esc(new Date(cache.fetchedAt).toLocaleString());
    }
    html += '</div>';
    if (!items.length) {
      var searched = !!(filters.q || filters.niche);
      var down = publicFeedWarning(cache && cache.warning);
      var hardFail = cache && (cache.warning === 'timeout' || cache.warning === 'network');
      if (searched && !down && cache && cache.ok !== false) {
        html +=
          '<div class="trend-empty">No relevant trends found for ' +
          esc(filters.q || filters.niche) +
          '. Try a broader topic.</div>';
      } else {
        html += emptyHeroHtml({ retry: !!hardFail });
      }
      var emptyLimits = (cache && cache.limitations) || [];
      if (emptyLimits.length) {
        html += '<div class="trend-limits"><div class="trend-sec-hd">Source notes</div><ul>';
        emptyLimits.forEach(function (l) {
          html += '<li>' + esc(l) + '</li>';
        });
        html += '</ul></div>';
      }
      return html;
    }
    html += section((ico('flame', 14) + ' Trending now'), items.slice(0, 8), productionId, true);
    html += section('News and search', news.concat(tags).slice(0, 12), productionId);
    html += section('Videos', videos, productionId);
    html += section('Music', music, productionId);
    var limits = (cache && cache.limitations) || [];
    if (limits.length) {
      html += '<div class="trend-limits"><div class="trend-sec-hd">Source notes</div><ul>';
      limits.forEach(function (l) {
        html += '<li>' + esc(l) + '</li>';
      });
      html += '</ul></div>';
    }
    return html;
  }

  function paintLoaded() {
    var grid = document.getElementById('lib-grid');
    var countEl = document.getElementById('lib-count');
    if (grid && global.S && S.libTab === 'trending') {
      grid.innerHTML = '<div class="trend-wrap">' + bodyHtml(null) + '</div>';
      if (countEl) countEl.textContent = String(((cache && cache.items) || []).length) + ' trends';
    }
    var studio = document.querySelector('.trend-studio');
    if (studio && studio.id) {
      studio.innerHTML = bodyHtml(studio.id.replace('trend-studio-', ''));
    }
  }

  function showLoading() {
    var sk = global.PreShootSkeleton ? PreShootSkeleton.list(5) : '<div class="trend-loading">Loading public trends</div>';
    var bar = filterBar();
    var grid = document.getElementById('lib-grid');
    if (grid && global.S && S.libTab === 'trending') {
      grid.innerHTML = '<div class="trend-wrap">' + bar + sk + '</div>';
    }
    var studio = document.querySelector('.trend-studio');
    if (studio) {
      studio.innerHTML = bar + '<div class="trend-studio-inner">' + (global.PreShootSkeleton ? PreShootSkeleton.list(4) : '<div class="trend-loading">Loading public trends</div>') + '</div>';
    }
  }

  function renderLibrary(force) {
    var grid = document.getElementById('lib-grid');
    var countEl = document.getElementById('lib-count');
    if (!grid) return;
    if (countEl) countEl.textContent = 'Trending';
    showLoading();
    load(!!force).then(function () {
      if (global.S && S.libTab !== 'trending') {
        paintLoaded();
        return;
      }
      paintLoaded();
    });
  }

  function renderStudioPanel(productionId) {
    var sk = global.PreShootSkeleton ? PreShootSkeleton.list(4) : '<div class="trend-loading">Loading public trends</div>';
    return (
      '<div class="trend-studio" id="trend-studio-' +
      esc(productionId) +
      '">' +
      filterBar() +
      '<div class="trend-studio-inner">' +
      sk +
      '</div></div>'
    );
  }

  function hydrateStudio(productionId) {
    var host = document.getElementById('trend-studio-' + productionId);
    if (!host) return;
    load(false).then(function () {
      var el = document.getElementById('trend-studio-' + productionId);
      if (!el) return;
      el.innerHTML = bodyHtml(productionId);
    });
  }

  function findItem(id) {
    var items = (cache && cache.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function inspire(id) {
    var it = findItem(id);
    if (!it) return;
    var idea = {
      title: it.title,
      hook: 'Inspired by ' + (it.source || it.platform) + (it.metric ? ' · ' + it.metric : ''),
      whyItWorks: 'Public trend reference. Original source stays on the platform.',
      shotAngle: '',
      editingStyle: '',
      audio: it.type === 'music' ? 'Reference only. Do not copy the recording. Source: ' + (it.url || '') : '',
      category: 'trending',
      ytSearch: it.platform === 'youtube' ? it.title : it.title,
      capcutSearch: it.title,
      trendRef: {
        id: it.id,
        url: it.url,
        platform: it.platform,
        source: it.source,
        type: it.type
      }
    };
    if (global.S) {
      S.ideas = [idea];
      S.sceneInfo = { type: 'trend', label: 'Trend inspiration' };
      S.scanImg = null;
    }
    if (typeof global.renderResults === 'function') global.renderResults();
    if (typeof global.goTab === 'function') global.goTab('results');
    if (typeof global.showToast === 'function') global.showToast('Opened as inspiration. Import to Studio when ready');
  }

  function saveToProduction(productionId, id) {
    var it = findItem(id);
    if (!it || !global.PreShootStudio) return;
    var result = PreShootStudio.addReference(productionId, {
      title: it.title,
      url: it.url,
      platform: it.platform === 'youtube' ? 'youtube' : 'trending',
      source: 'trend',
      note: (it.source || '') + (it.metric ? ' · ' + it.metric : ''),
      thumbnail: it.thumbnail || null,
      channel: it.creator || ''
    });
    if (typeof global.showToast === 'function') {
      global.showToast(result && result.duplicate ? 'Already saved' : 'Saved trend reference');
    }
    if (global.PreShootStudioUI && PreShootStudioUI.renderStudio) PreShootStudioUI.renderStudio();
  }

  function refetch() {
    cache = null;
    cacheKey = '';
    showLoading();
    load(false).then(paintLoaded);
  }

  function setFilter(key, value) {
    if (key === 'category') key = 'kind';
    filters[key] = value;
    if (key === 'region') {
      try {
        localStorage.setItem('scout_trend_region', value);
      } catch (e) {}
      refetch();
      return;
    }
    paintLoaded();
  }

  function searchTopic(q) {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    filters.q = String(q || '').trim().slice(0, 80);
    refetch();
  }

  function onSearchInput(q) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      var next = String(q || '').trim().slice(0, 80);
      if (next === filters.q) return;
      filters.q = next;
      refetch();
    }, TREND_DEBOUNCE_MS);
  }

  function selectNiche(name) {
    var next = String(name || '').trim();
    filters.niche = filters.niche === next ? '' : next;
    refetch();
  }

  function clearSearch() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    filters.q = '';
    filters.niche = '';
    refetch();
  }

  var PEEK_LEX = {
    cars: ['car', 'cars', 'auto', 'automotive', 'vehicle', 'ev', 'motorsport', 'racing'],
    technology: ['technology', 'tech', 'ai', 'gadget', 'camera', 'software'],
    videography: ['videography', 'video', 'filmmaking', 'cinematic', 'camera', 'b-roll'],
    photography: ['photography', 'photo', 'camera', 'lens'],
    fitness: ['fitness', 'gym', 'workout'],
    gaming: ['gaming', 'game', 'esports'],
    fashion: ['fashion', 'style', 'outfit'],
    music: ['music', 'song', 'album'],
    food: ['food', 'recipe', 'cooking'],
    travel: ['travel', 'trip', 'destination'],
    business: ['business', 'brand', 'marketing'],
    education: ['education', 'learn', 'tutorial']
  };

  function peekScore(item, query) {
    var hay = ((item && item.title) || '') + ' ' + ((item && item.topic) || '');
    hay = hay.toLowerCase();
    var q = String(query || '').toLowerCase().trim();
    if (!q) return 0;
    if (hay.indexOf(q) >= 0) return 1;
    var parts = q.split(/[\s,/]+/).filter(function (p) { return p.length > 2; });
    var extra = [];
    parts.forEach(function (p) {
      if (PEEK_LEX[p]) extra = extra.concat(PEEK_LEX[p]);
    });
    var terms = parts.concat(extra);
    var hits = 0;
    terms.forEach(function (t) {
      if (t && hay.indexOf(t) >= 0) hits += 1;
    });
    return hits ? Math.min(1, 0.3 + hits * 0.2) : 0;
  }

  function peek() {
    return ((cache && cache.items) || []).slice(0, 12);
  }

  function peekRelevant(opts) {
    opts = opts || {};
    var query = [opts.query, opts.niche, opts.subject, opts.scene].filter(Boolean).join(' ').trim();
    if (!query) return [];
    return ((cache && cache.items) || [])
      .map(function (it) {
        return { it: it, score: peekScore(it, query) };
      })
      .filter(function (row) { return row.score >= 0.34; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 6)
      .map(function (row) { return row.it; });
  }

  function refresh() {
    cache = null;
    cacheKey = '';
    showLoading();
    load(true).then(paintLoaded);
  }

  global.PreShootTrending = {
    renderLibrary: renderLibrary,
    renderStudioPanel: renderStudioPanel,
    hydrateStudio: hydrateStudio,
    inspire: inspire,
    saveToProduction: saveToProduction,
    setFilter: setFilter,
    searchTopic: searchTopic,
    onSearchInput: onSearchInput,
    selectNiche: selectNiche,
    clearSearch: clearSearch,
    refresh: refresh,
    load: load,
    peek: peek,
    peekRelevant: peekRelevant
  };
})(typeof window !== 'undefined' ? window : globalThis);
