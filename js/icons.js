/**
 * PreShoot SVG icon helpers (no emoji).
 * Usage: ICO.html('camera', 18), ICO.camera, ICO.brand('tiktok', 22)
 *
 * Style: 24×24 viewBox, stroke currentColor 1.8 (UI icons).
 * Brand marks use fill currentColor for recognition in mono UI.
 */
(function (global) {
  'use strict';

  var ATTR =
    ' xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  var FILL_ATTR =
    ' xmlns="http://www.w3.org/2000/svg" fill="currentColor" stroke="none" aria-hidden="true"';

  function svg(size, body, fill) {
    size = size || 20;
    return (
      '<svg class="ico-svg" width="' +
      size +
      '" height="' +
      size +
      '" viewBox="0 0 24 24"' +
      (fill ? FILL_ATTR : ATTR) +
      '>' +
      body +
      '</svg>'
    );
  }

  var PATHS = {
    camera:
      '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    lens:
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    drone:
      '<path d="M12 10v4M9 14h6"/><rect x="10" y="11" width="4" height="3" rx="0.6"/><path d="M6 8l3 3M18 8l-3 3M6 16l3-3M18 16l-3-3"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/>',
    mic:
      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6"/>',
    light:
      '<path d="M9 18h6M10 21h4"/><path d="M12 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z"/>',
    gimbal:
      '<circle cx="12" cy="8" r="3"/><path d="M12 11v4M9 19h6M12 15l-3 4M12 15l3 4"/><path d="M7 8H5M19 8h-2"/>',
    tripod:
      '<circle cx="12" cy="6" r="2.5"/><path d="M12 8.5V12M12 12 7 20M12 12l5 8M9 12h6"/>',
    actionCam:
      '<rect x="3" y="8" width="14" height="9" rx="2"/><circle cx="10" cy="12.5" r="2.5"/><path d="M17 11h3v4h-3"/>',
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
    history:
      '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2M4.5 7.5 3 5M3 5h3.5"/>',
    trash: '<path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"/>',
    export: '<path d="M12 3v10M8 7l4-4 4 4M5 14v5h14v-5"/>',
    lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
    file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
    chat: '<path d="M5 6h14v9H9l-4 3V6z"/>',
    image:
      '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4 16l4-3 3 2 4-4 5 5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    arrowLeft: '<path d="M14 6l-6 6 6 6M8 12h11"/>',
    arrowRight: '<path d="M10 6l6 6-6 6M6 12h11"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    send: '<path d="M4 12l15-7-4 7 4 7-15-7z"/><path d="M9 12h6"/>',
    hook: '<path d="M12 3v8a4 4 0 1 0 4 4"/><circle cx="12" cy="3" r="1.2" fill="currentColor" stroke="none"/>',
    music: '<path d="M10 18V7l9-2v9"/><circle cx="8" cy="18" r="2.5"/><circle cx="17" cy="14" r="2.5"/>',
    zap: '<path d="M13 3 6 13h5l-1 8 8-11h-5l1-7z"/>',
    user: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/>',
    users:
      '<circle cx="9" cy="9" r="3"/><path d="M3.5 18a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M14 18a4.5 4.5 0 0 1 6.5 0"/>',
    bookmark: '<path d="M7 4h10v16l-5-3-5 3V4z"/>',
    menu: '<path d="M5 8h14M5 12h14M5 16h14"/>',
    upload: '<path d="M12 16V5M8 8l4-4 4 4M5 19h14"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon: '<path d="M19 13.5A7.5 7.5 0 1 1 10.5 5 6 6 0 0 0 19 13.5z"/>',
    wand: '<path d="M5 19 15 9M13.5 7.5l1.5-1.5 2 2-1.5 1.5"/><path d="M16 4l.5 1.5L18 6l-1.5.5L16 8l-.5-1.5L14 6l1.5-.5L16 4z"/>',
    building:
      '<path d="M4 20h16M6 20V6l6-3 6 3v14"/><path d="M9 10h1M14 10h1M9 14h1M14 14h1M11 20v-4h2v4"/>',
    cart:
      '<path d="M4 5h2l2 11h10l2-8H7"/><circle cx="10" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
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
    softbox:
      '<rect x="7" y="4" width="10" height="12" rx="1"/><path d="M9 16v3M15 16v3M8 20h8"/>',
    handheld:
      '<path d="M10 4h4v8l2 6H8l2-6V4z"/><path d="M9 8h6"/>',
    car:
      '<path d="M4 14h16l-1.5-5.5A2 2 0 0 0 16.6 7H7.4a2 2 0 0 0-1.9 1.5L4 14z"/><path d="M4 14v3h2.5M20 14v3h-2.5"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
    quality:
      '<path d="M12 3l2.2 4.5L19 8.5l-3.5 3.4.8 4.8L12 14.5 7.7 16.7l.8-4.8L5 8.5l4.8-1L12 3z"/>',
    engagement:
      '<path d="M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>',
    clients:
      '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><path d="M12 13v2"/>',
    brand:
      '<path d="M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/>',
    cinematic:
      '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 9h18M3 15h18M8 6v12M16 6v12"/>',
    moody: '<path d="M19 13.5A7.5 7.5 0 1 1 10.5 5 6 6 0 0 0 19 13.5z"/>',
    minimal:
      '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M5 12h14"/>',
    luxury:
      '<path d="M6 9h12l-1.5 9H7.5L6 9z"/><path d="M9 9 12 4l3 5"/>',
    street:
      '<path d="M4 19V9l4-4h8l4 4v10"/><path d="M9 19v-5h6v5M4 12h16"/>',
    vintage:
      '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5M8 5.5 6 4M16 5.5 18 4"/>',
    colorful:
      '<circle cx="9" cy="10" r="3"/><circle cx="15" cy="10" r="3"/><circle cx="12" cy="15" r="3"/>',
    documentary:
      '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="10" cy="11" r="2"/><path d="M4 16l4-3 3 2 3-3 6 4"/>',
    surreal:
      '<circle cx="12" cy="12" r="8"/><path d="M8 12c0-2 1.5-3 4-3s4 1 4 3-1.5 3-4 3-4-1-4-3z"/>',
    naturalLight: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2"/>',
    artificialLight: '<path d="M9 18h6M10 21h4"/><path d="M12 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z"/>',
    goldenHour: '<circle cx="12" cy="14" r="4"/><path d="M4 18h16M8 10l1.5 2M16 10 14.5 12M12 7v2"/>',
    neon: '<path d="M7 8h10M7 12h10M7 16h7"/><path d="M5 6v12M19 6v8"/>',
    lowKey: '<path d="M19 13.5A7.5 7.5 0 1 1 10.5 5 6 6 0 0 0 19 13.5z"/>',
    highKey: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    mixedLight: '<path d="M4 18h16M8 10l4-5 4 5"/><circle cx="12" cy="13" r="2.5"/>',
    slowPace: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2 2"/>',
    mediumPace: '<path d="M5 12h14M13 8l4 4-4 4"/>',
    fastPace: '<path d="M13 3 6 13h5l-1 8 8-11h-5l1-7z"/>',
  };

  /* Official-style brand marks — monochrome fill, recognizable silhouettes */
  var BRANDS = {
    tiktok:
      '<path d="M14.5 3c.4 2.2 1.7 3.9 3.8 4.5v2.5c-1.4-.1-2.7-.6-3.8-1.4v5.7a5.3 5.3 0 1 1-5.3-5.3c.3 0 .6 0 .9.1v2.7a2.6 2.6 0 1 0 1.8 2.5V3h2.6z"/>',
    instagram:
      '<path d="M12 7.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2z"/><circle cx="17.3" cy="6.7" r="1.15"/><path d="M16.7 3H7.3A4.3 4.3 0 0 0 3 7.3v9.4A4.3 4.3 0 0 0 7.3 21h9.4a4.3 4.3 0 0 0 4.3-4.3V7.3A4.3 4.3 0 0 0 16.7 3zm2.6 13.7a2.6 2.6 0 0 1-2.6 2.6H7.3a2.6 2.6 0 0 1-2.6-2.6V7.3A2.6 2.6 0 0 1 7.3 4.7h9.4a2.6 2.6 0 0 1 2.6 2.6v9.4z"/>',
    youtube:
      '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15.2V8.8l5.2 3.2L10 15.2z"/>',
    shorts:
      '<path d="M17.5 3.5 6.5 8.2v7.6l11 4.7V3.5z"/><path d="M10.2 9.6v4.8l4.1-2.4-4.1-2.4z"/>',
    facebook:
      '<path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v6h3v-6h2.5l.5-3H13v-2c0-.6.4-1 1-1z"/>',
    x: '<path d="M4 4h4.2l4.1 5.8L17.3 4H20l-6.2 7.1L20.5 20H16.3l-4.5-6.3L7 20H4.2l6.6-7.5L4 4z"/>',
    threads:
      '<path d="M16.8 11.2c-.2-3.2-1.9-5-4.7-5-2.9 0-4.9 2.1-4.9 5.4 0 4 2.3 6 5.4 6 1.7 0 3.2-.5 4.2-1.3l-.8-1.5c-.8.6-1.9 1-3.3 1-2.2 0-3.6-1.3-3.6-3.8v-.1c.5.6 1.4 1 2.5 1 2.2 0 3.7-1.5 3.7-3.7 0-1.8-1.1-3-2.8-3-1.5 0-2.6.9-2.9 2.2.4-.2.8-.3 1.3-.3.9 0 1.5.5 1.5 1.3 0 1.4-1.5 2.4-1.5 2.4s-1.5-.9-1.5-2.6c0-2.4 1.9-4.2 4.6-4.2 2.9 0 5 1.9 5 5.1 0 .7-.1 1.4-.2 2H12.4c.1 1.4 1.1 2.2 2.5 2.2.8 0 1.5-.3 2-.7l.9 1.6c-.8.7-2 1.2-3.3 1.2-2.4 0-4-1.5-4.1-3.7h7.4z"/>',
    linkedin:
      '<path d="M6.5 9.5H3.7V20h2.8V9.5zM5.1 4A1.7 1.7 0 1 0 5.1 7.4 1.7 1.7 0 0 0 5.1 4zM20.3 20h-2.8v-5.6c0-1.5-.6-2.5-2-2.5-1.1 0-1.7.7-2 1.4-.1.3-.1.6-.1.9V20h-2.8s.1-9.3 0-10.5h2.8v1.7c.5-.8 1.5-2 3.6-2 2.5 0 4.3 1.6 4.3 5.1V20z"/>',
    pinterest:
      '<path d="M12 3a9 9 0 0 0-3.3 17.4c-.1-.7-.2-1.8 0-2.6l1.2-5.1s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.5 2.1-.8 3.3-.2.9.5 1.7 1.4 1.7 1.7 0 2.9-2.2 2.9-4.7 0-1.9-1.3-3.4-3.7-3.4-2.7 0-4.4 2-4.4 4.3 0 .8.2 1.4.6 1.9l.1.2-.2.9c0 .1-.1.2-.3.1-1.2-.5-1.8-1.9-1.8-3.4 0-2.5 2.1-5.5 6.3-5.5 3.4 0 5.6 2.4 5.6 5.1 0 3.5-1.9 6.1-4.8 6.1-1 0-1.9-.5-2.2-1.1l-.6 2.3c-.2.8-.7 1.7-1.1 2.3A9 9 0 1 0 12 3z"/>',
    snapchat:
      '<path d="M12 3c2.4 0 4.3 1.7 4.5 4.2.1.8.2 2.1.3 2.9.4.2 1 .5 1.6.4.5-.1.9-.4 1.1-.5.3-.2.6-.1.7.2.2.5-.2 1.1-1 1.6-.5.3-1.1.5-1.5.7 0 .2.1.7.2 1.1.2.7.4 1.5.9 2 .4.4.6.7.5 1.1-.1.4-.5.6-1 .6-.3 0-.7-.1-1.1-.2-.5-.1-1-.3-1.6-.3-.4 0-.8.1-1.3.3-.7.3-1.4.6-2.3.6s-1.6-.3-2.3-.6c-.5-.2-.9-.3-1.3-.3-.6 0-1.1.2-1.6.3-.4.1-.8.2-1.1.2-.5 0-.9-.2-1-.6-.1-.4.1-.7.5-1.1.5-.5.7-1.3.9-2 .1-.4.2-.9.2-1.1-.4-.2-1-.4-1.5-.7-.8-.5-1.2-1.1-1-1.6.1-.3.4-.4.7-.2.2.1.6.4 1.1.5.6.1 1.2-.2 1.6-.4.1-.8.2-2.1.3-2.9C7.7 4.7 9.6 3 12 3z"/>',
    reels:
      '<path d="M7.3 3h9.4A4.3 4.3 0 0 1 21 7.3v9.4A4.3 4.3 0 0 1 16.7 21H7.3A4.3 4.3 0 0 1 3 16.7V7.3A4.3 4.3 0 0 1 7.3 3zm0 1.7a2.6 2.6 0 0 0-2.6 2.6v9.4a2.6 2.6 0 0 0 2.6 2.6h9.4a2.6 2.6 0 0 0 2.6-2.6V7.3a2.6 2.6 0 0 0-2.6-2.6H7.3z"/><path d="M8 8.5h8v1.2l-2.2 2.2H8V8.5zm0 4.5h5.2L16 15.5V17H8v-4z"/>',
  };

  var GEAR_MAP = {
    camera: 'camera',
    lens: 'lens',
    drone: 'drone',
    microphone: 'mic',
    mic: 'mic',
    lighting: 'light',
    lights: 'light',
    gimbal: 'gimbal',
    tripod: 'tripod',
    action: 'actionCam',
    phone: 'phone',
    software: 'film',
    editingSoftware: 'film',
  };

  var PLATFORM_MAP = {
    tiktok: 'tiktok',
    reels: 'reels',
    shorts: 'shorts',
    youtube: 'youtube',
    twitter: 'x',
    x: 'x',
    linkedin: 'linkedin',
    pinterest: 'pinterest',
    facebook: 'facebook',
    threads: 'threads',
    snapchat: 'snapchat',
    instagram: 'instagram',
  };

  var GOAL_MAP = {
    'Grow Followers': 'megaphone',
    'Improve Quality': 'quality',
    'Increase Engagement': 'engagement',
    'Get Clients': 'clients',
    'Build Brand': 'brand',
    'Sell Products/Services': 'cart',
  };

  var ICO = {
    html: function (name, size) {
      var body = PATHS[name];
      if (!body) return '';
      return svg(size, body, false);
    },
    brand: function (name, size) {
      var key = PLATFORM_MAP[name] || name;
      var body = BRANDS[key];
      if (!body) return this.html(key, size);
      return svg(size, body, true);
    },
    gear: function (cat, size) {
      return this.html(GEAR_MAP[cat] || cat || 'gear', size);
    },
    goal: function (title, size) {
      return this.html(GOAL_MAP[title] || 'target', size);
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
        return svg(20, PATHS[k], false);
      },
    });
  });

  function hydrateIcons(root) {
    root = root || document;
    root.querySelectorAll('[data-ico]').forEach(function (el) {
      var name = el.getAttribute('data-ico');
      var size = parseInt(el.getAttribute('data-ico-size') || '18', 10);
      if (!name) return;
      el.innerHTML = ICO.html(name, size);
      el.removeAttribute('data-ico');
    });
    root.querySelectorAll('[data-brand]').forEach(function (el) {
      var name = el.getAttribute('data-brand');
      var size = parseInt(el.getAttribute('data-ico-size') || '22', 10);
      if (!name) return;
      el.innerHTML = ICO.brand(name, size);
      el.removeAttribute('data-brand');
    });
    root.querySelectorAll('[data-gear-ico]').forEach(function (el) {
      var cat = el.getAttribute('data-gear-ico');
      var size = parseInt(el.getAttribute('data-ico-size') || '18', 10);
      if (!cat) return;
      el.innerHTML = ICO.gear(cat, size);
      el.removeAttribute('data-gear-ico');
    });
  }

  ICO.hydrate = hydrateIcons;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        hydrateIcons(document);
      });
    } else {
      hydrateIcons(document);
    }
  }

  global.ICO = ICO;
  global.PRESHOOT_ICON_PATHS = PATHS;
  global.PRESHOOT_BRAND_PATHS = BRANDS;
  global.PRESHOOT_GEAR_ICONS = GEAR_MAP;
  global.PRESHOOT_PLATFORM_ICONS = PLATFORM_MAP;
  global.PRESHOOT_GOAL_ICONS = GOAL_MAP;
})(typeof window !== 'undefined' ? window : this);
