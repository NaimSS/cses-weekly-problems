const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(extra = {}) {
  const window = Object.assign({}, extra);
  const document = { readyState: 'complete', getElementById: () => null, addEventListener() {} };
  const ctx = vm.createContext({ window, document, setTimeout, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/app.js'), 'utf8'), ctx);
  return window.QOJ;
}

test('escapeHtml escapes dangerous characters', () => {
  const Q = load();
  assert.strictEqual(Q.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(Q.escapeHtml(null), '');
  assert.strictEqual(Q.escapeHtml(63), '63');
});

test('pid prefixes ids', () => {
  assert.strictEqual(load().pid('63'), 'qoj:63');
});

test('displayName prefers qoj_handle, then username, then Anonymous', () => {
  const Q = load();
  assert.strictEqual(Q.displayName({ qoj_handle: 'h', username: 'u' }), 'h');
  assert.strictEqual(Q.displayName({ username: 'u' }), 'u');
  assert.strictEqual(Q.displayName({ qoj_handle: '  ', username: null }), 'Anonymous');
  assert.strictEqual(Q.displayName(null), 'Anonymous');
});

test('lists falls back to defaults and filters disabled', () => {
  assert.deepStrictEqual([...load().lists().map(l => l.key)], ['D', 'C']);
  const Q = load({ QOJ_LISTS: [
    { key: 'C', label: 'Easy I', count: 2, enabled: true },
    { key: 'A', label: 'Hard', count: 0, enabled: false },
    { key: 'B', label: 'Medium I', count: 2, enabled: true }] });
  assert.deepStrictEqual([...Q.lists().map(l => l.key)], ['C', 'B']);
});

test('problemTableHtml escapes names and disables checks when logged out', () => {
  const Q = load();
  const html = Q.problemTableHtml([{ id: '5', name: '<b>x</b>', source: 'A · B', tags: ['T'], url: 'https://qoj.ac/problem/5' }], { checked: new Set(['5']), canEdit: false });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('data-id="5" checked disabled'));
  assert.strictEqual((html.match(/bg-secondary/g) || []).length, 2);
});

test('assignRanks handles ties', () => {
  const Q = load();
  const rows = Q.assignRanks([{ name: 'b', t: 2 }, { name: 'a', t: 2 }, { name: 'c', t: 5 }], r => r.t);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows.map(r => [r.name, r.rank]))), [['c', 1], ['a', 2], ['b', 2]]);
});

function fakeClient({ getSession, signIn } = {}) {
  const listeners = [];
  const q = { select() { return q; }, eq() { return q; }, order() { return q; }, range() { return q; },
    then(ok, bad) { return Promise.resolve({ data: [], count: 0, error: null }).then(ok, bad); } };
  return {
    listeners,
    auth: {
      getSession: getSession || (() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange(cb) { listeners.push(cb); },
      signInWithOAuth: signIn || (() => Promise.resolve({ error: null })),
    },
    from() { return q; },
  };
}
function loadWith(client, extra = {}) {
  return load(Object.assign({ QOJ_CONFIG: { supabaseUrl: 'u', supabaseKey: 'k' }, supabase: { createClient: () => client } }, extra));
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('auth listener is registered even when getSession rejects', async () => {
  const client = fakeClient({ getSession: () => Promise.reject(new Error('storage blocked')) });
  const Q = loadWith(client);
  await Q.ready;
  assert.strictEqual(client.listeners.length, 1);
  const seen = [];
  Q.onAuth((u) => seen.push(u && u.id));
  client.listeners[0]('SIGNED_IN', { user: { id: 'u1' } });
  await tick();
  assert.deepStrictEqual(seen, ['u1']);
  assert.strictEqual(Q.getUser().id, 'u1');
});

test('superseded auth events notify pages only with the latest user', async () => {
  const client = fakeClient();
  const Q = loadWith(client);
  await Q.ready;
  const seen = [];
  Q.onAuth((u) => seen.push(u && u.id));
  client.listeners[0]('SIGNED_IN', { user: { id: 'a' } });
  client.listeners[0]('SIGNED_IN', { user: { id: 'b' } });
  await tick();
  assert.deepStrictEqual(seen, ['b']);
});

test('signIn surfaces OAuth errors instead of rejecting', async () => {
  const alerts = [];
  const Q = loadWith(fakeClient({ signIn: () => Promise.reject(new Error('popup blocked')) }), { alert: (m) => alerts.push(m) });
  await Q.ready;
  await Q.signIn();
  assert.deepStrictEqual(alerts, ['Could not sign in: popup blocked']);
});

test('problemTableHtml labels checkboxes and uses the disabled tooltip', () => {
  const Q = load();
  const html = Q.problemTableHtml([{ id: '5', name: 'A "b"' }], { canEdit: false, disabledTitle: 'Loading…' });
  assert.ok(html.includes('aria-label="Solved #5 A &quot;b&quot;"'));
  assert.ok(html.includes('title="Loading…"'));
  assert.ok(Q.problemTableHtml([{ id: '5', name: 'x' }], { canEdit: true }).indexOf('disabled') === -1);
});
