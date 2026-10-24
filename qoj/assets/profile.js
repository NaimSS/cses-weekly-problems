/* Profile page: QOJ handle + import of a saved QOJ profile page. */
(function () {
  'use strict';
  var Q = window.QOJ, esc = Q.escapeHtml;
  var root = document.getElementById('page');
  var HANDLE_RE = /^[A-Za-z0-9_.-]{1,40}$/;
  var pending = null; // { newIds: [] }

  function msg(el, kind, text) {
    el.className = 'mt-2 small text-' + kind;
    el.textContent = text;
  }

  function render() {
    if (!Q.hasBackend()) {
      root.innerHTML = '<h3 class="mb-3">Profile</h3><p class="text-muted">Progress tracking is not configured for this site.</p>';
      return;
    }
    if (!Q.isLoggedIn()) {
      root.innerHTML = '<h3 class="mb-3">Profile</h3><div class="alert alert-light border" id="signin-hint">Sign in with GitHub (top right) to edit your profile and import solved problems.</div>';
      return;
    }
    var cur = (Q.getProfile() || {}).qoj_handle || '';
    root.innerHTML = '<h3 class="mb-3">Profile</h3>' +
      '<h5>QOJ handle</h5><p class="text-muted small">Shown instead of your GitHub name on rankings.</p>' +
      '<div class="input-group mb-1" style="max-width:420px"><input type="text" class="form-control" id="qoj-handle-input" maxlength="40" placeholder="QOJ handle" value="' + esc(cur) + '">' +
      '<button class="btn btn-outline-dark" type="button" id="qoj-handle-save">Save</button></div><div id="handle-msg" class="mt-2 small"></div>' +
      '<hr><h5>Import solved problems</h5>' +
      '<p class="small">Open <code>https://qoj.ac/user/profile/&lt;handle&gt;</code>, press Ctrl/Cmd+S, and choose the saved .html file below. ' +
      'It is parsed in your browser and never uploaded; only the problem ids are stored in your progress. Nothing is ever un-marked.</p>' +
      '<input type="file" class="form-control mb-2" id="import-file" accept=".html,.htm" style="max-width:420px">' +
      '<div id="import-preview" class="mb-2"></div>' +
      '<button class="btn btn-success btn-sm d-none" type="button" id="import-confirm">Import</button><div id="import-msg" class="mt-2 small"></div>';
    document.getElementById('qoj-handle-save').addEventListener('click', saveHandle);
    document.getElementById('import-file').addEventListener('change', onFile);
    document.getElementById('import-confirm').addEventListener('click', confirmImport);
  }

  async function saveHandle() {
    var out = document.getElementById('handle-msg');
    var v = document.getElementById('qoj-handle-input').value.trim();
    if (v && !HANDLE_RE.test(v)) { msg(out, 'danger', 'Invalid handle: use 1-40 letters, digits, "_", "." or "-".'); return; }
    var r = await Q.saveHandle(v);
    if (r.error) {
      var m = String(r.error.message || r.error);
      if (/qoj_handle|column|schema cache/i.test(m)) m = 'The qoj_handle column does not exist yet: ask the admin to run qoj/supabase_migration.sql.';
      msg(out, 'danger', 'Could not save: ' + m);
    } else msg(out, 'success', v ? 'Saved.' : 'Handle cleared.');
  }

  async function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    var prev = document.getElementById('import-preview'), btn = document.getElementById('import-confirm');
    var out = document.getElementById('import-msg');
    btn.classList.add('d-none'); out.textContent = ''; pending = null;
    if (!f) { prev.innerHTML = ''; return; }
    prev.innerHTML = '<span class="text-muted">Reading…</span>';
    var parsed, problems, mine;
    try {
      parsed = window.QOJImport.parseQojProfile(await f.text());
      problems = await Q.loadProblems();
      mine = await Q.fetchMyProgress();
    } catch (e) { prev.innerHTML = '<span class="text-danger">Could not read the file.</span>'; return; }
    var ids = parsed.solvedIds, idSet = new Set(ids);
    var newIds = ids.filter(function (id) { return !mine.has(id); });
    var h = '<table class="table table-sm table-bordered w-auto"><tbody>' +
      '<tr><td>Handle in page</td><td>' + (parsed.handle ? esc(parsed.handle) : '<span class="text-muted">not found</span>') + '</td></tr>' +
      '<tr><td>Accepted problems found</td><td>' + ids.length + '</td></tr>';
    Q.lists().forEach(function (l) {
      var inList = problems.filter(function (p) { return p.list === l.key && idSet.has(String(p.id)); }).length;
      h += '<tr><td>' + esc(l.label) + '</td><td>' + inList + '</td></tr>';
    });
    h += '<tr><td>Already marked</td><td>' + (ids.length - newIds.length) + '</td></tr>' +
      '<tr><td>New to import</td><td>' + newIds.length + '</td></tr></tbody></table>';
    var saved = ((Q.getProfile() || {}).qoj_handle || '').toLowerCase();
    if (parsed.handle && saved && parsed.handle.toLowerCase() !== saved) {
      h += '<div class="text-warning small">Warning: this page belongs to "' + esc(parsed.handle) + '" but your saved handle is "' + esc(saved) + '".</div>';
    }
    if (!ids.length) h += '<div class="text-danger small">No accepted problems found in this file.</div>';
    prev.innerHTML = h;
    pending = { newIds: newIds };
    if (newIds.length) { btn.textContent = 'Import ' + newIds.length + ' problems'; btn.classList.remove('d-none'); }
  }

  async function confirmImport() {
    var out = document.getElementById('import-msg'), btn = document.getElementById('import-confirm');
    if (!pending || !pending.newIds.length) return;
    btn.disabled = true;
    var r = await Q.setDone(pending.newIds, true);
    btn.disabled = false;
    if (r.error) { msg(out, 'danger', 'Import failed: ' + (r.error.message || r.error)); return; }
    msg(out, 'success', 'Imported ' + pending.newIds.length + ' problems.');
    pending = null;
    btn.classList.add('d-none');
  }

  Q.ready.then(function () { render(); Q.onAuth(function () { render(); }); });
})();
