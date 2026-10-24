const test = require('node:test');
const assert = require('node:assert');
const { parseQojProfile } = require('../../assets/import-parser.js');

const page = (body, head = '') => `<!DOCTYPE html><html><head>${head}<title>Profile</title></head><body>
<nav><a href="/problem/9999">nav</a><a href="/problem/8888">x</a></nav>${body}</body></html>`;

test('UOJ-style block with relative and absolute links, duplicates', () => {
  const html = page(`<div class="list-group">
    <div class="list-group-item"><h4 class="list-group-item-heading">Accepted problems：4 problems</h4>
    <p class="list-group-item-text"><a href="/problem/12">12</a> <a href="https://qoj.ac/problem/345">345</a>
    <a href="/problem/12">12</a> <a href="/problem/7?x=1">7</a></p></div></div>
    <div class="list-group-item"><a href="/problem/5555">later</a></div>`);
  const r = parseQojProfile(html);
  assert.deepStrictEqual(r.solvedIds, ['12', '345', '7']);
});

test('stops at following heading (Rejected)', () => {
  const html = page(`<div class="list-group-item"><h4 class="list-group-item-heading">Accepted problems：1</h4>
    <p><a href="/problem/1">1</a></p></div>
    <div class="list-group-item"><h4 class="list-group-item-heading">Rejected problems</h4><p><a href="/problem/2">2</a></p></div>`);
  assert.deepStrictEqual(parseQojProfile(html).solvedIds, ['1']);
});

test('stops at next list-group-item without heading tag', () => {
  const html = page(`<div class="list-group-item"><h4>Accepted problems</h4><p><a href="/problem/1">1</a></p></div>
    <div class="list-group-item"><a href="/problem/2">2</a></div>`);
  assert.deepStrictEqual(parseQojProfile(html).solvedIds, ['1']);
});

test('Chinese heading', () => {
  const html = page(`<h4 class="list-group-item-heading">AC 过的题目：2 道</h4><p><a href="/problem/10">10</a><a href="/problem/11">11</a></p>`);
  assert.deepStrictEqual(parseQojProfile(html).solvedIds, ['10', '11']);
});

test('heading with nested tags', () => {
  const html = page(`<h4><span>Accepted</span> problems</h4><a href="/problem/3">3</a>`);
  assert.deepStrictEqual(parseQojProfile(html).solvedIds, ['3']);
});

test('no heading yields empty list (nav links ignored)', () => {
  const r = parseQojProfile(page('<p>nothing</p><a href="/problem/77">77</a>'));
  assert.deepStrictEqual(r.solvedIds, []);
});

test('handle from og:url, canonical, saved-from comment', () => {
  assert.strictEqual(parseQojProfile(page('', '<meta property="og:url" content="https://qoj.ac/user/profile/Alice_1">')).handle, 'Alice_1');
  assert.strictEqual(parseQojProfile(page('', '<link rel="canonical" href="https://qoj.ac/user/profile/bob.x">')).handle, 'bob.x');
  assert.strictEqual(parseQojProfile('<!-- saved from url=(0043)https://qoj.ac/user/profile/carol -->' + page('')).handle, 'carol');
});

test('handle null when absent; empty input safe', () => {
  assert.strictEqual(parseQojProfile(page('')).handle, null);
  assert.deepStrictEqual(parseQojProfile(''), { handle: null, solvedIds: [] });
  assert.deepStrictEqual(parseQojProfile(null), { handle: null, solvedIds: [] });
});

test('real QOJ markup: Accepted and Tried in the same list-group-item, saved-from comment', () => {
  const html = `<!-- saved from url=(0035)https://qoj.ac/user/profile/NaimSS -->
<!DOCTYPE html><html><head><title>NaimSS</title></head><body><a href="/problem/9999">nav</a>
<div class="list-group"><div class="list-group-item"><h4 class="list-group-item-heading">
  Accepted problems：2 problems </h4><p class="list-group-item-text"><a href="https://qoj.ac/problem/7747" style="display:inline-block; width:4em;">7747</a>
<a href="https://qoj.ac/problem/12" style="display:inline-block; width:4em;">12</a></p>
<h4 class="list-group-item-heading">
  Tried problems：1 problems</h4><p class="list-group-item-text"><a href="https://qoj.ac/problem/55" style="display:inline-block; width:4em;">55</a></p></div></div></body></html>`;
  const r = parseQojProfile(html);
  assert.deepStrictEqual(r.solvedIds, ['7747', '12']);
  assert.strictEqual(r.handle, 'NaimSS');
});

test('linear time on pathological input (unclosed tags, long attributes)', () => {
  const cases = {
    'unclosed headings': '<h1 '.repeat(32000),
    'unclosed heading + far close': '<h2 '.repeat(32000) + '>x</h2>',
    'unclosed meta': '<meta '.repeat(32000),
    'unclosed link': '<link '.repeat(32000) + '>',
    'unclosed href': '<h4>Accepted problems</h4><a href="' + '/problem/1'.repeat(32000),
    'many headings': '<h3>Tried</h3>'.repeat(32000),
  };
  for (const [name, html] of Object.entries(cases)) {
    const t = Date.now();
    parseQojProfile(html);
    const ms = Date.now() - t;
    assert.ok(ms < 200, `${name}: ${ms}ms`);
  }
});

test('heading scan: unclosed lower heading does not hide a later Accepted block', () => {
  const html = page(`<h1 class="x">broken <h4>Accepted problems</h4><a href="/problem/42">42</a>`);
  assert.deepStrictEqual(parseQojProfile(html).solvedIds, ['42']);
  // a heading at another level does not close it
  assert.deepStrictEqual(parseQojProfile(page(`<h4>Accepted problems</h3><a href="/problem/1">1</a></h4><a href="/problem/2">2</a>`)).solvedIds, ['2']);
  // case-insensitive closing tag, last /problem/<n> in a href wins
  assert.deepStrictEqual(parseQojProfile(page(`<H4>Accepted problems</H4 ><a href="/problem/1/problem/9">x</a>`)).solvedIds, ['9']);
});

test('handle: og:url with content before property', () => {
  assert.strictEqual(parseQojProfile(page('', '<meta content="https://qoj.ac/user/profile/dave" property="og:url">')).handle, 'dave');
  assert.strictEqual(parseQojProfile(page('', '<link href="https://qoj.ac/user/profile/eve%21" rel="canonical">')).handle, 'eve!');
});
