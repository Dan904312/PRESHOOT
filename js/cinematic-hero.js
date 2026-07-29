/**
 * PreShoot cinematic landing hero — vanilla port of the GSAP scroll experience.
 * Keeps KineticGrid as the interactive background (mouse warp + click ripples).
 */
(function (global) {
  'use strict';

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function getViewportHeight() {
    if (window.visualViewport && window.visualViewport.height) {
      return window.visualViewport.height;
    }
    return window.innerHeight;
  }

  function runAnythingSync(el) {
    if (!el || prefersReducedMotion()) return function () {};

    var CYCLE_MS = 2800;
    var PAUSE_BEFORE = 0.12;
    var WIPE_SPAN = 0.38;
    var W_START = -0.2;
    var W_END = 1.2;
    var SCALE_MAX = 1.05;
    var EDGE = 0.1;
    var t0 = performance.now();
    var raf = 0;
    var stopped = false;

    function tick(now) {
      if (stopped) return;
      var u = ((now - t0) % CYCLE_MS) / CYCLE_MS;
      var w = W_START;
      var scale = 1;
      var glow = 0;
      if (u >= PAUSE_BEFORE && u < PAUSE_BEFORE + WIPE_SPAN) {
        var t = (u - PAUSE_BEFORE) / WIPE_SPAN;
        w = W_START + (W_END - W_START) * t;
        if (t < EDGE) {
          scale = 1 + (SCALE_MAX - 1) * (t / EDGE);
        } else if (t > 1 - EDGE) {
          scale = 1 + (SCALE_MAX - 1) * ((1 - t) / EDGE);
        } else {
          scale = SCALE_MAX;
        }
        glow = scale > 1 ? (scale - 1) / (SCALE_MAX - 1) : 0;
      }
      el.style.setProperty('--w', w.toFixed(4));
      el.style.setProperty('--glow', glow.toFixed(3));
      el.style.transform = 'scale(' + scale.toFixed(4) + ')';
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }

  function initCinematicHero(root) {
    if (!root || !global.gsap || !global.ScrollTrigger) return;

    var gsap = global.gsap;
    gsap.registerPlugin(global.ScrollTrigger);

    var mainCard = root.querySelector('.main-card');
    var mockup = root.querySelector('.iphone-mockup');
    var anythingEl = root.querySelector('.text-track .anything');
    var metricValue = parseInt(root.getAttribute('data-metric') || '6', 10);
    var rafId = 0;
    var stopAnything = null;

    if (prefersReducedMotion()) {
      gsap.set('.text-track, .text-days', { autoAlpha: 1, y: 0, scale: 1, filter: 'none', clipPath: 'none', rotationX: 0 });
      gsap.set('.main-card', { y: 0, autoAlpha: 1, width: '92%', height: '92%' });
      gsap.set(['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper', '.floating-badge', '.phone-widget'], { autoAlpha: 1 });
      gsap.set('.cta-wrapper', { autoAlpha: 0 });
      gsap.set('.hero-text-wrapper', { autoAlpha: 1 });
      gsap.set('.hero-first-frame', { autoAlpha: 0 });
      var counter = root.querySelector('.counter-val');
      if (counter) counter.textContent = String(metricValue);
      var ring = root.querySelector('.progress-ring');
      if (ring) ring.style.strokeDashoffset = '60';
      return;
    }

    // Mouse sheen + 3D phone tilt
    function onMouseMove(e) {
      if (window.scrollY > getViewportHeight() * 2.5) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(function () {
        if (mainCard) {
          var rect = mainCard.getBoundingClientRect();
          mainCard.style.setProperty('--mouse-x', e.clientX - rect.left + 'px');
          mainCard.style.setProperty('--mouse-y', e.clientY - rect.top + 'px');
        }
        if (mockup) {
          var xVal = (e.clientX / window.innerWidth - 0.5) * 2;
          var yVal = (e.clientY / getViewportHeight() - 0.5) * 2;
          gsap.to(mockup, {
            rotationY: xVal * 12,
            rotationX: -yVal * 12,
            ease: 'power3.out',
            duration: 1.2,
            transformPerspective: 1000
          });
        }
      });
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    var isMobile = window.innerWidth < 768;
    var ctx = gsap.context(function () {
      /* First paint already shows brand + value via .hero-first-frame (CSS).
         Keep headline mostly ready — shorter motion, no empty loading feel. */
      gsap.set('.hero-first-frame', { autoAlpha: 1 });
      gsap.set('.text-track', { autoAlpha: 0, y: 28, scale: 0.96, filter: 'blur(8px)', rotationX: -8 });
      gsap.set('.text-days', { autoAlpha: 1, clipPath: 'inset(0 100% 0 0)' });
      gsap.set('.main-card', { y: getViewportHeight() + 200, autoAlpha: 1 });
      gsap.set(['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper', '.floating-badge', '.phone-widget'], { autoAlpha: 0 });
      gsap.set('.cta-wrapper', { autoAlpha: 0, scale: 0.8, filter: 'blur(30px)' });

      var introTl = gsap.timeline({ delay: 0.05 });
      introTl
        .to('.hero-first-frame', { duration: 0.55, autoAlpha: 0, y: -12, ease: 'power2.in' }, 0)
        .to('.text-track', { duration: 1.05, autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', rotationX: 0, ease: 'expo.out' }, 0.12)
        .to('.text-days', { duration: 0.95, clipPath: 'inset(0 0% 0 0)', ease: 'power4.inOut' }, '-=0.65')
        .add(function () {
          gsap.set('.text-track', { clearProps: 'filter' });
          if (!stopAnything) stopAnything = runAnythingSync(anythingEl);
        });

      var scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: '+=7000',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
          invalidateOnRefresh: true
        }
      });

      scrollTl
        .to(['.hero-text-wrapper', '.bg-grid-theme'], { scale: 1.15, filter: 'blur(20px)', opacity: 0.2, ease: 'power2.inOut', duration: 2 }, 0)
        .to('.main-card', { y: 0, ease: 'power3.inOut', duration: 2 }, 0)
        .to('.main-card', {
          width: function () { return root.clientWidth; },
          height: function () { return root.clientHeight; },
          borderRadius: '0px',
          ease: 'power3.inOut',
          duration: 1.5
        })
        .fromTo('.mockup-scroll-wrapper',
          { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
          { y: 0, z: 0, rotationX: 0, rotationY: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 2.5 }, '-=0.8'
        )
        .fromTo('.phone-widget', { y: 40, autoAlpha: 0, scale: 0.95 }, { y: 0, autoAlpha: 1, scale: 1, stagger: 0.15, ease: 'back.out(1.2)', duration: 1.5 }, '-=1.5')
        .to('.progress-ring', { strokeDashoffset: 60, duration: 2, ease: 'power3.inOut' }, '-=1.2')
        .to('.counter-val', { innerHTML: metricValue, snap: { innerHTML: 1 }, duration: 2, ease: 'expo.out' }, '-=2.0')
        .fromTo('.floating-badge', { y: 100, autoAlpha: 0, scale: 0.7, rotationZ: -10 }, { y: 0, autoAlpha: 1, scale: 1, rotationZ: 0, ease: 'back.out(1.5)', duration: 1.5, stagger: 0.2 }, '-=2.0')
        .fromTo('.card-left-text', { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, ease: 'power4.out', duration: 1.5 }, '-=1.5')
        .fromTo('.card-right-text', { x: 50, autoAlpha: 0, scale: 0.8 }, { x: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 1.5 }, '<')
        .to({}, { duration: 2.5 })
        .set('.hero-text-wrapper', { autoAlpha: 0 })
        .set('.cta-wrapper', { autoAlpha: 1 })
        .to({}, { duration: 1.5 })
        .to(['.mockup-scroll-wrapper', '.floating-badge', '.card-left-text', '.card-right-text'], {
          scale: 0.9, y: -40, z: -200, autoAlpha: 0, ease: 'power3.in', duration: 1.2, stagger: 0.05
        })
        .to('.main-card', {
          width: function () { return isMobile ? window.innerWidth * 0.92 : window.innerWidth * 0.85; },
          height: function () { return getViewportHeight() * (isMobile ? 0.92 : 0.85); },
          borderRadius: isMobile ? '32px' : '40px',
          ease: 'expo.inOut',
          duration: 1.8
        }, 'pullback')
        .to('.cta-wrapper', { scale: 1, filter: 'blur(0px)', ease: 'expo.inOut', duration: 1.8 }, 'pullback')
        .to('.main-card', {
          y: function () { return -getViewportHeight() - 300; },
          ease: 'power3.in',
          duration: 1.5
        });
    }, root);

    function onViewportChange() {
      if (global.ScrollTrigger) global.ScrollTrigger.refresh();
    }
    window.addEventListener('resize', onViewportChange, { passive: true });
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', onViewportChange, { passive: true });
    }

    root._cinematicCleanup = function () {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onViewportChange);
      if (window.visualViewport) {
        visualViewport.removeEventListener('resize', onViewportChange);
      }
      cancelAnimationFrame(rafId);
      if (stopAnything) stopAnything();
      ctx.revert();
    };
  }

  global.initCinematicHero = initCinematicHero;
})(typeof window !== 'undefined' ? window : this);
