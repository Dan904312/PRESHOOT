/**
 * PreShoot SVG icon helpers (no emoji).
 * Usage: ICO.camera, ICO.html('camera', 18), etc.
 */
(function (global) {
  'use strict';

  var ATTR =
    ' xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  function svg(size, body) {
    size = size || 20;
    return (
      '<svg class="ico-svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24"' +
      ATTR +
      '>' +
      body +
      '</svg>'
    );
  }

  var PATHS = {
    camera:
      '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    target:
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    film:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    play: '<polygon points="9,7 17,12 9,17" fill="currentColor" stroke="none"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .3-8A6 6 0 0 0 6.2 12 3.5 3.5 0 0 0 7 18z"/>',
    phone:
      '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
    home: '<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    x: '<path d="M7 7l10 10M17 7 7 17"/>',
    megaphone:
      '<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M14 9.5a3.5 3.5 0 0 1 0 5"/><path d="M7 14l-1 5h3"/>',
    book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4z"/><path d="M5 18h11"/>',
    flame: '<path d="M12 3s5 4.5 5 9a5 5 0 1 1-10 0c0-2.5 1.8-4.5 3-6 0 2 1 3 2 3z"/>',
    theater:
      '<path d="M4 8c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><path d="M5 12c1.5 1.5 3 1.5 4.5 0S13 10.5 14.5 12 17 13.5 19 12"/><path d="M6 16c1 1 2 1 3 0s2-1 3 0 2 1 3 0 2-1 3 0"/>',
    clapper:
      '<path d="M3 9h18v11H3z"/><path d="M3 9l4-5 3 2.2L13 4l3 2.2L20 4"/><path d="M3 13h18"/>',
    director:
      '<path fill-rule="evenodd" d="M6.4 5.8c0-.66.54-1.2 1.2-1.2h6c.66 0 1.2.54 1.2 1.2v1.7h.4c1.1 0 2 .9 2 2v7.2c0 1.1-.9 2-2 2H5.2c-1.1 0-2-.9-2-2v-7.2c0-1.1.9-2 2-2h1.2V5.8zm2.5 5.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm4.2 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z" fill="currentColor" stroke="none"/><path d="M15.6 10.2 21.2 7.6v12.8l-5.6-2.6V10.2z" fill="currentColor" stroke="none"/>',
    smile:
      '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M8.5 14.5S10 16.5 12 16.5s3.5-2 3.5-2"/>',
    pencil: '<path d="M13 5l6 6M4 20l1.5-5.5L15 5l4 4L9.5 18.5 4 20z"/>',
    infinity: '<path d="M7 12c0-2.5 2-4.5 4.5-2.5S16.5 7 18 9.5 16 16.5 12.5 14.5 7 17 7 12z"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11M5 7h.01M5 12h.01M5 17h.01"/>',
    brain:
      '<path d="M9.5 5a3 3 0 0 0-3 3v1A2.5 2.5 0 0 0 5 11.5V14a3 3 0 0 0 3 3h.5M14.5 5a3 3 0 0 1 3 3v1A2.5 2.5 0 0 1 19 11.5V14a3 3 0 0 1-3 3H15M9.5 5A2.5 2.5 0 0 1 12 3a2.5 2.5 0 0 1 2.5 2M8.5 17v2M15.5 17v2M12 11v8"/>',
    sparkles:
      '<path d="M12 3l1.2 4.2L17.5 8.5 13.2 9.8 12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3z"/><path d="M18.5 14l.6 2.1 2.1.6-2.1.6-.6 2.1-.6-2.1-2.1-.6 2.1-.6.6-2.1z"/>',
    bell: '<path d="M7 17h10l-1-1.5V11a4 4 0 1 0-8 0v4.5L7 17z"/><path d="M10.5 19a1.5 1.5 0 0 0 3 0"/>',
    chart: '<path d="M4 19h16M7 16V10M12 16V6M17 16v-4"/>',
    trash: '<path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"/>',
    export: '<path d="M12 3v10M8 7l4-4 4 4M5 14v5h14v-5"/>',
    lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
    file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
    chat: '<path d="M5 6h14v9H9l-4 3V6z"/>',
    image:
      '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4 16l4-3 3 2 4-4 5 5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    arrowLeft: '<path d="M14 6l-6 6 6 6M8 12h11"/>',
    send: '<path d="M4 12l15-7-4 7 4 7-15-7z"/><path d="M9 12h6"/>',
    hook: '<path d="M12 3v8a4 4 0 1 0 4 4"/><circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none"/>',
    music: '<path d="M10 18V7l9-2v9"/><circle cx="8" cy="18" r="2.5"/><circle cx="17" cy="14" r="2.5"/>',
    zap: '<path d="M13 3 6 13h5l-1 8 8-11h-5l1-7z"/>',
    user: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/>',
    bookmark: '<path d="M7 4h10v16l-5-3-5 3V4z"/>',
    menu: '<path d="M5 8h14M5 12h14M5 16h14"/>',
    upload: '<path d="M12 16V5M8 8l4-4 4 4M5 19h14"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
    discord:
      '<path d="M8 8.5c3-1.5 5-1.5 8 0M8.5 15.5s.8 1.2 3.5 1.2 3.5-1.2 3.5-1.2"/><circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M6.5 7C8 5 10 4.5 12 4.5S16 5 17.5 7c1.2 2.2 1.7 5.2 1.5 7.5-1.3 1-2.8 1.7-4.5 2.1L13.5 19l-1-2.2c-.5.1-1 .1-1.5 0L10 19l-1-2.4c-1.7-.4-3.2-1.1-4.5-2.1C4.3 12.2 4.8 9.2 6.5 7z"/>',
    instagram:
      '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    palette:
      '<path d="M12 4a8 8 0 1 0 0 16h1.5a2 2 0 0 0 0-4H13a1.5 1.5 0 0 1 0-3h3A8 8 0 0 0 12 4z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="7.5" r="1" fill="currentColor" stroke="none"/>',
    gear:
      '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"/>',
    infinite:
      '<path d="M8 12c0-2.2 1.8-4 4-2.2S16.2 6 18 8.5 15.5 16.5 12 14.2 8 16.5 8 12z"/>',
  };

  var ICO = {
    html: function (name, size) {
      var body = PATHS[name];
      if (!body) return '';
      return svg(size, body);
    },
    wrap: function (name, size, className) {
      return (
        '<span class="' +
        (className || 'ico-wrap') +
        '">' +
        this.html(name, size) +
        '</span>'
      );
    },
  };

  Object.keys(PATHS).forEach(function (k) {
    Object.defineProperty(ICO, k, {
      get: function () {
        return svg(20, PATHS[k]);
      },
    });
  });

  global.ICO = ICO;
  global.PRESHOOT_ICON_PATHS = PATHS;
})(typeof window !== 'undefined' ? window : this);
