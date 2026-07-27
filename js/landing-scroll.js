/**
 * PreShoot landing scroll motion — post-hero sections only.
 * Matches cinematic hero easing (expo / power3). Does not touch #cinematic-hero.
 */
(function (global) {
  'use strict';

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  function initLandingScroll() {
    if (!global.gsap || !global.ScrollTrigger) return;

    var gsap = global.gsap;
    gsap.registerPlugin(global.ScrollTrigger);

    var root = document.querySelector('.site');
    if (!root) return;

    // Never animate inside the cinematic hero
    var hero = document.getElementById('cinematic-hero');

    function outsideHero(el) {
      return !hero || !hero.contains(el);
    }

    if (prefersReducedMotion()) {
      gsap.utils.toArray('.reveal, .sa-item, .creator-card, .step, .feat-cell, .price-card, .community-card, .stat').forEach(function (el) {
        if (!outsideHero(el)) return;
        gsap.set(el, { clearProps: 'all', autoAlpha: 1, y: 0, x: 0, scale: 1, filter: 'none' });
        el.classList.add('revealed');
      });
      return;
    }

    var mobile = isMobile();
    var yIn = mobile ? 28 : 48;
    var yInSm = mobile ? 18 : 32;
    var easeOut = 'expo.out';
    var easeSoft = 'power3.out';

    var ctx = gsap.context(function () {
      // ── Stats strip: staggered rise ──
      var stats = gsap.utils.toArray('.stats .stat').filter(outsideHero);
      if (stats.length) {
        stats.forEach(function (el) { el.classList.add('revealed'); });
        gsap.set(stats, { autoAlpha: 0, y: yInSm, scale: 0.96 });
        ScrollTrigger.batch(stats, {
          start: 'top 88%',
          once: true,
          onEnter: function (batch) {
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.9,
              ease: easeOut,
              stagger: 0.08,
              overwrite: true
            });
          }
        });
      }

      // ── Section headers (eyebrow → title → sub) ──
      gsap.utils.toArray('#how .reveal, #demo .reveal, #features .reveal, #pricing .reveal, .section > .reveal').forEach(function (block) {
        if (!outsideHero(block)) return;
        // Skip blocks that are grids/strips handled separately
        if (block.classList.contains('creator-strip') || block.classList.contains('steps') ||
            block.classList.contains('feat-grid') || block.classList.contains('pricing-wrap') ||
            block.classList.contains('community-grid') || block.classList.contains('phone-mock') ||
            block.classList.contains('final-h') || block.classList.contains('final-sub') ||
            block.classList.contains('final-actions')) {
          return;
        }

        var eyebrow = block.querySelector('.section-eyebrow');
        var title = block.querySelector('.section-h');
        var sub = block.querySelector('.section-sub');
        var note = block.querySelector('p[style]');
        var parts = [eyebrow, title, sub, note].filter(Boolean);
        if (!parts.length) {
          gsap.set(block, { autoAlpha: 0, y: yIn });
          ScrollTrigger.create({
            trigger: block,
            start: 'top 85%',
            once: true,
            onEnter: function () {
              gsap.to(block, { autoAlpha: 1, y: 0, duration: 1, ease: easeOut });
            }
          });
          return;
        }

        gsap.set(parts, { autoAlpha: 0, y: yIn });
        gsap.set(block, { autoAlpha: 1, y: 0 });
        block.classList.add('revealed');
        ScrollTrigger.create({
          trigger: block,
          start: 'top 82%',
          once: true,
          onEnter: function () {
            gsap.to(parts, {
              autoAlpha: 1,
              y: 0,
              duration: 1.05,
              ease: easeOut,
              stagger: 0.12
            });
          }
        });
      });

      // ── Creator image cards: staggered scale-in ──
      var creatorCards = gsap.utils.toArray('#how .creator-card');
      if (creatorCards.length) {
        gsap.set(creatorCards, { autoAlpha: 0, y: yIn, scale: 0.92 });
        var strip = document.querySelector('#how .creator-strip');
        if (strip) {
          gsap.set(strip, { autoAlpha: 1, y: 0, clearProps: 'transform' });
          strip.classList.add('revealed');
        }
        ScrollTrigger.create({
          trigger: strip || creatorCards[0],
          start: 'top 82%',
          once: true,
          onEnter: function () {
            gsap.to(creatorCards, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 1.1,
              ease: easeOut,
              stagger: 0.1
            });
          }
        });

        // Subtle image parallax (desktop only)
        if (!mobile) {
          creatorCards.forEach(function (card) {
            var img = card.querySelector('img');
            if (!img) return;
            gsap.fromTo(img,
              { yPercent: -6 },
              {
                yPercent: 6,
                ease: 'none',
                scrollTrigger: {
                  trigger: card,
                  start: 'top bottom',
                  end: 'bottom top',
                  scrub: 1.2
                }
              }
            );
          });
        }
      }

      // ── Steps: staggered rise ──
      var steps = gsap.utils.toArray('#how .step');
      if (steps.length) {
        var stepsWrap = document.querySelector('#how .steps');
        if (stepsWrap) {
          gsap.set(stepsWrap, { autoAlpha: 1, y: 0 });
          stepsWrap.classList.add('revealed');
        }
        gsap.set(steps, { autoAlpha: 0, y: yIn });
        ScrollTrigger.create({
          trigger: stepsWrap || steps[0],
          start: 'top 84%',
          once: true,
          onEnter: function () {
            gsap.to(steps, {
              autoAlpha: 1,
              y: 0,
              duration: 1,
              ease: easeOut,
              stagger: 0.14
            });
          }
        });
      }

      // ── Director demo: copy left, phone right ──
      var demoCopy = document.querySelector('#demo .demo-inner > .reveal');
      var phone = document.querySelector('#demo .phone-mock');
      if (demoCopy) {
        // handled by section header logic if it has eyebrow/h — but demo copy includes note.
        // Ensure phone gets its own entrance.
      }
      if (phone) {
        phone.classList.add('revealed');
        gsap.set(phone, {
          autoAlpha: 0,
          y: mobile ? yIn : 60,
          scale: mobile ? 0.94 : 0.9,
          rotateY: mobile ? 0 : 8
        });
        ScrollTrigger.create({
          trigger: phone,
          start: 'top 85%',
          once: true,
          onEnter: function () {
            gsap.to(phone, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              rotateY: 0,
              duration: 1.25,
              ease: easeOut
            });
            // Progressive chrome reveal inside phone
            var chrome = phone.querySelectorAll('.director-titlebar, .director-ctx, .director-messages, .director-input-bar');
            if (chrome.length) {
              gsap.fromTo(chrome,
                { autoAlpha: 0, y: 12 },
                { autoAlpha: 1, y: 0, duration: 0.7, ease: easeSoft, stagger: 0.1, delay: 0.25 }
              );
            }
          }
        });
      }

      // ── Feature cells: staggered ──
      var feats = gsap.utils.toArray('#features .feat-cell');
      if (feats.length) {
        var featGrid = document.querySelector('#features .feat-grid');
        if (featGrid) {
          gsap.set(featGrid, { autoAlpha: 1, y: 0 });
          featGrid.classList.add('revealed');
        }
        gsap.set(feats, { autoAlpha: 0, y: yIn, scale: 0.97 });
        ScrollTrigger.create({
          trigger: featGrid || feats[0],
          start: 'top 82%',
          once: true,
          onEnter: function () {
            gsap.to(feats, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.95,
              ease: easeOut,
              stagger: 0.09
            });
          }
        });
      }

      // ── Pricing cards ──
      var prices = gsap.utils.toArray('#pricing .price-card');
      if (prices.length) {
        var priceWrap = document.querySelector('#pricing .pricing-wrap');
        if (priceWrap) {
          gsap.set(priceWrap, { autoAlpha: 1, y: 0 });
          priceWrap.classList.add('revealed');
        }
        gsap.set(prices, { autoAlpha: 0, y: yIn, scale: 0.96 });
        ScrollTrigger.create({
          trigger: priceWrap || prices[0],
          start: 'top 82%',
          once: true,
          onEnter: function () {
            gsap.to(prices, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 1.05,
              ease: easeOut,
              stagger: 0.14
            });
          }
        });
      }

      // ── Community cards ──
      var community = gsap.utils.toArray('.community-card');
      if (community.length) {
        var cGrid = document.querySelector('.community-grid');
        if (cGrid) {
          gsap.set(cGrid, { autoAlpha: 1, y: 0 });
          cGrid.classList.add('revealed');
        }
        gsap.set(community, { autoAlpha: 0, y: yIn });
        ScrollTrigger.create({
          trigger: cGrid || community[0],
          start: 'top 85%',
          once: true,
          onEnter: function () {
            gsap.to(community, {
              autoAlpha: 1,
              y: 0,
              duration: 1,
              ease: easeOut,
              stagger: 0.12
            });
          }
        });
      }

      // ── Final CTA: headline → sub → actions ──
      var finalH = document.querySelector('.final-h');
      var finalSub = document.querySelector('.final-sub');
      var finalActions = document.querySelector('.final-actions');
      var finalParts = [finalH, finalSub, finalActions].filter(Boolean);
      if (finalParts.length) {
        finalParts.forEach(function (el) { el.classList.add('revealed'); });
        gsap.set(finalParts, { autoAlpha: 0, y: yIn, scale: 0.98 });
        ScrollTrigger.create({
          trigger: document.getElementById('final-cta') || finalH,
          start: 'top 80%',
          once: true,
          onEnter: function () {
            gsap.to(finalParts, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 1.15,
              ease: easeOut,
              stagger: 0.14
            });
          }
        });
      }

      // ── Footer: soft fade ──
      var footer = document.querySelector('footer');
      if (footer) {
        gsap.set(footer, { autoAlpha: 0, y: 24 });
        ScrollTrigger.create({
          trigger: footer,
          start: 'top 92%',
          once: true,
          onEnter: function () {
            gsap.to(footer, { autoAlpha: 1, y: 0, duration: 0.9, ease: easeSoft });
          }
        });
      }

      // Neutralize leftover CSS .reveal transitions that would fight GSAP on grid wrappers
      gsap.utils.toArray('.creator-strip.reveal, .steps.reveal, .feat-grid.reveal, .pricing-wrap.reveal, .community-grid.reveal, .phone-mock.reveal').forEach(function (el) {
        if (!outsideHero(el)) return;
        el.classList.add('revealed');
        gsap.set(el, { autoAlpha: 1, y: 0, clearProps: 'transform,filter' });
      });

    }, root);

    // Refresh after fonts/images settle
    window.addEventListener('load', function () {
      ScrollTrigger.refresh();
    }, { once: true });

    global._landingScrollCleanup = function () {
      ctx.revert();
    };
  }

  global.initLandingScroll = initLandingScroll;
})(typeof window !== 'undefined' ? window : this);
