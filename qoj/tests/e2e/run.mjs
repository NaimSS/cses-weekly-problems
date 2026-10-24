// End-to-end suite: headless Chrome over CDP against a generated copy of the site with a fake supabase-js.
// Usage (repo root): node qoj/tests/e2e/run.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchChrome, newTarget } from './cdp.mjs';
import { startServer } from './server.mjs';
import { FAKE_SUPABASE } from './fake-supabase.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const SCREENS = process.env.QOJ_SCREENS ||
  '/private/tmp/claude-501/-Users-naimsantos-Documents-CSES/96f2dea8-8df8-405d-80b6-4eb2d4f690ee/scratchpad/screens';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- reporting ---------- */
let failures = 0;
function report(ok, name, err) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + String(err && err.message || err).split('\n').join('\n      ')}`);
}
async function check(name, fn) {
  try { await fn(); report(true, name); } catch (e) { report(false, name, e); }
}

/* ---------- site build ---------- */
const tmp = mkdtempSync(join(tmpdir(), 'qoj-e2e-'));
const site = join(tmp, 'site');
cpSync(join(REPO, 'qoj'), site, { recursive: true, filter: (s) => !/__pycache__|\/tests(\/|$)/.test(s) });
for (const f of ['weeks_data.json', 'processed.csv']) rmSync(join(site, f), { force: true });
rmSync(join(site, 'weeks'), { recursive: true, force: true });
writeFileSync(join(site, 'processed.csv'), 'id,name,list,url\n');
writeFileSync(join(site, 'weeks_data.json'), '{}');
// long source badges on every problem (mobile overflow checks); nothing asserts on source text
const LONG_SOURCE = 'The 3rd Universal Cup Stage 27: Some-Very-Long-Contest-Name-Without-Any-Spaces-2026 · Day 1';
execFileSync(join(REPO, '.venv/bin/python'), ['-I', '-c', `import csv,sys
p=sys.argv[1]; rows=list(csv.DictReader(open(p,newline='',encoding='utf-8')))
for r in rows: r['source']=sys.argv[2]
w=csv.DictWriter(open(p,'w',newline='',encoding='utf-8'),fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)`,
  join(site, 'problems.csv'), LONG_SOURCE], { stdio: 'pipe' });
const WEEK_DATES = ['2026-10-18', '2026-10-25'];
for (const d of WEEK_DATES) {
  execFileSync(join(REPO, '.venv/bin/python'), [join(REPO, 'qoj/generate.py'), '--date', d,
    '--problems', join(site, 'problems.csv'), '--processed', join(site, 'processed.csv'),
    '--weeks-data', join(site, 'weeks_data.json'), '--output-dir', site], { stdio: 'pipe' });
}
const weeksData = JSON.parse(readFileSync(join(site, 'weeks_data.json'), 'utf8'));
const problems = JSON.parse(readFileSync(join(site, 'problems.json'), 'utf8'));
const LISTS = ['C', 'C2', 'B', 'B2'];
const LIST_COUNTS = { C: 2, C2: 2, B: 2, B2: 1 };
const LIST_SIZES = { C: 99, C2: 50, B: 98, B2: 76 };
const weekIds = (d) => LISTS.flatMap((k) => weeksData[d][k].map((p) => p.id));
const enabledProblems = problems.filter((p) => LISTS.includes(p.list));
const XSS = '<img src=x onerror=window.__xss=1>';

/* ---------- fake data ---------- */
const NOW = '2026-10-20T00:00:00Z';
const prog = (u, id, done = true) => ({ user_id: u, problem_id: 'qoj:' + id, done, updated_at: NOW });
const LONG_HANDLE = 'AliceQ' + 'x'.repeat(34); // 40 chars, the max allowed
function makeDb({ session = 'u1', bulk = false, missingHandleColumn = false, longHandle = false, ...extra } = {}) {
  const w1 = weekIds(WEEK_DATES[0]), w2 = weekIds(WEEK_DATES[1]);
  const progress = [
    // u1: 3 of week1, 1 of week2
    prog('u1', w1[0]), prog('u1', w1[1]), prog('u1', w1[6]), prog('u1', w2[0]), prog('u1', w1[2], false),
    // u2: all of week1, 2 of week2
    ...w1.map((i) => prog('u2', i)), prog('u2', w2[3]), prog('u2', w2[4]),
    // u3: 1 of week1 + CSES-style bare numeric rows that must be ignored
    prog('u3', w1[3]),
    { user_id: 'u3', problem_id: w1[4], done: true, updated_at: NOW },
    { user_id: 'u3', problem_id: '1068', done: true, updated_at: NOW },
  ];
  if (bulk) for (const u of ['bulk1', 'bulk2', 'bulk3', 'bulk4']) enabledProblems.forEach((p) => progress.push(prog(u, p.id)));
  const profiles = [
    { user_id: 'u1', username: 'alice', avatar_url: null, qoj_handle: 'AliceQ' },
    { user_id: 'u2', username: XSS, avatar_url: null, qoj_handle: null },
    { user_id: 'u3', username: 'carol', avatar_url: null, qoj_handle: '<svg onload=window.__xss=1>' },
  ];
  if (bulk) ['bulk1', 'bulk2', 'bulk3', 'bulk4'].forEach((u) => profiles.push({ user_id: u, username: u, avatar_url: null, qoj_handle: null }));
  if (missingHandleColumn) profiles.forEach((p) => delete p.qoj_handle);
  if (longHandle) profiles[0].qoj_handle = LONG_HANDLE;
  return {
    session: session ? { user: { id: session, user_metadata: { user_name: profiles.find((p) => p.user_id === session)?.username } } } : null,
    progress, profiles, missingHandleColumn, ...extra,
  };
}

/* ---------- bootstrap css (cached once; empty if offline) ---------- */
let BOOTSTRAP_CSS = '';
try {
  const r = await fetch('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css', { signal: AbortSignal.timeout(8000) });
  if (r.ok) BOOTSTRAP_CSS = await r.text();
} catch {}
console.log(`# bootstrap css: ${BOOTSTRAP_CSS ? 'loaded from network' : 'OFFLINE (empty stub)'}`);

/* ---------- browser + page helper ---------- */
const chrome = await launchChrome();
const srv = await startServer(site);
const ORIGIN = `http://127.0.0.1:${srv.port}/`;

async function openPage(path, { db = null, width = 1100, height = 900, wait = null, hash = '', preScript = null } = {}) {
  const t = await newTarget(chrome.port);
  const { send, on } = t;
  const errors = [];
  const page = { send, errors, close: () => t.close() };
  on('Runtime.exceptionThrown', (p) => errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' ')); });
  on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push('log: ' + p.entry.text + ' ' + (p.entry.url || '')); });
  on('Page.javascriptDialogOpening', (p) => {
    errors.push('dialog: ' + p.message);
    send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  on('Fetch.requestPaused', async (p) => {
    const isSb = /supabase-js/.test(p.request.url);
    const body = isSb ? FAKE_SUPABASE : BOOTSTRAP_CSS;
    await send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: isSb ? 'text/javascript' : 'text/css' }, { name: 'access-control-allow-origin', value: '*' }],
      body: Buffer.from(body).toString('base64'),
    }).catch(() => {});
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase-js*' }, { urlPattern: '*bootstrap*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  if (db) await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__FAKE_DB__ = ${JSON.stringify(db)};` });
  if (preScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: preScript });
  page.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr);
    return r.result.value;
  };
  page.waitFor = async (expr, what = expr, timeout = 6000) => {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await page.eval(`!!(${expr})`); if (last) return; } catch (e) { last = e.message; }
      await sleep(40);
    }
    throw new Error(`timeout waiting for: ${what}`);
  };
  page.text = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  page.writes = () => page.eval('window.__FAKE_WRITES__ || []');
  page.click = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
  await send('Page.navigate', { url: ORIGIN + path + hash });
  await page.waitFor(`document.readyState === 'complete' && window.QOJ`, 'page load');
  await page.waitFor(`document.querySelector('#site-header nav')`, 'header rendered');
  if (wait) await page.waitFor(wait, 'page ready: ' + wait);
  return page;
}

/* run fn on a page, then assert it produced no JS errors */
async function onPage(name, path, opts, fn) {
  let page;
  try {
    page = await openPage(path, opts);
    await fn(page);
    await sleep(60);
    report(page.errors.length === 0, name + ' (no JS/console errors)', page.errors.join('\n'));
  } catch (e) {
    report(false, name, e);
    if (page && page.errors.length) console.log('      errors: ' + page.errors.join(' | '));
  } finally { if (page) await page.close(); }
}

const READY = {
  all: `document.querySelector('#weeks-table')`,
  rank: `document.querySelector('table.rank-table') || document.querySelector('#page .text-muted:not(:only-child)')`,
  leaderboard: `document.querySelector('table.rank-table')`,
  solved: `document.querySelector('table.problem-table')`,
  profile: `document.querySelector('#qoj-handle-input') || document.querySelector('#signin-hint')`,
  week: `document.querySelector('table.problem-table')`,
};
const ROUTES = [
  ['all.html', 'all', 'all'], ['rank.html', 'rank', 'rank'], ['leaderboard.html', 'leaderboard', 'leaderboard'],
  ['solved.html', 'solved', 'solved'], ['profile.html', 'profile', 'profile'],
  ...WEEK_DATES.map((d) => [`weeks/${d}.html`, 'weekly', 'week']),
];
const NAV_ACTIVE = (key) => `document.querySelector('#site-header .nav-link.active')?.getAttribute('href')`;

const USER = (n) => makeDb({ session: n });
const OUT = (n) => makeDb({ session: null });

try {
  mkdirSync(SCREENS, { recursive: true });

  /* ===== 1. every route, logged out and in; nav links ===== */
  for (const mode of ['logged-out', 'logged-in']) {
    const db = mode === 'logged-in' ? makeDb({ session: 'u1' }) : makeDb({ session: null });
    await onPage(`index.html redirects to latest week (${mode})`, 'index.html', { db, wait: `location.pathname.endsWith('weeks/${WEEK_DATES[1]}.html')` }, async (p) => {
      await p.waitFor(`document.querySelector('table.problem-table')`);
    });
    for (const [path, active, kind] of ROUTES) {
      await onPage(`${path} renders (${mode})`, path, { db, wait: READY[kind] }, async (p) => {
        const act = await p.eval(NAV_ACTIVE());
        const expect = { weekly: 'index.html', all: 'all.html', rank: 'rank.html', leaderboard: 'leaderboard.html', solved: 'solved.html', profile: 'profile.html' }[active];
        assert.ok(act && act.endsWith(expect), `active nav item is ${act}, expected ...${expect}`);
        const auth = await p.text('#auth-area');
        if (mode === 'logged-out') assert.match(auth, /Login with GitHub/); else assert.match(auth, /AliceQ/);
        if (mode === 'logged-in') {
          const safe = path.replace(/[\/.]/g, '_');
          const shot = await p.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(SCREENS, `${safe}.png`), Buffer.from(shot.data, 'base64'));
        }
      });
    }
  }
  for (const from of ['all.html', `weeks/${WEEK_DATES[0]}.html`]) {
    await onPage(`nav links resolve from ${from}`, from, { db: makeDb({ session: null }), wait: READY[from === 'all.html' ? 'all' : 'week'] }, async (p) => {
      const hrefs = await p.eval(`[...document.querySelectorAll('#site-header a[href]')].map(a => a.href)`);
      assert.ok(hrefs.length >= 7, 'expected title + 6 nav links, got ' + hrefs.length);
      for (const h of hrefs) {
        const r = await fetch(h);
        assert.equal(r.status, 200, `${h} -> ${r.status}`);
      }
    });
  }
  await onPage('all.html links to every week + rank/leaderboard', 'all.html', { db: OUT(), wait: READY.all }, async (p) => {
    const hrefs = await p.eval(`[...document.querySelectorAll('#page a[href]')].map(a => a.href)`);
    for (const d of WEEK_DATES) assert.ok(hrefs.includes(`${ORIGIN}weeks/${d}.html`), 'missing week link ' + d);
    for (const h of hrefs) assert.equal((await fetch(h)).status, 200, h);
    const first = await p.eval(`document.querySelector('#weeks-table tbody tr td').innerText`);
    assert.equal(first, WEEK_DATES[1], 'newest week first');
  });

  /* ===== 2. week page ===== */
  const W = WEEK_DATES[0], wIds = weekIds(W);
  await onPage('week: rows/titles/links, checkboxes disabled when logged out', `weeks/${W}.html`, { db: OUT(), wait: READY.week }, async (p) => {
    assert.equal(await p.eval(`document.querySelectorAll('#pane-problems table.problem-table tbody tr[data-id]').length`), 7);
    const per = await p.eval(`[...document.querySelectorAll('#pane-problems table.problem-table')].map(t => t.querySelectorAll('tbody tr[data-id]').length)`);
    assert.deepEqual(per, [2, 2, 2, 1]);
    const links = await p.eval(`[...document.querySelectorAll('table.problem-table tbody tr[data-id]')].map(tr => [tr.dataset.id, tr.querySelector('a').href])`);
    assert.deepEqual(links.map((l) => l[0]), wIds);
    for (const [id, href] of links) assert.equal(href, `https://qoj.ac/problem/${id}`);
    assert.equal(await p.eval(`[...document.querySelectorAll('input.solve-check')].every(c => c.disabled)`), true);
    assert.equal(await p.eval(`document.querySelectorAll('input.solve-check').length`), 7);
    const headings = await p.eval(`[...document.querySelectorAll('#pane-problems h4')].map(h => h.innerText)`);
    assert.deepEqual(headings, ['Easy I', 'Easy II', 'Medium I', 'Medium II']);
  });
  await onPage('week: logged-in pre-checked, toggle writes upsert qoj:<id>', `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), wait: `document.querySelector('input.solve-check:checked')` }, async (p) => {
    const checked = await p.eval(`[...document.querySelectorAll('input.solve-check:checked')].map(c => c.dataset.id)`);
    assert.deepEqual(checked.sort(), [wIds[0], wIds[1], wIds[6]].sort());
    assert.equal(await p.eval(`[...document.querySelectorAll('input.solve-check')].some(c => c.disabled)`), false);
    const target = wIds[2];
    await p.click(`input.solve-check[data-id="${target}"]`);
    await p.waitFor(`window.__FAKE_WRITES__.length === 1`);
    let w = (await p.writes())[0];
    assert.equal(w.op, 'upsert'); assert.equal(w.table, 'progress');
    assert.equal(w.opts.onConflict, 'user_id,problem_id');
    assert.equal(w.rows.length, 1);
    assert.equal(w.rows[0].problem_id, 'qoj:' + target); assert.equal(w.rows[0].done, true); assert.equal(w.rows[0].user_id, 'u1');
    await p.waitFor(`document.querySelector('input.solve-check[data-id="${target}"]').checked && !document.querySelector('input.solve-check[data-id="${target}"]').disabled`);
    await p.click(`input.solve-check[data-id="${target}"]`);
    await p.waitFor(`window.__FAKE_WRITES__.length === 2`);
    w = (await p.writes())[1];
    assert.equal(w.rows[0].problem_id, 'qoj:' + target); assert.equal(w.rows[0].done, false);
    // survives tab switching
    await p.eval(`document.querySelector('[data-tab="rankings"]').click()`);
    await p.eval(`document.querySelector('[data-tab="problems"]').click()`);
    assert.equal(await p.eval(`document.querySelector('input.solve-check[data-id="${wIds[0]}"]').checked`), true);
    assert.equal(await p.eval(`document.querySelector('input.solve-check[data-id="${target}"]').checked`), false);
  });
  await onPage('week: Rankings tab counts and display names', `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), wait: READY.week }, async (p) => {
    await p.eval(`document.querySelector('[data-tab="rankings"]').click()`);
    await p.waitFor(`document.querySelector('table.week-board')`);
    const rows = await p.eval(`[...document.querySelectorAll('table.week-board tbody tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/^[🥇🥈🥉]\\s*/u,"").trim()))`);
    // u2 = 7/7, u1 = 3/7, u3 = 1/7 (bare numeric row ignored)
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].slice(0, 3), ['1', XSS, '7 / 7']);
    assert.deepEqual(rows[1].slice(0, 3), ['2', 'AliceQ', '3 / 7']);
    assert.deepEqual(rows[2].slice(0, 3), ['3', '<svg onload=window.__xss=1>', '1 / 7']);
    assert.deepEqual(rows[1].slice(3), ['2 / 2', '0 / 2', '0 / 2', '1 / 1']); // wIds[0],[1] in C; wIds[6] is B2
    assert.equal(await p.eval(`document.querySelectorAll('table.week-grid tbody tr').length`), 3);
    assert.equal(await p.eval(`window.__xss`), undefined);
  });
  await onPage('week: name falls back to username when qoj_handle column is missing', `weeks/${W}.html`, { db: makeDb({ session: 'u1', missingHandleColumn: true }), wait: READY.week }, async (p) => {
    await p.eval(`document.querySelector('[data-tab="rankings"]').click()`);
    await p.waitFor(`document.querySelector('table.week-board')`);
    assert.match(await p.text('table.week-board'), /alice/);
    assert.match(await p.text('#auth-area'), /alice/);
  });

  /* ===== 3. rank.html ===== */
  await onPage('rank: matrix with both weeks, per-cell counts, expand, total', 'rank.html', { db: makeDb({ session: 'u1' }), wait: `document.querySelector('table.rank-table tbody tr')` }, async (p) => {
    const head = await p.eval(`[...document.querySelectorAll('table.rank-table thead th')].map(th => th.innerText.trim())`);
    assert.deepEqual(head, ['#', 'User', WEEK_DATES[1], WEEK_DATES[0], 'Total']);
    const rows = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/^[🥇🥈🥉]\\s*/u,"").trim()))`);
    // u2: wk2 2/7, wk1 7/7 total 9 ; u1: wk2 1/7, wk1 3/7 total 4 ; u3: 0/7, 1/7 total 1
    assert.deepEqual(rows.map((r) => r.slice(2)), [['2/7', '7/7', '9'], ['1/7', '3/7', '4'], ['0/7', '1/7', '1']]);
    assert.deepEqual(rows.map((r) => r[1]), [XSS, 'AliceQ', '<svg onload=window.__xss=1>']);
    await p.eval(`document.querySelector('th[data-week="${W}"]').click()`);
    const head2 = await p.eval(`[...document.querySelectorAll('table.rank-table thead th')].map(th => th.innerText.replace(/\\s+/g,' ').trim())`);
    assert.equal(head2.length, 2 + 1 + 7 + 1);
    for (const id of wIds) assert.ok(head2.some((h) => h.endsWith('#' + id)), 'missing column #' + id);
    const u1 = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')[1].children].map(td => td.innerText.replace(/^[🥇🥈🥉]\\s*/u,"").trim())`);
    assert.equal(u1.slice(3, 10).join(''), wIds.map((id) => [wIds[0], wIds[1], wIds[6]].includes(id) ? '✓' : '✗').join(''));
    await p.eval(`document.querySelector('th[data-week="${W}"]').click()`);
    assert.equal(await p.eval(`document.querySelectorAll('table.rank-table thead th').length`), 5);
    assert.equal(await p.eval(`window.__xss`), undefined);
  });

  /* ===== 4. leaderboard ===== */
  const grand = enabledProblems.length;
  await onPage('leaderboard: ordering, per-list counts, qoj-only, >1000 rows paginate', 'leaderboard.html', { db: makeDb({ session: null, bulk: true }), wait: `document.querySelector('table.rank-table tbody tr')` }, async (p) => {
    const rows = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/^[🥇🥈🥉]\\s*/u,"").replace(/\\s+/g,' ').trim()))`);
    assert.equal(grand, 323);
    const bulk = rows.filter((r) => /^bulk/.test(r[1]));
    assert.equal(bulk.length, 4);
    for (const r of bulk) assert.equal(r[6], `323 / 323`);
    assert.deepEqual(bulk.map((r) => r[0]), ['1', '1', '1', '1']); // tied rank
    const head = await p.eval(`[...document.querySelectorAll('table.rank-table thead th')].map(th => th.innerText.trim())`);
    assert.deepEqual(head, ['#', 'User', 'Easy I', 'Easy II', 'Medium I', 'Medium II', 'Total']);
    assert.deepEqual(bulk[0].slice(2, 6), ['99 / 99', '50 / 50', '98 / 98', '76 / 76']);
    const alice = rows.find((r) => r[1] === 'AliceQ'), u2 = rows.find((r) => r[1] === XSS), carol = rows.find((r) => r[1].startsWith('<svg'));
    const cnt = (ids) => LISTS.map((k) => ids.filter((i) => problems.find((p2) => p2.id === i && p2.list === k)).length);
    const w1 = weekIds(WEEK_DATES[0]), w2 = weekIds(WEEK_DATES[1]);
    const expU1 = cnt([w1[0], w1[1], w1[6], w2[0]]), expU2 = cnt([...w1, w2[3], w2[4]]);
    assert.deepEqual(alice.slice(2, 6).map((s) => +s.split(' / ')[0]), expU1);
    assert.equal(alice[6], `4 / ${grand}`);
    assert.deepEqual(u2.slice(2, 6).map((s) => +s.split(' / ')[0]), expU2);
    assert.equal(u2[6], `9 / ${grand}`);
    assert.equal(carol[6], `1 / ${grand}`, 'bare numeric / non-qoj rows must be ignored');
    assert.ok(rows.indexOf(u2) < rows.indexOf(alice) && rows.indexOf(alice) < rows.indexOf(carol));
    assert.equal(await p.eval(`window.__xss`), undefined);
  });

  /* ===== 5. solved.html ===== */
  await onPage('solved: tabs, counts, filters, toggle write', 'solved.html', { db: makeDb({ session: 'u1' }), wait: READY.solved }, async (p) => {
    const tabs = await p.eval(`[...document.querySelectorAll('.list-tabs [data-list]')].map(a => a.dataset.list)`);
    assert.deepEqual(tabs, LISTS);
    const mine = new Set([weekIds(W)[0], weekIds(W)[1], weekIds(W)[6], weekIds(WEEK_DATES[1])[0]]);
    for (const k of LISTS) {
      await p.eval(`document.querySelector('.list-tabs [data-list="${k}"]').click()`);
      const ps = problems.filter((x) => x.list === k);
      assert.equal(ps.length, LIST_SIZES[k]);
      assert.equal(await p.eval(`document.querySelectorAll('table.problem-table tbody tr[data-id]').length`), LIST_SIZES[k]);
      const n = ps.filter((x) => mine.has(x.id)).length;
      assert.equal(await p.text('#solved-count'), `Solved ${n} / ${LIST_SIZES[k]}`);
      assert.equal(await p.eval(`document.querySelector('.list-tabs .active').dataset.list`), k);
      const vis = (f) => p.eval(`document.querySelector('[data-filter="${f}"]').click(), document.querySelectorAll('table.problem-table tbody tr[data-id]:not(.d-none)').length`);
      assert.equal(await vis('solved'), n);
      assert.equal(await vis('unsolved'), LIST_SIZES[k] - n);
      assert.equal(await vis('all'), LIST_SIZES[k]);
    }
    await p.eval(`document.querySelector('.list-tabs [data-list="C"]').click()`);
    const first = await p.eval(`document.querySelector('input.solve-check:not(:checked)').dataset.id`);
    await p.eval(`document.querySelector('[data-filter="unsolved"]').click()`);
    await p.click(`input.solve-check[data-id="${first}"]`);
    await p.waitFor(`window.__FAKE_WRITES__.length === 1`);
    const w = (await p.writes())[0];
    assert.equal(w.rows[0].problem_id, 'qoj:' + first); assert.equal(w.rows[0].done, true);
    const n0 = problems.filter((x) => x.list === 'C' && mine.has(x.id)).length;
    await p.waitFor(`document.querySelector('#solved-count').innerText === 'Solved ${n0 + 1} / 99'`);
    // filter 'unsolved' now hides the row we ticked
    assert.equal(await p.eval(`document.querySelector('tr[data-id="${first}"]').classList.contains('d-none')`), true);
  });
  await onPage('solved: logged-out is read-only', 'solved.html', { db: OUT(), wait: READY.solved }, async (p) => {
    assert.equal(await p.eval(`[...document.querySelectorAll('input.solve-check')].every(c => c.disabled)`), true);
    assert.equal(await p.text('#solved-count'), 'Solved 0 / 99');
    assert.ok(await p.eval(`!!document.querySelector('#signin-hint')`));
  });

  /* ===== 6. profile ===== */
  await onPage('profile: logged-out shows sign-in hint', 'profile.html', { db: OUT(), wait: READY.profile }, async (p) => {
    assert.ok(await p.eval(`!!document.querySelector('#signin-hint')`));
    assert.equal(await p.eval(`!!document.querySelector('#qoj-handle-input')`), false);
  });
  await onPage('profile: save handle valid/invalid', 'profile.html', { db: makeDb({ session: 'u1' }), wait: `document.querySelector('#qoj-handle-input')` }, async (p) => {
    assert.equal(await p.eval(`document.querySelector('#qoj-handle-input').value`), 'AliceQ');
    await p.eval(`document.querySelector('#qoj-handle-input').value = 'a b'; document.querySelector('#qoj-handle-save').click()`);
    await p.waitFor(`/Invalid handle/.test(document.querySelector('#handle-msg').innerText)`);
    assert.equal((await p.writes()).length, 0);
    await p.eval(`document.querySelector('#qoj-handle-input').value = 'New_Handle-1'; document.querySelector('#qoj-handle-save').click()`);
    await p.waitFor(`document.querySelector('#handle-msg').innerText === 'Saved.'`);
    const w = await p.writes();
    assert.equal(w.length, 1);
    assert.deepEqual([w[0].op, w[0].table, w[0].values, w[0].eq], ['update', 'profiles', { qoj_handle: 'New_Handle-1' }, [['user_id', 'u1']]]);
    assert.match(await p.text('#auth-area'), /New_Handle-1/);
  });
  await onPage('profile: missing qoj_handle column shows migration message', 'profile.html', { db: makeDb({ session: 'u1', missingHandleColumn: true }), wait: `document.querySelector('#qoj-handle-input')` }, async (p) => {
    await p.eval(`document.querySelector('#qoj-handle-input').value = 'Someone'; document.querySelector('#qoj-handle-save').click()`);
    await p.waitFor(`/supabase_migration\\.sql/.test(document.querySelector('#handle-msg').innerText)`);
  });
  await onPage('profile: import preview + confirm (only new ids, never done=false)', 'profile.html', { db: makeDb({ session: 'u1' }), wait: `document.querySelector('#import-file')` }, async (p) => {
    const w1 = weekIds(WEEK_DATES[0]);
    const already = [w1[0], w1[1]];                 // u1 already has these
    const fresh = [w1[2], w1[3], w1[4]];             // C/B/B2 etc: new
    const outside = '999999';                        // not in problems.json: skipped, never written
    const accepted = [...already, ...fresh, outside];
    const tried = [w1[5], '777777'];                 // Tried problems must NOT be imported
    const html = `<!-- saved from url=(0035)https://qoj.ac/user/profile/AliceQ -->
<!DOCTYPE html><html><head><title>AliceQ</title></head><body>
      <a href="/problem/7777">navjunk</a>
      <div class="list-group"><div class="list-group-item"><h4 class="list-group-item-heading">
        Accepted problems：${accepted.length} problems </h4><p class="list-group-item-text">${accepted.map((i) => `<a href="https://qoj.ac/problem/${i}" style="display:inline-block; width:4em;">${i}</a>`).join(' ')}</p>
      <h4 class="list-group-item-heading">
        Tried problems：${tried.length} problems</h4><p class="list-group-item-text">${tried.map((i) => `<a href="https://qoj.ac/problem/${i}" style="display:inline-block; width:4em;">${i}</a>`).join(' ')}</p></div></div></body></html>`;
    const file = join(tmp, 'uoj-fixture.html');
    writeFileSync(file, html);
    const { root } = await p.send('DOM.getDocument');
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
    await p.send('DOM.setFileInputFiles', { files: [file], nodeId });
    await p.waitFor(`document.querySelector('#import-preview table')`, 'import preview');
    const prev = await p.eval(`[...document.querySelectorAll('#import-preview tr')].map(tr => [...tr.children].map(td => td.innerText.trim()))`);
    const cntList = (k) => accepted.filter((i) => problems.find((x) => x.id === i && x.list === k)).length;
    const asObj = Object.fromEntries(prev);
    assert.equal(asObj['Handle in page'], 'AliceQ');
    assert.equal(asObj['Accepted problems found'], String(accepted.length));
    assert.equal(asObj['Easy I'], String(cntList('C'))); assert.equal(asObj['Easy II'], String(cntList('C2')));
    assert.equal(asObj['Medium I'], String(cntList('B'))); assert.equal(asObj['Medium II'], String(cntList('B2')));
    assert.equal(asObj['Skipped (not in premier lists)'], '1');
    assert.equal(asObj['Already marked'], '2'); assert.equal(asObj['New to import'], String(fresh.length));
    assert.equal((await p.writes()).length, 0, 'preview must not write');
    await p.click('#import-confirm');
    await p.waitFor(`/Imported/.test(document.querySelector('#import-msg').innerText)`);
    const w = await p.writes();
    assert.equal(w.length, 1);
    assert.deepEqual(w[0].rows.map((r) => r.problem_id).sort(), fresh.map((i) => 'qoj:' + i).sort());
    assert.ok(w[0].rows.every((r) => r.done === true));
  });

  /* ===== 7. XSS: covered by seeded username/handle on week/rank/leaderboard; also header ===== */
  await onPage('xss: hostile username in header + all ranking pages stays inert', 'leaderboard.html', { db: (() => { const d = makeDb({ session: 'u2' }); return d; })(), wait: `document.querySelector('table.rank-table tbody tr')` }, async (p) => {
    assert.match(await p.text('#auth-area'), /<img src=x/);
    assert.equal(await p.eval(`document.querySelectorAll('img[src="x"]').length`), 0);
    assert.equal(await p.eval(`window.__xss`), undefined);
  });
  await onPage('xss: hostile handle prefilled in profile input stays inert', 'profile.html', { db: (() => { const d = makeDb({ session: 'u3' }); return d; })(), wait: `document.querySelector('#qoj-handle-input')` }, async (p) => {
    assert.equal(await p.eval(`document.querySelector('#qoj-handle-input').value`), '<svg onload=window.__xss=1>');
    assert.equal(await p.eval(`window.__xss`), undefined);
  });

  /* ===== 8. mobile ===== */
  for (const [path, , kind] of ROUTES) {
    for (const width of [375, 390]) {
      await onPage(`mobile ${width}px: no horizontal page scroll on ${path} (40-char handle, long sources)`, path, { db: makeDb({ session: 'u1', bulk: path === 'leaderboard.html', longHandle: true }), width, height: 800, wait: READY[kind] }, async (p) => {
        // with mobile emulation Chrome widens the layout viewport (innerWidth/clientWidth) to fit the content,
        // so compare against the emulated device width, not window.innerWidth
        const measure = async (what) => {
          await sleep(100);
          const m = await p.eval(`({sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth})`);
          assert.ok(m.sw <= width && m.bw <= width, `${what}: scrollWidth ${m.sw}/${m.bw} > ${width}` + (BOOTSTRAP_CSS ? '' : ' (bootstrap offline)'));
        };
        await measure('initial');
        if (kind === 'solved' || kind === 'week') {
          const box = await p.eval(`(() => { const r = document.querySelector('input.solve-check').getBoundingClientRect(); return [r.width, r.height]; })()`);
          if (BOOTSTRAP_CSS) assert.ok(box[0] >= 22 && box[1] >= 22, 'checkbox tap target ' + box);
        }
        if (kind === 'week') {
          await p.eval(`document.querySelector('[data-tab="rankings"]').click()`); await p.waitFor(`document.querySelector('table.week-board')`);
          await measure('rankings tab');
        }
        if (kind === 'rank') { await p.eval(`document.querySelector('th[data-week]').click()`); await measure('expanded week'); }
        if (kind === 'rank' || kind === 'leaderboard' || kind === 'week') {
          // user column is sticky inside the horizontal scroller
          assert.equal(await p.eval(`getComputedStyle(document.querySelector('.rank-scroll .rank-table td.user-cell')).position`), 'sticky');
        }
        const lo = await p.eval(`(() => { const r = document.querySelector('#logout-btn').getBoundingClientRect(); return [r.width, r.height]; })()`);
        assert.ok(lo[0] >= 60 && lo[1] >= 30, 'logout tap target ' + lo);
      });
    }
  }

  /* ===== 9. Supabase failure modes ===== */
  await onPage('outage: leaderboard shows error (not an empty board)', 'leaderboard.html', { db: makeDb({ session: 'u1', fail: ['progress'] }), wait: `document.querySelector('#page .text-danger')` }, async (p) => {
    assert.match(await p.text('#page'), /Could not load leaderboard/);
    assert.doesNotMatch(await p.text('#page'), /No progress recorded/);
  });
  await onPage('outage: profiles error also surfaces on leaderboard', 'leaderboard.html', { db: makeDb({ session: null, fail: ['profiles'] }), wait: `document.querySelector('#page .text-danger')` }, async (p) => {
    assert.match(await p.text('#page'), /Could not load leaderboard/);
  });
  await onPage('outage: rank page shows error', 'rank.html', { db: makeDb({ session: 'u1', fail: ['progress'] }), wait: `document.querySelector('#page .text-danger')` }, async (p) => {
    assert.match(await p.text('#page'), /Could not load rankings/);
  });
  await onPage('outage: week page shows progress error + rankings error', `weeks/${W}.html`, { db: makeDb({ session: 'u1', fail: ['progress'] }), wait: `document.querySelector('#progress-error')` }, async (p) => {
    assert.match(await p.text('#progress-error'), /Could not load your progress/);
    await p.eval(`document.querySelector('[data-tab="rankings"]').click()`);
    await p.waitFor(`/Could not load rankings/.test(document.querySelector('#pane-rankings').innerText)`);
  });
  await onPage('outage: solved page shows progress error', 'solved.html', { db: makeDb({ session: 'u1', fail: ['progress'] }), wait: `document.querySelector('#progress-error')` }, async () => {});
  await onPage('outage: profile import shows error instead of "Already marked: 0"', 'profile.html', { db: makeDb({ session: 'u1', fail: ['progress'] }), wait: `document.querySelector('#import-file')` }, async (p) => {
    const file = join(tmp, 'outage-fixture.html');
    writeFileSync(file, `<h4>Accepted problems</h4><p><a href="/problem/${weekIds(W)[0]}">x</a></p>`);
    const { root } = await p.send('DOM.getDocument');
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
    await p.send('DOM.setFileInputFiles', { files: [file], nodeId });
    await p.waitFor(`document.querySelector('#import-preview .text-danger')`, 'import error');
    assert.match(await p.text('#import-preview'), /Could not load your current progress/);
    assert.equal(await p.eval(`document.querySelector('#import-confirm').classList.contains('d-none')`), true);
  });
  await onPage('profile: save handle with no matching profile row reports an error', 'profile.html', { db: makeDb({ session: 'u9' }), wait: `document.querySelector('#qoj-handle-input')` }, async (p) => {
    await p.eval(`document.querySelector('#qoj-handle-input').value = 'Ghost'; document.querySelector('#qoj-handle-save').click()`);
    await p.waitFor(`/Could not save/.test(document.querySelector('#handle-msg').innerText)`);
  });
  await onPage('hang: profiles query never answers, header + week still render', `weeks/${W}.html`, { db: makeDb({ session: 'u1', hang: ['profiles'] }), wait: READY.week }, async (p) => {
    assert.match(await p.text('#auth-area'), /alice/); // GitHub name until the profile arrives
    assert.equal(await p.eval(`document.querySelectorAll('input.solve-check:checked').length`), 3);
  });
  await onPage('no backend: leaderboard says tracking not configured', 'leaderboard.html', { db: { noBackend: true }, wait: `document.querySelector('table.rank-table')` }, async (p) => {
    assert.match(await p.text('table.rank-table'), /Progress tracking not configured/);
    assert.match(await p.text('#auth-area'), /Offline mode/);
  });
  await onPage('no backend: rank says tracking not configured', 'rank.html', { db: { noBackend: true }, wait: `document.querySelector('table.rank-table')` }, async (p) => {
    assert.match(await p.text('table.rank-table'), /Progress tracking not configured/);
  });

  /* ===== 10. auth + rendering races ===== */
  await onPage('logout notifies pages exactly once', 'solved.html', { db: makeDb({ session: 'u1' }), wait: READY.solved }, async (p) => {
    await p.eval(`window.__authCalls = 0; QOJ.onAuth(() => window.__authCalls++)`);
    await p.click('#logout-btn');
    await p.waitFor(`/Login with GitHub/.test(document.querySelector('#auth-area').innerText)`);
    await sleep(150);
    assert.equal(await p.eval('window.__authCalls'), 1);
    assert.ok(await p.eval(`!!document.querySelector('#signin-hint')`));
  });
  await onPage('logout error still resets the UI', 'solved.html', { db: makeDb({ session: 'u1', signOutError: true }), wait: READY.solved }, async (p) => {
    await p.eval(`window.__authCalls = 0; QOJ.onAuth(() => window.__authCalls++)`);
    await p.click('#logout-btn');
    await p.waitFor(`/Login with GitHub/.test(document.querySelector('#auth-area').innerText)`);
    await sleep(100);
    assert.equal(await p.eval('window.__authCalls'), 1);
  });
  await onPage('week: rapid tab switching drops stale rankings', `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), wait: READY.week }, async (p) => {
    await p.eval(`document.querySelector('[data-tab="rankings"]').click(); document.querySelector('[data-tab="problems"]').click()`);
    await sleep(200);
    assert.equal(await p.eval(`document.querySelector('#pane-rankings').innerText.trim()`), 'Loading rankings…');
  });
  await onPage('checkbox re-enables and reverts when setDone throws', `weeks/${W}.html`, { db: makeDb({ session: 'u1', throwOnUpsert: true }), wait: READY.week }, async (p) => {
    await p.eval(`window.__alerts = []; window.alert = (m) => window.__alerts.push(m)`);
    const id = weekIds(W)[2];
    await p.click(`input.solve-check[data-id="${id}"]`);
    await p.waitFor(`!document.querySelector('input.solve-check[data-id="${id}"]').disabled`);
    assert.equal(await p.eval(`document.querySelector('input.solve-check[data-id="${id}"]').checked`), false);
    assert.match((await p.eval('window.__alerts'))[0], /Could not save: fake network failure/);
  });
  await onPage('rank: expanding a week with no enabled-list problems keeps it collapsible', 'rank.html', {
    db: makeDb({ session: 'u1' }), wait: `document.querySelector('table.rank-table tbody tr')`,
    preScript: `Object.defineProperty(window, 'QOJ_PAGE', { configurable: true, get() { return this.__qp; },
      set(v) { if (v && v.weeks) v.weeks['2026-10-11'] = { A: [{ id: '1', name: 'Hard one', list: 'A' }] }; this.__qp = v; } });`,
  }, async (p) => {
    const ncols = () => p.eval(`document.querySelectorAll('table.rank-table thead th').length`);
    assert.equal(await ncols(), 6);
    await p.eval(`document.querySelector('th[data-week="2026-10-11"]').click()`);
    assert.equal(await ncols(), 6);
    assert.ok(await p.eval(`!!document.querySelector('th[data-week="2026-10-11"]')`));
    const cells = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')].map(tr => tr.children.length)`);
    assert.ok(cells.every((n) => n === 6), 'row widths ' + cells);
  });

  /* ===== 11. effects: burst, podium, paging/filters, no overflow ===== */
  const FX_SHOTS = process.env.QOJ_FX_SHOTS || join(SCREENS, 'qoj-fx');
  mkdirSync(FX_SHOTS, { recursive: true });
  const shot = async (p, name) => {
    const r = await p.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(FX_SHOTS, name), Buffer.from(r.data, 'base64'));
  };
  const noOverflow = (p) => p.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
  await onPage('fx: ticking a box bursts particles that clean up; unticking does not', `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), wait: READY.week + ` && !document.querySelector('input.solve-check').disabled` }, async (p) => {
    const id = weekIds(W)[2];
    await p.click(`input.solve-check[data-id="${id}"]`);
    await p.waitFor(`document.querySelectorAll('.fx-particle').length >= 12`, 'particles');
    const n = await p.eval(`document.querySelectorAll('.fx-particle').length`);
    assert.ok(n >= 12 && n <= 16, 'particles ' + n);
    assert.equal(await p.eval(`getComputedStyle(document.querySelector('.fx-particle')).pointerEvents`), 'none');
    await shot(p, 'burst-mid.png');
    await p.waitFor(`document.querySelectorAll('.fx-particle').length === 0`, 'cleanup', 3000);
    await p.waitFor(`!document.querySelector('input.solve-check[data-id="${id}"]').disabled`);
    await p.click(`input.solve-check[data-id="${id}"]`);
    await sleep(300);
    assert.equal(await p.eval(`document.querySelectorAll('.fx-particle').length`), 0);
  });
  await onPage('fx: reduced motion spawns no particles', `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), wait: READY.week + ` && !document.querySelector('input.solve-check').disabled` }, async (p) => {
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await p.click(`input.solve-check[data-id="${weekIds(W)[2]}"]`);
    await sleep(300);
    assert.equal(await p.eval(`document.querySelectorAll('.fx-particle').length`), 0);
  });
  for (const width of [375, 1440]) {
    await onPage(`fx: week rankings podium + filtered progress query + memo (${width}px)`, `weeks/${W}.html`, { db: makeDb({ session: 'u1' }), width, wait: READY.week }, async (p) => {
      await p.click('[data-tab="rankings"]');
      await p.waitFor(`document.querySelector('table.week-board tbody tr')`);
      const cls = await p.eval(`[...document.querySelectorAll('table.week-board tbody tr')].map(tr => tr.className.replace(/me-row/,'').trim())`);
      assert.equal(cls[0], 'podium-gold');
      assert.ok(cls.slice(1).every((c) => c === 'podium-silver' || c === 'podium-bronze' || c === ''), 'classes ' + cls);
      assert.match(await p.eval(`document.querySelector('table.week-board tbody tr .podium-medal').innerText`), /\u{1F947}/u);
      assert.ok(await noOverflow(p), 'horizontal overflow');
      await p.click('[data-tab="problems"]'); await p.click('[data-tab="rankings"]');
      await p.waitFor(`document.querySelector('table.week-board tbody tr')`);
      const reads = await p.eval(`window.__FAKE_READS__.filter(r => r.table === 'progress' && /user_id/.test(r.cols))`);
      assert.equal(reads.length, 1, 'rankings progress memoised: ' + JSON.stringify(reads));
      assert.equal(reads[0].inLen, weekIds(W).length, 'progress query filtered by this week ids');
      await shot(p, `week-rankings-${width}.png`);
    });
    await onPage(`fx: rank.html podium + filter + no overflow (${width}px)`, 'rank.html', { db: makeDb({ session: 'u1' }), width, wait: `document.querySelector('table.rank-table tbody tr')` }, async (p) => {
      const cls = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')].map(tr => tr.className.replace(/me-row/,'').trim())`);
      assert.deepEqual(cls, ['podium-gold', 'podium-silver', 'podium-bronze']);
      const reads = await p.eval(`window.__FAKE_READS__.filter(r => r.table === 'progress')`);
      assert.ok(reads.length && reads.every((r) => r.inLen > 0), 'rank progress filtered by picked ids');
      assert.ok(await noOverflow(p), 'horizontal overflow');
      await shot(p, `rank-${width}.png`);
    });
    await onPage(`fx: leaderboard tie shares gold + no overflow (${width}px)`, 'leaderboard.html', { db: makeDb({ session: 'u1', bulk: true }), width, wait: `document.querySelector('table.rank-table tbody tr')` }, async (p) => {
      const cls = await p.eval(`[...document.querySelectorAll('table.rank-table tbody tr')].map(tr => tr.className.replace(/me-row/,'').trim())`);
      assert.deepEqual(cls.slice(0, 4), ['podium-gold', 'podium-gold', 'podium-gold', 'podium-gold']);
      assert.ok(!cls.slice(4).includes('podium-gold'));
      assert.ok(await noOverflow(p), 'horizontal overflow');
      await shot(p, `leaderboard-${width}.png`);
    });
  }
} finally {
  await chrome.close();
  srv.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
