#!/usr/bin/env python3
"""
Generates a shareable HTML page from today's CSES problem picks.
"""

import argparse
import random
import csv
from datetime import date
from pathlib import Path

SEED = 42
RANKING_CSV   = Path(__file__).parent / "cses_difficulty_ranking.csv"
PROCESSED_CSV = Path(__file__).parent / "processed.csv"
OUTPUT_DIR    = Path(__file__).parent / "weeks"
INDEX_HTML    = Path(__file__).parent / "index.html"
ALL_HTML      = Path(__file__).parent / "all.html"


# ── data loading (mirrors pick_problems.py) ───────────────────────────────────

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

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CSES Weekly Picks · {today_display}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

    :root {{
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
    }}

    body {{
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 3rem 1.5rem;
    }}

    /* ── nav ── */
    .week-nav {{
      display: flex;
      align-items: center;
      gap: 1rem;
      max-width: 860px;
      margin: 0 auto 2.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }}
    .nav-back {{
      font-size: .85rem;
      color: var(--muted);
      text-decoration: none;
      transition: color .15s;
    }}
    .nav-back:hover {{ color: var(--text); }}
    .nav-date {{
      font-size: .85rem;
      color: var(--muted);
      margin-left: auto;
    }}

    /* ── header ── */
    header {{
      text-align: center;
      margin-bottom: 3.5rem;
    }}
    .logo {{
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      font-size: .85rem;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }}
    .logo svg {{ opacity: .5; }}
    h1 {{
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      font-weight: 700;
      letter-spacing: -.02em;
      line-height: 1.1;
    }}
    h1 span {{ color: var(--accent); }}
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

    /* ── layout ── */
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

    .section-title {{
      font-size: 1rem;
      font-weight: 600;
      color: var(--muted);
    }}
    .section-rule {{
      flex: 1;
      height: 1px;
      background: var(--border);
    }}

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
    .card-link {{
      text-decoration: none;
      color: inherit;
    }}
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

    /* left accent bar per tier */
    .hard-section   .card {{ border-left: 3px solid var(--hard);   }}
    .medium-section .card {{ border-left: 3px solid var(--medium); }}
    .easy-section   .card {{ border-left: 3px solid var(--easy);   }}

    /* ── footer ── */
    footer {{
      text-align: center;
      margin-top: 4rem;
      font-size: .78rem;
      color: var(--muted);
    }}
    footer a {{ color: var(--muted); text-decoration: underline; }}

    @media (max-width: 540px) {{
      .card {{ flex-wrap: wrap; }}
    }}
  </style>
</head>
<body>
  <nav class="week-nav">
    <a href="../all.html" class="nav-back">← All Weeks</a>
    <span class="nav-date">Week of {today_display}</span>
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

  <footer>
    Generated from <a href="https://cses.fi/problemset/" target="_blank">cses.fi/problemset</a> · ranked by solve count · seed {SEED}
  </footer>

  <script>
    const KEY = id => `cses-done-${{id}}`;

    function toggleDone(btn) {{
      const card = btn.closest('.card');
      const id = card.dataset.id;
      const done = localStorage.getItem(KEY(id)) === '1';
      setDone(card, !done);
    }}

    function setDone(card, done) {{
      localStorage.setItem(KEY(card.dataset.id), done ? '1' : '0');
      card.classList.toggle('done', done);
    }}

    document.addEventListener('DOMContentLoaded', () => {{
      document.querySelectorAll('.card[data-id]').forEach(card => {{
        if (localStorage.getItem(KEY(card.dataset.id)) === '1') card.classList.add('done');
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
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

    :root {{
      --bg:         #0f1117;
      --surface:    #1a1d27;
      --border:     #2a2d3a;
      --text:       #e8eaf0;
      --muted:      #6b7280;
      --accent:     #6366f1;
      --radius:     12px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }}

    body {{
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 3rem 1.5rem;
    }}

    header {{
      text-align: center;
      margin-bottom: 3rem;
    }}
    .logo {{
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      font-size: .85rem;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }}
    .logo svg {{ opacity: .5; }}
    h1 {{
      font-size: clamp(1.8rem, 4vw, 2.8rem);
      font-weight: 700;
      letter-spacing: -.02em;
    }}
    h1 span {{ color: var(--accent); }}
    .subtitle {{
      margin-top: .6rem;
      color: var(--muted);
      font-size: .9rem;
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
    .week-date {{
      font-size: 1rem;
      font-weight: 600;
    }}
    .week-arrow {{
      color: var(--muted);
      font-size: .9rem;
    }}

    footer {{
      text-align: center;
      margin-top: 4rem;
      font-size: .78rem;
      color: var(--muted);
    }}
    footer a {{ color: var(--muted); text-decoration: underline; }}
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

    if latest:
        INDEX_HTML.write_text(build_redirect(latest), encoding="utf-8")
        print(f"Index  → {INDEX_HTML}  (redirects to {latest.name})")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate a shareable HTML of today's CSES picks.")
    parser.add_argument("--ranking",   "-r", default=str(RANKING_CSV))
    parser.add_argument("--processed", "-p", default=str(PROCESSED_CSV))
    parser.add_argument("--date",      "-d", default=str(date.today()),
                        help="ISO date for the week page (default: today)")
    parser.add_argument("--seed",      "-s", type=int, default=SEED)
    args = parser.parse_args()

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

    html = build_html(hard, medium, easy, today_iso)

    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = OUTPUT_DIR / f"{today_iso}.html"
    output_path.write_text(html, encoding="utf-8")
    print(f"Saved  → {output_path}")

    regenerate_index()


if __name__ == "__main__":
    main()
