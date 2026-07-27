/**
 * KineticGrid — vanilla JS port of the 21st.dev React component.
 * Interactive warping grid background with cursor ripples.
 */
(function (global) {
  'use strict';

  var CELL_SIZE = 55;
  var INFLUENCE_RADIUS = 260;
  var MAX_WARP = 24;
  var DOT_SPACING = 28;
  var LERP_SPEED = 0.08;
  var LINE_BASE = { r: 255, g: 255, b: 255, a: 0.13 };
  var NODE_BASE_RADIUS = 1.8;
  var NODE_ACTIVE_RADIUS = 3.2;

  function lerpN(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(base, active, t) {
    var r = Math.round(lerpN(base.r, active.r, t));
    var g = Math.round(lerpN(base.g, active.g, t));
    var b = Math.round(lerpN(base.b, active.b, t));
    var a = lerpN(base.a, active.a, t);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }

  function KineticGrid(container, options) {
    options = options || {};
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) return;

    this.globalColor = options.globalColor || 'default';
    this.interactive = options.interactive !== false;
    this.fixed = options.fixed !== false;

    this.mouse = { x: -9999, y: -9999 };
    this.targetMouse = { x: -9999, y: -9999 };
    this.ripples = [];
    this.raf = 0;
    this.size = { w: 0, h: 0 };

    this._build();
    this._bind();
    this._animate = this._animate.bind(this);
    this.raf = requestAnimationFrame(this._animate);
  }

  KineticGrid.prototype._build = function () {
    this.container.classList.add('kinetic-grid-root');
    if (!this.container.style.position || this.container.style.position === 'static') {
      this.container.style.position = 'relative';
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'kinetic-grid-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText =
      'position:' + (this.fixed ? 'fixed' : 'absolute') +
      ';inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block;';

    var theme = this.globalColor === 'monochrome' ? '#000000' : '#121314';
    this.container.style.background = theme;

    if (this.container.firstChild) {
      this.container.insertBefore(this.canvas, this.container.firstChild);
    } else {
      this.container.appendChild(this.canvas);
    }

    Array.prototype.forEach.call(this.container.children, function (child) {
      if (child !== this.canvas && !child.classList.contains('kinetic-grid-layer')) {
        child.style.position = child.style.position || 'relative';
        child.style.zIndex = child.style.zIndex || '1';
      }
    }.bind(this));
  };

  KineticGrid.prototype._getTheme = function () {
    if (this.globalColor === 'monochrome') {
      return {
        bg: '#000000',
        lineActive: { r: 255, g: 255, b: 255, a: 0.9 },
        nodeActive: { r: 255, g: 255, b: 255, a: 1.0 },
        glow: '255,255,255',
        ripple: '255,255,255'
      };
    }
    return {
      bg: '#121314',
      lineActive: { r: 74, g: 158, b: 255, a: 0.9 },
      nodeActive: { r: 74, g: 158, b: 255, a: 1.0 },
      glow: '74,158,255',
      ripple: '100,180,255'
    };
  };

  KineticGrid.prototype._setSize = function () {
    var rect = this.fixed
      ? { width: window.innerWidth, height: window.innerHeight }
      : this.container.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width));
    var h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = w;
    this.canvas.height = h;
    this.size = { w: w, h: h };
  };

  KineticGrid.prototype._getWarpedPoint = function (gx, gy, col, row, cols, rows) {
    var edgeMargin = 1.5;
    var colPin = Math.min(col / edgeMargin, (cols - 1 - col) / edgeMargin, 1);
    var rowPin = Math.min(row / edgeMargin, (rows - 1 - row) / edgeMargin, 1);
    var pinFactor = colPin * colPin * rowPin * rowPin;

    var dx = gx - this.mouse.x;
    var dy = gy - this.mouse.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var proximity = Math.max(0, 1 - dist / INFLUENCE_RADIUS) * pinFactor;

    var rx = 0, ry = 0;
    for (var i = 0; i < this.ripples.length; i++) {
      var r = this.ripples[i];
      var rdx = gx - r.x;
      var rdy = gy - r.y;
      var rdist = Math.sqrt(rdx * rdx + rdy * rdy);
      var waveWidth = 55;
      var diff = rdist - r.radius;
      if (Math.abs(diff) < waveWidth) {
        var strength = (1 - Math.abs(diff) / waveWidth) * r.opacity * 18 * pinFactor;
        var angle = Math.atan2(rdy, rdx);
        var sign = diff < 0 ? -1 : 1;
        rx += Math.cos(angle) * strength * sign * -1;
        ry += Math.sin(angle) * strength * sign * -1;
      }
    }

    if (dist < INFLUENCE_RADIUS && dist > 0 && pinFactor > 0) {
      var t = dist / INFLUENCE_RADIUS;
      var eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
      var warpAmt = eased * MAX_WARP * pinFactor;
      var angle2 = Math.atan2(dy, dx);
      return {
        pt: {
          x: gx - Math.cos(angle2) * warpAmt + rx,
          y: gy - Math.sin(angle2) * warpAmt + ry
        },
        proximity: proximity
      };
    }

    return { pt: { x: gx + rx, y: gy + ry }, proximity: proximity };
  };

  KineticGrid.prototype._draw = function (now) {
    var ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    var W = this.size.w;
    var H = this.size.h;
    var theme = this._getTheme();

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (var x = DOT_SPACING / 2; x < W; x += DOT_SPACING) {
      for (var y = DOT_SPACING / 2; y < H; y += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (var ri = this.ripples.length - 1; ri >= 0; ri--) {
      var ripple = this.ripples[ri];
      var age = (now - ripple.born) / 1000;
      ripple.radius = Math.max(0, age * 400);
      ripple.opacity = Math.max(0, 1 - age * 1.2);
      if (ripple.opacity <= 0) this.ripples.splice(ri, 1);
    }

    var cols = Math.max(2, Math.ceil(W / CELL_SIZE)) + 1;
    var rows = Math.max(2, Math.ceil(H / CELL_SIZE)) + 1;
    var cellW = W / (cols - 1);
    var cellH = H / (rows - 1);
    var pts = [];
    var prox = [];

    for (var row = 0; row < rows; row++) {
      pts[row] = [];
      prox[row] = [];
      for (var col = 0; col < cols; col++) {
        var warped = this._getWarpedPoint(col * cellW, row * cellH, col, row, cols, rows);
        pts[row][col] = warped.pt;
        prox[row][col] = warped.proximity;
      }
    }

    var self = this;
    function drawSeg(p1, p2, pr1, pr2) {
      var avg = (pr1 + pr2) / 2;
      var t = avg * avg * (3 - 2 * avg);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = lerpColor(LINE_BASE, theme.lineActive, t);
      ctx.lineWidth = lerpN(0.8, 1.5, t);
      ctx.stroke();
    }

    ctx.lineCap = 'butt';
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols - 1; c2++) {
        drawSeg(pts[r2][c2], pts[r2][c2 + 1], prox[r2][c2], prox[r2][c2 + 1]);
      }
    }
    for (var c3 = 0; c3 < cols; c3++) {
      for (var r3 = 0; r3 < rows - 1; r3++) {
        drawSeg(pts[r3][c3], pts[r3 + 1][c3], prox[r3][c3], prox[r3 + 1][c3]);
      }
    }

    for (var r4 = 0; r4 < rows; r4++) {
      for (var c4 = 0; c4 < cols; c4++) {
        var p = pts[r4][c4];
        var pr = prox[r4][c4];
        var t2 = pr * pr * (3 - 2 * pr);
        var nr = lerpN(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, t2);

        if (t2 > 0.3) {
          var glowR = nr + lerpN(0, 6, (t2 - 0.3) / 0.7);
          var grd = ctx.createRadialGradient(p.x, p.y, nr * 0.5, p.x, p.y, glowR);
          grd.addColorStop(0, 'rgba(' + theme.glow + ',' + (t2 * 0.3).toFixed(3) + ')');
          grd.addColorStop(1, 'rgba(' + theme.glow + ',0)');
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, nr, 0, Math.PI * 2);
        ctx.fillStyle = lerpColor(
          { r: 255, g: 255, b: 255, a: 0.2 },
          theme.nodeActive,
          t2
        );
        ctx.fill();
      }
    }

    for (var ri2 = 0; ri2 < this.ripples.length; ri2++) {
      var rp = this.ripples[ri2];
      var safeRadius = Math.max(0, rp.radius);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, safeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + theme.ripple + ',' + (rp.opacity * 0.28).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  KineticGrid.prototype._animate = function (now) {
    this.mouse.x = lerpN(this.mouse.x, this.targetMouse.x, LERP_SPEED);
    this.mouse.y = lerpN(this.mouse.y, this.targetMouse.y, LERP_SPEED);
    this._draw(now);
    this.raf = requestAnimationFrame(this._animate);
  };

  KineticGrid.prototype._pointerLocal = function (e) {
    if (this.fixed) {
      return { x: e.clientX, y: e.clientY };
    }
    var rect = this.container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  KineticGrid.prototype._onMouseMove = function (e) {
    if (!this.interactive) return;
    var p = this._pointerLocal(e);
    this.targetMouse.x = p.x;
    this.targetMouse.y = p.y;
  };

  KineticGrid.prototype._onClick = function (e) {
    if (!this.interactive) return;
    var p = this._pointerLocal(e);
    this.ripples.push({
      x: p.x,
      y: p.y,
      radius: 0,
      opacity: 1,
      born: performance.now()
    });
  };

  KineticGrid.prototype._onResize = function () {
    this._setSize();
  };

  KineticGrid.prototype._bind = function () {
    this._setSize();
    this._onResizeBound = this._onResize.bind(this);
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onClickBound = this._onClick.bind(this);

    window.addEventListener('resize', this._onResizeBound);
    if (this.interactive) {
      window.addEventListener('mousemove', this._onMouseMoveBound);
      window.addEventListener('click', this._onClickBound);
    }

    if (!this.fixed && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResizeBound);
      this._ro.observe(this.container);
    }
  };

  KineticGrid.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResizeBound);
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('click', this._onClickBound);
    if (this._ro) this._ro.disconnect();
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  };

  global.KineticGrid = KineticGrid;
})(typeof window !== 'undefined' ? window : this);
