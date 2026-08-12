/* PreShoot premium onboarding — uses S / gs / ss / authWith / showMain / showToast / scheduleCloudSync / updateNicheSummary */
(function (global) {
  var GOALS = [
    { title: 'Grow Followers', sub: 'Reach more people on your platforms' },
    { title: 'Improve Quality', sub: 'Raise production value and craft' },
    { title: 'Increase Engagement', sub: 'Get more comments, saves, and shares' },
    { title: 'Get Clients', sub: 'Attract paid work and bookings' },
    { title: 'Build Brand', sub: 'Strengthen your personal brand' },
    { title: 'Sell Products/Services', sub: 'Drive sales and conversions' }
  ];

  var EXPERIENCE = [
    { id: 'beginner', title: 'Beginner', sub: 'Learning the craft' },
    { id: 'intermediate', title: 'Intermediate', sub: 'Shooting regularly' },
    { id: 'advanced', title: 'Advanced', sub: 'Pro-level workflow' }
  ];

  var NICHE_SUGGESTIONS = [
    'Car Content', 'Fitness', 'Tech Reviews', 'Fashion', 'Beauty', 'Food',
    'Travel', 'Lifestyle', 'Real Estate', 'Gaming', 'Education', 'Business'
  ];

  var GEAR_SECTIONS = [
    { key: 'camera', cat: 'camera', label: 'Camera' },
    { key: 'lens', cat: 'lens', label: 'Lens' },
    { key: 'drone', cat: 'drone', label: 'Drone' },
    { key: 'microphone', cat: 'microphone', label: 'Microphone' },
    { key: 'lighting', cat: 'lighting', label: 'Lighting' },
    { key: 'gimbal', cat: 'gimbal', label: 'Gimbal' }
  ];

  var SOFTWARE = ['CapCut', 'Premiere Pro', 'Final Cut Pro', 'DaVinci Resolve', 'After Effects', 'iMovie'];

  var FLOW_PAGES = ['niche', 'experience', 'goals', 'gear', 'google', 'install'];
  var EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

  function draft() {
    return gs('ob_draft', {
      primaryNiche: '',
      experienceLevel: '',
      goals: [],
      gear: {
        camera: [],
        lens: [],
        drone: [],
        microphone: [],
        lighting: [],
        gimbal: [],
        editingSoftware: []
      }
    });
  }

  function saveDraft(d) {
    ss('ob_draft', d);
  }

  function hasPersonalization() {
    var n = (typeof S !== 'undefined' && S.niche) ? S.niche : gs('niche', {});
    var g = (typeof S !== 'undefined' && S.gear) ? S.gear : gs('gear', {});
    if (((n.primaryNiche || n.contentType || '') + '').trim()) return true;
    var goals = n.goals;
    if (Array.isArray(goals) && goals.length) return true;
    if (typeof goals === 'string' && goals.trim()) return true;
    var fields = ['camera', 'lens', 'drone', 'microphone', 'lighting', 'gimbal'];
    for (var i = 0; i < fields.length; i++) {
      if ((g[fields[i]] || '') + '') {
        if (String(g[fields[i]]).trim()) return true;
      }
    }
    if (g.editingSoftware && g.editingSoftware.length) return true;
    return false;
  }

  function persistToSourceOfTruth() {
    var d = draft();
    S.niche = Object.assign({}, S.niche || {}, {
      primaryNiche: d.primaryNiche || '',
      experienceLevel: d.experienceLevel || S.niche.experienceLevel || 'intermediate',
      skillLevel: d.experienceLevel || S.niche.skillLevel || 'intermediate',
      goals: (d.goals || []).slice(),
      contentType: S.niche.contentType || d.primaryNiche || '',
      extraContext: S.niche.extraContext || ''
    });
    /* Keep legacy string goals for older prompt paths that expect join — buildPrompt handles arrays */
    var g = d.gear || {};
    function joinList(arr) {
      return (arr || []).filter(Boolean).join(', ');
    }
    S.gear = Object.assign({}, S.gear || {}, {
      camera: joinList(g.camera),
      lens: joinList(g.lens),
      drone: joinList(g.drone),
      microphone: joinList(g.microphone),
      lighting: joinList(g.lighting),
      gimbal: joinList(g.gimbal),
      editingSoftware: (g.editingSoftware || []).slice(),
      editingDevice: (S.gear && S.gear.editingDevice) || '',
      shootingEnvironments: (S.gear && S.gear.shootingEnvironments) || []
    });
    var gearList = [];
    if (S.gear.camera) gearList.push(S.gear.camera);
    if (S.gear.lens) gearList.push(S.gear.lens);
    if (S.gear.drone) gearList.push(S.gear.drone);
    S.niche.gear = gearList.join(', ');
    ss('niche', S.niche);
    ss('gear', S.gear);
    if (typeof updateNicheSummary === 'function') updateNicheSummary();
    syncMenuFieldsFromState();
    if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
  }

  function syncMenuFieldsFromState() {
    var n = S.niche || {};
    var g = S.gear || {};
    var el;
    el = document.getElementById('niche-primary');
    if (el) el.value = n.primaryNiche || '';
    document.querySelectorAll('#exp-level-seg .seg-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === (n.experienceLevel || '').toLowerCase());
    });
    var goalsList = Array.isArray(n.goals) ? n.goals : String(n.goals || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    document.querySelectorAll('#niche-modal .card-select').forEach(function (card) {
      var title = card.querySelector('.card-select-title');
      if (!title) return;
      var t = title.textContent.trim();
      card.classList.toggle('selected', goalsList.some(function (g0) { return t === g0 || t.indexOf(g0) !== -1 || g0.indexOf(t) !== -1; }));
    });
    var map = {
      'gear-camera': g.camera,
      'gear-lens': g.lens,
      'gear-drone': g.drone,
      'gear-mic': g.microphone,
      'gear-lights': g.lighting,
      'gear-gimbal': g.gimbal
    };
    Object.keys(map).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.value = map[id] || '';
    });
    document.querySelectorAll('#editing-software-chips .chip').forEach(function (chip) {
      var t = chip.textContent.trim();
      chip.classList.toggle('selected', (g.editingSoftware || []).indexOf(t) !== -1);
    });
  }

  function setPhase(phase) {
    S.obPhase = phase;
    var intro = document.getElementById('ob-intro');
    var flow = document.getElementById('ob-flow');
    if (!intro || !flow) return;
    if (phase === 'intro') {
      intro.classList.add('active');
      intro.setAttribute('aria-hidden', 'false');
      flow.classList.remove('active');
      flow.setAttribute('aria-hidden', 'true');
    } else {
      intro.classList.remove('active');
      intro.setAttribute('aria-hidden', 'true');
      flow.classList.add('active');
      flow.setAttribute('aria-hidden', 'false');
    }
  }

  function runIntroSequence() {
    var stage = document.getElementById('ob-intro');
    if (!stage) return;
    stage.classList.remove('play');
    void stage.offsetWidth;
    stage.classList.add('play');
    var logo = document.getElementById('ob-logo-letters');
    if (logo && !logo.dataset.built) {
      var word = 'PreShoot';
      logo.innerHTML = '';
      for (var i = 0; i < word.length; i++) {
        var span = document.createElement('span');
        span.className = 'ob-letter';
        span.style.transitionDelay = (0.4 + i * 0.05) + 's';
        span.textContent = word[i];
        logo.appendChild(span);
      }
      logo.dataset.built = '1';
    }
  }

  function showPage(index, dir) {
    S.obSlide = index;
    var total = FLOW_PAGES.length;
    var bar = document.getElementById('ob-progress-fill');
    if (bar) bar.style.width = (((index + 1) / total) * 100) + '%';
    var back = document.getElementById('ob-back');
    var next = document.getElementById('ob-next');
    if (back) back.style.visibility = index === 0 ? 'hidden' : 'visible';
    if (next) next.textContent = index === total - 1 ? 'Enter PreShoot' : 'Next';

    FLOW_PAGES.forEach(function (id, i) {
      var el = document.getElementById('obp-' + id);
      if (!el) return;
      el.classList.remove('current', 'prev', 'next');
      if (i === index) el.classList.add('current');
      else if (i < index) el.classList.add('prev');
      else el.classList.add('next');
    });

    var pageId = FLOW_PAGES[index];
    if (pageId === 'google' && S.authUser && dir > 0) {
      var skipTo = nextPageIndex(index, 1);
      if (skipTo >= FLOW_PAGES.length) {
        done();
        return;
      }
      if (skipTo !== index) {
        showPage(skipTo, dir);
        return;
      }
    }
    if (pageId === 'gear') renderGearUI();
    if (pageId === 'niche') hydrateNiche();
    if (pageId === 'experience') hydrateExperience();
    if (pageId === 'goals') hydrateGoals();
    if (pageId === 'google') hydrateGoogle();

    var skip = document.getElementById('ob-skip-btn');
    if (skip) skip.style.opacity = '1';
  }

  function hydrateNiche() {
    var d = draft();
    var input = document.getElementById('ob-niche-input');
    if (input) input.value = d.primaryNiche || '';
    document.querySelectorAll('#ob-niche-suggestions .ob-suggest').forEach(function (btn) {
      btn.classList.toggle('on', (d.primaryNiche || '') === btn.dataset.value);
    });
  }

  function hydrateExperience() {
    var d = draft();
    document.querySelectorAll('#ob-exp-list .ob-choice').forEach(function (card) {
      card.classList.toggle('selected', card.dataset.value === d.experienceLevel);
    });
  }

  function hydrateGoals() {
    var d = draft();
    var selected = d.goals || [];
    document.querySelectorAll('#ob-goals-list .ob-choice').forEach(function (card) {
      card.classList.toggle('selected', selected.indexOf(card.dataset.value) !== -1);
    });
  }

  function hydrateGoogle() {
    var signed = !!S.authUser;
    var box = document.getElementById('ob-google-box');
    var done = document.getElementById('ob-google-done');
    if (box) box.style.display = signed ? 'none' : 'block';
    if (done) {
      done.style.display = signed ? 'block' : 'none';
      if (signed) done.querySelector('.ob-google-name').textContent = S.authUser.name || S.authUser.email || 'Connected';
    }
  }

  function splitField(val) {
    if (Array.isArray(val)) return val.filter(Boolean);
    return String(val || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function seedDraftFromState() {
    var d = draft();
    var n = S.niche || {};
    var g = S.gear || {};
    if (!d.primaryNiche) d.primaryNiche = n.primaryNiche || n.contentType || '';
    if (!d.experienceLevel) d.experienceLevel = n.experienceLevel || n.skillLevel || '';
    if (!d.goals || !d.goals.length) {
      d.goals = Array.isArray(n.goals) ? n.goals.slice() : splitField(n.goals);
    }
    d.gear = d.gear || {};
    GEAR_SECTIONS.forEach(function (sec) {
      if (!d.gear[sec.key] || !d.gear[sec.key].length) d.gear[sec.key] = splitField(g[sec.key]);
    });
    if (!d.gear.editingSoftware || !d.gear.editingSoftware.length) {
      d.gear.editingSoftware = (g.editingSoftware || []).slice();
    }
    saveDraft(d);
  }

  function renderGearUI() {
    var host = document.getElementById('ob-gear-sections');
    if (!host) return;
    var d = draft();
    var html = '';
    GEAR_SECTIONS.forEach(function (sec) {
      var items = (d.gear && d.gear[sec.key]) || [];
      html += '<div class="ob-gear-sec" data-key="' + sec.key + '" data-cat="' + sec.cat + '">';
      html += '<div class="ob-gear-label">';
      if (typeof ICO !== 'undefined') html += '<span class="ob-gear-ico">' + ICO.gear(sec.cat, 16) + '</span>';
      html += sec.label + '</div>';
      html += '<div class="ob-gear-search-wrap">';
      html += '<input class="ob-gear-search" type="text" placeholder="Search or type ' + sec.label.toLowerCase() + '" data-key="' + sec.key + '" data-cat="' + sec.cat + '" autocomplete="off">';
      html += '<div class="ob-gear-suggest" hidden></div>';
      html += '</div>';
      html += '<div class="ob-gear-chips">';
      items.forEach(function (item) {
        html += '<button type="button" class="ob-chip on" data-key="' + sec.key + '" data-item="' + escapeAttr(item) + '">' + escapeHtml(item) + '<span class="ob-chip-x" aria-hidden="true"></span></button>';
      });
      html += '</div></div>';
    });
    html += '<div class="ob-gear-sec" data-key="editingSoftware">';
    html += '<div class="ob-gear-label">';
    if (typeof ICO !== 'undefined') html += '<span class="ob-gear-ico">' + ICO.html('film', 16) + '</span>';
    html += 'Editing Software</div>';
    html += '<div class="ob-soft-grid">';
    SOFTWARE.forEach(function (sw) {
      var on = ((d.gear && d.gear.editingSoftware) || []).indexOf(sw) !== -1 ? ' selected' : '';
      html += '<button type="button" class="ob-soft' + on + '" data-sw="' + escapeAttr(sw) + '">' + escapeHtml(sw) + '</button>';
    });
    html += '</div></div>';
    host.innerHTML = html;

    host.querySelectorAll('.ob-gear-search').forEach(function (input) {
      input.addEventListener('input', onGearInput);
      input.addEventListener('keydown', onGearKey);
      input.addEventListener('focus', onGearInput);
    });
    host.querySelectorAll('.ob-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        removeGearItem(chip.dataset.key, chip.dataset.item);
      });
    });
    host.querySelectorAll('.ob-soft').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleSoftware(btn.dataset.sw);
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function onGearInput(e) {
    var input = e.target;
    var cat = input.dataset.cat;
    var key = input.dataset.key;
    var box = input.parentElement.querySelector('.ob-gear-suggest');
    if (!box) return;
    var catalog = global.PreShootGearCatalog;
    var results = catalog ? catalog.search(cat, input.value, 8) : [];
    if (!results.length && input.value.trim()) {
      results = ['Add "' + input.value.trim() + '"'];
    }
    if (!results.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = results.map(function (r) {
      var val = r.indexOf('Add "') === 0 ? input.value.trim() : r;
      return '<button type="button" class="ob-suggest-row" data-key="' + key + '" data-val="' + escapeAttr(val) + '">' + escapeHtml(r) + '</button>';
    }).join('');
    box.querySelectorAll('.ob-suggest-row').forEach(function (row) {
      row.addEventListener('click', function () {
        addGearItem(row.dataset.key, row.dataset.val);
        input.value = '';
        box.hidden = true;
      });
    });
  }

  function onGearKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var v = e.target.value.trim();
      if (!v) return;
      addGearItem(e.target.dataset.key, v);
      e.target.value = '';
      var box = e.target.parentElement.querySelector('.ob-gear-suggest');
      if (box) box.hidden = true;
    }
  }

  function addGearItem(key, value) {
    if (!value) return;
    var d = draft();
    d.gear = d.gear || {};
    d.gear[key] = d.gear[key] || [];
    if (d.gear[key].indexOf(value) === -1) d.gear[key].push(value);
    saveDraft(d);
    persistToSourceOfTruth();
    renderGearUI();
  }

  function removeGearItem(key, value) {
    var d = draft();
    d.gear = d.gear || {};
    d.gear[key] = (d.gear[key] || []).filter(function (x) { return x !== value; });
    saveDraft(d);
    persistToSourceOfTruth();
    renderGearUI();
  }

  function toggleSoftware(sw) {
    var d = draft();
    d.gear = d.gear || {};
    d.gear.editingSoftware = d.gear.editingSoftware || [];
    var i = d.gear.editingSoftware.indexOf(sw);
    if (i === -1) d.gear.editingSoftware.push(sw);
    else d.gear.editingSoftware.splice(i, 1);
    saveDraft(d);
    persistToSourceOfTruth();
    renderGearUI();
  }

  function captureCurrentPage() {
    var id = FLOW_PAGES[S.obSlide] || '';
    var d = draft();
    if (id === 'niche') {
      var input = document.getElementById('ob-niche-input');
      d.primaryNiche = input ? input.value.trim() : d.primaryNiche;
    }
    saveDraft(d);
    persistToSourceOfTruth();
  }

  function validatePage() {
    var id = FLOW_PAGES[S.obSlide];
    var d = draft();
    if (id === 'niche') {
      var input = document.getElementById('ob-niche-input');
      var v = input ? input.value.trim() : '';
      if (!v) {
        if (typeof showToast === 'function') showToast('Add your primary niche to continue', '');
        return false;
      }
      d.primaryNiche = v;
      saveDraft(d);
    }
    if (id === 'experience' && !d.experienceLevel) {
      if (typeof showToast === 'function') showToast('Choose your experience level', '');
      return false;
    }
    if (id === 'goals' && (!d.goals || !d.goals.length)) {
      if (typeof showToast === 'function') showToast('Select at least one goal', '');
      return false;
    }
    return true;
  }

  function nextPageIndex(from, dir) {
    var i = from + dir;
    while (i >= 0 && i < FLOW_PAGES.length) {
      if (FLOW_PAGES[i] === 'google' && S.authUser && dir > 0) {
        i++;
        continue;
      }
      return i;
    }
    return i;
  }

  function bindIntroButtons() {
    var start = document.getElementById('ob-btn-start');
    var login = document.getElementById('ob-btn-login');
    function bindTouchClick(btn, fn) {
      if (!btn) return;
      btn.addEventListener('touchend', function (e) {
        e.preventDefault();
        btn.dataset.touched = '1';
        fn(e);
        setTimeout(function () { btn.dataset.touched = ''; }, 350);
      });
      btn.addEventListener('click', function (e) {
        if (btn.dataset.touched === '1') return;
        e.preventDefault();
        e.stopPropagation();
        fn(e);
      });
    }
    bindTouchClick(start, function (e) { PreShootOnboard.start(); });
    bindTouchClick(login, function (e) { PreShootOnboard.login(); });
    /* Fallback: if CSS animation fails, reveal buttons after 2.5s */
    setTimeout(function () {
      var actions = document.getElementById('ob-intro-actions');
      if (actions) {
        actions.style.opacity = '1';
        actions.style.transform = 'translateY(0)';
      }
    }, 2500);
  }

  function init() {
    S.obPhase = 'intro';
    S.obSlide = 0;
    seedDraftFromState();
    buildStaticLists();
    bindIntroButtons();
    setPhase('intro');
    runIntroSequence();

    var resume = gs('ob_oauth_resume', null);
    if (resume && S.authUser) {
      /* handled by onAuthResolved after cloud load; keep intro until then */
    }
  }

  function buildStaticLists() {
    var nicheHost = document.getElementById('ob-niche-suggestions');
    if (nicheHost && !nicheHost.dataset.built) {
      nicheHost.innerHTML = NICHE_SUGGESTIONS.map(function (n) {
        return '<button type="button" class="ob-suggest" data-value="' + escapeAttr(n) + '">' + escapeHtml(n) + '</button>';
      }).join('');
      nicheHost.dataset.built = '1';
      nicheHost.querySelectorAll('.ob-suggest').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var input = document.getElementById('ob-niche-input');
          if (input) input.value = btn.dataset.value;
          var d = draft();
          d.primaryNiche = btn.dataset.value;
          saveDraft(d);
          hydrateNiche();
          persistToSourceOfTruth();
        });
      });
    }

    var expHost = document.getElementById('ob-exp-list');
    if (expHost && !expHost.dataset.built) {
      expHost.innerHTML = EXPERIENCE.map(function (ex, idx) {
        return '<button type="button" class="ob-choice" data-value="' + ex.id + '" style="transition-delay:' + (idx * 0.06) + 's">' +
          '<div class="ob-choice-title">' + ex.title + '</div>' +
          '<div class="ob-choice-sub">' + ex.sub + '</div></button>';
      }).join('');
      expHost.dataset.built = '1';
      expHost.querySelectorAll('.ob-choice').forEach(function (card) {
        card.addEventListener('click', function () {
          var d = draft();
          d.experienceLevel = card.dataset.value;
          saveDraft(d);
          hydrateExperience();
          persistToSourceOfTruth();
        });
      });
    }

    var goalHost = document.getElementById('ob-goals-list');
    if (goalHost && !goalHost.dataset.built) {
      goalHost.innerHTML = GOALS.map(function (g, idx) {
        return '<button type="button" class="ob-choice" data-value="' + escapeAttr(g.title) + '" style="transition-delay:' + (idx * 0.05) + 's">' +
          '<div class="ob-choice-title">' + escapeHtml(g.title) + '</div>' +
          '<div class="ob-choice-sub">' + escapeHtml(g.sub) + '</div></button>';
      }).join('');
      goalHost.dataset.built = '1';
      goalHost.querySelectorAll('.ob-choice').forEach(function (card) {
        card.addEventListener('click', function () {
          var d = draft();
          d.goals = d.goals || [];
          var i = d.goals.indexOf(card.dataset.value);
          if (i === -1) d.goals.push(card.dataset.value);
          else d.goals.splice(i, 1);
          saveDraft(d);
          hydrateGoals();
          persistToSourceOfTruth();
        });
      });
    }

    var nicheInput = document.getElementById('ob-niche-input');
    if (nicheInput && !nicheInput.dataset.bound) {
      nicheInput.dataset.bound = '1';
      nicheInput.addEventListener('change', function () {
        var d = draft();
        d.primaryNiche = nicheInput.value.trim();
        saveDraft(d);
        persistToSourceOfTruth();
      });
    }
  }

  function start() {
    if (!S || typeof S !== 'object') { showToast('App is still loading', ''); return; }
    seedDraftFromState();
    setPhase('flow');
    showPage(0, 1);
    if (global.PreShootAnalytics) PreShootAnalytics.track('onboarding_started');
  }

  function login() {
    if (!S || typeof S !== 'object') { showToast('App is still loading', ''); return; }
    ss('ob_oauth_resume', { from: 'intro-login', ts: Date.now() });
    if (typeof authWith === 'function') authWith('google');
    else showToast('Sign in is not ready yet', '');
  }

  function connectGoogle() {
    ss('ob_oauth_resume', { from: 'flow-google', step: S.obSlide, ts: Date.now() });
    if (typeof authWith === 'function') authWith('google');
  }

  function next() {
    if (S.obPhase !== 'flow') return;
    if (!validatePage()) return;
    captureCurrentPage();
    var nextIdx = nextPageIndex(S.obSlide, 1);
    if (nextIdx >= FLOW_PAGES.length) {
      done();
      return;
    }
    showPage(nextIdx, 1);
  }

  function back() {
    if (S.obPhase !== 'flow') return;
    captureCurrentPage();
    var prev = nextPageIndex(S.obSlide, -1);
    if (prev < 0) {
      setPhase('intro');
      runIntroSequence();
      return;
    }
    showPage(prev, -1);
  }

  function skip() {
    captureCurrentPage();
    done();
  }

  function done() {
    persistToSourceOfTruth();
    ss('ob_done', true);
    ss('ob_oauth_resume', null);
    if (global.PreShootAnalytics) PreShootAnalytics.track('onboarding_completed');
    if (typeof showMain === 'function') showMain();
  }

  function onAuthResolved() {
    var resume = gs('ob_oauth_resume', null);
    ss('ob_oauth_resume', null);

    if (hasPersonalization()) {
      ss('ob_done', true);
      if (typeof showMain === 'function') showMain();
      return true;
    }

    if (resume && resume.from === 'intro-login') {
      start();
      return true;
    }
    if (resume && resume.from === 'flow-google') {
      setPhase('flow');
      var step = typeof resume.step === 'number' ? resume.step : FLOW_PAGES.indexOf('google');
      var after = nextPageIndex(step, 1);
      if (after >= FLOW_PAGES.length) done();
      else showPage(after, 1);
      return true;
    }

    if (S.obPhase === 'flow' && FLOW_PAGES[S.obSlide] === 'google') {
      hydrateGoogle();
    }
    return false;
  }

  global.PreShootOnboard = {
    init: init,
    start: start,
    login: login,
    connectGoogle: connectGoogle,
    next: next,
    back: back,
    skip: skip,
    done: done,
    hasPersonalization: hasPersonalization,
    onAuthResolved: onAuthResolved,
    persistToSourceOfTruth: persistToSourceOfTruth,
    FLOW_PAGES: FLOW_PAGES
  };

  /* Global handlers used by HTML onclick */
  global.obInit = function () { PreShootOnboard.init(); };
  global.obStart = function () { PreShootOnboard.start(); };
  global.obLogin = function () { PreShootOnboard.login(); };
  global.obGoogle = function () { PreShootOnboard.connectGoogle(); };
  global.obNext = function () { PreShootOnboard.next(); };
  global.obBack = function () { PreShootOnboard.back(); };
  global.obSkip = function () { PreShootOnboard.skip(); };
  global.obDone = function () { PreShootOnboard.done(); };
})(typeof window !== 'undefined' ? window : globalThis);
