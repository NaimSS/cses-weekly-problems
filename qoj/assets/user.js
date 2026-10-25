/* User statistics (user.html?u=<user_id>): CSES-style grid of every enabled-list problem, solved cells green. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml;
  var root = document.getElementById('page');
  var uid = new URLSearchParams(window.location.search).get('u');
  Q.loadProblems().catch(function () { /* surfaced in main() */ }); // start before auth resolves

  function gridHtml(problems, solved) {
    return '<div class="solve-grid">' + problems.map(function (p) {
      var yes = solved.has(String(p.id));
      return '<a class="solve-cell' + (yes ? ' yes' : '') + '" data-id="' + esc(p.id) + '" href="' + esc(Q.problemUrl(p)) +
        '" target="_blank" rel="noopener" title="' + esc(p.name) + '">' + (yes ? '✓' : '') + '</a>';
    }).join('') + '</div>';
  }

  async function main() {
    if (!uid) { root.innerHTML = '<p class="text-muted">No user selected. Pick one from the <a href="leaderboard.html">leaderboard</a>.</p>'; return; }
    var data;
    try { data = await Promise.all([Q.loadProblems(), Q.fetchUserProgress(uid), Q.fetchProfiles()]); }
    catch (e) { root.innerHTML = '<p class="text-danger">Could not load user statistics.</p>'; return; }
    var probs = data[0], solved = data[1], name = Q.nameOf(Q.profileMap(data[2]), uid);
    document.title = name + ' - Premier Weekly';
    var lists = Q.lists(), total = 0, done = 0, body = '';
    lists.forEach(function (l) {
      var ps = probs.filter(function (p) { return p.list === l.key; });
      var n = ps.filter(function (p) { return solved.has(String(p.id)); }).length;
      total += ps.length; done += n;
      body += '<h4 class="section-label" data-list="' + esc(l.key) + '">' + esc(l.label) +
        ' <small class="text-muted">' + n + ' / ' + ps.length + '</small></h4>' + gridHtml(ps, solved);
    });
    root.innerHTML = '<h3 class="mb-2">Statistics for <span id="user-name">' + esc(name) + '</span></h3>' +
      '<p id="user-solved">Solved tasks: ' + done + ' / ' + total + '</p>' + body +
      (Q.hasBackend() ? '' : '<p class="text-muted mt-3">Progress tracking not configured.</p>') +
      '<p class="mt-3"><a href="leaderboard.html">Back to leaderboard</a></p>';
  }

  Q.ready.then(main);
})();
