#!/usr/bin/env python3
"""
Generates shareable HTML pages from today's CSES problem picks.
Produces: weeks/YYYY-MM-DD.html, all.html, rank.html, index.html
"""

import argparse
import json
import random
import csv
from datetime import date
from pathlib import Path

SEED = 42
RANKING_CSV     = Path(__file__).parent / "cses_difficulty_ranking.csv"
PROCESSED_CSV   = Path(__file__).parent / "processed.csv"
WEEKS_DATA_JSON = Path(__file__).parent / "weeks_data.json"
OUTPUT_DIR      = Path(__file__).parent / "weeks"
INDEX_HTML      = Path(__file__).parent / "index.html"
ALL_HTML        = Path(__file__).parent / "all.html"
RANK_HTML       = Path(__file__).parent / "rank.html"

import os
SUPABASE_URL      = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


# ── data loading ──────────────────────────────────────────────────────────────

def load_ranking(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_processed_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        id_col = next((c for c in (reader.fieldnames or [])
                       if c.strip().lower() in ("id", "problem_id")), None)
        if id_col is None:
            f.seek(0)
            reader = csv.reader(f)
            next(reader, None)
            return {row[0].strip() for row in reader if row}
        return {row[id_col].strip() for row in reader}


def load_weeks_data() -> dict:
    if not WEEKS_DATA_JSON.exists():
        return {}
    with WEEKS_DATA_JSON.open(encoding="utf-8") as f:
        return json.load(f)


def save_weeks_data(data: dict) -> None:
    with WEEKS_DATA_JSON.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def pick(pool: list[dict], n: int, rng: random.Random) -> list[dict]:
    if len(pool) < n:
        raise ValueError(f"Need {n} problems but only {len(pool)} available.")
    return rng.sample(pool, n)


def save_processed(path: Path, problems: list[dict]) -> None:
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "name", "section", "url"])
        if write_header:
            writer.writeheader()
        for p in problems:
            writer.writerow({"id": p["id"], "name": p["name"],
                             "section": p["section"], "url": p["url"]})


# ── shared CSS ────────────────────────────────────────────────────────────────

COMMON_CSS = """
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0f1117;
      --surface:    #1a1d27;
      --border:     #2a2d3a;
      --text:       #e8eaf0;
      --muted:      #6b7280;
      --hard:       #ef4444;
      --hard-dim:   #3b1515;
      --medium:     #f59e0b;
      --medium-dim: #3b2a0a;
      --easy:       #22c55e;
      --easy-dim:   #0d2e18;
      --accent:     #6366f1;
      --radius:     12px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 3rem 1.5rem;
    }

    /* ── nav ── */
    .week-nav {
      display: flex;
      align-items: center;
      gap: 1rem;
      max-width: 860px;
      margin: 0 auto 2.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .nav-back {
      font-size: .85rem;
      color: var(--muted);
      text-decoration: none;
      transition: color .15s;
    }
    .nav-back:hover { color: var(--text); }
    .nav-rank {
      font-size: .85rem;
      color: var(--muted);
      text-decoration: none;
      transition: color .15s;
    }
    .nav-rank:hover { color: var(--accent); }
    .nav-date {
      font-size: .85rem;
      color: var(--muted);
      margin-left: auto;
    }

    /* ── header ── */
    header {
      text-align: center;
      margin-bottom: 2.5rem;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      font-size: .85rem;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    .logo svg { opacity: .5; }
    h1 {
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      font-weight: 700;
      letter-spacing: -.02em;
      line-height: 1.1;
    }
    h1 span { color: var(--accent); }

    /* ── auth ── */
    .auth-area {
      display: flex;
      align-items: center;
      gap: .5rem;
      font-size: .82rem;
      color: var(--muted);
    }
    .auth-area img { border-radius: 50%; vertical-align: middle; }
    .login-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font-size: .82rem;
      padding: .3rem .75rem;
      transition: border-color .15s;
      display: inline-flex;
      align-items: center;
      gap: .4rem;
    }
    .login-btn:hover { border-color: var(--accent); }
    .login-btn svg { opacity: .7; }
    .signout-link {
      cursor: pointer;
      color: var(--muted);
      text-decoration: underline;
      background: none;
      border: none;
      font-size: .82rem;
      padding: 0;
    }
    .signout-link:hover { color: var(--text); }

    /* ── footer ── */
    footer {
      text-align: center;
      margin-top: 4rem;
      font-size: .78rem;
      color: var(--muted);
    }
    footer a { color: var(--muted); text-decoration: underline; }
"""

AUTH_JS = """
    async function signIn() {
      await sb.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.href }
      });
    }

    async function signOut() {
      await sb.auth.signOut();
      currentUser = null;
      renderAuth(null);
      document.querySelectorAll('.card[data-id]').forEach(c => c.classList.remove('done'));
      loadLocal();
    }

    function renderAuth(user) {
      const area = document.getElementById('auth-area');
      if (!USE_SUPABASE) { area.innerHTML = ''; return; }
      if (user) {
        const name   = user.user_metadata?.user_name || user.email;
        const avatar = user.user_metadata?.avatar_url;
        area.innerHTML = `
          ${avatar ? `<img src="${avatar}" width="22" height="22" alt="">` : ''}
          <span>${name}</span>
          <button class="signout-link" onclick="signOut()">Sign out</button>`;
      } else {
        area.innerHTML = `
          <button class="login-btn" onclick="signIn()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577
              0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756
              -1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834
              2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93
              0-1.31.468-2.38 1.235-3.22-.124-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.3 1.23
              .96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23
              .655 1.653.243 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.625
              -5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694
              .825.576C20.565 21.796 24 17.298 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Sign in with GitHub
          </button>`;
      }
    }
"""

SUPABASE_BOOT_JS = """
    document.addEventListener('DOMContentLoaded', async () => {
      if (!USE_SUPABASE) {
        loadLocal();
        return;
      }

      renderAuth(null);

      const { data: { session } } = await sb.auth.getSession();
      currentUser = session?.user ?? null;
      renderAuth(currentUser);
      currentUser ? await loadCloud() : loadLocal();

      sb.auth.onAuthStateChange(async (event, session) => {
        currentUser = session?.user ?? null;
        renderAuth(currentUser);
        document.querySelectorAll('.card[data-id]').forEach(c => c.classList.remove('done'));
        currentUser ? await loadCloud() : loadLocal();
      });
    });
"""


# ── HTML generation ───────────────────────────────────────────────────────────

def problem_card(p: dict, index: int) -> str:
    return f"""
        <div class="card" data-id="{p['id']}">
          <span class="card-index">{index:02d}</span>
          <div class="card-body">
            <a class="card-link" href="{p['url']}" target="_blank" rel="noopener">
              <div class="card-title">{p['name']}</div>
            </a>
            <div class="card-meta">
              <span class="tag">{p['section']}</span>
              <span class="tag">ID {p['id']}</span>
            </div>
          </div>
          <button class="check-btn" onclick="toggleDone(this)" aria-label="Mark done">✓</button>
        </div>"""


def build_html(hard: list[dict], medium: list[dict], easy: list[dict], today_iso: str) -> str:
    today_display = date.fromisoformat(today_iso).strftime("%B %d, %Y")

    hard_cards   = "\n".join(problem_card(p, i + 1) for i, p in enumerate(hard))
    medium_cards = "\n".join(problem_card(p, i + 1) for i, p in enumerate(medium))
    easy_cards   = "\n".join(problem_card(p, i + 1) for i, p in enumerate(easy))

    sb_url = SUPABASE_URL
    sb_key = SUPABASE_ANON_KEY

    week_problems_js = json.dumps({
        "hard":   [{"id": p["id"], "name": p["name"]} for p in hard],
        "medium": [{"id": p["id"], "name": p["name"]} for p in medium],
        "easy":   [{"id": p["id"], "name": p["name"]} for p in easy],
    }, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CSES Weekly Picks · {today_display}</title>
  <style>
{COMMON_CSS}

    /* ── summary pill ── */
    .date {{
      margin-top: .6rem;
      color: var(--muted);
      font-size: .9rem;
    }}
    .summary {{
      display: inline-flex;
      gap: 1.5rem;
      margin-top: 1.5rem;
      padding: .6rem 1.4rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 99px;
      font-size: .82rem;
      color: var(--muted);
    }}
    .summary b {{ color: var(--text); }}

    /* ── tabs ── */
    .tab-nav {{
      display: flex;
      gap: 0;
      max-width: 860px;
      margin: 0 auto 2rem;
      border-bottom: 1px solid var(--border);
    }}
    .tab-btn {{
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      cursor: pointer;
      font-family: var(--font);
      font-size: .9rem;
      font-weight: 600;
      padding: .65rem 1.3rem;
      margin-bottom: -1px;
      transition: color .15s, border-color .15s;
    }}
    .tab-btn:hover {{ color: var(--text); }}
    .tab-btn.active {{ color: var(--accent); border-bottom-color: var(--accent); }}
    .tab-content.hidden {{ display: none; }}

    /* ── problems layout ── */
    .wrapper {{
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }}

    /* ── section ── */
    .section-header {{
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }}
    .pill {{
      padding: .3rem .9rem;
      border-radius: 99px;
      font-size: .75rem;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
    }}
    .pill.hard   {{ background: var(--hard-dim);   color: var(--hard);   }}
    .pill.medium {{ background: var(--medium-dim); color: var(--medium); }}
    .pill.easy   {{ background: var(--easy-dim);   color: var(--easy);   }}
    .section-title {{ font-size: 1rem; font-weight: 600; color: var(--muted); }}
    .section-rule {{ flex: 1; height: 1px; background: var(--border); }}

    /* ── cards ── */
    .cards {{ display: flex; flex-direction: column; gap: .75rem; }}
    .card {{
      display: flex;
      align-items: center;
      gap: 1.25rem;
      padding: 1.1rem 1.4rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color .15s, transform .15s, box-shadow .15s;
    }}
    .card:hover {{
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
    }}
    .card-index {{
      font-size: 1.1rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--border);
      min-width: 1.8rem;
      text-align: right;
    }}
    .card-body {{ flex: 1; min-width: 0; }}
    .card-link {{ text-decoration: none; color: inherit; }}
    .card-title {{
      font-size: 1rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .card-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: .4rem;
      margin-top: .35rem;
    }}
    .tag {{
      font-size: .72rem;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: .15rem .5rem;
    }}

    /* ── check button ── */
    .check-btn {{
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--muted);
      cursor: pointer;
      padding: .3rem .55rem;
      font-size: .9rem;
      flex-shrink: 0;
      transition: background .15s, color .15s;
    }}
    .check-btn:hover {{ border-color: var(--easy); color: var(--easy); }}
    .card.done .check-btn {{ background: var(--easy-dim); color: var(--easy); border-color: var(--easy); }}
    .card.done .card-title {{ text-decoration: line-through; opacity: .45; }}

    .hard-section   .card {{ border-left: 3px solid var(--hard);   }}
    .medium-section .card {{ border-left: 3px solid var(--medium); }}
    .easy-section   .card {{ border-left: 3px solid var(--easy);   }}

    /* ── rankings section ── */
    .rank-section {{
      max-width: 860px;
      margin: 0 auto;
    }}
    .rank-leaderboard {{ margin-bottom: 2.5rem; }}
    .rank-grid-title {{
      font-size: 1rem;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: .75rem;
    }}
    .rank-grid-title::after {{
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }}

    .rank-table, .grid-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: .88rem;
    }}
    .rank-table th, .rank-table td,
    .grid-table th, .grid-table td {{
      padding: .55rem .8rem;
      border: 1px solid var(--border);
      text-align: center;
      white-space: nowrap;
    }}
    .rank-table th:first-child, .rank-table td:first-child,
    .grid-table th:first-child, .grid-table td:first-child {{
      text-align: left;
    }}
    .rank-table thead th, .grid-table thead th {{
      background: var(--surface);
      font-size: .78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
    }}
    .rank-table tbody tr:hover, .grid-table tbody tr:hover {{
      background: var(--surface);
    }}
    .rank-num {{
      display: inline-block;
      min-width: 1.4rem;
      color: var(--muted);
      font-size: .8rem;
      text-align: right;
      margin-right: .3rem;
    }}
    .rank-avatar {{
      border-radius: 50%;
      vertical-align: middle;
      margin-right: .4rem;
    }}
    .solved-frac {{ color: var(--muted); font-size: .8rem; }}

    .grid-wrap {{ overflow-x: auto; }}
    .diff-label {{
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      font-size: .82rem;
    }}
    .diff-dot {{
      width: 7px; height: 7px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }}
    .diff-dot.hard   {{ background: var(--hard);   }}
    .diff-dot.medium {{ background: var(--medium); }}
    .diff-dot.easy   {{ background: var(--easy);   }}

    .cell-done {{ background: var(--easy-dim);   color: var(--easy);   font-weight: 700; }}
    .cell-miss {{ background: var(--hard-dim);   color: var(--hard);   opacity: .65;    }}

    .no-sb, .no-data, .loading-msg {{
      color: var(--muted);
      text-align: center;
      padding: 3rem 1rem;
      font-size: .9rem;
    }}

    @media (max-width: 540px) {{
      .card {{ flex-wrap: wrap; }}
    }}
  </style>
</head>
<body>
  <nav class="week-nav">
    <a href="../all.html" class="nav-back">← All Weeks</a>
    <a href="../rank.html" class="nav-rank">Rankings</a>
    <span class="nav-date">Week of {today_display}</span>
    <div class="auth-area" id="auth-area"><!-- populated by JS --></div>
  </nav>

  <header>
    <div class="logo">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      CSES Problem Set
    </div>
    <h1>Weekly <span>Practice</span> Picks</h1>
    <div class="date">{today_display}</div>
    <div class="summary">
      <span><b>2</b> Hard</span>
      <span><b>3</b> Medium</span>
      <span><b>4</b> Easy</span>
      <span><b>9</b> Total</span>
    </div>
  </header>

  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('problems', this)">Problems</button>
    <button class="tab-btn"        onclick="switchTab('rankings', this)">Rankings</button>
  </div>

  <!-- ── Problems tab ── -->
  <div id="tab-problems" class="tab-content">
    <div class="wrapper">

      <div class="hard-section">
        <div class="section-header">
          <span class="pill hard">Hard</span>
          <div class="section-rule"></div>
        </div>
        <div class="cards">
          {hard_cards}
        </div>
      </div>

      <div class="medium-section">
        <div class="section-header">
          <span class="pill medium">Medium</span>
          <div class="section-rule"></div>
        </div>
        <div class="cards">
          {medium_cards}
        </div>
      </div>

      <div class="easy-section">
        <div class="section-header">
          <span class="pill easy">Easy</span>
          <div class="section-rule"></div>
        </div>
        <div class="cards">
          {easy_cards}
        </div>
      </div>

    </div>
  </div>

  <!-- ── Rankings tab ── -->
  <div id="tab-rankings" class="tab-content hidden">
    <div id="rankings-container">
      <p class="loading-msg">Loading…</p>
    </div>
  </div>

  <footer>
    Generated from <a href="https://cses.fi/problemset/" target="_blank">cses.fi/problemset</a> · ranked by solve count · seed {SEED}
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    const SUPABASE_URL      = "{sb_url}";
    const SUPABASE_ANON_KEY = "{sb_key}";
    const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

    const sb = USE_SUPABASE
      ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

    let currentUser = null;

    // ── Week problems (embedded at generation time) ───────────────────────────
    const WEEK_PROBLEMS = {week_problems_js};

    // ── Tabs ─────────────────────────────────────────────────────────────────
    let rankingsLoaded = false;

    function switchTab(tab, btn) {{
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      document.getElementById('tab-' + tab).classList.remove('hidden');
      btn.classList.add('active');
      if (tab === 'rankings' && !rankingsLoaded) {{
        rankingsLoaded = true;
        loadRankings();
      }}
    }}

    // ── Rankings ──────────────────────────────────────────────────────────────
    async function loadRankings() {{
      const container = document.getElementById('rankings-container');
      if (!USE_SUPABASE || !sb) {{
        container.innerHTML = '<p class="no-sb">Configure Supabase to see group rankings.</p>';
        return;
      }}

      const allIds = [
        ...WEEK_PROBLEMS.hard,
        ...WEEK_PROBLEMS.medium,
        ...WEEK_PROBLEMS.easy,
      ].map(p => p.id);

      const [progressRes, profilesRes] = await Promise.all([
        sb.from('progress').select('user_id, problem_id').in('problem_id', allIds).eq('done', true),
        sb.from('profiles').select('user_id, username, avatar_url'),
      ]);

      const progress = progressRes.data || [];
      const profiles = profilesRes.data || [];

      const userMap = new Map();
      for (const p of profiles) {{
        userMap.set(p.user_id, {{ username: p.username || 'Anonymous', avatar: p.avatar_url, solved: new Set() }});
      }}
      for (const row of progress) {{
        if (!userMap.has(row.user_id)) {{
          userMap.set(row.user_id, {{ username: 'Unknown', avatar: null, solved: new Set() }});
        }}
        userMap.get(row.user_id).solved.add(row.problem_id);
      }}

      if (userMap.size === 0) {{
        container.innerHTML = '<p class="no-data">No progress yet — be the first to mark a problem done!</p>';
        return;
      }}

      const users = [...userMap.entries()].sort((a, b) => b[1].solved.size - a[1].solved.size);
      const total = allIds.length;

      // ── Leaderboard table ──
      let lb = `<table class="rank-table"><thead><tr>
        <th>#</th><th style="text-align:left">User</th>
        <th>Solved</th>
        <th style="color:var(--hard)">Hard</th>
        <th style="color:var(--medium)">Medium</th>
        <th style="color:var(--easy)">Easy</th>
      </tr></thead><tbody>`;

      users.forEach(([, u], i) => {{
        const hSolved = WEEK_PROBLEMS.hard.filter(p => u.solved.has(p.id)).length;
        const mSolved = WEEK_PROBLEMS.medium.filter(p => u.solved.has(p.id)).length;
        const eSolved = WEEK_PROBLEMS.easy.filter(p => u.solved.has(p.id)).length;
        const av = u.avatar ? `<img class="rank-avatar" src="${{u.avatar}}" width="20" height="20" alt="">` : '';
        lb += `<tr>
          <td><span class="rank-num">${{i + 1}}</span></td>
          <td>${{av}}${{u.username}}</td>
          <td><strong>${{u.solved.size}}</strong> <span class="solved-frac">/ ${{total}}</span></td>
          <td>${{hSolved}} <span class="solved-frac">/ ${{WEEK_PROBLEMS.hard.length}}</span></td>
          <td>${{mSolved}} <span class="solved-frac">/ ${{WEEK_PROBLEMS.medium.length}}</span></td>
          <td>${{eSolved}} <span class="solved-frac">/ ${{WEEK_PROBLEMS.easy.length}}</span></td>
        </tr>`;
      }});
      lb += `</tbody></table>`;

      // ── Problem grid ──
      const allProblems = [
        ...WEEK_PROBLEMS.hard.map((p, i)   => ({{ ...p, diff: 'hard',   label: `Hard ${{i + 1}}`   }})),
        ...WEEK_PROBLEMS.medium.map((p, i) => ({{ ...p, diff: 'medium', label: `Medium ${{i + 1}}` }})),
        ...WEEK_PROBLEMS.easy.map((p, i)   => ({{ ...p, diff: 'easy',   label: `Easy ${{i + 1}}`   }})),
      ];

      let gridHead = `<tr><th>Problem</th>`;
      for (const [, u] of users) {{
        const av = u.avatar ? `<img class="rank-avatar" src="${{u.avatar}}" width="18" height="18" alt="">` : '';
        gridHead += `<th>${{av}}${{u.username}}</th>`;
      }}
      gridHead += `</tr>`;

      let gridBody = '';
      for (const p of allProblems) {{
        gridBody += `<tr><td><span class="diff-label"><span class="diff-dot ${{p.diff}}"></span>${{p.label}}</span></td>`;
        for (const [, u] of users) {{
          gridBody += u.solved.has(p.id)
            ? `<td class="cell-done">✓</td>`
            : `<td class="cell-miss">✗</td>`;
        }}
        gridBody += `</tr>`;
      }}

      const grid = `
        <div class="rank-grid-title">Problem Breakdown</div>
        <div class="grid-wrap">
          <table class="grid-table">
            <thead>${{gridHead}}</thead>
            <tbody>${{gridBody}}</tbody>
          </table>
        </div>`;

      container.innerHTML = `<div class="rank-section"><div class="rank-leaderboard">${{lb}}</div>${{grid}}</div>`;
    }}

    // ── Auth ──────────────────────────────────────────────────────────────────
{AUTH_JS}

    // ── Progress ──────────────────────────────────────────────────────────────
    function localKey(id) {{ return `cses-done-${{id}}`; }}

    function loadLocal() {{
      document.querySelectorAll('.card[data-id]').forEach(card => {{
        if (localStorage.getItem(localKey(card.dataset.id)) === '1')
          card.classList.add('done');
      }});
    }}

    async function loadCloud() {{
      const {{ data }} = await sb
        .from('progress')
        .select('problem_id, done')
        .eq('user_id', currentUser.id);
      if (!data) return;
      document.querySelectorAll('.card[data-id]').forEach(card => {{
        const row = data.find(r => r.problem_id === card.dataset.id);
        card.classList.toggle('done', row?.done === true);
      }});
    }}

    async function toggleDone(btn) {{
      const card = btn.closest('.card');
      const id   = card.dataset.id;
      const done = !card.classList.contains('done');
      card.classList.toggle('done', done);

      if (currentUser && sb) {{
        await sb.from('progress').upsert({{
          user_id:    currentUser.id,
          problem_id: id,
          done:       done,
          updated_at: new Date().toISOString()
        }}, {{ onConflict: 'user_id,problem_id' }});
      }} else {{
        localStorage.setItem(localKey(id), done ? '1' : '0');
      }}
    }}

    // ── Boot ──────────────────────────────────────────────────────────────────
{SUPABASE_BOOT_JS}
  </script>
</body>
</html>"""


def build_rank_html(weeks_data: dict) -> str:
    sb_url = SUPABASE_URL
    sb_key = SUPABASE_ANON_KEY
    weeks_js = json.dumps(weeks_data, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CSES Weekly Picks · Rankings</title>
  <style>
{COMMON_CSS}

    .subtitle {{
      margin-top: .6rem;
      color: var(--muted);
      font-size: .9rem;
    }}

    /* ── rank table ── */
    .rank-section {{
      max-width: 1000px;
      margin: 0 auto;
    }}
    .table-wrap {{ overflow-x: auto; }}

    .rank-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: .88rem;
    }}
    .rank-table th, .rank-table td {{
      padding: .6rem .9rem;
      border: 1px solid var(--border);
      text-align: center;
      white-space: nowrap;
    }}
    .rank-table th:first-child, .rank-table td:first-child {{
      text-align: left;
      position: sticky;
      left: 0;
      background: var(--bg);
      z-index: 1;
    }}
    .rank-table thead th {{
      background: var(--surface);
      font-size: .78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--muted);
    }}
    .rank-table thead th:first-child {{
      background: var(--surface);
    }}
    .rank-table tbody tr:hover td {{
      background: var(--surface);
    }}
    .rank-table tbody tr:hover td:first-child {{
      background: var(--surface);
    }}

    .rank-avatar {{
      border-radius: 50%;
      vertical-align: middle;
      margin-right: .4rem;
    }}

    /* cell colour coding */
    .cell-high  {{ background: var(--easy-dim);   color: var(--easy);   font-weight: 700; }}
    .cell-mid   {{ background: var(--medium-dim); color: var(--medium); font-weight: 700; }}
    .cell-low   {{ background: var(--hard-dim);   color: var(--hard);   }}
    .cell-zero  {{ color: var(--muted); }}
    .cell-total {{ font-weight: 700; font-size: 1rem; border-left: 2px solid var(--accent); }}

    .week-link {{ color: inherit; text-decoration: none; }}
    .week-link:hover {{ color: var(--accent); text-decoration: underline; }}

    .no-sb, .no-data, .loading-msg {{
      color: var(--muted);
      text-align: center;
      padding: 3rem 1rem;
      font-size: .9rem;
    }}

    .legend {{
      display: flex;
      gap: 1.2rem;
      justify-content: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }}
    .legend-item {{
      display: flex;
      align-items: center;
      gap: .4rem;
      font-size: .78rem;
      color: var(--muted);
    }}
    .legend-dot {{
      width: 10px; height: 10px;
      border-radius: 2px;
    }}
  </style>
</head>
<body>
  <nav class="week-nav">
    <a href="all.html" class="nav-back">← All Weeks</a>
    <span class="nav-date">Group Rankings</span>
    <div class="auth-area" id="auth-area"><!-- populated by JS --></div>
  </nav>

  <header>
    <div class="logo">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      CSES Problem Set
    </div>
    <h1>Group <span>Rankings</span></h1>
    <p class="subtitle">Problems solved per week across the group</p>
  </header>

  <div class="legend">
    <span class="legend-item"><span class="legend-dot" style="background:var(--easy-dim);border:1px solid var(--easy)"></span> ≥ 75 %</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--medium-dim);border:1px solid var(--medium)"></span> 44 – 74 %</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--hard-dim);border:1px solid var(--hard)"></span> 1 – 43 %</span>
    <span class="legend-item"><span class="legend-dot" style="background:var(--border)"></span> 0</span>
  </div>

  <div id="rank-container">
    <p class="loading-msg">Loading…</p>
  </div>

  <footer>
    Generated from <a href="https://cses.fi/problemset/" target="_blank">cses.fi/problemset</a> · ranked by solve count
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    const SUPABASE_URL      = "{sb_url}";
    const SUPABASE_ANON_KEY = "{sb_key}";
    const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

    const sb = USE_SUPABASE
      ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

    let currentUser = null;

    // All weeks data embedded at generation time
    const ALL_WEEKS = {weeks_js};

    async function loadAllRankings() {{
      const container = document.getElementById('rank-container');
      if (!USE_SUPABASE || !sb) {{
        container.innerHTML = '<p class="no-sb">Configure Supabase to see group rankings.</p>';
        return;
      }}

      // weeks newest-first
      const weeks = Object.keys(ALL_WEEKS).sort().reverse();
      if (weeks.length === 0) {{
        container.innerHTML = '<p class="no-data">No weeks generated yet.</p>';
        return;
      }}

      // collect all problem IDs
      const allIds = [];
      for (const w of weeks) {{
        const wd = ALL_WEEKS[w];
        allIds.push(...wd.hard.map(p => p.id), ...wd.medium.map(p => p.id), ...wd.easy.map(p => p.id));
      }}

      const [progressRes, profilesRes] = await Promise.all([
        sb.from('progress').select('user_id, problem_id').in('problem_id', allIds).eq('done', true),
        sb.from('profiles').select('user_id, username, avatar_url'),
      ]);

      const progress = progressRes.data || [];
      const profiles = profilesRes.data || [];

      const userMap = new Map();
      for (const p of profiles) {{
        userMap.set(p.user_id, {{ username: p.username || 'Anonymous', avatar: p.avatar_url, solved: new Set() }});
      }}
      for (const row of progress) {{
        if (!userMap.has(row.user_id)) {{
          userMap.set(row.user_id, {{ username: 'Unknown', avatar: null, solved: new Set() }});
        }}
        userMap.get(row.user_id).solved.add(row.problem_id);
      }}

      if (userMap.size === 0) {{
        container.innerHTML = '<p class="no-data">No progress yet — sign in and mark problems done on weekly pages!</p>';
        return;
      }}

      // week problem sets
      const weekSets = {{}};
      for (const w of weeks) {{
        const wd = ALL_WEEKS[w];
        weekSets[w] = new Set([...wd.hard.map(p => p.id), ...wd.medium.map(p => p.id), ...wd.easy.map(p => p.id)]);
      }}

      // sort users by total solved descending
      const users = [...userMap.entries()].sort((a, b) => b[1].solved.size - a[1].solved.size);

      // build table
      let head = `<tr><th>User</th>`;
      for (const w of weeks) {{
        const d = new Date(w + 'T12:00:00');
        const label = d.toLocaleDateString('en-US', {{ month: 'short', day: 'numeric' }});
        head += `<th><a class="week-link" href="weeks/${{w}}.html">${{label}}</a></th>`;
      }}
      head += `<th class="cell-total">Total</th></tr>`;

      let body = '';
      for (const [, u] of users) {{
        const av = u.avatar ? `<img class="rank-avatar" src="${{u.avatar}}" width="20" height="20" alt="">` : '';
        body += `<tr><td>${{av}}${{u.username}}</td>`;
        let total = 0;
        for (const w of weeks) {{
          const wps = weekSets[w];
          const count = [...wps].filter(id => u.solved.has(id)).length;
          const pct   = count / wps.size;
          total += count;
          let cls = 'cell-zero';
          if (pct >= 0.75)       cls = 'cell-high';
          else if (pct >= 0.44)  cls = 'cell-mid';
          else if (count > 0)    cls = 'cell-low';
          body += `<td class="${{cls}}">${{count > 0 ? count + '<span style="font-size:.75rem;opacity:.6"> /' + wps.size + '</span>' : '—'}}</td>`;
        }}
        body += `<td class="cell-total">${{total}}</td></tr>`;
      }}

      container.innerHTML = `
        <div class="rank-section">
          <div class="table-wrap">
            <table class="rank-table">
              <thead>${{head}}</thead>
              <tbody>${{body}}</tbody>
            </table>
          </div>
        </div>`;
    }}

    // ── Auth ──────────────────────────────────────────────────────────────────
{AUTH_JS}

    // ── Boot ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {{
      if (!USE_SUPABASE) {{
        renderAuth(null);
        loadAllRankings();
        return;
      }}

      renderAuth(null);

      const {{ data: {{ session }} }} = await sb.auth.getSession();
      currentUser = session?.user ?? null;
      renderAuth(currentUser);
      loadAllRankings();

      sb.auth.onAuthStateChange(async (event, session) => {{
        currentUser = session?.user ?? null;
        renderAuth(currentUser);
      }});
    }});
  </script>
</body>
</html>"""


def build_redirect(latest: Path) -> str:
    target = f"weeks/{latest.name}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0; url={target}" />
  <title>CSES Weekly Picks</title>
</head>
<body>
  <script>location.replace("{target}");</script>
</body>
</html>"""


def build_index(week_files: list[Path]) -> str:
    week_files_sorted = sorted(week_files, reverse=True)

    week_items = []
    for wf in week_files_sorted:
        iso = wf.stem
        try:
            display = date.fromisoformat(iso).strftime("%B %d, %Y")
        except ValueError:
            display = iso
        week_items.append(f"""
        <a class="week-card" href="weeks/{wf.name}">
          <span class="week-date">{display}</span>
          <span class="week-arrow">→</span>
        </a>""")

    items_html = "\n".join(week_items)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CSES Weekly Picks</title>
  <style>
{COMMON_CSS}

    .subtitle {{
      margin-top: .6rem;
      color: var(--muted);
      font-size: .9rem;
    }}

    .top-links {{
      display: flex;
      justify-content: center;
      gap: .75rem;
      margin-bottom: 2.5rem;
    }}
    .rank-btn {{
      display: inline-flex;
      align-items: center;
      gap: .4rem;
      padding: .55rem 1.2rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: .88rem;
      font-weight: 600;
      text-decoration: none;
      transition: border-color .15s, transform .1s;
    }}
    .rank-btn:hover {{
      border-color: var(--accent);
      transform: translateY(-1px);
    }}

    .weeks-list {{
      max-width: 600px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: .75rem;
    }}
    .week-card {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.1rem 1.4rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      text-decoration: none;
      color: inherit;
      transition: border-color .15s, transform .15s, box-shadow .15s;
    }}
    .week-card:hover {{
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
    }}
    .week-date {{ font-size: 1rem; font-weight: 600; }}
    .week-arrow {{ color: var(--muted); font-size: .9rem; }}
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      CSES Problem Set
    </div>
    <h1>Weekly <span>Practice</span> Picks</h1>
    <p class="subtitle">Select a week to view its problems</p>
  </header>

  <div class="top-links">
    <a class="rank-btn" href="rank.html">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 20 18 10"/><polyline points="12 20 12 4"/><polyline points="6 20 6 14"/></svg>
      Group Rankings
    </a>
  </div>

  <div class="weeks-list">
    {items_html}
  </div>

  <footer>
    Generated from <a href="https://cses.fi/problemset/" target="_blank">cses.fi/problemset</a> · ranked by solve count
  </footer>
</body>
</html>"""


def regenerate_index() -> None:
    week_files = sorted(OUTPUT_DIR.glob("*.html"))
    latest = week_files[-1] if week_files else None

    ALL_HTML.write_text(build_index(week_files), encoding="utf-8")
    print(f"All    → {ALL_HTML}")

    weeks_data = load_weeks_data()
    RANK_HTML.write_text(build_rank_html(weeks_data), encoding="utf-8")
    print(f"Rank   → {RANK_HTML}")

    if latest:
        INDEX_HTML.write_text(build_redirect(latest), encoding="utf-8")
        print(f"Index  → {INDEX_HTML}  (redirects to {latest.name})")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate a shareable HTML of today's CSES picks.")
    parser.add_argument("--ranking",      "-r", default=str(RANKING_CSV))
    parser.add_argument("--processed",    "-p", default=str(PROCESSED_CSV))
    parser.add_argument("--date",         "-d", default=str(date.today()),
                        help="ISO date for the week page (default: today)")
    parser.add_argument("--seed",         "-s", type=int, default=SEED)
    parser.add_argument("--rebuild-only", action="store_true",
                        help="Rebuild all week pages + rank/index from weeks_data.json without picking new problems")
    args = parser.parse_args()

    if args.rebuild_only:
        weeks_data = load_weeks_data()
        if not weeks_data:
            print("ERROR: weeks_data.json is empty. Nothing to rebuild.")
            raise SystemExit(1)
        OUTPUT_DIR.mkdir(exist_ok=True)
        for week_iso, wd in weeks_data.items():
            html = build_html(wd["hard"], wd["medium"], wd["easy"], week_iso)
            out = OUTPUT_DIR / f"{week_iso}.html"
            out.write_text(html, encoding="utf-8")
            print(f"Rebuilt → {out}")
        regenerate_index()
        return

    ranking_path   = Path(args.ranking)
    processed_path = Path(args.processed)
    today_iso      = args.date

    if not ranking_path.exists():
        print(f"ERROR: {ranking_path} not found. Run scraper.py first.")
        raise SystemExit(1)

    all_problems  = load_ranking(ranking_path)
    processed_ids = load_processed_ids(processed_path)
    available     = [p for p in all_problems if p["id"] not in processed_ids]

    rng    = random.Random(args.seed)
    hard   = pick([p for p in available if 1   <= int(p["rank"]) <= 100], 2, rng)
    medium = pick([p for p in available if 101 <= int(p["rank"]) <= 250], 3, rng)
    easy   = pick([p for p in available if 251 <= int(p["rank"]) <= 400], 4, rng)

    save_processed(processed_path, hard + medium + easy)

    # Save week→problems mapping for rank page
    weeks_data = load_weeks_data()
    weeks_data[today_iso] = {
        "hard":   [{"id": p["id"], "name": p["name"], "section": p["section"], "url": p["url"]} for p in hard],
        "medium": [{"id": p["id"], "name": p["name"], "section": p["section"], "url": p["url"]} for p in medium],
        "easy":   [{"id": p["id"], "name": p["name"], "section": p["section"], "url": p["url"]} for p in easy],
    }
    save_weeks_data(weeks_data)
    print(f"Weeks  → {WEEKS_DATA_JSON}")

    html = build_html(hard, medium, easy, today_iso)

    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = OUTPUT_DIR / f"{today_iso}.html"
    output_path.write_text(html, encoding="utf-8")
    print(f"Saved  → {output_path}")

    regenerate_index()


if __name__ == "__main__":
    main()
