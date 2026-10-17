/* =====================================================================
   opening.js — the title sequence and the closing motif
   ---------------------------------------------------------------------
   The letters of LIMITS start spread apart and close the gaps between
   them exponentially: offset(t) = offset0 · e^(−t/τ). The gap tends to 0.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var hero = document.getElementById('top');
  if (!hero) return;

  var title = hero.querySelector('[data-title]');
  var letters = Array.prototype.slice.call(title.querySelectorAll('span'));
  var motif = new EX.Motif(hero.querySelector('[data-motif]'));

  var sequence = [
    { el: hero.querySelector('.opening__logo'), at: 0.05 },
    { el: hero.querySelector('.opening__meta'), at: 0.2 },
    { el: hero.querySelector('.opening__course'), at: 0.25 },
    { el: hero.querySelector('.opening__subtitle'), at: 1.35 }
  ];
  hero.querySelectorAll('.credits__item').forEach(function (el, i) {
    sequence.push({ el: el, at: 1.7 + i * 0.12 });
  });
  sequence.forEach(function (s) { s.el.setAttribute('data-enter', ''); });

  function converge(delay) {
    var size = parseFloat(getComputedStyle(title).fontSize) || 200;
    var centre = (letters.length - 1) / 2;
    var spread = size * 0.17;                    // initial gap between neighbours
    var tau = 0.46;                              // seconds; 63% of the gap closes per τ
    var t = -delay;
    EX.loop(function (dt) {
      t += dt;
      if (t < 0) return true;
      var k = Math.exp(-t / tau);                // remaining fraction of the gap
      var opacity = Math.min(1, t / 0.8);
      for (var i = 0; i < letters.length; i++) {
        letters[i].style.transform = 'translateX(' + ((i - centre) * spread * k).toFixed(2) + 'px)';
        letters[i].style.opacity = opacity;
      }
      if (centre * spread * k < 0.04 && opacity >= 1) {
        letters.forEach(function (el) { el.style.transform = ''; el.style.opacity = '1'; });
        title.classList.add('is-set');
        return false;
      }
      return true;
    });
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    if (EX.reduced) {
      letters.forEach(function (el) { el.style.opacity = '1'; });
      sequence.forEach(function (s) { s.el.classList.add('is-on'); });
      motif.play();
      return;
    }
    sequence.forEach(function (s) {
      setTimeout(function () { s.el.classList.add('is-on'); }, s.at * 1000);
    });
    converge(0.3);
    motif.play(1.0, 0.55);
  }

  // Wait for the display face so the letters are measured with the right font.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start);
    setTimeout(start, 1400);
  } else {
    start();
  }

  /* ---------- closing screen: the motif returns ---------- */
  var endMotifEl = document.querySelector('[data-motif="end"]');
  if (endMotifEl) {
    var endMotif = new EX.Motif(endMotifEl);
    EX.onEnter(endMotifEl, function () { endMotif.play(0.2, 0.6); }, 0.9);
  }
})();
