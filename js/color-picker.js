/**
 * PreShoot accent / palette colour picker (vanilla).
 * HSV square + hue slider + hex field. No gradients in app chrome —
 * the picker itself uses canvas fills only for colour selection UX.
 */
(function (global) {
  'use strict';

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hexToHsv(hex) {
    hex = String(hex || '#4A9EFF').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.slice(0, 2), 16) / 255;
    var g = parseInt(hex.slice(2, 4), 16) / 255;
    var b = parseInt(hex.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d > 1e-9) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var s = max < 1e-9 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHex(r, g, b) {
    function p(n) {
      var s = clamp(n, 0, 255).toString(16).toUpperCase();
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + p(r) + p(g) + p(b);
  }

  function hsvToHex(h, s, v) {
    var rgb = hsvToRgb(h, s, v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function normalizeHex(hex) {
    if (!hex) return null;
    var h = String(hex).trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toUpperCase();
  }

  function ColorPicker(root, options) {
    options = options || {};
    this.root = typeof root === 'string' ? document.querySelector(root) : root;
    if (!this.root) return;
    this.onChange = options.onChange || function () {};
    this.hsv = hexToHsv(options.color || '#4A9EFF');
    this._dragging = null;
    this._build();
    this.setHex(hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v), true);
  }

  ColorPicker.prototype._build = function () {
    this.root.innerHTML =
      '<div class="cp-wrap">' +
      '<div class="cp-sv" tabindex="0"><canvas class="cp-sv-canvas"></canvas><div class="cp-sv-cursor"></div></div>' +
      '<div class="cp-hue" tabindex="0"><canvas class="cp-hue-canvas"></canvas><div class="cp-hue-cursor"></div></div>' +
      '<div class="cp-meta">' +
      '<div class="cp-preview"></div>' +
      '<input class="cp-hex" type="text" maxlength="7" spellcheck="false" aria-label="Hex colour">' +
      '</div>' +
      '</div>';

    this.svEl = this.root.querySelector('.cp-sv');
    this.svCanvas = this.root.querySelector('.cp-sv-canvas');
    this.svCursor = this.root.querySelector('.cp-sv-cursor');
    this.hueEl = this.root.querySelector('.cp-hue');
    this.hueCanvas = this.root.querySelector('.cp-hue-canvas');
    this.hueCursor = this.root.querySelector('.cp-hue-cursor');
    this.preview = this.root.querySelector('.cp-preview');
    this.hexInput = this.root.querySelector('.cp-hex');

    var self = this;
    function bindDrag(el, kind) {
      function start(e) {
        e.preventDefault();
        self._dragging = kind;
        self._pointer(kind, e);
      }
      el.addEventListener('mousedown', start);
      el.addEventListener('touchstart', start, { passive: false });
    }
    bindDrag(this.svEl, 'sv');
    bindDrag(this.hueEl, 'hue');

    window.addEventListener('mousemove', function (e) {
      if (!self._dragging) return;
      self._pointer(self._dragging, e);
    });
    window.addEventListener('touchmove', function (e) {
      if (!self._dragging) return;
      self._pointer(self._dragging, e);
    }, { passive: false });
    window.addEventListener('mouseup', function () { self._dragging = null; });
    window.addEventListener('touchend', function () { self._dragging = null; });

    this.hexInput.addEventListener('change', function () {
      var hex = normalizeHex(self.hexInput.value);
      if (hex) self.setHex(hex);
      else self.hexInput.value = self.getHex();
    });
    this.hexInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        self.hexInput.blur();
      }
    });

    this._resize();
    window.addEventListener('resize', function () { self._resize(); });
  };

  ColorPicker.prototype._resize = function () {
    var svW = this.svEl.clientWidth || 240;
    var svH = Math.round(svW * 0.55);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.svCanvas.width = Math.round(svW * dpr);
    this.svCanvas.height = Math.round(svH * dpr);
    this.svCanvas.style.width = svW + 'px';
    this.svCanvas.style.height = svH + 'px';
    this.svEl.style.height = svH + 'px';

    var hueW = this.hueEl.clientWidth || svW;
    var hueH = 14;
    this.hueCanvas.width = Math.round(hueW * dpr);
    this.hueCanvas.height = Math.round(hueH * dpr);
    this.hueCanvas.style.width = hueW + 'px';
    this.hueCanvas.style.height = hueH + 'px';

    this._paint();
    this._syncCursors();
  };

  ColorPicker.prototype._paint = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var sv = this.svCanvas.getContext('2d');
    var w = this.svCanvas.width;
    var h = this.svCanvas.height;
    var base = hsvToHex(this.hsv.h, 1, 1);
    sv.clearRect(0, 0, w, h);
    /* White → hue */
    var g1 = sv.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, '#ffffff');
    g1.addColorStop(1, base);
    sv.fillStyle = g1;
    sv.fillRect(0, 0, w, h);
    /* Transparent → black */
    var g2 = sv.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, '#000000');
    sv.fillStyle = g2;
    sv.fillRect(0, 0, w, h);

    var hue = this.hueCanvas.getContext('2d');
    var hw = this.hueCanvas.width;
    var hh = this.hueCanvas.height;
    var hg = hue.createLinearGradient(0, 0, hw, 0);
    for (var i = 0; i <= 6; i++) {
      hg.addColorStop(i / 6, hsvToHex(i * 60, 1, 1));
    }
    hue.clearRect(0, 0, hw, hh);
    hue.fillStyle = hg;
    hue.fillRect(0, 0, hw, hh);
  };

  ColorPicker.prototype._syncCursors = function () {
    var svW = this.svEl.clientWidth || 1;
    var svH = this.svEl.clientHeight || 1;
    this.svCursor.style.left = (this.hsv.s * svW) + 'px';
    this.svCursor.style.top = ((1 - this.hsv.v) * svH) + 'px';
    var hueW = this.hueEl.clientWidth || 1;
    this.hueCursor.style.left = ((this.hsv.h / 360) * hueW) + 'px';
    var hex = this.getHex();
    this.preview.style.background = hex;
    if (document.activeElement !== this.hexInput) this.hexInput.value = hex;
  };

  ColorPicker.prototype._pointer = function (kind, e) {
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    if (kind === 'sv') {
      var r = this.svEl.getBoundingClientRect();
      this.hsv.s = clamp((t.clientX - r.left) / r.width, 0, 1);
      this.hsv.v = clamp(1 - (t.clientY - r.top) / r.height, 0, 1);
    } else {
      var hr = this.hueEl.getBoundingClientRect();
      this.hsv.h = clamp(((t.clientX - hr.left) / hr.width) * 360, 0, 359.999);
      this._paint();
    }
    this._syncCursors();
    this.onChange(this.getHex());
  };

  ColorPicker.prototype.getHex = function () {
    return hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
  };

  ColorPicker.prototype.setHex = function (hex, silent) {
    var n = normalizeHex(hex);
    if (!n) return;
    this.hsv = hexToHsv(n);
    this._paint();
    this._syncCursors();
    if (!silent) this.onChange(n);
  };

  global.PreShootColorPicker = ColorPicker;
  global.PreShootColor = {
    hexToHsv: hexToHsv,
    hsvToHex: hsvToHex,
    normalizeHex: normalizeHex
  };
})(typeof window !== 'undefined' ? window : this);
