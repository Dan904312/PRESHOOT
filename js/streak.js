/* Creator streak calendar — accent-themed, server-backed.
 * A streak day counts once per local calendar day after a meaningful
 * creation action: completed scan, Director reply, or Studio production create.
 * Opening the app, login, refresh, and settings do not count.
 */
(function (global) {
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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
    var tz = global.PreShootEntitlements && PreShootEntitlements.tz
      ? PreShootEntitlements.tz()
      : 'UTC';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
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

  function renderProfileBlock() {
    var ent = currentEnt();
    var streak = (ent && ent.streak) || { current: 0, longest: 0, days: [] };
    var now = new Date();
    var cal = renderCalendarHtml(now.getFullYear(), now.getMonth(), daysSet(ent), todayIso());
    return (
      '<div class="streak-card" id="streak-card">' +
        '<div class="streak-card-top">' +
          '<div class="streak-card-kicker">Creator streak</div>' +
          '<div class="streak-card-nums">' +
            '<span><strong>' + (streak.current || 0) + '</strong> current</span>' +
            '<span class="streak-card-sep">·</span>' +
            '<span><strong>' + (streak.longest || 0) + '</strong> longest</span>' +
          '</div>' +
        '</div>' +
        cal +
        '<div class="streak-card-note">One creation day counts once — scan, Director, or Studio.</div>' +
      '</div>'
    );
  }

  function fillSheet() {
    var body = document.getElementById('streak-sheet-body');
    if (!body) return;
    body.innerHTML = renderProfileBlock();
  }

  function openCalendar() {
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
  }

  global.PreShootStreak = {
    renderProfileBlock: renderProfileBlock,
    openCalendar: openCalendar,
    syncFromEntitlement: syncFromEntitlement,
    onActivity: onActivity,
    fillSheet: fillSheet
  };
})(typeof window !== 'undefined' ? window : globalThis);
