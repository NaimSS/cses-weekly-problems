/* All weeks index. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml, base = window.QOJ_BASE || '';
  Q.ready.then(function () {
    var weeks = ((window.QOJ_PAGE || {}).weeks || []).slice().sort().reverse();
    var h = '<h3 class="mb-3">All weeks</h3><p><a class="btn btn-sm btn-outline-secondary me-2" href="' + esc(base) + 'rank.html">Week ranking</a>' +
      '<a class="btn btn-sm btn-outline-secondary" href="' + esc(base) + 'leaderboard.html">Leaderboard</a></p>';
    if (!weeks.length) h += '<p class="text-muted">No weeks yet.</p>';
    else {
      h += '<table class="table table-bordered table-hover table-striped" id="weeks-table"><thead><tr><th>Week</th></tr></thead><tbody>' +
        weeks.map(function (d) {
          return '<tr><td><a href="' + esc(base) + 'weeks/' + esc(d) + '.html">' + esc(d) + '</a></td></tr>';
        }).join('') + '</tbody></table>';
    }
    document.getElementById('page').innerHTML = h;
  });
})();
