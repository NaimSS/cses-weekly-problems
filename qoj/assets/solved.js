/* My problems: one tab per enabled list, full problem table with filters. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml;
  var root = document.getElementById('page');
  var problems = [], mine = new Set(), activeList = null, filter = 'all';

  function listProblems(key) { return problems.filter(function (p) { return p.list === key; }); }

  function applyFilter() {
    root.querySelectorAll('table.problem-table tbody tr[data-id]').forEach(function (tr) {
      var done = mine.has(tr.getAttribute('data-id'));
      tr.classList.toggle('d-none', (filter === 'solved' && !done) || (filter === 'unsolved' && done));
    });
    root.querySelectorAll('[data-filter]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-filter') === filter);
    });
  }
  function updateCount() {
    var ps = listProblems(activeList), n = ps.filter(function (p) { return mine.has(String(p.id)); }).length;
    var el = root.querySelector('#solved-count');
    if (el) el.textContent = 'Solved ' + n + ' / ' + ps.length;
  }

  function render() {
    var lists = Q.lists();
    if (!activeList || !lists.some(function (l) { return l.key === activeList; })) activeList = lists[0].key;
    var can = Q.isLoggedIn();
    var h = '<h3 class="mb-3">My problems</h3>';
    if (!can) h += '<div class="alert alert-light border" id="signin-hint">Sign in with GitHub (top right) to track your solved problems.</div>';
    h += '<ul class="nav nav-tabs list-tabs mb-3">' + lists.map(function (l) {
      return '<li class="nav-item"><a class="nav-link' + (l.key === activeList ? ' active' : '') + '" href="#" data-list="' + esc(l.key) + '">' + esc(l.label) + '</a></li>';
    }).join('') + '</ul>' +
      '<div class="d-flex justify-content-between align-items-center mb-2"><strong id="solved-count"></strong>' +
      '<div class="btn-group btn-group-sm">' + ['all', 'unsolved', 'solved'].map(function (f) {
        return '<button type="button" class="btn btn-outline-secondary" data-filter="' + f + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
      }).join('') + '</div></div>' +
      Q.problemTableHtml(listProblems(activeList), { checked: mine, canEdit: can });
    root.innerHTML = h;
    updateCount();
    applyFilter();
  }

  async function load() {
    try { mine = await Q.fetchMyProgress(); } catch (e) { mine = new Set(); }
    render();
  }

  Q.ready.then(async function () {
    try { problems = await Q.loadProblems(); }
    catch (e) { root.innerHTML = '<p class="text-danger">Could not load problems.</p>'; return; }
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-list]') : null;
      if (t) { e.preventDefault(); activeList = t.getAttribute('data-list'); render(); return; }
      var f = e.target.closest ? e.target.closest('[data-filter]') : null;
      if (f) { filter = f.getAttribute('data-filter'); applyFilter(); }
    });
    Q.bindChecks(root, function (id, done) {
      if (done) mine.add(String(id)); else mine.delete(String(id));
      updateCount();
      applyFilter();
    });
    await load();
    Q.onAuth(load);
  });
})();
