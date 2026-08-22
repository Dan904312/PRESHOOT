/**
 * Library + Studio trending UI.
 * Reads the server-cached public trend dataset. Never scrapes in the browser.
 */
(function (global) {
  'use strict';

  var cache = null;
  var inflight = null;
  var filters = { platform: 'all', category: 'all', region: 'US' };

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

  function load(force) {
    if (!force && cache && cache.items) return Promise.resolve(cache);
    if (inflight) return inflight;
    var url = '/api/trends?region=' + encodeURIComponent(filters.region || 'US');
    if (force) url += '&refresh=1';
    inflight = apiFetch(url, { method: 'GET' })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        inflight = null;
        if (data && Array.isArray(data.items)) cache = data;
        else {
          cache = {
            ok: true,
            items: [],
            sources: (data && data.sources) || [],
            limitations: (data && data.limitations) || [],
            warning: (data && (data.warning || data.error && data.error.message)) || 'empty'
          };
        }
        return cache;
      })
      .catch(function () {
        inflight = null;
        if (cache) return cache;
        cache = {
          ok: false,
          items: [],
          sources: [],
          limitations: ['Trend feed could not be reached. No placeholder data is shown.'],
          warning: 'network'
        };
        return cache;
      });
    return inflight;
  }

  function filteredItems() {
    var items = (cache && cache.items) || [];
    return items.filter(function (it) {
      if (filters.platform !== 'all' && it.platform !== filters.platform) return false;
      if (filters.category === 'all') return true;
      if (filters.category === 'video') return it.type === 'video';
      if (filters.category === 'music') return it.type === 'music';
      if (filters.category === 'hashtag') return it.type === 'hashtag' || it.type === 'search';
      if (filters.category === 'pattern') return it.type === 'hashtag' || it.category === 'search';
      return it.type === filters.category || it.category === filters.category;
    });
  }

  function sourceNote() {
    var sources = (cache && cache.sources) || [];
    if (!sources.length) return 'Waiting for public sources.';
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
    var html = '<div class="trend-filters">';
    html += '<label>Platform<select onchange="PreShootTrending.setFilter(\'platform\',this.value)">';
    [
      ['all', 'All'],
      ['google', 'Google Trends'],
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
    html += '<label>Category<select onchange="PreShootTrending.setFilter(\'category\',this.value)">';
    [
      ['all', 'All'],
      ['video', 'Videos'],
      ['music', 'Music'],
      ['hashtag', 'Hashtags'],
      ['pattern', 'Patterns']
    ].forEach(function (o) {
      html +=
        '<option value="' +
        o[0] +
        '"' +
        (filters.category === o[0] ? ' selected' : '') +
        '>' +
        o[1] +
        '</option>';
    });
    html += '</select></label>';
    html += '<label>Region<select onchange="PreShootTrending.setFilter(\'region\',this.value)">';
    ['US', 'GB', 'AU', 'CA', 'IN'].forEach(function (r) {
      html +=
        '<option value="' +
        r +
        '"' +
        (filters.region === r ? ' selected' : '') +
        '>' +
        r +
        '</option>';
    });
    html += '</select></label>';
    html +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootTrending.refresh()">Refresh</button>';
    html += '</div>';
    return html;
  }

  function bodyHtml(productionId) {
    var items = filteredItems();
    var videos = items.filter(function (i) { return i.type === 'video'; });
    var music = items.filter(function (i) { return i.type === 'music'; });
    var tags = items.filter(function (i) { return i.type === 'hashtag' || i.category === 'search'; });
    var html = filterBar();
    html += '<div class="trend-note">' + esc(sourceNote());
    if (cache && cache.fetchedAt) {
      html += ' · Updated ' + esc(new Date(cache.fetchedAt).toLocaleString());
    }
    html += '</div>';
    if (cache && cache.warning === 'unavailable' && !items.length) {
      html +=
        '<div class="trend-empty">Public trend sources did not return data. Nothing here is simulated.</div>';
    }
    html += section((ico('flame', 14) + ' Trending now'), items.slice(0, 8), productionId, true);
    html += section('Videos', videos, productionId);
    html += section('Music', music, productionId);
    html += section('Hashtags', tags, productionId);
    html += section('Patterns', tags.slice(0, 8), productionId);
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

  function renderLibrary() {
    var grid = document.getElementById('lib-grid');
    var countEl = document.getElementById('lib-count');
    if (!grid) return;
    if (countEl) countEl.textContent = 'Trending';
    grid.innerHTML = '<div class="trend-wrap"><div class="trend-loading">Loading public trends…</div></div>';
    load(false).then(function () {
      if (global.S && S.libTab !== 'trending') return;
      grid.innerHTML = '<div class="trend-wrap">' + bodyHtml(null) + '</div>';
      if (countEl) countEl.textContent = String(((cache && cache.items) || []).length) + ' trends';
    });
  }

  function renderStudioPanel(productionId) {
    return (
      '<div class="trend-studio" id="trend-studio-' +
      esc(productionId) +
      '"><div class="trend-loading">Loading public trends…</div></div>'
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
      audio: it.type === 'music' ? 'Reference only — do not copy the recording. Source: ' + (it.url || '') : '',
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
    if (typeof global.showToast === 'function') global.showToast('Opened as inspiration — import to Studio when ready');
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

  function setFilter(key, value) {
    filters[key] = value;
    if (key === 'region') {
      cache = null;
      renderLibrary();
      return;
    }
    var grid = document.getElementById('lib-grid');
    if (grid && global.S && S.libTab === 'trending') {
      grid.innerHTML = '<div class="trend-wrap">' + bodyHtml(null) + '</div>';
    }
    var studio = document.querySelector('.trend-studio');
    if (studio && studio.id) {
      var pid = studio.id.replace('trend-studio-', '');
      studio.innerHTML = bodyHtml(pid);
    }
  }

  function refresh() {
    cache = null;
    if (global.S && S.libTab === 'trending') renderLibrary();
    else load(true);
  }

  global.PreShootTrending = {
    renderLibrary: renderLibrary,
    renderStudioPanel: renderStudioPanel,
    hydrateStudio: hydrateStudio,
    inspire: inspire,
    saveToProduction: saveToProduction,
    setFilter: setFilter,
    refresh: refresh,
    load: load
  };
})(typeof window !== 'undefined' ? window : globalThis);
