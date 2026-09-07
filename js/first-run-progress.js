/**
 * First-run Phase 3: client-side progressive unlocks (emphasis only).
 * Uses existing local counts. No new APIs, keys, or analytics vendors.
 *
 * Gates:
 *   G0  0 scans and 0 ideas
 *   G1  >=1 scan or >=1 idea
 *   G2  >=1 Project or >=1 Production
 *   G3  >=3 scans or >=2 productions (richer Director secondary copy only)
 */
(function (global) {
  'use strict';

  var PREFIX = 'ps_fr3_';
  var TIP_STUDIO = PREFIX + 'tip_studio';
  var TIP_DIRECTOR = PREFIX + 'tip_director';
  var TIP_PREFS = PREFIX + 'tip_prefs';
  var OPENED_STUDIO = PREFIX + 'opened_studio';

  var TIPS = {
    studio:
      'Ready to plan this idea? Build in Studio opens a Project and its first Production. You can keep browsing if you are not ready.',
    director:
      'Director can write the script and shot list for this production. PreShoot plans; it does not render finished video.',
    prefs:
      'Creator prefs personalize later ideas. Optional, and you can change them anytime.'
  };

  function lsGet(key) {
    try {
      return global.localStorage ? localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, val) {
    try {
      if (global.localStorage) localStorage.setItem(key, val);
    } catch (e) {}
  }

  function counts() {
    var scans = 0;
    var ideas = 0;
    var projects = 0;
    var productions = 0;
    try {
      var hist = typeof global.getHistory === 'function' ? global.getHistory() || [] : [];
      scans = hist.length;
    } catch (e) {}
    try {
      var lib = typeof global.getLib === 'function' ? global.getLib() || [] : [];
      ideas += lib.length;
    } catch (e) {}
    try {
      if (global.S && global.S.ideas && global.S.ideas.length) ideas += global.S.ideas.length;
    } catch (e) {}
    try {
      if (global.PreShootStudio && typeof PreShootStudio.listProjects === 'function') {
        var list = PreShootStudio.listProjects({ includeArchived: true }) || [];
        projects = list.length;
        list.forEach(function (p) {
          productions +=
            p.productionCount ||
            (p.productions && p.productions.length) ||
            0;
        });
      }
    } catch (e) {}
    return {
      scans: scans,
      ideas: ideas,
      projects: projects,
      productions: productions,
      signedIn: !!(global.S && global.S.authUser)
    };
  }

  function gateOf(c) {
    var g = 0;
    if (c.scans >= 1 || c.ideas >= 1) g = 1;
    if (c.projects >= 1 || c.productions >= 1) g = 2;
    if (c.scans >= 3 || c.productions >= 2) g = Math.max(g, 3);
    return g;
  }

  function getActivation() {
    var c = counts();
    var g = gateOf(c);
    return {
      scans: c.scans,
      ideas: c.ideas,
      projects: c.projects,
      productions: c.productions,
      signedIn: c.signedIn,
      gate: g,
      g1: g >= 1,
      g2: g >= 2,
      g3: g >= 3
    };
  }

  function openedStudio() {
    return lsGet(OPENED_STUDIO) === '1';
  }

  function markStudioOpened() {
    lsSet(OPENED_STUDIO, '1');
  }

  function tipDismissed(id) {
    if (id === 'studio') return lsGet(TIP_STUDIO) === '1';
    if (id === 'director') return lsGet(TIP_DIRECTOR) === '1';
    if (id === 'prefs') return lsGet(TIP_PREFS) === '1';
    return true;
  }

  function shouldShowTip(id) {
    if (tipDismissed(id)) return false;
    var act = getActivation();
    if (id === 'studio') return act.ideas >= 1 && !openedStudio();
    if (id === 'director') return act.productions >= 1 || !!(global.S && S.activeProductionId);
    if (id === 'prefs') return act.gate >= 1;
    return false;
  }

  function tipHtml(id) {
    var text = TIPS[id];
    if (!text) return '';
    return (
      '<div class="fr-tip" data-fr-tip="' +
      id +
      '" role="status">' +
      '<div class="fr-tip-body">' +
      text +
      '</div>' +
      '<button type="button" class="fr-tip-dismiss" onclick="PreShootFirstRun.dismissTip(\'' +
      id +
      '\')">Got it</button>' +
      '</div>'
    );
  }

  function dismissTip(id) {
    if (id === 'studio') lsSet(TIP_STUDIO, '1');
    else if (id === 'director') lsSet(TIP_DIRECTOR, '1');
    else if (id === 'prefs') lsSet(TIP_PREFS, '1');
    try {
      var nodes = document.querySelectorAll('[data-fr-tip="' + id + '"]');
      for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
    } catch (e) {}
  }

  function mountTip(host, id) {
    if (!host) return;
    host.innerHTML = shouldShowTip(id) ? tipHtml(id) : '';
  }

  function homeDirectorSubtitle() {
    var act = getActivation();
    var name = '';
    try {
      if (global.S && S.activeProductionId && global.PreShootStudio && PreShootStudio.findProduction) {
        var found = PreShootStudio.findProduction(S.activeProductionId);
        if (found && found.production) name = found.production.name || '';
      }
    } catch (e) {}
    if (name) return 'Commands this production';
    if (act.gate >= 3) return 'Plan scripts and shot lists with AI';
    return 'Plan with AI after you scan';
  }

  function paintHomeDirector() {
    var el = document.getElementById('home-dir-sub');
    if (el) el.textContent = homeDirectorSubtitle();
  }

  function applyMenuGates() {
    var menu = document.getElementById('screen-menu');
    if (!menu) return getActivation();
    var act = getActivation();
    menu.classList.toggle('pre-scan', act.gate < 1);
    var folds = menu.querySelectorAll('.menu-defer-fold');
    for (var i = 0; i < folds.length; i++) folds[i].open = act.gate >= 1;
    mountTip(document.getElementById('fr-tip-menu'), 'prefs');
    return act;
  }

  function applyAppearGates() {
    var adv = document.getElementById('appear-advanced');
    if (!adv) return;
    adv.open = getActivation().gate >= 1;
  }

  global.PreShootFirstRun = {
    THRESHOLDS: {
      g1Scans: 1,
      g1Ideas: 1,
      g2Projects: 1,
      g3Scans: 3,
      g3Productions: 2
    },
    TIPS: TIPS,
    getActivation: getActivation,
    gate: function () {
      return getActivation().gate;
    },
    shouldShowTip: shouldShowTip,
    tipHtml: tipHtml,
    dismissTip: dismissTip,
    mountTip: mountTip,
    markStudioOpened: markStudioOpened,
    openedStudio: openedStudio,
    homeDirectorSubtitle: homeDirectorSubtitle,
    paintHomeDirector: paintHomeDirector,
    applyMenuGates: applyMenuGates,
    applyAppearGates: applyAppearGates
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
