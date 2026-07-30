/**
 * PreShoot Creative Research — modular platform research for ideas.
 * Platforms register adapters; UI stays platform-agnostic for future TikTok/IG/etc.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'connected_accounts';

  var PLATFORMS = {
    youtube: {
      id: 'youtube',
      label: 'YouTube',
      requiresConnection: false,
      accent: 'rgba(255,70,70,.22)'
    },
    capcut: {
      id: 'capcut',
      label: 'CapCut',
      requiresConnection: true,
      accent: 'rgba(255,255,255,.12)'
    }
    // Future: tiktok, instagram, vimeo, pinterest, behance
  };

  function gs(k, fallback) {
    try {
      var v = localStorage.getItem('scout_' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function ss(k, v) {
    try {
      localStorage.setItem('scout_' + k, JSON.stringify(v));
    } catch (e) {}
  }

  function getConnectedAccounts() {
    var base = gs(STORAGE_KEY, { capcut: null });
    if (!base || typeof base !== 'object') base = { capcut: null };
    return base;
  }

  function setConnectedAccounts(accounts) {
    ss(STORAGE_KEY, accounts);
    if (global.S) global.S.connectedAccounts = accounts;
  }

  function isCapCutConnected() {
    var a = getConnectedAccounts().capcut;
    return !!(a && a.connected);
  }

  function connectCapCut(displayName) {
    var accounts = getConnectedAccounts();
    accounts.capcut = {
      connected: true,
      displayName: (displayName || 'CapCut account').trim() || 'CapCut account',
      connectedAt: new Date().toISOString(),
      provider: 'capcut'
    };
    setConnectedAccounts(accounts);
    return accounts.capcut;
  }

  function disconnectCapCut() {
    var accounts = getConnectedAccounts();
    accounts.capcut = { connected: false, displayName: null, connectedAt: null, provider: 'capcut' };
    setConnectedAccounts(accounts);
  }

  function isGoogleConnected(authUser) {
    return !!(authUser && (authUser.provider === 'google' || authUser.email));
  }

  /** Build idea-aware research context for any platform adapter. */
  function buildContext(idea, state) {
    idea = idea || {};
    state = state || global.S || {};
    var niche = state.niche || {};
    var aesthetic = state.aesthetic || {};
    var pf = state.platformFocus || {};
    var scene = state.sceneInfo || {};
    return {
      title: idea.title || '',
      hook: idea.hook || idea.primaryHook || '',
      altHooks: idea.altHooks || [],
      whyItWorks: idea.whyItWorks || '',
      shotAngle: idea.shotAngle || '',
      editingStyle: idea.editingStyle || '',
      audio: idea.audio || '',
      category: idea.category || '',
      difficulty: idea.difficulty || '',
      ytSearch: idea.ytSearch || '',
      capcutSearch: idea.capcutSearch || '',
      sceneLabel: scene.label || '',
      sceneType: scene.type || '',
      niche: niche.contentType || niche.platform || '',
      creatorStyle: niche.style || '',
      goals: niche.goals || '',
      platform: (pf.primaryPlatform || (pf.platforms && pf.platforms[0]) || niche.platform || '') + '',
      contentStyles: pf.contentStyles || [],
      aesthetics: aesthetic.aesthetics || [],
      pacing: aesthetic.pacing || '',
      transitionStyle: aesthetic.transitionStyle || '',
      format: state.selectedFormat || idea.category || '',
      formatExtra: state.selectedFormatExtra || state.selectedFormatCustom || ''
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function platformIcon(id) {
    if (id === 'youtube') {
      return '<span class="rs-plat-ico yt" aria-hidden="true">▶</span>';
    }
    if (id === 'capcut') {
      return '<span class="rs-plat-ico cc" aria-hidden="true">CC</span>';
    }
    return '<span class="rs-plat-ico" aria-hidden="true">◆</span>';
  }

  function renderCard(item, platform) {
    var thumb = item.thumbnail
      ? '<img class="rs-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy">'
      : '<div class="rs-thumb rs-thumb-ph">' + platformIcon(platform) + '</div>';
    var meta = [];
    if (item.channel) meta.push(escapeHtml(item.channel));
    if (item.viewsLabel) meta.push(escapeHtml(item.viewsLabel));
    if (item.styleTag) meta.push(escapeHtml(item.styleTag));
    var why = item.why ? '<div class="rs-why">' + escapeHtml(item.why) + '</div>' : '';
    var href = item.url || '#';
    var cta = item.cta || (platform === 'capcut' ? 'Open in CapCut' : 'Open on YouTube');
    return (
      '<article class="rs-card" data-platform="' +
      escapeHtml(platform) +
      '">' +
      thumb +
      '<div class="rs-body">' +
      '<div class="rs-top">' +
      platformIcon(platform) +
      '<div class="rs-title">' +
      escapeHtml(item.title || 'Reference') +
      '</div></div>' +
      (meta.length ? '<div class="rs-meta">' + meta.join(' · ') + '</div>' : '') +
      why +
      '<a class="rs-cta" href="' +
      escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(cta) +
      '</a>' +
      '</div></article>'
    );
  }

  function renderLoading(platform) {
    return (
      '<div class="rs-state" id="rs-panel-' +
      platform +
      '"><div class="rs-spinner"></div><div class="rs-state-t">Finding the best ' +
      (platform === 'capcut' ? 'templates' : 'references') +
      ' for this idea…</div></div>'
    );
  }

  function renderError(platform, message, actionHtml) {
    return (
      '<div class="rs-state rs-error" id="rs-panel-' +
      platform +
      '"><div class="rs-state-t">' +
      escapeHtml(message || 'Could not load recommendations.') +
      '</div>' +
      (actionHtml || '') +
      '</div>'
    );
  }

  function renderResults(platform, payload) {
    var items = (payload && payload.items) || [];
    var strategy = (payload && payload.strategy) || {};
    var head =
      '<div class="rs-strategy">' +
      (strategy.intent
        ? '<div class="rs-intent">' + escapeHtml(strategy.intent) + '</div>'
        : '') +
      (strategy.techniques && strategy.techniques.length
        ? '<div class="rs-tech">' +
          strategy.techniques
            .slice(0, 4)
            .map(function (t) {
              return '<span class="rs-chip">' + escapeHtml(t) + '</span>';
            })
            .join('') +
          '</div>'
        : '') +
      '</div>';
    if (!items.length) {
      return (
        '<div class="rs-panel" id="rs-panel-' +
        platform +
        '">' +
        head +
        renderError(
          platform,
          payload && payload.emptyMessage
            ? payload.emptyMessage
            : 'No strong matches found. Try refining the idea or search manually.',
          payload && payload.fallbackUrl
            ? '<a class="rs-cta" href="' +
                escapeHtml(payload.fallbackUrl) +
                '" target="_blank" rel="noopener">Open broader search</a>'
            : ''
        ) +
        '</div>'
      );
    }
    return (
      '<div class="rs-panel" id="rs-panel-' +
      platform +
      '">' +
      head +
      '<div class="rs-list">' +
      items.map(function (it) {
        return renderCard(it, platform);
      }).join('') +
      '</div></div>'
    );
  }

  /** Shell HTML inside idea sheet — buttons trigger loadResearch */
  function renderResearchShell() {
    return (
      '<div class="sh-sec rs-sec">' +
      '<div class="sh-lbl">Creative research</div>' +
      '<p class="rs-intro">Curated references matched to this exact idea — not a generic keyword dump.</p>' +
      '<div class="rs-actions">' +
      '<button type="button" class="rs-launch yt" onclick="PreShootResearch.launch(\'youtube\')">YouTube references</button>' +
      '<button type="button" class="rs-launch cc" onclick="PreShootResearch.launch(\'capcut\')">CapCut templates</button>' +
      '</div>' +
      '<div id="rs-mount" class="rs-mount"></div>' +
      '</div>'
    );
  }

  function ensureStateAccounts() {
    if (!global.S) return;
    if (!global.S.connectedAccounts) {
      global.S.connectedAccounts = getConnectedAccounts();
    }
  }

  function launch(platform) {
    ensureStateAccounts();
    var mount = document.getElementById('rs-mount');
    if (!mount) return;

    var meta = PLATFORMS[platform];
    if (!meta) {
      mount.innerHTML = renderError(platform, 'Platform not available yet.');
      return;
    }

    if (meta.requiresConnection && platform === 'capcut' && !isCapCutConnected()) {
      mount.innerHTML = renderError(
        'capcut',
        'Connect CapCut in Profile to unlock idea-matched templates and a smoother editing workflow.',
        '<button type="button" class="rs-cta rs-btn" onclick="PreShootResearch.goConnectCapCut()">Connect CapCut</button>'
      );
      if (typeof global.showToast === 'function') {
        global.showToast('Connect CapCut in Profile for smarter templates');
      }
      return;
    }

    mount.innerHTML = renderLoading(platform);

    var idea = null;
    try {
      var idx = global.S.activeIdea;
      var src = global.S.activeSource;
      var ideas =
        src === 'results'
          ? global.S.ideas
          : src === 'lib'
            ? typeof global.getLib === 'function'
              ? global.getLib()
              : []
            : typeof global.getHistory === 'function' && src && String(src).indexOf('_') >= 0
              ? global.getHistory()[parseInt(String(src).split('_')[1], 10)].ideas
              : [];
      idea = ideas && ideas[idx];
    } catch (e) {
      idea = null;
    }

    if (!idea) {
      mount.innerHTML = renderError(platform, 'Open an idea first, then run research.');
      return;
    }

    var ctx = buildContext(idea, global.S);
    var apiFetch = global.apiFetch || function (url, opts) {
      return fetch(url, opts);
    };

    apiFetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platform, context: ctx })
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          var msg =
            (res.data && res.data.error && res.data.error.message) ||
            'Research unavailable right now.';
          mount.innerHTML = renderError(platform, msg);
          return;
        }
        mount.innerHTML = renderResults(platform, res.data);
      })
      .catch(function () {
        mount.innerHTML = renderError(
          platform,
          'Network error. Check your connection and try again.',
          '<button type="button" class="rs-cta rs-btn" onclick="PreShootResearch.launch(\'' +
            platform +
            '\')">Retry</button>'
        );
      });
  }

  function goConnectCapCut() {
    if (typeof global.shCloseForce === 'function') global.shCloseForce();
    else if (typeof global.closeSheet === 'function') global.closeSheet();
    if (typeof global.goTab === 'function') global.goTab('profile');
    setTimeout(function () {
      openCapCutConnectModal();
      var el = document.getElementById('connected-accounts');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 280);
  }

  function openCapCutConnectModal() {
    var existing = document.getElementById('capcut-connect-modal');
    if (existing) {
      existing.classList.add('open');
      return;
    }
    if (typeof global.openM === 'function') {
      global.openM('capcut-connect-modal');
    }
  }

  function closeCapCutConnectModal() {
    if (typeof global.closeM === 'function') global.closeM('capcut-connect-modal');
  }

  function confirmCapCutConnect() {
    var input = document.getElementById('capcut-display-name');
    var name = input ? input.value : '';
    connectCapCut(name);
    closeCapCutConnectModal();
    if (typeof global.renderProf === 'function') global.renderProf();
    if (typeof global.scheduleCloudSync === 'function') global.scheduleCloudSync();
    if (typeof global.showToast === 'function') {
      global.showToast('CapCut connected — template research unlocked');
    }
  }

  function renderConnectedAccountsSection(authUser) {
    ensureStateAccounts();
    var accounts = getConnectedAccounts();
    var googleOn = isGoogleConnected(authUser);
    var cc = accounts.capcut;
    var ccOn = !!(cc && cc.connected);

    var googleSub = googleOn
      ? escapeHtml((authUser && (authUser.email || authUser.name)) || 'Connected')
      : 'Sign in with Google to sync';
    var ccSub = ccOn
      ? escapeHtml(cc.displayName || 'Connected')
      : 'Connect for idea-matched templates';

    return (
      '<div class="menu-sec" id="connected-accounts">' +
      '<div class="menu-sec-title">Connected Accounts</div>' +
      '<div class="menu-card">' +
      '<div class="menu-row' +
      (googleOn ? '' : '" onclick="authWith(\'google\')') +
      '">' +
      '<div class="menu-ico" style="background:var(--s2)"><span style="font-weight:800;color:#4285F4">G</span></div>' +
      '<div class="menu-info"><div class="menu-row-title">Google</div><div class="menu-row-sub">' +
      googleSub +
      '</div></div>' +
      '<div class="conn-status ' +
      (googleOn ? 'on' : 'off') +
      '">' +
      (googleOn ? 'Connected' : 'Connect') +
      '</div></div>' +
      '<div class="menu-row" onclick="' +
      (ccOn ? 'PreShootResearch.promptDisconnectCapCut()' : 'PreShootResearch.openCapCutConnectModal()') +
      '">' +
      '<div class="menu-ico" style="background:var(--s2)"><span style="font-weight:800;font-size:11px;letter-spacing:.02em">CC</span></div>' +
      '<div class="menu-info"><div class="menu-row-title">CapCut</div><div class="menu-row-sub">' +
      ccSub +
      '</div></div>' +
      '<div class="conn-status ' +
      (ccOn ? 'on' : 'off') +
      '">' +
      (ccOn ? 'Connected' : 'Connect') +
      '</div></div>' +
      '<div style="padding:10px 14px 14px;font-size:12px;color:var(--text3);line-height:1.5">More services (TikTok, Instagram, Vimeo) can be added here later.</div>' +
      '</div></div>'
    );
  }

  function promptDisconnectCapCut() {
    if (!confirm('Disconnect CapCut? Template research will ask you to reconnect.')) return;
    disconnectCapCut();
    if (typeof global.renderProf === 'function') global.renderProf();
    if (typeof global.scheduleCloudSync === 'function') global.scheduleCloudSync();
    if (typeof global.showToast === 'function') global.showToast('CapCut disconnected');
  }

  global.PreShootResearch = {
    PLATFORMS: PLATFORMS,
    buildContext: buildContext,
    getConnectedAccounts: getConnectedAccounts,
    setConnectedAccounts: setConnectedAccounts,
    isCapCutConnected: isCapCutConnected,
    connectCapCut: connectCapCut,
    disconnectCapCut: disconnectCapCut,
    renderResearchShell: renderResearchShell,
    renderConnectedAccountsSection: renderConnectedAccountsSection,
    launch: launch,
    goConnectCapCut: goConnectCapCut,
    openCapCutConnectModal: openCapCutConnectModal,
    closeCapCutConnectModal: closeCapCutConnectModal,
    confirmCapCutConnect: confirmCapCutConnect,
    promptDisconnectCapCut: promptDisconnectCapCut
  };
})(typeof window !== 'undefined' ? window : this);
