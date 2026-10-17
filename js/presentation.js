/* =====================================================================
   presentation.js — navigation chrome and presentation mode
   ---------------------------------------------------------------------
   • Top bar: appears once the opening has scrolled away.
   • Chapter rail: a vertical number line. Its marker sits on a chapter's
     tick when the chapter starts and approaches the next tick as you read.
   • Presentation mode (P): fullscreen, chrome hidden, ↑/↓ and
     PageUp/PageDown move between "stops" (one composed screen each).
     Sliders and steppers keep working; ←/→ stay with the interactives.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var root = document.documentElement;
  var hero = document.getElementById('top');
  var ending = document.getElementById('end');
  var topbar = document.querySelector('[data-topbar]');
  var topChapter = document.querySelector('[data-topbar-chapter]');
  var rail = document.querySelector('[data-rail]');
  var railLinks = Array.prototype.slice.call(rail.querySelectorAll('a'));
  var marker = rail.querySelector('[data-rail-marker]');
  var chapters = Array.prototype.slice.call(document.querySelectorAll('[data-chapter]'));
  var dark = Array.prototype.slice.call(document.querySelectorAll('.theme-dark, .theme-deep'));
  var stops = Array.prototype.slice.call(document.querySelectorAll('[data-stop]'));
  var dialog = document.getElementById('references');
  var hud = document.querySelector('[data-hud]');
  var hudCount = hud.querySelector('[data-hud-count]');
  var presentButtons = Array.prototype.slice.call(document.querySelectorAll('[data-present]'));

  /* ---------------------------------------------------------- chrome */
  var markerY = null, markerTarget = 0, markerRunning = false, lastChapter = -2;

  function ticks() {
    var top = rail.getBoundingClientRect().top;
    return railLinks.map(function (a) { var r = a.getBoundingClientRect(); return r.top - top + r.height / 2; });
  }
  function coversY(el, y) { var r = el.getBoundingClientRect(); return r.top <= y && r.bottom > y; }

  function update() {
    var vh = window.innerHeight, probe = vh * 0.42;
    var heroBottom = hero.getBoundingClientRect().bottom;
    topbar.classList.toggle('is-visible', heroBottom < 40);
    var endTop = ending.getBoundingClientRect().top;
    rail.classList.toggle('is-visible', heroBottom < vh * 0.45 && endTop > vh * 0.55);

    var idx = -1, frac = 0;
    chapters.forEach(function (sec, i) {
      var r = sec.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) { idx = i; frac = (probe - r.top) / r.height; }
    });
    if (idx >= 0) {
      var t = ticks();
      var y0 = t[idx], y1 = idx + 1 < t.length ? t[idx + 1] : t[idx];
      markerTarget = y0 + (y1 - y0) * EX.clamp(frac, 0, 1);
      if (markerY === null) markerY = markerTarget;
      runMarker();
    }
    if (idx !== lastChapter) {
      lastChapter = idx;
      railLinks.forEach(function (a, i) { a.classList.toggle('is-active', i === idx); });
      if (idx >= 0) {
        var sec = chapters[idx];
        topChapter.innerHTML = '<span class="num">' + sec.getAttribute('data-chapter') + '</span>' + sec.getAttribute('data-name');
      } else {
        topChapter.textContent = '';
      }
    }
    var topDark = null;
    dark.forEach(function (el) { if (coversY(el, 28)) topDark = el; });
    topbar.classList.toggle('is-dark', !!topDark);
    topbar.classList.toggle('is-deep', !!topDark && topDark.classList.contains('theme-deep'));
    rail.classList.toggle('is-dark', dark.some(function (el) { return coversY(el, vh / 2); }));
  }

  function runMarker() {
    if (markerRunning) return;
    markerRunning = true;
    EX.loop(function (dt) {
      markerY = EX.approach(markerY, markerTarget, 0.14, dt);
      if (Math.abs(markerY - markerTarget) < 0.05) markerY = markerTarget;
      marker.style.setProperty('--y', markerY.toFixed(2) + 'px');
      if (markerY === markerTarget) { markerRunning = false; return false; }
      return true;
    });
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; update(); });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();

  /* ------------------------------------------------ presentation mode */
  var presenting = false, scrollCancel = null, animIndex = null, enterIndex = 0, hudTimer = 0, moved = false;

  function stopTop(el) { return el.getBoundingClientRect().top + window.scrollY; }
  function maxScroll() { return document.documentElement.scrollHeight - window.innerHeight; }
  function currentIndex() {
    var y = window.scrollY + 6, idx = 0;
    for (var i = 0; i < stops.length; i++) if (stopTop(stops[i]) <= y) idx = i;
    return idx;
  }

  function showHud(i) {
    var s = stops[i];
    var sec = s.closest('[data-chapter]');
    var name = s === hero ? 'Opening' : s === ending ? 'Ending' : (sec ? sec.getAttribute('data-chapter') + ' · ' + sec.getAttribute('data-name') : '');
    hudCount.textContent = (i + 1) + ' / ' + stops.length + (name ? '  ' + name : '');
    hud.classList.add('is-on');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { hud.classList.remove('is-on'); }, 1800);
  }

  function cancelScroll() { if (scrollCancel) { scrollCancel(); scrollCancel = null; } animIndex = null; }

  function goTo(i) {
    i = EX.clamp(i, 0, stops.length - 1);
    var target = Math.min(Math.round(stopTop(stops[i])), maxScroll());
    showHud(i);
    cancelScroll();
    animIndex = i;
    if (EX.reduced) { window.scrollTo({ top: target, behavior: 'instant' }); animIndex = null; return; }
    var y = window.scrollY;
    scrollCancel = EX.loop(function (dt) {
      y = EX.approach(y, target, 0.17, dt);
      if (Math.abs(y - target) < 0.6) y = target;
      window.scrollTo({ top: y, behavior: 'instant' });
      if (y === target) { scrollCancel = null; animIndex = null; return false; }
      return true;
    });
  }

  function step(dir) {
    moved = true;
    var cur = animIndex !== null ? animIndex : currentIndex();
    if (dir < 0 && animIndex === null && window.scrollY > stopTop(stops[cur]) + 8) { goTo(cur); return; }
    goTo(cur + dir);
  }

  // after entering, snap to the stop we started from — unless the presenter already moved
  function realign() { if (presenting && !moved) goTo(enterIndex); }

  function setPressed(on) {
    presentButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(on)); });
  }

  function enter() {
    if (presenting) return;
    presenting = true;
    moved = false;
    enterIndex = currentIndex();
    root.classList.add('is-presenting');
    setPressed(true);
    var el = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(realign);
    } else {
      goTo(enterIndex);
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function exit() {
    if (!presenting) return;
    presenting = false;
    cancelScroll();
    root.classList.remove('is-presenting');
    setPressed(false);
    hud.classList.remove('is-on');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    schedule();
  }

  function toggle() { if (presenting) exit(); else enter(); }

  // used by the hand-gesture remote (js/gesture/present-gestures.mjs): same moves as ↑ / ↓
  EX.presentation = {
    step: step,
    isPresenting: function () { return presenting; },
    currentStop: function () { return stops[animIndex !== null ? animIndex : currentIndex()]; },
  };

  document.addEventListener('fullscreenchange', function () {
    if (document.fullscreenElement && presenting) {
      // the viewport just grew: re-align with the stop we started from
      setTimeout(realign, 80);
    } else if (!document.fullscreenElement && presenting) {
      exit();
    }
  });

  presentButtons.forEach(function (b) { b.addEventListener('click', toggle); });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (dialog && dialog.open) return;
    var t = e.target;
    var typing = t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|checkbox|button)$/.test(t.type)));
    if (typing) return;
    if (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') { toggle(); e.preventDefault(); return; }   // e.code: works with an Arabic keyboard too
    if (!presenting) return;
    var onRange = t && t.tagName === 'INPUT' && t.type === 'range';
    if (e.key === 'PageDown' || (e.key === 'ArrowDown' && !onRange) || (e.key === ' ' && !/^(BUTTON|INPUT)$/.test(t.tagName))) { step(1); e.preventDefault(); }
    else if (e.key === 'PageUp' || (e.key === 'ArrowUp' && !onRange)) { step(-1); e.preventDefault(); }
    else if (e.key === 'Home' && !onRange) { moved = true; goTo(0); e.preventDefault(); }
    else if (e.key === 'End' && !onRange) { moved = true; goTo(stops.length - 1); e.preventDefault(); }
    else if (e.key === 'Escape' && !document.fullscreenElement) { exit(); }
  });

  // any manual scroll gesture wins over an animation in progress
  ['wheel', 'touchstart', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, function () { if (scrollCancel) cancelScroll(); }, { passive: true });
  });

  /* ----------------------------------------------------- references */
  var openBtn = document.querySelector('[data-open-refs]');
  var closeBtn = document.querySelector('[data-close-refs]');
  if (dialog && openBtn) {
    openBtn.addEventListener('click', function () {
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    });
    closeBtn.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  }
})();
