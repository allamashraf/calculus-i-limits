/* =====================================================================
   Chapter 05 — The limit laws
   ---------------------------------------------------------------------
   The worked example reveals one step at a time. Each step lights up
   the laws it uses in the list on the left, so the reader can see
   *which* theorem justifies *which* line.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var root = document.querySelector('[data-stepper-name="worked"]');
  if (!root) return;
  var laws = document.querySelectorAll('[data-law]');

  EX.stepper(root, function (i, step) {
    var uses = step ? (step.getAttribute('data-uses') || '').split(',').filter(Boolean) : [];
    laws.forEach(function (li) {
      li.classList.toggle('is-used', uses.indexOf(li.getAttribute('data-law')) !== -1);
    });
  });
})();
