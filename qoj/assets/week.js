/* Weekly page: Problems tab + Rankings tab. */
(function () {
  'use strict';
  var Q = window.QOJ, page = window.QOJ_PAGE || {}, esc = Q.escapeHtml;
  var root = document.getElementById('page');
  var mine = new Set(), mineErr = false;
  var activeTab = 'problems', isReady = false;
  var rankSeq = 0, refreshSeq = 0;

  function weekLists() {
    return Q.lists().map(function (l) { return { l: l, ps: (page.problems || {})[l.key] || [] }; });
  }

  function weekIds() {
    var ids = [];
    weekLists().forEach(function (x) { x.ps.forEach(function (p) { ids.push(String(p.id)); }); });
    return ids;
  }

  function problemsHtml() {
    var can = Q.isLoggedIn(), h = '';
    if (!isReady) { /* static tables first; auth state not known yet */ }
    else if (!can) h += '<p class="text-muted" id="signin-hint">Sign in to track your progress.</p>';
    else if (mineErr) h += '<p class="text-danger" id="progress-error">Could not load your progress.</p>';
    weekLists().forEach(function (x) {
      h += '<h4 class="section-label">' + esc(x.l.label) + '</h4>' +
        Q.problemTableHtml(x.ps, { checked: mine, canEdit: can });
    });
    return h;
  }

  async function renderRankings(pane) {
    var seq = ++rankSeq;
    if (!Q.hasBackend()) { pane.innerHTML = '<p class="text-muted">Progress tracking not configured.</p>'; return; }
    pane.innerHTML = '<p class="text-muted">Loading rankings…</p>';
    var data;
    try {
      data = await Promise.all([Q.fetchProgress(weekIds()), Q.fetchProfiles()]);
    } catch (e) {
      if (seq === rankSeq) pane.innerHTML = '<p class="text-danger">Could not load rankings.</p>';
      return;
    }
    if (seq !== rankSeq) return;
    var byUser = Q.groupByUser(data[0]), pmap = Q.profileMap(data[1]);
    var wl = weekLists(), me = Q.getUser() && Q.getUser().id;
    var all = [];
    wl.forEach(function (x) { x.ps.forEach(function (p) { all.push(p); }); });
    var rows = [];
    byUser.forEach(function (set, uid) {
      var per = wl.map(function (x) { return x.ps.filter(function (p) { return set.has(String(p.id)); }).length; });
      var total = per.reduce(function (a, b) { return a + b; }, 0);
      if (total > 0) rows.push({ uid: uid, name: Q.nameOf(pmap, uid), set: set, per: per, total: total });
    });
    Q.assignRanks(rows, function (r) { return r.total; });
    if (!rows.length) { pane.innerHTML = '<p class="text-muted">Nobody has solved a problem this week yet.</p>'; return; }

    var h = '<h4 class="section-label">Leaderboard</h4><div class="rank-scroll"><table class="table table-bordered table-hover table-striped rank-table week-board"><thead><tr>' +
      '<th>#</th><th class="user-cell">User</th><th>Solved</th>' +
      wl.map(function (x) { return '<th>' + esc(x.l.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var rr = Q.rankRow(r, me);
      h += '<tr' + rr.attr + '><td>' + r.rank + '</td><td class="user-cell">' + rr.medal + Q.userLinkHtml(r.uid, r.name) +
        '</td><td>' + r.total + ' / ' + all.length + '</td>' +
        r.per.map(function (n, i) { return '<td>' + n + ' / ' + wl[i].ps.length + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table></div><h4 class="section-label">Problems</h4><div class="rank-scroll"><table class="table table-bordered table-hover rank-table week-grid"><thead><tr><th class="user-cell">User</th>' +
      all.map(function (p) {
        return '<th title="' + esc(p.name) + '"><a href="' + esc(p.url || ('https://qoj.ac/problem/' + p.id)) + '" target="_blank" rel="noopener">#' + esc(p.id) + '</a></th>';
      }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var rr = Q.rankRow(r, me);
      h += '<tr' + rr.attr + '><td class="user-cell">' + rr.medal + Q.userLinkHtml(r.uid, r.name) + '</td>' + all.map(function (p) {
        return r.set.has(String(p.id)) ? '<td class="cell-yes">✓</td>' : '<td class="cell-no">✗</td>';
      }).join('') + '</tr>';
    });
    pane.innerHTML = h + '</tbody></table></div>';
  }

  function build() {
    root.innerHTML = '<h3 class="mb-3">Week of ' + esc(page.date || '') + '</h3>' +
      '<ul class="nav nav-tabs mb-3" id="week-tabs">' +
      '<li class="nav-item"><a class="nav-link" href="#" data-tab="problems">Problems</a></li>' +
      '<li class="nav-item"><a class="nav-link" href="#" data-tab="rankings">Rankings</a></li></ul>' +
      '<div id="pane-problems"></div><div id="pane-rankings" style="display:none"></div>';
    Q.bindChecks(root, function (id, done) { if (done) mine.add(String(id)); else mine.delete(String(id)); });
    root.querySelector('#week-tabs').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (!a) return;
      e.preventDefault();
      show(a.getAttribute('data-tab'));
    });
    show(activeTab);
  }

  function show(tab) {
    activeTab = tab;
    root.querySelectorAll('#week-tabs [data-tab]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === tab);
    });
    var pp = root.querySelector('#pane-problems'), pr = root.querySelector('#pane-rankings');
    pp.style.display = tab === 'problems' ? '' : 'none';
    pr.style.display = tab === 'rankings' ? '' : 'none';
    if (tab === 'problems') { rankSeq++; pp.innerHTML = problemsHtml(); } else renderRankings(pr);
  }

  async function refresh() {
    var seq = ++refreshSeq, m, err = false;
    try { m = await Q.fetchMyProgress(); } catch (e) { m = new Set(); err = true; }
    if (seq !== refreshSeq) return;
    mine = m; mineErr = err;
    show(activeTab);
  }

  function start() {
    build(); // static problem tables render without waiting for auth
    Q.ready.then(function () {
      isReady = true;
      show(activeTab);
      refresh();
      Q.onAuth(refresh);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
