/**
 * Content planning calendar UI — native PreShoot screen.
 * Studio remains source of truth; this is an index/planning layer.
 * Personal streak overlay is never written into a shared workspace document.
 */
(function (global) {
  'use strict';

  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var viewYear = null;
  var viewMonth = null;
  var selectedDate = null;
  var editingId = null;

  function Studio() {
    return global.PreShootStudio;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tz() {
    return global.PreShootEntitlements && PreShootEntitlements.tz
      ? PreShootEntitlements.tz()
      : 'UTC';
  }

  function todayIso() {
    if (Studio() && Studio().localCalDate) return Studio().localCalDate();
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isShared() {
    return !!(global.PreShootWorkspace && PreShootWorkspace.isShared && PreShootWorkspace.isShared());
  }

  function workspaceName() {
    try {
      var c = global.PreShootWorkspace && PreShootWorkspace.getContext && PreShootWorkspace.getContext();
      if (c && c.isShared) return c.activeWorkspaceName || 'Shared workspace';
    } catch (e) {}
    return 'Personal';
  }

  function canEdit() {
    if (!isShared()) return true;
    return !!(global.PreShootWorkspace && PreShootWorkspace.canEdit && PreShootWorkspace.canEdit());
  }

  function streakDays() {
    var set = {};
    var ent = global.S && S.entitlement;
    var days = (ent && ent.streak && ent.streak.days) || [];
    if (typeof days === 'string') {
      try { days = JSON.parse(days); } catch (e) { days = []; }
    }
    (Array.isArray(days) ? days : []).forEach(function (d) {
      set[String(d).slice(0, 10)] = true;
    });
    return set;
  }

  function streakNums() {
    var st = (global.S && S.entitlement && S.entitlement.streak) || {};
    return {
      current: st.current || 0,
      longest: st.longest || 0,
      days: Array.isArray(st.days) ? st.days : []
    };
  }

  function localDateFromTs(ts) {
    if (!ts) return null;
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(ts));
    } catch (e) {
      return new Date(ts).toISOString().slice(0, 10);
    }
  }

  function derivedEvents() {
    var out = [];
    if (!isShared() && typeof global.getHistory === 'function') {
      (global.getHistory() || []).forEach(function (entry, i) {
        var date = localDateFromTs(entry.ts);
        if (!date) return;
        out.push({
          id: 'derived_scan_' + (entry.ts || i),
          date: date,
          type: 'scan',
          status: 'idea',
          title: entry.sceneLabel || entry.sceneType || 'Scan',
          derived: true,
          notes: ((entry.ideas || []).length || 0) + ' ideas'
        });
      });
    }
    if (Studio() && Studio().listProjects) {
      Studio().listProjects({ includeArchived: true }).forEach(function (p) {
        (p.productions || []).forEach(function (prod) {
          var date = localDateFromTs(prod.createdAt || prod.updatedAt);
          if (!date) return;
          var status = 'planned';
          if (prod.status === 'posted') status = 'posted';
          else if (prod.status === 'ready_to_post' || prod.status === 'ready') status = 'ready';
          else if (prod.status === 'filming' || prod.status === 'editing') status = 'in_production';
          out.push({
            id: 'derived_prod_' + prod.id,
            date: date,
            type: 'production',
            status: status,
            title: prod.name,
            projectId: p.id,
            productionId: prod.id,
            derived: true
          });
        });
      });
    }
    return out;
  }

  function storedEvents() {
    if (!Studio() || !Studio().listCalendarEvents) return [];
    return Studio().listCalendarEvents({ personal: false }) || [];
  }

  function allEvents() {
    var stored = storedEvents();
    var ids = {};
    stored.forEach(function (e) {
      if (e.productionId) ids['p:' + e.productionId] = true;
      if (e.type === 'scan' && e.date) ids['s:' + e.date] = true;
    });
    var extra = derivedEvents().filter(function (e) {
      if (e.productionId && ids['p:' + e.productionId]) return false;
      if (e.type === 'scan' && ids['s:' + e.date]) return false;
      return true;
    });
    return stored.concat(extra);
  }

  function eventsOn(iso) {
    return allEvents().filter(function (e) {
      return e.date === iso;
    });
  }

  function mondayOf(iso) {
    var parts = String(iso).split('-').map(function (n) { return parseInt(n, 10); });
    var utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    var dow = utc.getUTCDay();
    var delta = dow === 0 ? -6 : 1 - dow;
    utc.setUTCDate(utc.getUTCDate() + delta);
    return utc.toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    var parts = String(iso).split('-').map(function (x) { return parseInt(x, 10); });
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + n));
    return d.toISOString().slice(0, 10);
  }

  function progress() {
    var today = todayIso();
    var weekStart = mondayOf(today);
    var weekEnd = addDays(weekStart, 6);
    var monthStart = today.slice(0, 8) + '01';
    var last = new Date(
      Date.UTC(parseInt(today.slice(0, 4), 10), parseInt(today.slice(5, 7), 10), 0)
    ).getUTCDate();
    var monthEnd = today.slice(0, 8) + String(last).padStart(2, '0');
    var events = allEvents();
    var streak = streakNums();
    var streakSet = streakDays();

    function count(pred, a, b) {
      var n = 0;
      events.forEach(function (e) {
        if (e.date >= a && e.date <= b && pred(e)) n += 1;
      });
      return n;
    }
    var isPost = function (e) {
      return e.type === 'post' || e.type === 'production';
    };
    var hist = typeof global.getHistory === 'function' && !isShared() ? global.getHistory() : [];
    var scansMonth = hist.filter(function (h) {
      var d = localDateFromTs(h.ts);
      return d && d >= monthStart && d <= monthEnd;
    }).length;

    return {
      currentStreak: streak.current,
      longestStreak: streak.longest,
      videosPlanned: count(function (e) {
        return isPost(e) && e.status !== 'posted' && e.status !== 'skipped';
      }, '0000-01-01', '9999-12-31'),
      videosPosted: count(function (e) {
        return isPost(e) && e.status === 'posted';
      }, '0000-01-01', '9999-12-31'),
      ideasScanned: isShared()
        ? count(function (e) { return e.type === 'scan' || e.type === 'idea'; }, '0000-01-01', '9999-12-31')
        : hist.length,
      week: {
        planned: count(function (e) {
          return isPost(e) && e.status !== 'posted' && e.status !== 'skipped';
        }, weekStart, weekEnd),
        posted: count(function (e) { return isPost(e) && e.status === 'posted'; }, weekStart, weekEnd),
        streak: Object.keys(streakSet).filter(function (d) {
          return d >= weekStart && d <= weekEnd;
        }).length
      },
      month: {
        planned: count(function (e) {
          return isPost(e) && e.status !== 'posted' && e.status !== 'skipped';
        }, monthStart, monthEnd),
        posted: count(function (e) { return isPost(e) && e.status === 'posted'; }, monthStart, monthEnd),
        scans: scansMonth
      }
    };
  }

  function markers(iso) {
    var list = eventsOn(iso);
    return {
      planned: list.some(function (e) {
        return e.status !== 'posted' && e.status !== 'skipped' && (e.type === 'post' || e.type === 'production' || e.type === 'other');
      }),
      posted: list.some(function (e) { return e.status === 'posted'; }),
      scanned: list.some(function (e) { return e.type === 'scan' || e.type === 'idea'; }),
      streak: !!streakDays()[iso]
    };
  }

  function ensureView() {
    var t = todayIso().split('-');
    if (viewYear == null) viewYear = parseInt(t[0], 10);
    if (viewMonth == null) viewMonth = parseInt(t[1], 10) - 1;
    if (!selectedDate) selectedDate = todayIso();
  }

  function statusLabel(s) {
    var map = {
      idea: 'Idea',
      planned: 'Planned',
      in_production: 'In Production',
      ready: 'Ready',
      posted: 'Posted',
      skipped: 'Skipped'
    };
    return map[s] || s;
  }

  function typeLabel(t) {
    var map = { post: 'Post', scan: 'Scan', idea: 'Idea', production: 'Production', other: 'Other' };
    return map[t] || t;
  }

  function recordStreak(kind) {
    if (global.PreShootEntitlements && PreShootEntitlements.recordActivity) {
      PreShootEntitlements.recordActivity(kind);
    }
  }

  function renderWeekStrip() {
    var today = todayIso();
    var start = mondayOf(today);
    var html = '<div class="plan-week" aria-label="This week">';
    for (var i = 0; i < 7; i++) {
      var iso = addDays(start, i);
      var m = markers(iso);
      var cls = 'plan-week-day';
      if (iso === today) cls += ' is-today';
      if (iso === selectedDate) cls += ' is-sel';
      if (m.streak) cls += ' is-streak';
      html +=
        '<button type="button" class="' +
        cls +
        '" onclick="PreShootCalendar.openDay(\'' +
        iso +
        '\')"><span class="plan-week-dow">' +
        DOW[i] +
        '</span><span class="plan-week-n">' +
        parseInt(iso.slice(8), 10) +
        '</span><span class="plan-week-mark">' +
        (m.streak ? '🔥' : m.posted ? '✓' : m.planned ? '●' : '') +
        '</span></button>';
    }
    html += '</div>';
    return html;
  }

  function renderMonthGrid() {
    ensureView();
    var first = new Date(viewYear, viewMonth, 1);
    var startWeekday = (first.getDay() + 6) % 7;
    var lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
    var today = todayIso();
    var html = '<div class="plan-cal">';
    html += '<div class="plan-cal-nav">';
    html +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootCalendar.prevMonth()" aria-label="Previous month">‹</button>';
    html += '<div class="plan-cal-hd">' + MONTHS[viewMonth] + ' ' + viewYear + '</div>';
    html +=
      '<button type="button" class="studio-btn ghost sm" onclick="PreShootCalendar.nextMonth()" aria-label="Next month">›</button>';
    html += '</div>';
    html += '<div class="plan-cal-week">';
    DOW.forEach(function (d) {
      html += '<span class="plan-cal-dow">' + d + '</span>';
    });
    html += '</div><div class="plan-cal-grid">';
    var i;
    for (i = 0; i < startWeekday; i++) html += '<span class="plan-cal-cell is-empty"></span>';
    for (var d = 1; d <= lastDate; d++) {
      var iso = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(d);
      var m = markers(iso);
      var cls = 'plan-cal-cell';
      if (iso === today) cls += ' is-today';
      if (iso === selectedDate) cls += ' is-sel';
      if (m.streak) cls += ' is-streak';
      html +=
        '<button type="button" class="' +
        cls +
        '" onclick="PreShootCalendar.openDay(\'' +
        iso +
        '\')"><span class="plan-cal-n">' +
        d +
        '</span><span class="plan-cal-dots">';
      if (m.planned) html += '<i class="dot planned" title="Planned"></i>';
      if (m.posted) html += '<i class="dot posted" title="Posted"></i>';
      if (m.scanned) html += '<i class="dot scanned" title="Scan / idea"></i>';
      if (m.streak) html += '<i class="dot streak" title="Streak"></i>';
      html += '</span></button>';
    }
    html += '</div></div>';
    return html;
  }

  function renderStats() {
    var p = progress();
    var fire = p.currentStreak ? '🔥 ' + p.currentStreak + ' day streak' : 'No active streak';
    var html = '<div class="plan-stats">';
    [
      [fire, 'Personal streak'],
      [String(p.longestStreak), 'Longest'],
      [String(p.videosPlanned), 'Videos planned'],
      [String(p.videosPosted), 'Videos posted'],
      [String(p.ideasScanned), 'Ideas scanned'],
      [p.week.posted + ' posted', 'This week'],
      [p.month.posted + ' posted', 'This month']
    ].forEach(function (row) {
      html +=
        '<div class="plan-stat"><div class="plan-stat-n">' +
        esc(row[0]) +
        '</div><div class="plan-stat-l">' +
        esc(row[1]) +
        '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function projectName(id) {
    if (!id || !Studio()) return '';
    var p = Studio().findProject(id);
    return p ? p.name : '';
  }

  function productionName(id) {
    if (!id || !Studio()) return '';
    var f = Studio().findProduction(id);
    return f && f.production ? f.production.name : '';
  }

  function renderDayList(iso) {
    var list = eventsOn(iso);
    var html = '<div class="plan-day-hd"><div class="plan-day-title">' + esc(iso) + '</div>';
    html += '<div class="plan-day-sub">';
    var m = markers(iso);
    var bits = [];
    if (m.planned) bits.push('● Planned');
    if (m.posted) bits.push('✓ Posted');
    if (m.streak) bits.push('🔥 Streak (personal)');
    if (m.scanned) bits.push('Scan / idea');
    html += esc(bits.join(' · ') || 'No activity yet');
    html += '</div></div>';
    if (!list.length) {
      html += '<div class="plan-empty">Nothing planned for this day.</div>';
    } else {
      list.forEach(function (e) {
        html += '<div class="plan-item">';
        html += '<div class="plan-item-k">' + esc(typeLabel(e.type)) + ' · ' + esc(statusLabel(e.status)) + '</div>';
        html += '<div class="plan-item-t">' + esc(e.title) + '</div>';
        var meta = [];
        var pn = projectName(e.projectId);
        var pr = productionName(e.productionId);
        if (pn) meta.push('Project: ' + pn);
        if (pr) meta.push('Production: ' + pr);
        if (e.platform) meta.push(e.platform);
        if (meta.length) html += '<div class="plan-item-m">' + esc(meta.join(' · ')) + '</div>';
        if (e.notes) html += '<div class="plan-item-m">' + esc(e.notes) + '</div>';
        html += '<div class="plan-item-actions">';
        if (e.productionId) {
          html +=
            '<button type="button" class="studio-btn primary sm" onclick="PreShootCalendar.openProduction(\'' +
            esc(e.productionId) +
            '\')">Open Production</button>';
        }
        if (!e.derived && e.status !== 'posted' && canEdit()) {
          html +=
            '<button type="button" class="studio-btn sm" onclick="PreShootCalendar.markPosted(\'' +
            esc(e.id) +
            '\')">Mark as Posted</button>';
          html +=
            '<button type="button" class="studio-btn ghost sm" onclick="PreShootCalendar.editEvent(\'' +
            esc(e.id) +
            '\')">Edit</button>';
          html +=
            '<button type="button" class="studio-btn ghost danger sm" onclick="PreShootCalendar.deleteEvent(\'' +
            esc(e.id) +
            '\')">Delete</button>';
        }
        html += '</div></div>';
      });
    }
    if (canEdit()) {
      html +=
        '<button type="button" class="studio-btn primary" style="width:100%;margin-top:12px" onclick="PreShootCalendar.openPlanForm()">+ Plan Content</button>';
    } else {
      html += '<div class="plan-empty">This shared calendar is read-only for your role.</div>';
    }
    return html;
  }

  function ideaOptions() {
    var out = [];
    if (typeof global.getLib === 'function') {
      (global.getLib() || []).forEach(function (idea, i) {
        if (idea && idea.title) out.push({ id: 'lib:' + i + ':' + idea.title, title: idea.title });
      });
    }
    if (typeof global.getHistory === 'function') {
      (global.getHistory() || []).forEach(function (entry, hi) {
        (entry.ideas || []).forEach(function (idea, ii) {
          if (idea && idea.title) {
            out.push({
              id: 'hist:' + hi + ':' + ii + ':' + idea.title,
              title: idea.title
            });
          }
        });
      });
    }
    var seen = {};
    return out.filter(function (x) {
      if (seen[x.title]) return false;
      seen[x.title] = true;
      return true;
    }).slice(0, 80);
  }

  function renderPlanForm(iso, existing) {
    var links = Studio() && Studio().listStudioLinkOptions ? Studio().listStudioLinkOptions() : { projects: [], productions: [] };
    var ev = existing || {
      date: iso,
      type: 'post',
      status: 'planned',
      title: '',
      projectId: '',
      productionId: '',
      ideaId: '',
      platform: '',
      notes: ''
    };
    var html = '<form class="plan-form" onsubmit="PreShootCalendar.savePlan(event)">';
    html += '<div class="plan-form-kicker">What are you planning?</div>';
    html += '<div class="plan-kind">';
    [
      ['post', 'Video'],
      ['idea', 'Idea'],
      ['other', 'Other']
    ].forEach(function (k) {
      html +=
        '<label class="plan-kind-opt"><input type="radio" name="plan-kind" value="' +
        k[0] +
        '"' +
        (ev.type === k[0] || (k[0] === 'post' && ev.type === 'production') ? ' checked' : '') +
        '> ' +
        k[1] +
        '</label>';
    });
    html += '</div>';
    html += '<label class="st-label">Title</label>';
    html +=
      '<input class="st-input" id="plan-title" required maxlength="160" value="' +
      esc(ev.title) +
      '" placeholder="3 Mistakes Every Business Makes">';
    html += '<label class="st-label">Project</label><select class="st-input" id="plan-project">';
    html += '<option value="">None</option>';
    (links.projects || []).forEach(function (p) {
      html +=
        '<option value="' +
        esc(p.id) +
        '"' +
        (ev.projectId === p.id ? ' selected' : '') +
        '>' +
        esc(p.name) +
        '</option>';
    });
    html += '</select>';
    html += '<label class="st-label">Production</label><select class="st-input" id="plan-production">';
    html += '<option value="">None</option>';
    (links.productions || []).forEach(function (p) {
      html +=
        '<option value="' +
        esc(p.id) +
        '" data-project="' +
        esc(p.projectId) +
        '"' +
        (ev.productionId === p.id ? ' selected' : '') +
        '>' +
        esc(p.projectName + ' — ' + p.name) +
        '</option>';
    });
    html += '</select>';
    html += '<label class="st-label">Idea</label><select class="st-input" id="plan-idea">';
    html += '<option value="">None</option>';
    ideaOptions().forEach(function (idea) {
      html +=
        '<option value="' +
        esc(idea.id) +
        '"' +
        (ev.ideaId === idea.id || ev.ideaId === idea.title ? ' selected' : '') +
        '>' +
        esc(idea.title) +
        '</option>';
    });
    html += '</select>';
    html += '<label class="st-label">Platform</label>';
    html +=
      '<input class="st-input" id="plan-platform" maxlength="40" value="' +
      esc(ev.platform || '') +
      '" placeholder="TikTok, Reels, Shorts…">';
    html += '<label class="st-label">Status</label><select class="st-input" id="plan-status">';
    ['idea', 'planned', 'in_production', 'ready', 'posted', 'skipped'].forEach(function (s) {
      html +=
        '<option value="' +
        s +
        '"' +
        (ev.status === s ? ' selected' : '') +
        '>' +
        statusLabel(s) +
        '</option>';
    });
    html += '</select>';
    html += '<label class="st-label">Notes</label>';
    html +=
      '<textarea class="st-input" id="plan-notes" rows="3" maxlength="2000">' +
      esc(ev.notes || '') +
      '</textarea>';
    html += '<input type="hidden" id="plan-id" value="' + esc(ev.id || '') + '">';
    html += '<input type="hidden" id="plan-date" value="' + esc(iso) + '">';
    html +=
      '<button type="submit" class="studio-btn primary" style="width:100%;margin-top:14px">Save plan</button>';
    html += '</form>';
    return html;
  }

  function fillDaySheet() {
    var body = document.getElementById('plan-day-body');
    if (!body) return;
    body.innerHTML = renderDayList(selectedDate || todayIso());
  }

  function renderScreen() {
    ensureView();
    var root = document.getElementById('plan-root');
    if (!root) return;
    var html = '';
    html += '<div class="plan-hd">';
    html += '<div><div class="plan-title">Content calendar</div>';
    html +=
      '<div class="plan-sub">' +
      esc(isShared() ? workspaceName() + ' planning' : 'Personal planning') +
      ' · streak stays personal</div></div></div>';
    html += renderStats();
    html += renderWeekStrip();
    html += renderMonthGrid();
    html +=
      '<div class="plan-legend"><span>● Planned</span><span>✓ Posted</span><span>🔥 Streak</span></div>';
    html += '<div class="plan-day-panel">' + renderDayList(selectedDate || todayIso()) + '</div>';
    root.innerHTML = html;
    fillDaySheet();
  }

  function openScreen(iso) {
    ensureView();
    if (iso) {
      selectedDate = iso;
      var parts = iso.split('-');
      viewYear = parseInt(parts[0], 10);
      viewMonth = parseInt(parts[1], 10) - 1;
    }
    if (typeof global.goTab === 'function') global.goTab('plan');
    else renderScreen();
  }

  function openDay(iso) {
    selectedDate = iso;
    renderScreen();
    var sheet = document.getElementById('plan-day-modal');
    if (sheet && window.matchMedia && window.matchMedia('(max-width: 699px)').matches) {
      fillDaySheet();
      if (typeof global.openM === 'function') global.openM('plan-day-modal');
    }
  }

  function openPlanForm(eventId) {
    editingId = eventId || null;
    var existing = null;
    if (eventId) {
      storedEvents().forEach(function (e) {
        if (e.id === eventId) existing = e;
      });
    }
    var body = document.getElementById('plan-form-body');
    var ttl = document.getElementById('plan-form-ttl');
    if (ttl) ttl.textContent = existing ? 'Edit plan' : 'Plan content';
    if (body) body.innerHTML = renderPlanForm(selectedDate || todayIso(), existing);
    if (typeof global.openM === 'function') global.openM('plan-form-modal');
  }

  function savePlan(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!Studio() || !canEdit()) return false;
    var kindEl = document.querySelector('input[name="plan-kind"]:checked');
    var type = kindEl ? kindEl.value : 'post';
    var prodSel = document.getElementById('plan-production');
    var productionId = prodSel ? prodSel.value : '';
    var projectId = document.getElementById('plan-project')
      ? document.getElementById('plan-project').value
      : '';
    if (productionId && prodSel && prodSel.selectedOptions && prodSel.selectedOptions[0]) {
      var dp = prodSel.selectedOptions[0].getAttribute('data-project');
      if (dp) projectId = dp;
    }
    var ideaId = document.getElementById('plan-idea') ? document.getElementById('plan-idea').value : '';
    var status = document.getElementById('plan-status')
      ? document.getElementById('plan-status').value
      : 'planned';
    var payload = {
      id: document.getElementById('plan-id') && document.getElementById('plan-id').value,
      date: document.getElementById('plan-date') && document.getElementById('plan-date').value,
      type: type,
      status: status,
      title: document.getElementById('plan-title') && document.getElementById('plan-title').value,
      projectId: projectId || null,
      productionId: productionId || null,
      ideaId: ideaId || null,
      platform: document.getElementById('plan-platform') && document.getElementById('plan-platform').value,
      notes: document.getElementById('plan-notes') && document.getElementById('plan-notes').value
    };
    if (status === 'posted' && !payload.completedAt) payload.completedAt = Date.now();
    var result = Studio().upsertCalendarEvent(payload, { personal: false });
    if (!result || !result.ok) {
      if (typeof global.showToast === 'function') {
        global.showToast(result && result.error === 'read_only' ? 'Read-only workspace' : 'Could not save');
      }
      return false;
    }
    recordStreak(status === 'posted' ? 'post' : 'plan');
    if (typeof global.closeM === 'function') global.closeM('plan-form-modal');
    if (typeof global.closeM === 'function') global.closeM('plan-day-modal');
    renderScreen();
    if (typeof global.showToast === 'function') global.showToast('Saved to calendar');
    return false;
  }

  function markPosted(id) {
    if (!Studio() || !canEdit()) return;
    var result = Studio().markCalendarPosted(id, { personal: false });
    if (!result || !result.ok) return;
    var ev = result.event;
    if (ev && ev.productionId && Studio().setProductionStatus) {
      try {
        Studio().setProductionStatus(ev.productionId, 'posted');
      } catch (e) {}
    }
    recordStreak('post');
    renderScreen();
    fillDaySheet();
    if (typeof global.showToast === 'function') global.showToast('Marked posted');
  }

  function deleteEvent(id) {
    if (!Studio() || !canEdit()) return;
    if (!global.confirm || !confirm('Remove this plan from the calendar? The Studio production is not deleted.')) {
      return;
    }
    Studio().removeCalendarEvent(id, { personal: false });
    renderScreen();
    fillDaySheet();
  }

  function editEvent(id) {
    openPlanForm(id);
  }

  function openProduction(id) {
    if (typeof global.closeM === 'function') {
      global.closeM('plan-day-modal');
      global.closeM('plan-form-modal');
    }
    if (global.PreShootStudioUI && PreShootStudioUI.openProduction) {
      PreShootStudioUI.openProduction(id);
    }
  }

  function prevMonth() {
    ensureView();
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderScreen();
  }

  function nextMonth() {
    ensureView();
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderScreen();
  }

  function indexScan(entry) {
    if (!Studio() || !Studio().upsertCalendarEvent) return;
    var date = localDateFromTs((entry && entry.ts) || Date.now()) || todayIso();
    Studio().upsertCalendarEvent(
      {
        id: 'scan_' + date,
        date: date,
        type: 'scan',
        status: 'idea',
        title: (entry && (entry.sceneLabel || entry.sceneType)) || 'Scan',
        notes: entry && entry.ideas ? entry.ideas.length + ' ideas' : ''
      },
      { personal: true }
    );
  }

  function indexIdea(idea) {
    if (!Studio() || !idea) return;
    Studio().upsertCalendarEvent(
      {
        date: todayIso(),
        type: 'idea',
        status: 'idea',
        title: idea.title || 'Idea',
        ideaId: idea.title || null
      },
      { personal: true }
    );
  }

  function indexProduction(prod, project) {
    if (!Studio() || !prod) return;
    Studio().upsertCalendarEvent(
      {
        id: 'prodref_' + prod.id,
        date: todayIso(),
        type: 'production',
        status: 'in_production',
        title: prod.name || 'Production',
        productionId: prod.id,
        projectId: project && project.id
      },
      { personal: false }
    );
  }

  function planFromIdea(idea, iso) {
    selectedDate = iso || todayIso();
    openScreen(selectedDate);
    setTimeout(function () {
      openPlanForm();
      var title = document.getElementById('plan-title');
      if (title && idea) title.value = idea.title || '';
      var ideaSel = document.getElementById('plan-idea');
      if (ideaSel && idea && idea.title) {
        var opts = ideaSel.options;
        for (var i = 0; i < opts.length; i++) {
          if (opts[i].textContent === idea.title) {
            ideaSel.selectedIndex = i;
            break;
          }
        }
      }
    }, 60);
  }

  function planFromProduction(productionId, iso) {
    selectedDate = iso || todayIso();
    var found = Studio() && Studio().findProduction(productionId);
    openScreen(selectedDate);
    setTimeout(function () {
      openPlanForm();
      if (found) {
        var title = document.getElementById('plan-title');
        if (title) title.value = found.production.name || '';
        var proj = document.getElementById('plan-project');
        if (proj) proj.value = found.project.id;
        var prod = document.getElementById('plan-production');
        if (prod) prod.value = productionId;
      }
    }, 60);
  }

  global.PreShootCalendar = {
    render: renderScreen,
    open: openScreen,
    openDay: openDay,
    openPlanForm: openPlanForm,
    savePlan: savePlan,
    markPosted: markPosted,
    deleteEvent: deleteEvent,
    editEvent: editEvent,
    openProduction: openProduction,
    prevMonth: prevMonth,
    nextMonth: nextMonth,
    indexScan: indexScan,
    indexIdea: indexIdea,
    indexProduction: indexProduction,
    planFromIdea: planFromIdea,
    planFromProduction: planFromProduction,
    todayIso: todayIso
  };
})(typeof window !== 'undefined' ? window : globalThis);
