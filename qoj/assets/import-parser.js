/* Parse a saved QOJ (UOJ fork) profile page. String/regex only so it runs in Node and the browser. */
(function () {
  'use strict';

  var HEADING_RE = /accepted\s+problems|AC\s*过的题目/i;
  var BLOCK_END_RE = /<h[1-6]\b|class\s*=\s*["'][^"']*\blist-group-item(?![-\w])/i;

  function stripTags(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

  function findBlock(html) {
    var re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, m;
    while ((m = re.exec(html))) {
      if (!HEADING_RE.test(stripTags(m[2]))) continue;
      var start = m.index + m[0].length;
      var rest = html.slice(start);
      var end = rest.search(BLOCK_END_RE);
      return end === -1 ? rest : rest.slice(0, end);
    }
    return null;
  }

  function findHandle(html) {
    var pats = [
      /<meta[^>]+property\s*=\s*["']og:url["'][^>]*content\s*=\s*["'][^"']*\/user\/profile\/([^"'\/?#<>\s]+)/i,
      /<meta[^>]+content\s*=\s*["'][^"']*\/user\/profile\/([^"'\/?#<>\s]+)["'][^>]*property\s*=\s*["']og:url["']/i,
      /<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["'][^"']*\/user\/profile\/([^"'\/?#<>\s]+)/i,
      /<link[^>]+href\s*=\s*["'][^"']*\/user\/profile\/([^"'\/?#<>\s]+)["'][^>]*rel\s*=\s*["']canonical["']/i,
      /saved from url=\(\d+\)\s*https?:\/\/[^\s\/]+\/user\/profile\/([^\s\/?#>"']+)/i
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = pats[i].exec(html);
      if (m) {
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
      }
    }
    return null;
  }

  function parseQojProfile(html) {
    html = String(html == null ? '' : html);
    var block = findBlock(html), ids = [], seen = {};
    if (block) {
      var re = /href\s*=\s*["'][^"']*\/problem\/(\d+)(?!\d)[^"']*["']/gi, m;
      while ((m = re.exec(block))) {
        if (!seen[m[1]]) { seen[m[1]] = true; ids.push(m[1]); }
      }
    }
    return { handle: findHandle(html), solvedIds: ids };
  }

  var api = { parseQojProfile: parseQojProfile };
  if (typeof window !== 'undefined') window.QOJImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
