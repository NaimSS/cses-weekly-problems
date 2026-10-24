/* Week-over-week matrix: users x weeks, click a week header to expand into per-problem columns. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml;
  var root = document.getElementById('page');
  var weeksData = (window.QOJ_PAGE || {}).weeks || {};
  var dates = Object.keys(weeksData).sort().reverse();
  var expanded = new Set();
  var model = null;

  function weekProblems(d) {
    var out = [];
    Q.lists().forEach(function (l) { ((weeksData[d] || {})[l.key] || []).forEach(function (p) { out.push(p); }); });
    return out;
  }

  function cellClass(n, tot) {
    if (tot && n / tot >= 0.75) return 'table-success';
    return n > 0 ? 'table-warning' : '';
  }

  function render() {
    if (!model) return;
    var me = Q.getUser() && Q.getUser().id;
    var h = '<h3 class="mb-3">Week ranking</h3><p class="text-muted small">Click a week header to expand its problems.</p>' +
      '<div class="rank-scroll"><table class="table table-bordered table-hover rank-table"><thead><tr><th>#</th><th class="user-cell">User</th>';
    dates.forEach(function (d) {
      var ps = weekProblems(d);
      if (expanded.has(d)) {
        h += ps.map(function (p, i) {
          return '<th' + (i === 0 ? ' class="week-head" data-week="' + esc(d) + '"' : '') + ' title="' + esc(p.name) + '">' +
            (i === 0 ? esc(d) + '<br>' : '') + '#' + esc(p.id) + '</th>';
        }).join('');
      } else h += '<th class="week-head" data-week="' + esc(d) + '">' + esc(d) + '</th>';
    });
    h += '<th>Total</th></tr></thead><tbody>';
    model.rows.forEach(function (r) {
      h += '<tr' + (r.uid === me ? ' class="me-row"' : '') + '><td>' + r.rank + '</td><td class="user-cell">' + esc(r.name) + '</td>';
      dates.forEach(function (d) {
        var ps = weekProblems(d);
        if (expanded.has(d)) {
          h += ps.map(function (p) {
            return r.set.has(String(p.id)) ? '<td class="cell-yes">✓</td>' : '<td class="cell-no">✗</td>';
          }).join('');
        } else {
          var n = ps.filter(function (p) { return r.set.has(String(p.id)); }).length;
          h += '<td class="' + cellClass(n, ps.length) + '">' + n + '/' + ps.length + '</td>';
        }
      });
      h += '<td><strong>' + r.total + '</strong></td></tr>';
    });
    if (!model.rows.length) h += '<tr><td colspan="' + (dates.length + 3) + '" class="text-muted">No progress recorded yet.</td></tr>';
    root.innerHTML = h + '</tbody></table></div>';
  }

  async function load() {
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    var data;
    try { data = await Promise.all([Q.fetchProgress(), Q.fetchProfiles()]); }
    catch (e) { root.innerHTML = '<p class="text-danger">Could not load rankings.</p>'; return; }
    var byUser = Q.groupByUser(data[0]), pmap = Q.profileMap(data[1]);
    var ids = new Set();
    dates.forEach(function (d) { weekProblems(d).forEach(function (p) { ids.add(String(p.id)); }); });
    var rows = [];
    byUser.forEach(function (set, uid) {
      var total = 0;
      set.forEach(function (id) { if (ids.has(id)) total++; });
      if (total > 0) rows.push({ uid: uid, name: Q.nameOf(pmap, uid), set: set, total: total });
    });
    Q.assignRanks(rows, function (r) { return r.total; });
    model = { rows: rows };
    render();
  }

  Q.ready.then(function () {
    root.addEventListener('click', function (e) {
      var th = e.target.closest ? e.target.closest('[data-week]') : null;
      if (!th) return;
      var d = th.getAttribute('data-week');
      if (expanded.has(d)) expanded.delete(d); else expanded.add(d);
      render();
    });
    load();
    Q.onAuth(render);
  });
})();
