/* QOJ Premier Weekly - small visual effects (particle burst, podium helpers). Exposes window.QOJFX. */
(function () {
  'use strict';
  var W = window;
  var FX = W.QOJFX = W.QOJFX || {};
  var COLORS = ['#198754', '#0d6efd', '#ffc107', '#20c997'];
  var PODIUM = [null, ['podium-gold', '🥇'], ['podium-silver', '🥈'], ['podium-bronze', '🥉']];

  function reducedMotion() {
    try { return !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function podium(rank, solved) {
    if (!(solved > 0)) return null;
    var p = PODIUM[rank];
    return p ? { cls: p[0], medal: p[1] } : null;
  }

  function burst(el) {
    var D = W.document;
    if (!el || !D || !D.body || !el.getBoundingClientRect || reducedMotion()) return 0;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var n = 12 + Math.floor(Math.random() * 5);
    for (var i = 0; i < n; i++) {
      var s = D.createElement('span');
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      var dist = 22 + Math.random() * 22;
      var size = 5 + Math.floor(Math.random() * 2);
      s.className = 'fx-particle';
      s.style.left = (cx - size / 2) + 'px';
      s.style.top = (cy - size / 2) + 'px';
      s.style.width = s.style.height = size + 'px';
      s.style.background = COLORS[i % COLORS.length];
      s.style.setProperty('--fx-dx', Math.round(Math.cos(ang) * dist) + 'px');
      s.style.setProperty('--fx-dy', Math.round(Math.sin(ang) * dist) + 'px');
      s.style.animationDuration = (600 + Math.floor(Math.random() * 200)) + 'ms';
      (function (node) {
        var done = false;
        function rm() { if (done) return; done = true; if (node.parentNode) node.parentNode.removeChild(node); }
        node.addEventListener('animationend', rm);
        setTimeout(rm, 1200);
      })(s);
      D.body.appendChild(s);
    }
    return n;
  }

  FX.burst = burst;
  FX.podium = podium;
})();
