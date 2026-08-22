/* Creator streak — server-backed. Display only; never grant from the client. */
(function (global) {
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function daysSet(ent) {
    var set = {};
    var days = (ent && ent.streak && ent.streak.days) || [];
    if (typeof days === 'string') {
      try { days = JSON.parse(days); } catch (e) { days = []; }
    }
    (Array.isArray(days) ? days : []).forEach(function (d) {
      set[String(d).slice(0, 10)] = true;
    });
    return set;
  }

  function todayIso() {
    var zone = global.PreShootEntitlements && PreShootEntitlements.tz
      ? PreShootEntitlements.tz()
      : 'UTC';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
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

  function renderCalendarHtml(year, monthIndex, active, today) {
    var first = new Date(year, monthIndex, 1);
    var startWeekday = (first.getDay() + 6) % 7;
    var lastDate = new Date(year, monthIndex + 1, 0).getDate();
    var html = '<div class="streak-cal">';
    html += '<div class="streak-cal-hd">' + MONTHS[monthIndex] + ' ' + year + '</div>';
    html += '<div class="streak-cal-week">';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) {
      html += '<span class="streak-cal-dow">' + d + '</span>';
    });
    html += '</div><div class="streak-cal-grid">';
    var i;
    for (i = 0; i < startWeekday; i++) html += '<span class="streak-cal-day is-empty"></span>';
    for (var d = 1; d <= lastDate; d++) {
      var iso = year + '-' + pad(monthIndex + 1) + '-' + pad(d);
      var cls = 'streak-cal-day';
      if (active[iso]) cls += ' is-active';
      if (iso === today) cls += ' is-today';
      html += '<span class="' + cls + '" data-day="' + iso + '">' + d + '</span>';
    }
    html += '</div></div>';
    return html;
  }

  function currentEnt() {
    return (typeof S !== 'undefined' && S.entitlement) || null;
  }

  function progressBar(at, target) {
    var t = Math.max(1, parseInt(target, 10) || 10);
    var n = Math.max(0, parseInt(at, 10) || 0);
    var pct = Math.max(0, Math.min(100, Math.round((n / t) * 100)));
    return (
      '<div class="streak-progress" role="progressbar" aria-valuenow="' +
      n +
      '" aria-valuemax="' +
      t +
      '">' +
      '<i style="width:' +
      pct +
      '%"></i></div>' +
      '<div class="streak-progress-lbl">' +
      n +
      ' / ' +
      t +
      '</div>'
    );
  }

  function activeReward(ent) {
    var e = ent || {};
    var iso = e.accessEndsAt || e.streakAccessEndsAt;
    if (!iso) return '';
    var left =
      global.PreShootEntitlements && PreShootEntitlements.formatRemaining
        ? PreShootEntitlements.formatRemaining(iso)
        : '';
    if (!left) return '';
    return (
      '<div class="streak-card-note">Director + Studio access · ' +
      esc(left) +
      '</div>'
    );
  }

  function renderProfileBlock() {
    var ent = currentEnt();
    var streak = (ent && ent.streak) || {
      current: 0,
      longest: 0,
      days: [],
      progress: { at: 0, target: 10 },
      nextReward: { days: 10, description: '2 free days of Director + Studio' }
    };
    var now = new Date();
    var cal = renderCalendarHtml(now.getFullYear(), now.getMonth(), daysSet(ent), todayIso());
    var current = streak.current || 0;
    var todayDone = streak.todayComplete === true;
    var headline = current
      ? '🔥 ' + current + ' day streak'
      : 'No active streak';
    var sub = current
      ? current + ' day' + (current !== 1 ? 's' : '') + ' in a row'
      : 'Complete a Scan, plan, or Studio action to start.';
    var nudge = current
      ? todayDone
        ? "You're on fire."
        : 'Keep it going today.'
      : '';
    var next = streak.nextReward;
    var prog = streak.progress || { at: current, target: (next && next.days) || 10 };
    var nextHtml = '';
    if (next) {
      nextHtml =
        '<div class="streak-next">' +
        '<div class="streak-next-k">Next reward</div>' +
        '<div class="streak-next-t">' +
        esc(next.days) +
        ' day streak</div>' +
        '<div class="streak-next-d">' +
        esc(next.description || next.title || '') +
        '</div>' +
        progressBar(prog.at, prog.target) +
        '</div>';
    }
    return (
      '<div class="streak-card" id="streak-card">' +
        '<div class="streak-card-top">' +
          '<div class="streak-card-kicker">Creator streak</div>' +
          '<div class="streak-card-nums">' +
            '<span><strong>' +
            current +
            '</strong> current</span>' +
            '<span class="streak-card-sep">·</span>' +
            '<span><strong>' +
            (streak.longest || 0) +
            '</strong> best</span>' +
          '</div>' +
        '</div>' +
        '<div class="streak-card-hd">' +
        esc(headline) +
        '</div>' +
        '<div class="streak-card-sub">' +
        esc(sub) +
        (nudge ? ' ' + esc(nudge) : '') +
        '</div>' +
        nextHtml +
        activeReward(ent) +
        cal +
        '<div class="streak-card-note">Personal. One meaningful day counts once — Scan, plan, post, Director, or Studio. Opening the app does not count.</div>' +
        '<button type="button" class="studio-btn" style="width:100%;margin-top:12px" onclick="PreShootCalendar&&PreShootCalendar.open()">Open content calendar</button>' +
      '</div>'
    );
  }

  function fillSheet() {
    var body = document.getElementById('streak-sheet-body');
    if (!body) return;
    body.innerHTML = renderProfileBlock();
  }

  function openCalendar() {
    if (global.PreShootCalendar && PreShootCalendar.open) {
      PreShootCalendar.open();
      return;
    }
    fillSheet();
    if (typeof openM === 'function') openM('streak-modal');
  }

  function syncFromEntitlement() {
    var host = document.getElementById('prof-streak-slot');
    if (host) host.innerHTML = renderProfileBlock();
    var n = document.getElementById('streak-n');
    if (n) {
      var cur = (currentEnt() && currentEnt().streak && currentEnt().streak.current) || 0;
      n.textContent = cur + ' day' + (cur !== 1 ? 's' : '');
    }
  }

  function celebrate(days) {
    if (!days) return;
    if (typeof showToast === 'function') {
      showToast(days + '-day streak', '');
    }
  }

  function onActivity(data) {
    syncFromEntitlement();
    if (data && data.milestone) celebrate(data.milestone);
    if (data && data.grants && data.grants.length && typeof showToast === 'function') {
      var access = data.grants.filter(function (g) {
        return g && g.kind === 'access';
      })[0];
      if (access) showToast('10-day reward unlocked', '');
    }
  }

  global.PreShootStreak = {
    renderProfileBlock: renderProfileBlock,
    openCalendar: openCalendar,
    syncFromEntitlement: syncFromEntitlement,
    onActivity: onActivity,
    fillSheet: fillSheet
  };
})(typeof window !== 'undefined' ? window : globalThis);
