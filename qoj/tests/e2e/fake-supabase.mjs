// Fake supabase-js UMD (only the calls listed in qoj/README.md). State: window.__FAKE_DB__.
//   { session: {user:{id,user_metadata}}|null, progress: [...], profiles: [...], missingHandleColumn: bool,
//     fail: [table…] (selects return an error), hang: [table…] (selects never settle), noBackend: bool,
//     signOutError: bool, throwOnUpsert: bool }
// Writes are recorded in window.__FAKE_WRITES__.
export const FAKE_SUPABASE = `(function () {
  var W = window;
  W.__FAKE_WRITES__ = W.__FAKE_WRITES__ || [];
  if (W.__FAKE_DB__ && W.__FAKE_DB__.noBackend) { W.supabase = {}; return; }
  var authListeners = [];
  var CAP = 1000; // PostgREST max rows per request
  function db() { return W.__FAKE_DB__; }
  function Q(table, op) { this.table = table; this.op = op; this.f = []; this.ord = []; this.rng = null; this.cols = '*'; }
  Q.prototype.select = function (c) { this.cols = c; return this; };
  Q.prototype.eq = function (c, v) { this.f.push(function (r) { return r[c] === v; }); this.eqs = (this.eqs || []).concat([[c, v]]); return this; };
  Q.prototype.like = function (c, p) {
    var re = new RegExp('^' + p.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\\\$&').replace(/%/g, '.*') + '$');
    this.f.push(function (r) { return re.test(String(r[c])); }); return this;
  };
  Q.prototype.in = function (c, a) { this.f.push(function (r) { return a.indexOf(r[c]) >= 0; }); return this; };
  Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.prototype.order = function (c, o) { this.ord.push([c, !o || o.ascending !== false]); return this; };
  Q.prototype.then = function (ok, bad) { return Promise.resolve().then(this.run.bind(this)).then(ok, bad); };
  Q.prototype.run = function () {
    var self = this, d = db();
    if (self.op === 'select') {
      if ((d.hang || []).indexOf(self.table) >= 0) return new Promise(function () {});
      if ((d.fail || []).indexOf(self.table) >= 0) return { data: null, error: { message: 'fake outage on ' + self.table } };
      var cols = self.cols === '*' ? null : self.cols.split(',').map(function (s) { return s.trim(); });
      if (self.table === 'profiles' && cols && cols.indexOf('qoj_handle') >= 0 && d.missingHandleColumn)
        return { data: null, error: { message: 'column profiles.qoj_handle does not exist' } };
      var rows = d[self.table].filter(function (r) { return self.f.every(function (f) { return f(r); }); });
      self.ord.slice().reverse().forEach(function (o) {
        rows.sort(function (a, b) { return (a[o[0]] < b[o[0]] ? -1 : a[o[0]] > b[o[0]] ? 1 : 0) * (o[1] ? 1 : -1); });
      });
      var a = self.rng ? self.rng[0] : 0, b = self.rng ? Math.min(self.rng[1], a + CAP - 1) : CAP - 1;
      rows = rows.slice(a, b + 1).map(function (r) {
        if (!cols) return Object.assign({}, r);
        var o = {}; cols.forEach(function (c) { o[c] = r[c]; }); return o;
      });
      return { data: rows, error: null };
    }
    if (self.op === 'update') {
      W.__FAKE_WRITES__.push({ op: 'update', table: self.table, values: self.vals, eq: self.eqs });
      if (self.table === 'profiles' && 'qoj_handle' in self.vals && d.missingHandleColumn)
        return { error: { message: "Could not find the 'qoj_handle' column of 'profiles' in the schema cache" } };
      var hit = d[self.table].filter(function (r) { return self.f.every(function (f) { return f(r); }); });
      hit.forEach(function (r) { Object.assign(r, self.vals); });
      // .select() after update returns the updated rows (empty when nothing matched, e.g. RLS / no row)
      return self.cols !== '*' ? { data: hit.map(function (r) { return Object.assign({}, r); }), error: null } : { error: null };
    }
    if (self.op === 'upsert') {
      if (d.throwOnUpsert) throw new Error('fake network failure');
      W.__FAKE_WRITES__.push({ op: 'upsert', table: self.table, rows: self.rowsIn, opts: self.opts });
      var keys = (self.opts && self.opts.onConflict || '').split(',');
      self.rowsIn.forEach(function (n) {
        var ex = d[self.table].filter(function (r) { return keys.every(function (k) { return r[k] === n[k]; }); })[0];
        if (ex) Object.assign(ex, n); else d[self.table].push(Object.assign({}, n));
      });
      return { error: null };
    }
  };
  var client = {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: db().session || null }, error: null }); },
      onAuthStateChange: function (cb) {
        authListeners.push(cb);
        setTimeout(function () { cb('INITIAL_SESSION', db().session || null); }, 0);
        return { data: { subscription: { unsubscribe: function () {} } } };
      },
      signInWithOAuth: function (o) { W.__FAKE_WRITES__.push({ op: 'signIn', opts: o }); return Promise.resolve({ error: null }); },
      signOut: function () {
        W.__FAKE_WRITES__.push({ op: 'signOut' });
        if (db().signOutError) return Promise.resolve({ error: { message: 'fake signOut failure' } });
        db().session = null;
        authListeners.forEach(function (cb) { cb('SIGNED_OUT', null); }); // supabase-js notifies before resolving
        return Promise.resolve({ error: null });
      }
    },
    from: function (t) {
      return {
        select: function (c) { return new Q(t, 'select').select(c); },
        upsert: function (rows, opts) { var q = new Q(t, 'upsert'); q.rowsIn = rows; q.opts = opts; return q; },
        update: function (v) { var q = new Q(t, 'update'); q.vals = v; return q; }
      };
    }
  };
  W.supabase = { createClient: function () { return client; } };
})();`;
