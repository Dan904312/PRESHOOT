/**
 * Shared skeleton placeholders. Same shape language across Library, Trending,
 * Studio, research, and scan. Respects prefers-reduced-motion via CSS.
 */
(function (global) {
  'use strict';

  function line(w) {
    return '<span class="sk-line" style="width:' + (w || '72%') + '"></span>';
  }

  function card() {
    return (
      '<article class="sk-card" aria-hidden="true">' +
      '<div class="sk-thumb"></div>' +
      '<div class="sk-body">' +
      line('40%') +
      line('88%') +
      line('64%') +
      '</div></article>'
    );
  }

  function list(n) {
    var html = '<div class="sk-list" role="status" aria-live="polite" aria-label="Loading">';
    var i;
    for (i = 0; i < (n || 4); i++) html += card();
    html += '</div>';
    return html;
  }

  function ideaCards(n) {
    var html = '<div class="sk-ideas" role="status" aria-label="Generating ideas">';
    var i;
    for (i = 0; i < (n || 6); i++) {
      html +=
        '<div class="sk-idea">' +
        '<span class="sk-chip"></span>' +
        line('78%') +
        line('92%') +
        line('54%') +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function rows(n) {
    var html = '<div class="sk-rows" role="status" aria-label="Loading">';
    var i;
    for (i = 0; i < (n || 5); i++) {
      html += '<div class="sk-row">' + '<span class="sk-avatar"></span>' + '<div>' + line('70%') + line('46%') + '</div></div>';
    }
    html += '</div>';
    return html;
  }

  global.PreShootSkeleton = {
    card: card,
    list: list,
    ideaCards: ideaCards,
    rows: rows,
    line: line
  };
})(typeof window !== 'undefined' ? window : this);
