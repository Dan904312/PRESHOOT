/**
 * PreShoot landing motion system — post-hero sections only.
 * Philosophy: Apple / Linear / Stripe — attention direction, not spectacle.
 * GPU-only (transform, opacity, filter). Shared easing with cinematic hero.
 * Does NOT animate #cinematic-hero.
 */
(function (global) {
  'use strict';

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  function fillOdoReel(reel) {
    if (!reel || reel.childNodes.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i <= 9; i++) {
      var d = document.createElement('div');
      d.className = 'odo-num';
      d.textContent = String(i);
      frag.appendChild(d);
    }
    // Extra 0–9 cycle for smoother long spins
    for (var j = 0; j <= 9; j++) {
      var d2 = document.createElement('div');
      d2.className = 'odo-num';
      d2.textContent = String(j);
      frag.appendChild(d2);
    }
    reel.appendChild(frag);
  }

  function initHookOdometer(gsap, ScrollTrigger, mobile) {
    var stage = document.getElementById('hooks-stage');
    var odo = document.getElementById('hook-odo');
    if (!stage || !odo) return;

    var digits = odo.querySelectorAll('.odo-digit');
    digits.forEach(function (digit) {
      fillOdoReel(digit.querySelector('.odo-reel'));
    });

    var title = document.getElementById('hooks-title');
    var sub = document.getElementById('hooks-sub');
    var chips = document.getElementById('hooks-chips');
    var copyEls = [title, sub, chips].filter(Boolean);

    stage.classList.add('revealed');
    gsap.set(copyEls, { autoAlpha: 0, y: 16, filter: 'blur(6px)' });
    gsap.set(stage, { autoAlpha: 0, y: mobile ? 24 : 40, scale: 0.985 });

    var digitH = function () {
      var el = odo.querySelector('.odo-num');
      return el ? el.offsetHeight : mobile ? 72 : 112;
    };

    var activeTl = null;
    var visible = false;

    function killActive() {
      if (activeTl) {
        activeTl.kill();
        activeTl = null;
      }
      digits.forEach(function (digit) {
        var reel = digit.querySelector('.odo-reel');
        if (reel) gsap.killTweensOf(reel);
      });
      gsap.killTweensOf(copyEls);
      gsap.killTweensOf(stage);
    }

    function resetOdo() {
      killActive();
      digits.forEach(function (digit) {
        var reel = digit.querySelector('.odo-reel');
        if (reel) gsap.set(reel, { y: 0 });
      });
      gsap.set(copyEls, { autoAlpha: 0, y: 16, filter: 'blur(6px)' });
      gsap.set(stage, { autoAlpha: 0, y: mobile ? 24 : 40, scale: 0.985 });
    }

    function playOdo() {
      if (visible) return;
      visible = true;
      killActive();

      var h = digitH() || (mobile ? 72 : 112);
      var target = [1, 0, 0]; // 100
      activeTl = gsap.timeline();

      activeTl.to(stage, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 1.05,
        ease: 'expo.out'
      }, 0);

      digits.forEach(function (digit, i) {
        var reel = digit.querySelector('.odo-reel');
        if (!reel) return;
        gsap.set(reel, { y: 0 });
        var goal = target[i];
        var endY = -((10 + goal) * h);
        activeTl.fromTo(
          reel,
          { y: 0 },
          {
            y: endY,
            duration: 1.55 + i * 0.18,
            ease: 'power3.inOut'
          },
          0.15
        );
      });

      activeTl.to(
        copyEls,
        {
          autoAlpha: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.95,
          ease: 'expo.out',
          stagger: 0.12,
          clearProps: 'filter'
        },
        1.35
      );
    }

    function leaveOdo() {
      if (!visible) {
        resetOdo();
        return;
      }
      visible = false;
      resetOdo();
    }

    /* Replay every time the section enters the viewport */
    if (typeof IntersectionObserver === 'function') {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && entry.intersectionRatio > 0.12) {
              playOdo();
            } else {
              leaveOdo();
            }
          });
        },
        { threshold: [0, 0.12, 0.25], rootMargin: '0px 0px -8% 0px' }
      );
      io.observe(stage);
    } else {
      ScrollTrigger.create({
        trigger: stage,
        start: 'top 88%',
        end: 'bottom 12%',
        onEnter: playOdo,
        onEnterBack: playOdo,
        onLeave: leaveOdo,
        onLeaveBack: leaveOdo
      });
    }

    requestAnimationFrame(function () {
      var rect = stage.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.88 && rect.bottom > window.innerHeight * 0.12) {
        playOdo();
      }
    });
  }

  function revealHeader(gsap, ScrollTrigger, block, opts) {
    opts = opts || {};
    var eyebrow = block.querySelector('.section-eyebrow');
    var title = block.querySelector('.section-h, .final-h');
    var sub = block.querySelector('.section-sub, .final-sub');
    var seen = {};
    var parts = [eyebrow, title, sub]
      .concat(Array.prototype.slice.call(block.querySelectorAll('p[style], .privacy-strip')))
      .filter(function (el) {
        if (!el || seen[el]) return false;
        seen[el] = true;
        return true;
      });
    if (!parts.length) return false;

    var y = opts.y != null ? opts.y : 28;
    gsap.set(parts, { autoAlpha: 0, y: y, filter: 'blur(10px)' });
    gsap.set(block, { autoAlpha: 1, y: 0 });
    block.classList.add('revealed');

    // Word reveal for major titles when not mobile
    var splitWords = null;
    if (title && !opts.skipWords && !isMobile() && title.children.length === 0) {
      var html = title.innerHTML;
      // Preserve <br>
      var chunks = html.split(/(<br\s*\/?>)/i);
      var out = '';
      chunks.forEach(function (chunk) {
        if (/^<br/i.test(chunk)) {
          out += chunk;
          return;
        }
        var words = chunk.split(/(\s+)/);
        words.forEach(function (w) {
          if (/^\s+$/.test(w) || w === '') {
            out += w;
          } else {
            out += '<span class="mw" style="display:inline-block;will-change:transform,opacity,filter">' + w + '</span>';
          }
        });
      });
      title.innerHTML = out;
      splitWords = title.querySelectorAll('.mw');
      gsap.set(splitWords, { autoAlpha: 0, y: 18, filter: 'blur(8px)' });
      gsap.set(title, { autoAlpha: 1, y: 0, filter: 'none' });
    }

    ScrollTrigger.create({
      trigger: block,
      start: opts.start || 'top 90%',
      once: true,
      onEnter: function () {
        if (splitWords && splitWords.length) {
          if (eyebrow) {
            gsap.to(eyebrow, {
              autoAlpha: 1,
              y: 0,
              filter: 'blur(0px)',
              duration: 0.7,
              ease: 'expo.out',
              clearProps: 'filter'
            });
          }
          gsap.to(splitWords, {
            autoAlpha: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 0.85,
            ease: 'expo.out',
            stagger: 0.035,
            delay: eyebrow ? 0.08 : 0,
            clearProps: 'filter'
          });
          var rest = parts.filter(function (el) {
            return el !== eyebrow && el !== title;
          });
          if (rest.length) {
            gsap.to(rest, {
              autoAlpha: 1,
              y: 0,
              filter: 'blur(0px)',
              duration: 0.95,
              ease: 'expo.out',
              stagger: 0.1,
              delay: 0.28,
              clearProps: 'filter'
            });
          }
        } else {
          gsap.to(parts, {
            autoAlpha: 1,
            y: 0,
            filter: 'blur(0px)',
            duration: 1.0,
            ease: 'expo.out',
            stagger: 0.1,
            clearProps: 'filter'
          });
        }
      }
    });
    return true;
  }

  function staggerCards(gsap, ScrollTrigger, cards, trigger, opts) {
    opts = opts || {};
    if (!cards || !cards.length) return;
    var y = opts.y != null ? opts.y : (isMobile() ? 22 : 36);
    gsap.set(cards, {
      autoAlpha: 0,
      y: y,
      scale: opts.scale != null ? opts.scale : 0.98,
      filter: opts.blur ? 'blur(8px)' : 'none'
    });
    ScrollTrigger.create({
      trigger: trigger || cards[0],
      start: opts.start || 'top 90%',
      once: true,
      onEnter: function () {
        gsap.to(cards, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: opts.duration || 0.95,
          ease: 'expo.out',
          stagger: opts.stagger != null ? opts.stagger : 0.09,
          clearProps: 'filter'
        });
      }
    });
  }

  function initLandingScroll() {
    if (!global.gsap || !global.ScrollTrigger) return;

    var gsap = global.gsap;
    gsap.registerPlugin(global.ScrollTrigger);

    var root = document.querySelector('.site');
    if (!root) return;
    var hero = document.getElementById('cinematic-hero');

    function outsideHero(el) {
      return !hero || !hero.contains(el);
    }

    if (prefersReducedMotion()) {
      gsap.utils
        .toArray(
          '.reveal, .sa-item, .creator-card, .step, .feat-cell, .price-card, .community-card, .stat, .proof-panel, .hooks-stage, .hooks-title, .hooks-sub, .hooks-chips'
        )
        .forEach(function (el) {
          if (!outsideHero(el)) return;
          gsap.set(el, { clearProps: 'all', autoAlpha: 1, y: 0, x: 0, scale: 1, filter: 'none' });
          el.classList.add('revealed');
        });
      // Snap odometer to 100
      var odo = document.getElementById('hook-odo');
      if (odo) {
        odo.querySelectorAll('.odo-digit').forEach(function (digit, i) {
          fillOdoReel(digit.querySelector('.odo-reel'));
          var reel = digit.querySelector('.odo-reel');
          var h = (odo.querySelector('.odo-num') && odo.querySelector('.odo-num').offsetHeight) || 80;
          var target = [1, 0, 0][i];
          gsap.set(reel, { y: -((10 + target) * h) });
        });
      }
      return;
    }

    var mobile = isMobile();
    var yIn = mobile ? 22 : 36;
    var easeOut = 'expo.out';

    var ctx = gsap.context(function () {
      // ── Stats ──
      var stats = gsap.utils.toArray('.stats .stat').filter(outsideHero);
      if (stats.length) {
        stats.forEach(function (el) {
          el.classList.add('revealed');
        });
        staggerCards(gsap, ScrollTrigger, stats, document.querySelector('.stats'), {
          y: mobile ? 16 : 24,
          scale: 0.97,
          stagger: 0.07,
          start: 'top 92%',
          duration: 0.85
        });
      }

      // ── Section headers (all post-hero sections) ──
      gsap.utils
        .toArray(
          '#proof > .reveal, #how > .reveal, #demo .reveal, #features > .reveal, #trust > .reveal, #pricing > .reveal, #hooks .hooks-head, .section > .reveal'
        )
        .forEach(function (block) {
          if (!outsideHero(block)) return;
          if (block.classList.contains('revealed')) return;
          if (
            block.classList.contains('creator-strip') ||
            block.classList.contains('steps') ||
            block.classList.contains('feat-grid') ||
            block.classList.contains('pricing-wrap') ||
            block.classList.contains('community-grid') ||
            block.classList.contains('proof-grid') ||
            block.classList.contains('trust-grid') ||
            block.classList.contains('phone-mock') ||
            block.classList.contains('hooks-stage')
          ) {
            return;
          }
          if (block.querySelector('.section-h') || block.querySelector('.section-eyebrow') || block.querySelector('.final-h')) {
            revealHeader(gsap, ScrollTrigger, block, { y: yIn });
          }
        });

      // ── Proof panels: from sides ──
      var proofPanels = gsap.utils.toArray('#proof .proof-panel');
      if (proofPanels.length) {
        var proofGrid = document.querySelector('#proof .proof-grid');
        if (proofGrid) {
          proofGrid.classList.add('revealed');
          gsap.set(proofGrid, { autoAlpha: 1 });
        }
        proofPanels.forEach(function (panel, i) {
          gsap.set(panel, {
            autoAlpha: 0,
            x: mobile ? 0 : i === 0 ? -36 : 36,
            y: mobile ? 28 : 16,
            filter: 'blur(8px)'
          });
        });
        ScrollTrigger.create({
          trigger: proofGrid || proofPanels[0],
          start: 'top 90%',
          once: true,
          onEnter: function () {
            gsap.to(proofPanels, {
              autoAlpha: 1,
              x: 0,
              y: 0,
              filter: 'blur(0px)',
              duration: 1.1,
              ease: easeOut,
              stagger: 0.14,
              clearProps: 'filter'
            });
            // Images cinematic
            var imgs = gsap.utils.toArray('#proof .proof-img-wrap img');
            if (imgs.length) {
              gsap.fromTo(
                imgs,
                { scale: 0.98, filter: 'blur(6px)' },
                { scale: 1, filter: 'blur(0px)', duration: 1.2, ease: easeOut, clearProps: 'filter' }
              );
            }
          }
        });
      }

      // ── Hooks showcase odometer ──
      initHookOdometer(gsap, ScrollTrigger, mobile);

      // ── Creator cards ──
      var creatorCards = gsap.utils.toArray('#how .creator-card');
      if (creatorCards.length) {
        var strip = document.querySelector('#how .creator-strip');
        if (strip) {
          gsap.set(strip, { autoAlpha: 1 });
          strip.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, creatorCards, strip || creatorCards[0], {
          scale: 0.97,
          blur: true,
          stagger: 0.1,
          duration: 1.05
        });
        if (!mobile) {
          creatorCards.forEach(function (card) {
            var img = card.querySelector('img');
            if (!img) return;
            gsap.fromTo(
              img,
              { yPercent: -5 },
              {
                yPercent: 5,
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

      // ── Steps ──
      var steps = gsap.utils.toArray('#how .step');
      if (steps.length) {
        var stepsWrap = document.querySelector('#how .steps');
        if (stepsWrap) {
          gsap.set(stepsWrap, { autoAlpha: 1 });
          stepsWrap.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, steps, stepsWrap || steps[0], {
          stagger: 0.13,
          scale: 0.985
        });
      }

      // Privacy strip
      var privacy = document.querySelector('#how .privacy-strip');
      if (privacy) {
        gsap.set(privacy, { autoAlpha: 0, y: 20, filter: 'blur(6px)' });
        ScrollTrigger.create({
          trigger: privacy,
          start: 'top 92%',
          once: true,
          onEnter: function () {
            gsap.to(privacy, {
              autoAlpha: 1,
              y: 0,
              filter: 'blur(0px)',
              duration: 0.9,
              ease: easeOut,
              clearProps: 'filter'
            });
          }
        });
      }

      // ── Director phone ──
      var phone = document.querySelector('#demo .phone-mock');
      if (phone) {
        phone.classList.add('revealed');
        gsap.set(phone, {
          autoAlpha: 0,
          y: mobile ? yIn : 48,
          scale: mobile ? 0.96 : 0.94,
          rotateY: mobile ? 0 : 6,
          filter: 'blur(8px)'
        });
        ScrollTrigger.create({
          trigger: phone,
          start: 'top 90%',
          once: true,
          onEnter: function () {
            gsap.to(phone, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              rotateY: 0,
              filter: 'blur(0px)',
              duration: 1.2,
              ease: easeOut,
              clearProps: 'filter'
            });
            var chrome = phone.querySelectorAll(
              '.director-titlebar, .director-ctx, .director-messages, .director-input-bar'
            );
            if (chrome.length) {
              gsap.fromTo(
                chrome,
                { autoAlpha: 0, y: 10 },
                { autoAlpha: 1, y: 0, duration: 0.65, ease: 'power3.out', stagger: 0.09, delay: 0.28 }
              );
            }
          }
        });
      }

      // ── Features ──
      var feats = gsap.utils.toArray('#features .feat-cell');
      if (feats.length) {
        var featGrid = document.querySelector('#features .feat-grid');
        if (featGrid) {
          gsap.set(featGrid, { autoAlpha: 1 });
          featGrid.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, feats, featGrid || feats[0], {
          stagger: 0.08,
          scale: 0.98,
          blur: true
        });
      }

      // ── Trust grid ──
      var trustKids = gsap.utils.toArray('#trust .walk-frame, #trust .founder-card');
      if (trustKids.length) {
        var trustGrid = document.querySelector('#trust .trust-grid');
        if (trustGrid) {
          gsap.set(trustGrid, { autoAlpha: 1 });
          trustGrid.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, trustKids, trustGrid || trustKids[0], {
          stagger: 0.14,
          scale: 0.985,
          blur: true,
          duration: 1.05
        });
      }

      // ── Pricing ──
      var prices = gsap.utils.toArray('#pricing .price-card');
      if (prices.length) {
        var priceWrap = document.querySelector('#pricing .pricing-wrap');
        if (priceWrap) {
          gsap.set(priceWrap, { autoAlpha: 1 });
          priceWrap.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, prices, priceWrap || prices[0], {
          stagger: 0.14,
          scale: 0.97,
          blur: true,
          duration: 1.05
        });
      }

      // ── Community ──
      var community = gsap.utils.toArray('.community-card');
      if (community.length) {
        var cGrid = document.querySelector('.community-grid');
        if (cGrid) {
          gsap.set(cGrid, { autoAlpha: 1 });
          cGrid.classList.add('revealed');
        }
        staggerCards(gsap, ScrollTrigger, community, cGrid || community[0], {
          stagger: 0.12,
          scale: 0.98
        });
      }

      // ── Final CTA ──
      var finalParts = [
        document.querySelector('.final-h'),
        document.querySelector('.final-sub'),
        document.querySelector('.final-actions')
      ].filter(Boolean);
      if (finalParts.length) {
        finalParts.forEach(function (el) {
          el.classList.add('revealed');
        });
        gsap.set(finalParts, { autoAlpha: 0, y: yIn, filter: 'blur(8px)', scale: 0.985 });
        ScrollTrigger.create({
          trigger: document.getElementById('final-cta') || finalParts[0],
          start: 'top 88%',
          once: true,
          onEnter: function () {
            gsap.to(finalParts, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              filter: 'blur(0px)',
              duration: 1.1,
              ease: easeOut,
              stagger: 0.13,
              clearProps: 'filter'
            });
          }
        });
      }

      // ── Footer ──
      var footer = document.querySelector('footer');
      if (footer) {
        gsap.set(footer, { autoAlpha: 0, y: 20 });
        ScrollTrigger.create({
          trigger: footer,
          start: 'top 94%',
          once: true,
          onEnter: function () {
            gsap.to(footer, { autoAlpha: 1, y: 0, duration: 0.85, ease: 'power3.out' });
          }
        });
      }

      // Neutralize grid wrappers
      gsap.utils
        .toArray(
          '.creator-strip.reveal, .steps.reveal, .feat-grid.reveal, .pricing-wrap.reveal, .community-grid.reveal, .phone-mock.reveal, .proof-grid.reveal, .trust-grid.reveal'
        )
        .forEach(function (el) {
          if (!outsideHero(el)) return;
          el.classList.add('revealed');
          gsap.set(el, { autoAlpha: 1, y: 0, clearProps: 'transform,filter' });
        });
    }, root);

    window.addEventListener(
      'load',
      function () {
        ScrollTrigger.refresh();
      },
      { once: true }
    );

    global._landingScrollCleanup = function () {
      ctx.revert();
    };
  }

  global.initLandingScroll = initLandingScroll;
})(typeof window !== 'undefined' ? window : this);
