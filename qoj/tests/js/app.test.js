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
