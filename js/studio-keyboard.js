/**
 * Studio mobile keyboard — overlay model (native iOS behaviour).
 * Layout never resizes for the keyboard; only scroll the active field into view.
 */
(function (global) {
  'use strict';

  var MOBILE_MAX = 899;
  var _lastScrollEl = null;
  var _lastScrollTop = null;

  function isMobile() {
    return global.innerWidth <= MOBILE_MAX;
  }

  function isStudioActive() {
    return global.S && global.S.tab === 'studio';
  }

  function isFocusableField(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    return type !== 'file' && type !== 'checkbox' && type !== 'radio' && type !== 'hidden' && type !== 'button';
  }

  function scrollContainerFor(el) {
    if (!el) return null;
    return el.closest('#studio-root') || el.closest('.sb');
  }

  function keyboardTopPx() {
    var vv = global.visualViewport;
    if (!vv) return global.innerHeight;
    return vv.offsetTop + vv.height;
  }

  function ensureFieldVisible(el, opts) {
    opts = opts || {};
    if (!el || !isFocusableField(el)) return;
    if (!opts.force && (!isMobile() || !isStudioActive())) return;

    var sc = scrollContainerFor(el);
    if (!sc) return;

    var run = function () {
      var rect = el.getBoundingClientRect();
      if (!rect.height) return;
      var pad = opts.padding != null ? opts.padding : 14;
      var kbTop = keyboardTopPx();
      var overlap = rect.bottom - kbTop + pad;
      if (overlap > 0) {
        sc.scrollTop += overlap;
        return;
      }
      var viewTop = global.visualViewport ? global.visualViewport.offsetTop : 0;
      var headerPad = 72;
      var topGap = rect.top - viewTop - headerPad;
      if (topGap < 0) {
        sc.scrollTop += topGap;
      }
    };

    requestAnimationFrame(function () {
      requestAnimationFrame(run);
    });
    setTimeout(run, 100);
    setTimeout(run, 280);
  }

  function rememberScroll() {
    var sc = global.document.getElementById('studio-root');
    if (!sc) return;
    _lastScrollEl = sc;
    _lastScrollTop = sc.scrollTop;
  }

  function onFocusIn(ev) {
    if (!isMobile() || !isStudioActive()) return;
    var el = ev.target;
    if (!isFocusableField(el)) return;
    rememberScroll();
    ensureFieldVisible(el);
  }

  function onFocusOut(ev) {
    if (!isMobile() || !isStudioActive()) return;
    /* Natural restore — no forced scroll jump when keyboard closes */
    _lastScrollEl = null;
    _lastScrollTop = null;
  }

  function bind() {
    global.document.addEventListener('focusin', onFocusIn, true);
    global.document.addEventListener('focusout', onFocusOut, true);
    if (global.visualViewport) {
      global.visualViewport.addEventListener(
        'resize',
        function () {
          var active = global.document.activeElement;
          if (active && isFocusableField(active) && isMobile() && isStudioActive()) {
            ensureFieldVisible(active, { force: true });
          }
        },
        { passive: true }
      );
    }
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.PreShootStudioKeyboard = {
    ensureVisible: ensureFieldVisible,
    isMobile: isMobile
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
