/* QOJ Premier Weekly - shared helpers, Supabase access and site header. Exposes window.QOJ. */
(function () {
  'use strict';
  var W = window;
  var D = typeof document !== 'undefined' ? document : null;
  var QOJ = W.QOJ = W.QOJ || {};
  var state = { sb: null, user: null, profile: null };
  var authCbs = [];
  var problemsPromise = null;

  var DEFAULT_LISTS = [
    { key: 'D', label: 'Beginners', count: 4, enabled: true },
    { key: 'C', label: 'Easy I', count: 3, enabled: true }
  ];
  var NAV = [
    ['weekly', 'index.html', 'Weekly'],
    ['all', 'all.html', 'All weeks'],
    ['rank', 'rank.html', 'Week ranking'],
    ['leaderboard', 'leaderboard.html', 'Leaderboard'],
    ['solved', 'solved.html', 'My problems'],
    ['profile', 'profile.html', 'Profile']
  ];

  function base() { return W.QOJ_BASE || ''; }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pid(id) { return 'qoj:' + id; }
  function unpid(p) { return String(p).replace(/^qoj:/, ''); }

  function lists() {
    var l = W.QOJ_LISTS;
    if (Array.isArray(l) && l.length) {
      var en = l.filter(function (x) { return x && x.enabled !== false && x.key; });
      if (en.length) return en;
    }
    return DEFAULT_LISTS.slice();
  }

  function displayName(p) {
    var n = p && (p.qoj_handle || p.username);
    n = n ? String(n).trim() : '';
    return n || 'Anonymous';
  }

  /* ---------- Supabase ---------- */
  try {
    var cfg = W.QOJ_CONFIG;
    if (cfg && cfg.supabaseUrl && cfg.supabaseKey && W.supabase && W.supabase.createClient) {
      state.sb = W.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    }
  } catch (e) { state.sb = null; }

  /* Pages until the server says we have everything (exact count) or returns an empty page, so a
     server-side max-rows below our page size cannot silently truncate. make(from, to) must use a stable order. */
  async function paged(make) {
    var out = [], size = 1000, total = null;
    for (;;) {
      var r = await make(out.length, out.length + size - 1);
      if (r.error) return { data: out, error: r.error };
      var rows = r.data || [];
      if (typeof r.count === 'number') total = r.count;
      if (!rows.length) break;
      out = out.concat(rows);
      if (total !== null && out.length >= total) break;
    }
    return { data: out, error: null };
  }

  function sbError(e) { return e instanceof Error ? e : new Error((e && e.message) || String(e)); }

  /* Throws on Supabase errors; retries without qoj_handle if that column does not exist yet. */
  async function selectProfiles(uid) {
    if (!state.sb) return [];
    var colsList = ['user_id, username, avatar_url, qoj_handle', 'user_id, username, avatar_url'];
    var err = null;
    for (var i = 0; i < colsList.length; i++) {
      var r = await paged(function (a, b) {
        var q = state.sb.from('profiles').select(colsList[i], { count: 'exact' });
        if (uid) q = q.eq('user_id', uid);
        return q.order('user_id', { ascending: true }).range(a, b);
      });
      if (!r.error) return r.data;
      err = r.error;
    }
    throw sbError(err);
  }
  /* Per-page-load memo (promises), so re-opening a tab does not refetch; dropped on failure and after writes. */
  var profilesMemo = null, progressMemo = new Map(), minePre = null;
  function fetchProfiles() {
    if (!profilesMemo) {
      profilesMemo = selectProfiles(null);
      profilesMemo.catch(function () { profilesMemo = null; });
    }
    return profilesMemo;
  }
  function invalidate() { progressMemo.clear(); }

  async function progressChunk(ids) {
    var r = await paged(function (a, b) {
      var q = state.sb.from('progress').select('user_id, problem_id', { count: 'exact' }).eq('done', true);
      q = ids ? q.in('problem_id', ids) : q.like('problem_id', 'qoj:%');
      return q.order('user_id', { ascending: true }).order('problem_id', { ascending: true }).range(a, b);
    });
    if (r.error) throw sbError(r.error);
    return r.data.map(function (x) { return { user_id: x.user_id, id: unpid(x.problem_id) }; });
  }
  /* ids (bare problem ids) restricts the query; long lists are chunked to keep URLs short and run in parallel. */
  function fetchProgress(ids) {
    if (!state.sb) return Promise.resolve([]);
    var list = ids ? Array.from(new Set(Array.from(ids, String))).sort() : null;
    var key = list ? list.join(',') : '*';
    var hit = progressMemo.get(key);
    if (hit) return hit;
    var p;
    if (!list) p = progressChunk(null);
    else if (!list.length) p = Promise.resolve([]);
    else {
      var jobs = [];
      for (var i = 0; i < list.length; i += 300) jobs.push(progressChunk(list.slice(i, i + 300).map(pid)));
      p = Promise.all(jobs).then(function (parts) { return [].concat.apply([], parts); });
    }
    progressMemo.set(key, p);
    p.catch(function () { if (progressMemo.get(key) === p) progressMemo.delete(key); });
    return p;
  }

  /* QOJ.ready starts one fetch early (in parallel with the profile); the first caller consumes it. */
  function fetchMyProgress() {
    if (minePre) { var p = minePre; minePre = null; return p; }
    return selectMine();
  }
  function selectMine() {
    return state.user ? fetchUserProgress(state.user.id) : Promise.resolve(new Set());
  }
  /* Set of bare ids the given user marked done (any user: progress has public SELECT). */
  async function fetchUserProgress(uid) {
    var set = new Set();
    if (!state.sb || !uid) return set;
    var r = await paged(function (a, b) {
      return state.sb.from('progress').select('problem_id', { count: 'exact' })
        .eq('user_id', uid).eq('done', true).like('problem_id', 'qoj:%')
        .order('problem_id', { ascending: true }).range(a, b);
    });
    if (r.error) throw sbError(r.error);
    r.data.forEach(function (x) { set.add(unpid(x.problem_id)); });
    return set;
  }

  async function setDone(ids, done) {
    if (!state.sb || !state.user) return { error: new Error('Not signed in') };
    var uid = state.user.id, now = new Date().toISOString();
    ids = Array.isArray(ids) ? ids : [ids];
    invalidate();
    minePre = null;
    for (var i = 0; i < ids.length; i += 500) {
      var rows = ids.slice(i, i + 500).map(function (id) {
        return { user_id: uid, problem_id: pid(id), done: !!done, updated_at: now };
      });
      var r = await state.sb.from('progress').upsert(rows, { onConflict: 'user_id,problem_id' });
      if (r && r.error) return { error: r.error };
    }
    invalidate();
    return { error: null };
  }

  async function saveHandle(handle) {
    if (!state.sb || !state.user) return { error: new Error('Not signed in') };
    var h = handle ? String(handle).trim() : null;
    var r = await state.sb.from('profiles').update({ qoj_handle: h || null }).eq('user_id', state.user.id).select('user_id');
    var err = r.error || null;
    if (!err && !(r.data && r.data.length)) err = new Error('Your profile row was not found (sign out and in again).');
    if (!err) {
      profilesMemo = null;
      state.profile = Object.assign({}, state.profile || { user_id: state.user.id }, { qoj_handle: h || null });
      renderHeader();
    }
    return { error: err };
  }

  async function signIn() {
    if (!state.sb) return;
    var url = W.location ? W.location.href.split('#')[0] : undefined;
    var r;
    try { r = await state.sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: url } }); }
    catch (e) { r = { error: e }; }
    if (r && r.error && W.alert) W.alert('Could not sign in: ' + (r.error.message || r.error));
  }
  /* onAuthStateChange(SIGNED_OUT) notifies pages; reset directly only if signOut itself failed. */
  async function signOut() {
    if (!state.sb) return;
    var r;
    try { r = await state.sb.auth.signOut(); } catch (e) { r = { error: e }; }
    if (r && r.error && state.user) {
      state.user = null; state.profile = null;
      renderHeader();
      authCbs.forEach(function (cb) { cb(null); });
    }
  }
  function onAuth(cb) { authCbs.push(cb); }

  async function loadMyProfile() {
    state.profile = null;
    if (state.user) {
      var uid = state.user.id;
      var rows = await selectProfiles(uid);
      if (state.user && state.user.id === uid) state.profile = rows[0] || null;
    }
  }

  function loadProblems() {
    if (!problemsPromise) {
      problemsPromise = fetch(base() + 'problems.json').then(function (r) {
        if (!r.ok) throw new Error('problems.json: HTTP ' + r.status);
        return r.json();
      });
      problemsPromise.catch(function () { problemsPromise = null; });
    }
    return problemsPromise;
  }

  /* ---------- aggregation helpers ---------- */
  function profileMap(profiles) {
    var m = new Map();
    (profiles || []).forEach(function (p) { m.set(p.user_id, p); });
    return m;
  }
  function groupByUser(rows) {
    var m = new Map();
    (rows || []).forEach(function (r) {
      if (!m.has(r.user_id)) m.set(r.user_id, new Set());
      m.get(r.user_id).add(r.id);
    });
    return m;
  }
  function nameOf(pmap, uid) {
    var p = pmap.get(uid);
    if (p) return displayName(p);
    if (state.user && state.user.id === uid) return myName();
    return 'Anonymous';
  }
  /* sort in place by key desc then name; assign competition ranks to r.rank */
  function assignRanks(rows, keyFn) {
    rows.sort(function (a, b) {
      return (keyFn(b) - keyFn(a)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
    });
    rows.forEach(function (r, i) {
      r.rank = (i > 0 && keyFn(rows[i - 1]) === keyFn(r)) ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }

  /* Row class + medal markup for a ranked row ({rank,total}); me = current user id. */
  function rankRow(r, me) {
    var pod = W.QOJFX && W.QOJFX.podium ? W.QOJFX.podium(r.rank, r.total) : null;
    var cls = [];
    if (me && r.uid === me) cls.push('me-row');
    if (pod) cls.push(pod.cls);
    return {
      attr: cls.length ? ' class="' + cls.join(' ') + '"' : '',
      medal: pod ? '<span class="podium-medal" aria-hidden="true">' + pod.medal + '</span>' : ''
    };
  }

  /* ---------- problem table ---------- */
  function problemUrl(p) { return p.url || ('https://qoj.ac/problem/' + p.id); }
  function userUrl(uid) { return base() + 'user.html?u=' + encodeURIComponent(uid); }
  /* Ranking-table name: opens that user's statistics page in a new tab. */
  function userLinkHtml(uid, name) {
    return '<a class="user-link" href="' + escapeHtml(userUrl(uid)) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>';
  }
  function problemTitleHtml(p) {
    var h = '<a href="' + escapeHtml(problemUrl(p)) + '" target="_blank" rel="noopener">' + escapeHtml(p.name) + '</a>';
    if (p.source) {
      String(p.source).split(' · ').forEach(function (s) {
        if (s) h += '<span class="badge rounded-pill bg-secondary">' + escapeHtml(s) + '</span>';
      });
    }
    (p.tags || []).forEach(function (t) {
      h += '<span class="badge rounded-pill bg-success">' + escapeHtml(t) + '</span>';
    });
    return h;
  }
  /* opts: { checked: Set of bare ids, canEdit: bool, disabledTitle: tooltip when !canEdit } */
  function problemTableHtml(problems, opts) {
    opts = opts || {};
    var checked = opts.checked || new Set();
    var h = '<div class="rank-scroll"><table class="table table-bordered table-hover table-striped problem-table"><thead><tr>' +
      '<th class="col-id">ID</th><th>Title</th><th class="col-check">Done</th></tr></thead><tbody>';
    problems.forEach(function (p) {
      var id = escapeHtml(p.id);
      h += '<tr data-id="' + id + '"><td class="col-id">#' + id + '</td><td>' + problemTitleHtml(p) + '</td>' +
        '<td class="col-check"><input type="checkbox" class="form-check-input solve-check" data-id="' + id + '"' +
        (checked.has(String(p.id)) ? ' checked' : '') +
        (opts.canEdit ? '' : ' disabled title="' + escapeHtml(opts.disabledTitle || 'Sign in to track') + '"') +
        ' aria-label="' + escapeHtml('Solved #' + p.id + ' ' + (p.name || '')) + '"></td></tr>';
    });
    if (!problems.length) h += '<tr><td colspan="3" class="text-center text-muted">No problems.</td></tr>';
    return h + '</tbody></table></div>';
  }
  /* Delegated change handler: persists via setDone, reverts on failure, then onChange(id, done). */
  function bindChecks(root, onChange) {
    root.addEventListener('change', async function (ev) {
      var el = ev.target;
      if (!el || !el.classList || !el.classList.contains('solve-check')) return;
      var id = el.getAttribute('data-id'), done = el.checked;
      el.disabled = true;
      var r;
      try { r = await setDone([id], done); }
      catch (e) { r = { error: e }; }
      finally { el.disabled = false; }
      if (r.error) {
        el.checked = !done;
        if (W.alert) W.alert('Could not save: ' + (r.error.message || r.error));
        return;
      }
      if (done && W.QOJFX && W.QOJFX.burst) { try { W.QOJFX.burst(el); } catch (e) { /* cosmetic */ } }
      if (onChange) onChange(id, done);
    });
  }

  /* ---------- header ---------- */
  function myName() {
    if (state.profile) return displayName(state.profile);
    var m = (state.user && state.user.user_metadata) || {};
    return displayName({ username: m.user_name || m.preferred_username || m.full_name || m.name });
  }

  function renderHeader() {
    if (!D) return;
    var el = D.getElementById('site-header');
    if (!el) return;
    var active = el.getAttribute('data-active');
    var auth;
    if (!state.sb) auth = '<span class="text-muted">Offline mode</span>';
    else if (state.user) {
      auth = '<span class="user-name">' + escapeHtml(myName()) + '</span>' +
        '<a href="#" id="logout-btn" role="button">Logout</a>';
    } else auth = '<button type="button" class="btn btn-sm btn-outline-dark" id="login-btn">Login with GitHub</button>';
    var nav = NAV.map(function (n) {
      return '<li class="nav-item"><a class="nav-link' + (n[0] === active ? ' active' : '') +
        '" href="' + escapeHtml(base() + n[1]) + '">' + n[2] + '</a></li>';
    }).join('');
    el.innerHTML = '<div class="site-top d-flex justify-content-between align-items-end">' +
      '<h1 class="site-title"><a href="' + escapeHtml(base() + 'index.html') + '">Premier Weekly</a></h1>' +
      '<div id="auth-area">' + auth + '</div></div>' +
      '<nav class="site-nav"><ul class="nav">' + nav + '</ul></nav>';
    var li = D.getElementById('login-btn'), lo = D.getElementById('logout-btn');
    if (li) li.addEventListener('click', function () { signIn(); });
    if (lo) lo.addEventListener('click', function (e) { e.preventDefault(); signOut(); });
  }

  function domReady() {
    return new Promise(function (res) {
      if (!D || D.readyState !== 'loading') return res();
      D.addEventListener('DOMContentLoaded', function () { res(); });
    });
  }

  /* Resolves to TIMEOUT if p has not settled after ms (so a hung Supabase call cannot block the page). */
  var TIMEOUT = {};
  var READY_TIMEOUT_MS = 3000;
  var NEEDS_MINE = { week: true, solved: true };
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(TIMEOUT); }, ms); })]);
  }

  QOJ.ready = (async function () {
    await domReady();
    if (state.sb) {
      try {
        var r = await withTimeout(state.sb.auth.getSession(), READY_TIMEOUT_MS);
        if (r !== TIMEOUT) state.user = (r && r.data && r.data.session && r.data.session.user) || null;
      } catch (e) { state.user = null; }
      // subscribe even if getSession failed, so INITIAL_SESSION and later sign-in/out still reach the pages
      try {
        state.sb.auth.onAuthStateChange(function (ev, session) {
          var u = (session && session.user) || null;
          if ((u && u.id) === (state.user && state.user.id)) return;
          state.user = u;
          minePre = null; // prefetched for the previous user
          setTimeout(async function () {
            try { await loadMyProfile(); } catch (e) { state.profile = null; }
            if (state.user !== u) return; // superseded by a later auth event, which notifies instead
            renderHeader();
            authCbs.forEach(function (cb) { cb(u); });
          }, 0);
        });
      } catch (e) { /* no live auth updates */ }
      if (state.user) {
        var uid = state.user.id;
        if (NEEDS_MINE[(W.QOJ_PAGE || {}).type]) {
          minePre = selectMine();
          minePre.catch(function () { /* surfaced to the first fetchMyProgress caller */ });
        }
        var lp = loadMyProfile().then(function () { return true; }, function () { state.profile = null; return true; });
        if ((await withTimeout(lp, READY_TIMEOUT_MS)) === TIMEOUT) {
          // profile arrived late: refresh the header and let pages re-render with it
          lp.then(function () {
            if (!state.user || state.user.id !== uid) return;
            renderHeader();
            authCbs.forEach(function (cb) { cb(state.user); });
          });
        }
      }
    }
    renderHeader();
  })();

  Object.assign(QOJ, {
    escapeHtml: escapeHtml, pid: pid, lists: lists, displayName: displayName,
    loadProblems: loadProblems, fetchProfiles: fetchProfiles, fetchProgress: fetchProgress,
    fetchMyProgress: fetchMyProgress, fetchUserProgress: fetchUserProgress, setDone: setDone, saveHandle: saveHandle,
    signIn: signIn, signOut: signOut, onAuth: onAuth, renderHeader: renderHeader,
    getUser: function () { return state.user; },
    getProfile: function () { return state.profile; },
    isLoggedIn: function () { return !!state.user; },
    hasBackend: function () { return !!state.sb; },
    rankRow: rankRow, profileMap: profileMap, groupByUser: groupByUser, nameOf: nameOf, assignRanks: assignRanks,
    problemUrl: problemUrl, userUrl: userUrl, userLinkHtml: userLinkHtml, problemTitleHtml: problemTitleHtml, problemTableHtml: problemTableHtml, bindChecks: bindChecks
  });
})();
