/**
 * PreShoot cinematic landing hero — vanilla GSAP scroll experience.
 * First hero ("Scan ANYTHING…") is authoritative on every device/browser.
 * Mid-scroll content ("Ideas, redefined.") must never appear on initial load.
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

  /** Ensure load always starts at the first hero — no scroll-restoration mid-pin. */
  function lockScrollToTop() {
    try {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
    } catch (e) {}
    if (window.scrollY || window.pageYOffset) {
      window.scrollTo(0, 0);
    }
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
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

  function markIntroDone(root) {
    if (root) root.setAttribute('data-hero-phase', 'intro-done');
    document.documentElement.classList.add('hero-intro-done');
  }

  function showStaticFirstHero(root, gsap) {
    /* Accessible / reduced-motion: stay on first hero. Never jump to mid-scroll card. */
    gsap.set('.hero-first-frame', { autoAlpha: 1, visibility: 'visible' });
    gsap.set('.hero-text-wrapper', { autoAlpha: 0 });
    gsap.set('.text-track, .text-days, .text-secs', { autoAlpha: 0 });
    gsap.set('.main-card', {
      y: getViewportHeight() + 200,
      autoAlpha: 1,
      visibility: 'visible'
    });
    gsap.set(
      ['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper', '.floating-badge', '.phone-widget'],
      { autoAlpha: 0 }
    );
    gsap.set('.cta-wrapper', { autoAlpha: 0 });
    var counter = root.querySelector('.counter-val');
    if (counter) counter.textContent = '0';
    var ring = root.querySelector('.progress-ring');
    if (ring) ring.style.strokeDashoffset = '402';
    markIntroDone(root);
  }

  function initCinematicHero(root) {
    if (!root || !global.gsap || !global.ScrollTrigger) return;

    var gsap = global.gsap;
    gsap.registerPlugin(global.ScrollTrigger);

    lockScrollToTop();
    root.setAttribute('data-hero-phase', 'first');
    document.documentElement.classList.remove('hero-intro-done');

    var mainCard = root.querySelector('.main-card');
    var mockup = root.querySelector('.iphone-mockup');
    var anythingEl = root.querySelector('.text-track .anything');
    var metricValue = parseInt(root.getAttribute('data-metric') || '6', 10);
    var rafId = 0;
    var stopAnything = null;
    var scrollTriggerInstance = null;
    var introComplete = false;

    if (prefersReducedMotion()) {
      showStaticFirstHero(root, gsap);
      /* Still pin briefly so scroll doesn't dump users into mid-card content.
         First hero stays until the user actually scrolls. */
      var reducedCtx = gsap.context(function () {
        global.ScrollTrigger.create({
          trigger: root,
          start: 'top top',
          end: '+=1400',
          pin: true,
          scrub: true,
          onUpdate: function (self) {
            var p = self.progress;
            gsap.set('.hero-first-frame', { autoAlpha: Math.max(0, 1 - p * 1.35) });
            if (p > 0.2) {
              var rise = Math.min(1, (p - 0.2) / 0.45);
              gsap.set('.main-card', {
                y: (1 - rise) * (getViewportHeight() + 200),
                autoAlpha: 1
              });
            }
            if (p > 0.5) {
              gsap.set(
                ['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper'],
                { autoAlpha: Math.min(1, (p - 0.5) / 0.3) }
              );
            }
          }
        });
      }, root);

      root._cinematicCleanup = function () {
        reducedCtx.revert();
      };
      return;
    }

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
      /* First paint already shows correct copy via .hero-first-frame. */
      gsap.set('.hero-first-frame', { autoAlpha: 1, visibility: 'visible' });
      gsap.set('.hero-text-wrapper', { autoAlpha: 1 });
      gsap.set('.text-track', {
        autoAlpha: 0,
        y: 18,
        scale: 0.98,
        filter: 'blur(6px)',
        rotationX: -4
      });
      gsap.set('.text-days', { autoAlpha: 0, y: 14 });
      gsap.set('.text-secs', { autoAlpha: 0, y: 10 });
      gsap.set('.main-card', { y: getViewportHeight() + 200, autoAlpha: 1, visibility: 'visible' });
      gsap.set(
        ['.card-left-text', '.card-right-text', '.mockup-scroll-wrapper', '.floating-badge', '.phone-widget'],
        { autoAlpha: 0 }
      );
      gsap.set('.cta-wrapper', { autoAlpha: 0, scale: 0.8, filter: 'blur(30px)' });

      lockScrollToTop();

      var introTl = gsap.timeline({
        delay: 0.35,
        onComplete: function () {
          introComplete = true;
          markIntroDone(root);
          lockScrollToTop();
          /* Attach scrubbed scroll timeline only after first hero has finished intro */
          buildScrollTimeline();
          if (global.ScrollTrigger) global.ScrollTrigger.refresh();
        }
      });

      introTl
        .to('.hero-first-frame', { duration: 0.55, autoAlpha: 0, ease: 'power2.inOut' }, 0)
        .to(
          '.text-track',
          {
            duration: 0.9,
            autoAlpha: 1,
            y: 0,
            scale: 1,
            filter: 'blur(0px)',
            rotationX: 0,
            ease: 'expo.out'
          },
          0.15
        )
        .to('.text-days', { duration: 0.75, autoAlpha: 1, y: 0, ease: 'power3.out' }, 0.28)
        .to('.text-secs', { duration: 0.7, autoAlpha: 1, y: 0, ease: 'power3.out' }, 0.4)
        .add(function () {
          gsap.set('.text-track', { clearProps: 'filter' });
          if (!stopAnything) stopAnything = runAnythingSync(anythingEl);
          var ff = root.querySelector('.hero-first-frame');
          if (ff) ff.setAttribute('aria-hidden', 'true');
          var tw = root.querySelector('.hero-text-wrapper');
          if (tw) tw.removeAttribute('aria-hidden');
        });

      function buildScrollTimeline() {
        if (scrollTriggerInstance) return;
        lockScrollToTop();

        var scrollTl = gsap.timeline({
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: '+=7000',
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onRefreshInit: function () {
              /* Avoid refresh applying mid-progress from restored scroll */
              if (!introComplete) lockScrollToTop();
            }
          }
        });

        scrollTriggerInstance = scrollTl.scrollTrigger;

        scrollTl
          .to(
            ['.hero-text-wrapper', '.bg-grid-theme'],
            { scale: 1.15, filter: 'blur(20px)', opacity: 0.2, ease: 'power2.inOut', duration: 2 },
            0
          )
          .to('.main-card', { y: 0, ease: 'power3.inOut', duration: 2 }, 0)
          .to('.main-card', {
            width: function () {
              return root.clientWidth;
            },
            height: function () {
              return root.clientHeight;
            },
            borderRadius: '0px',
            ease: 'power3.inOut',
            duration: 1.5
          })
          .fromTo(
            '.mockup-scroll-wrapper',
            { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
            {
              y: 0,
              z: 0,
              rotationX: 0,
              rotationY: 0,
              autoAlpha: 1,
              scale: 1,
              ease: 'expo.out',
              duration: 2.5
            },
            '-=0.8'
          )
          .fromTo(
            '.phone-widget',
            { y: 40, autoAlpha: 0, scale: 0.95 },
            { y: 0, autoAlpha: 1, scale: 1, stagger: 0.15, ease: 'back.out(1.2)', duration: 1.5 },
            '-=1.5'
          )
          .to('.progress-ring', { strokeDashoffset: 60, duration: 2, ease: 'power3.inOut' }, '-=1.2')
          .to(
            '.counter-val',
            { innerHTML: metricValue, snap: { innerHTML: 1 }, duration: 2, ease: 'expo.out' },
            '-=2.0'
          )
          .fromTo(
            '.floating-badge',
            { y: 100, autoAlpha: 0, scale: 0.7, rotationZ: -10 },
            {
              y: 0,
              autoAlpha: 1,
              scale: 1,
              rotationZ: 0,
              ease: 'back.out(1.5)',
              duration: 1.5,
              stagger: 0.2
            },
            '-=2.0'
          )
          .fromTo(
            '.card-left-text',
            { x: -50, autoAlpha: 0 },
            { x: 0, autoAlpha: 1, ease: 'power4.out', duration: 1.5 },
            '-=1.5'
          )
          .fromTo(
            '.card-right-text',
            { x: 50, autoAlpha: 0, scale: 0.8 },
            { x: 0, autoAlpha: 1, scale: 1, ease: 'expo.out', duration: 1.5 },
            '<'
          )
          .to({}, { duration: 2.5 })
          .set('.hero-text-wrapper', { autoAlpha: 0 })
          .set('.cta-wrapper', { autoAlpha: 1 })
          .to({}, { duration: 1.5 })
          .to(
            ['.mockup-scroll-wrapper', '.floating-badge', '.card-left-text', '.card-right-text'],
            {
              scale: 0.9,
              y: -40,
              z: -200,
              autoAlpha: 0,
              ease: 'power3.in',
              duration: 1.2,
              stagger: 0.05
            }
          )
          .to(
            '.main-card',
            {
              width: function () {
                return isMobile ? window.innerWidth * 0.92 : window.innerWidth * 0.85;
              },
              height: function () {
                return getViewportHeight() * (isMobile ? 0.92 : 0.85);
              },
              borderRadius: isMobile ? '32px' : '40px',
              ease: 'expo.inOut',
              duration: 1.8
            },
            'pullback'
          )
          .to('.cta-wrapper', { scale: 1, filter: 'blur(0px)', ease: 'expo.inOut', duration: 1.8 }, 'pullback')
          .to('.main-card', {
            y: function () {
              return -getViewportHeight() - 300;
            },
            ease: 'power3.in',
            duration: 1.5
          });
      }
    }, root);

    function onViewportChange() {
      if (!introComplete) {
        lockScrollToTop();
        return;
      }
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
