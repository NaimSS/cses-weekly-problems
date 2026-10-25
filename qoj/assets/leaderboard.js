/* All-time leaderboard over the enabled premier lists. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml;
  var root = document.getElementById('page');

  var seq = 0;
  Q.loadProblems().catch(function () { /* surfaced in main() */ }); // start before auth resolves

  async function main() {
    var my = ++seq;
    root.innerHTML = '<p class="text-muted">Loading…</p>';
    var data;
    try {
      var profilesP = Q.fetchProfiles(); // in flight while problems.json loads
      var probs = await Q.loadProblems();
      var enabled = new Set(Q.lists().map(function (l) { return l.key; }));
      var ids = probs.filter(function (p) { return enabled.has(p.list); }).map(function (p) { return String(p.id); });
      data = [probs].concat(await Promise.all([Q.fetchProgress(ids), profilesP]));
    }
    catch (e) {
      if (my === seq) root.innerHTML = '<p class="text-danger">Could not load leaderboard.</p>';
      return;
    }
    if (my !== seq) return;
    var lists = Q.lists(), idsByList = {};
    lists.forEach(function (l) { idsByList[l.key] = new Set(); });
    data[0].forEach(function (p) { if (idsByList[p.list]) idsByList[p.list].add(String(p.id)); });
    var grand = 0;
    lists.forEach(function (l) { grand += idsByList[l.key].size; });
    var byUser = Q.groupByUser(data[1]), pmap = Q.profileMap(data[2]);
    var me = Q.getUser() && Q.getUser().id, rows = [];
    byUser.forEach(function (set, uid) {
      var per = lists.map(function (l) {
        var n = 0;
        set.forEach(function (id) { if (idsByList[l.key].has(id)) n++; });
        return n;
      });
      var total = per.reduce(function (a, b) { return a + b; }, 0);
      if (total > 0) rows.push({ uid: uid, name: Q.nameOf(pmap, uid), per: per, total: total });
    });
    Q.assignRanks(rows, function (r) { return r.total; });
    var h = '<h3 class="mb-3">Leaderboard</h3><div class="rank-scroll"><table class="table table-bordered table-hover table-striped rank-table"><thead><tr><th>#</th><th class="user-cell">User</th>' +
      lists.map(function (l) { return '<th>' + esc(l.label) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var rr = Q.rankRow(r, me);
      h += '<tr' + rr.attr + '><td>' + r.rank + '</td><td class="user-cell">' + rr.medal + Q.userLinkHtml(r.uid, r.name) + '</td>' +
        r.per.map(function (n, i) {
          var tot = idsByList[lists[i].key].size, pct = tot ? Math.round(100 * n / tot) : 0;
          return '<td>' + n + ' / ' + tot + '<div class="progress thin"><div class="progress-bar bg-success" style="width:' + pct + '%"></div></div></td>';
        }).join('') + '<td><strong>' + r.total + ' / ' + grand + '</strong></td></tr>';
    });
    if (!rows.length) {
      h += '<tr><td colspan="' + (lists.length + 3) + '" class="text-muted">' +
        (Q.hasBackend() ? 'No progress recorded yet.' : 'Progress tracking not configured.') + '</td></tr>';
    }
    root.innerHTML = h + '</tbody></table></div>';
  }

  Q.ready.then(function () { main(); Q.onAuth(main); });
})();
