# QOJ Premier Weekly

Weekly practice picks from the QOJ **Premier List** (https://qoj.ac/problems?premier_list=C).
Same idea as the CSES site in the repo root, light QOJ-style UI (Bootstrap 5).

Enabled lists: **D (Beginners), C (Easy I)**. C2, B, B2 and A are scraped/configurable but disabled.

## Commands

```bash
# 1. Rebuild the problem list from pages saved in the browser (QOJ is behind Cloudflare, scripts get 403)
#    Save https://qoj.ac/problems?premier_list=<L> for each list as "Webpage, Complete", then:
.venv/bin/python qoj/scraper.py ~/Downloads/*list*.html

# 2. Pick a new week (appends to qoj/processed.csv — never re-run for an existing week)
#    The RNG is seeded per week with "<seed>:<date>", so a date always gets the same picks.
#    --skip-existing: if the week already exists, print a notice, rebuild, exit 0 (the
#    scheduled workflow uses this; without it an existing week exits 1).
#    Low pools print a GitHub Actions `::warning::` line; an exhausted list exits 1 and writes nothing.
.venv/bin/python qoj/generate.py [--date YYYY-MM-DD] [--skip-existing]

# 3. Rebuild HTML/JSON only
.venv/bin/python qoj/generate.py --rebuild-only

# Tests
.venv/bin/python -m unittest discover -s qoj/tests -v
node --test qoj/tests/js/*.test.js
node qoj/tests/e2e/run.mjs        # headless Chrome over CDP, no installs
```

## Files

| File | Owner | Purpose |
|---|---|---|
| `premier.py` | python | `PREMIER_LISTS` config, paths, load/pick helpers |
| `scraper.py` | python | saved QOJ list HTML → `problems.csv` |
| `generate.py` | python | picks a week, writes data + generated page shells + `assets/config.js` |
| `problems.csv` | data | `id,name,list,source,tags,url` (all scraped lists, A included) |
| `problems.json` | generated | same as CSV (compact JSON array, `tags` as list), plus any past pick from `weeks_data.json` missing from the CSV |
| `processed.csv` | data | append-only pick log `id,name,list,url` (written after `weeks_data.json`; a mismatch between the two only warns) |
| `weeks_data.json` | data | `{ "YYYY-MM-DD": { "D": [problem…], "C": […] } }` |
| `index.html` | generated | redirect to latest week |
| `all.html`, `rank.html`, `weeks/<date>.html` | generated shells | JS renders content from `window.QOJ_PAGE` |
| `leaderboard.html`, `solved.html`, `profile.html` | hand-written static | |
| `assets/config.js` | generated | `window.QOJ_CONFIG = { supabaseUrl, supabaseKey }` |
| `assets/qoj.css`, `assets/app.js`, `assets/<page>.js`, `assets/import-parser.js` | hand-written | UI |
| `supabase_migration.sql` | | adds `profiles.qoj_handle` |

## Contract

### Problem object (problems.json, weeks_data.json)
```json
{ "id": "63", "name": "Meetings", "list": "C", "source": "JOISC 2019 Day 1", "tags": ["Interactive"], "url": "https://qoj.ac/problem/63" }
```
- `id` is a string. `source` = all grey (`badge-secondary`) badges joined with `" · "` (may be empty). `tags` = green (`badge-success`) badges.
- In CSV, `tags` is `;`-joined.
- A problem appearing in several lists is kept only in the hardest one (A > B2 > B > C2 > C > D).

### PREMIER_LISTS (premier.py) — display order easy → hard
| key | label | count/week | enabled |
|---|---|---|---|
| D | Beginners | 4 | yes |
| C | Easy I | 3 | yes |
| C2 | Easy II | 0 | no |
| B | Medium I | 0 | no |
| B2 | Medium II | 0 | no |
| A | Hard | 0 | no |

Exposed to JS as `window.QOJ_LISTS` in `assets/config.js`: `[{key, label, count, enabled}, …]` in this order.

### Supabase
- `progress(user_id, problem_id, done, updated_at)` — QOJ rows use `problem_id = "qoj:<id>"` (CSES uses bare numbers; must not collide).
- `profiles(user_id, username, avatar_url, qoj_handle)` — display name = `qoj_handle || username || 'Anonymous'`. Pages must still work if `qoj_handle` column does not exist yet (retry select without it).
  - Writes: RLS policy "Users update own profile" is UPDATE-only, and `authenticated` only has the column grant `update (qoj_handle)`, so a user can change only their own `qoj_handle` (no insert/delete, no `username`/`avatar_url`). A check constraint enforces `qoj_handle is null or ~ '^[A-Za-z0-9_.-]{1,40}$'` (same as `HANDLE_RE` in `assets/profile.js`). Applied by `supabase_hardening.sql` at the repo root.
- Only these supabase-js calls are used (the e2e fake implements exactly these):
  - `supabase.createClient(url, key)`
  - `auth.getSession()`, `auth.onAuthStateChange(cb)`, `auth.signInWithOAuth({provider:'github', options:{redirectTo}})`, `auth.signOut()`
  - `from(t).select(cols)` chained with any of `.eq(col,v)`, `.like(col,pattern)`, `.in(col,arr)`, `.range(a,b)`, `.order(col,{ascending})`, then awaited → `{data, error}`
  - `from(t).upsert(rows, {onConflict})` awaited → `{error}`
  - `from(t).update(obj).eq(col, v).select(cols)` awaited → `{data, error}` (empty `data` = no row matched)
- Reads of progress paginate with `.range()` in 1000-row pages.

### Page shells
Every page (generated or static) has this structure:
```html
<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>…</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="{BASE}assets/qoj.css">
</head><body>
  <div class="container">
    <div id="site-header" data-active="{weekly|all|rank|leaderboard|solved|profile}"></div>
    <main id="page"><p class="text-muted">Loading…</p></main>
    <footer class="site-footer">…</footer>
  </div>
  <script>window.QOJ_BASE = "{BASE}"; window.QOJ_PAGE = {…};</script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
  <script src="{BASE}assets/config.js"></script>
  <script src="{BASE}assets/app.js"></script>
  <script src="{BASE}assets/{page}.js"></script>
</body></html>
```
- `{BASE}` = `""` for `qoj/*.html`, `"../"` for `qoj/weeks/*.html`.
- `QOJ_PAGE` per page:
  - week: `{ "type": "week", "date": "2026-10-25", "problems": { "D": [...], "C": [...] } }` → `assets/week.js`
  - all: `{ "type": "all", "weeks": ["2026-10-25", …] }` (newest first) → `assets/all.js`
  - rank: `{ "type": "rank", "weeks": <weeks_data.json> }` → `assets/rank.js`
  - leaderboard / solved / profile: `{ "type": "<name>" }` (they fetch `{BASE}problems.json`)
- Element ids/classes the e2e tests rely on: `#site-header`, `#page`, `#auth-area`, `input.solve-check[data-id="<id>"]` (checkbox per problem row, `data-id` = bare QOJ id), `table.problem-table`, `table.rank-table`, `#qoj-handle-input`, `#qoj-handle-save`, `#import-file`, `#import-preview`, `#import-confirm`, `.list-tabs [data-list="<key>"]`.
