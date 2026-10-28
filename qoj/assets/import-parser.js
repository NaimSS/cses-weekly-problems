/* Parse a saved QOJ (UOJ fork) profile page. String/regex only so it runs in Node and the browser. */
(function () {
  'use strict';

  var HEADING_RE = /accepted\s+problems|AC\s*过的题目/i;
  var BLOCK_END_RE = /<h[1-6]\b|class\s*=\s*["'][^"']*\blist-group-item(?![-\w])/i;

  function stripTags(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* Same matches as /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, but linear: the next '>' and the next
     closing tag per level are cached, and positions only move forward, so unclosed tags cannot rescan. */
  function findBlock(html) {
    var open = /<h([1-6])\b/gi, m, gt = -2, close = {}, closeEnd = {};
    function nextClose(level, from) {
      if (close[level] === undefined || (close[level] !== -1 && close[level] < from)) {
        var re = new RegExp('</h' + level + '\\s*>', 'gi');
        re.lastIndex = from;
        var c = re.exec(html);
        close[level] = c ? c.index : -1;
        closeEnd[level] = c ? c.index + c[0].length : -1;
      }
      return close[level];
    }
    while ((m = open.exec(html))) {
      var p = m.index + m[0].length;
      if (gt !== -1 && gt < p) gt = html.indexOf('>', p);
      if (gt === -1) break;                     // no '>' left: no tag can open
      var c = nextClose(m[1], gt + 1);
      if (c === -1) continue;                   // unclosed at this level; try later headings
      open.lastIndex = closeEnd[m[1]];
      if (!HEADING_RE.test(stripTags(html.slice(gt + 1, c)))) continue;
      var rest = html.slice(closeEnd[m[1]]);
      var end = rest.search(BLOCK_END_RE);
      return end === -1 ? rest : rest.slice(0, end);
    }
    return null;
  }

  /* First <name ...> tag (up to the next '>') where `key` attr matches keyRe and `val` attr holds a
     /user/profile/<handle> URL. Tags are scanned once each (linear even for unclosed tags). */
  function allMatches(re, s) {
    var out = [], m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) { out.push(m); re.lastIndex = m.index + 1; } // overlapping, like regex backtracking
    return out;
  }
  /* keyFirst: key attr before the url attr (else after). Mirrors the greedy picks of the old one-regex patterns. */
  function tagProfile(html, name, key, val, keyFirst) {
    var open = new RegExp('<' + name, 'gi'), m;
    var keyRe = new RegExp(key, 'gi');
    var valRe = new RegExp(val + '\\s*=\\s*["\'][^"\']*\\/user\\/profile\\/([^"\'\\/?#<>\\s]+)' + (keyFirst ? '' : '["\']'), 'gi');
    while ((m = open.exec(html))) {
      var gt = html.indexOf('>', m.index), end = gt === -1 ? html.length : gt;
      var tag = html.slice(m.index, end), start = m[0].length + 1;
      var ks = allMatches(keyRe, tag).filter(function (k) { return k.index >= start; });
      var vs = allMatches(valRe, tag).filter(function (v) { return v.index >= start; });
      var hit = null;
      if (ks.length && keyFirst) {
        var k0 = ks[0].index + ks[0][0].length;
        vs.forEach(function (v) { if (v.index >= k0) hit = v; });
      } else if (ks.length) {
        var kl = ks[ks.length - 1].index;
        vs.forEach(function (v) { if (v.index + v[0].length <= kl) hit = v; });
      }
      if (hit) return hit[1];
      open.lastIndex = end;
    }
    return null;
  }

  function findHandle(html) {
    var og = 'property\\s*=\\s*["\']og:url["\']', canon = 'rel\\s*=\\s*["\']canonical["\']';
    var h = tagProfile(html, 'meta', og, 'content', true) || tagProfile(html, 'meta', og, 'content', false) ||
      tagProfile(html, 'link', canon, 'href', true) || tagProfile(html, 'link', canon, 'href', false);
    if (!h) {
      var m = /saved from url=\(\d+\)\s*https?:\/\/[^\s\/]+\/user\/profile\/([^\s\/?#>"']+)/i.exec(html);
      h = m && m[1];
    }
    if (!h) return null;
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  function parseQojProfile(html) {
    html = String(html == null ? '' : html);
    var block = findBlock(html), ids = [], seen = {};
    if (block) {
      // href value first, then the last /problem/<n> in it (same result as one regex, without backtracking blowup)
      var re = /href\s*=\s*["']([^"']*)["']/gi, last = /^[\s\S]*\/problem\/(\d+)/, m, v;
      while ((m = re.exec(block))) {
        if (!(v = last.exec(m[1]))) continue;
        var id = v[1].replace(/^0+(?=\d)/, ''); // /problem/0063 is problem 63 (ids are compared as strings)
        if (!seen[id]) { seen[id] = true; ids.push(id); }
      }
    }
    return { handle: findHandle(html), solvedIds: ids };
  }

  var api = { parseQojProfile: parseQojProfile };
  if (typeof window !== 'undefined') window.QOJImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
