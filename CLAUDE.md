# CSES Picks — Claude Instructions

## Python Environment

Always use the local venv:

```bash
.venv/bin/python generate_html.py
```

Never use system `python` or `python3`.

## Project Overview

Weekly competitive-programming picks site. Each week 9 CSES problems are selected (2 hard / 3 medium / 4 easy by solve-count rank) and published as static HTML on GitHub Pages. See `README.md` for full project description.

## Key Files

| File | Purpose |
|------|---------|
| `cses_difficulty_ranking.csv` | Full CSES problem list — columns: `rank, id, name, section, solves, attempts, url` |
| `processed.csv` | **Append-only** log of every problem ever picked (`id, name, section, url`) — prevents repeats |
| `weeks_data.json` | Maps week date → `{hard, medium, easy}` lists — source of truth for rebuilds and rank page |
| `generate_html.py` | Main generator: picks problems, writes HTML, updates index/rank pages |
| `scraper.py` | Parses CSES HTML exports to rebuild `cses_difficulty_ranking.csv` |
| `pick_problems.py` | Standalone problem-picker utility |
| `supabase_schema.sql` | Supabase schema: `progress` + `profiles` tables with RLS |

## Difficulty Bands

| Tier | Rank range | Count/week |
|------|-----------|-----------|
| Hard | 1 – 100 | 2 |
| Medium | 101 – 250 | 3 |
| Easy | 251 – 400 | 4 |

## Generated Pages

| File | Description |
|------|-------------|
| `weeks/YYYY-MM-DD.html` | Weekly page — "Problems" tab + "Rankings" tab |
| `all.html` | Index of all weeks with "Group Rankings" button |
| `rank.html` | Overall leaderboard: users × weeks, cells = problems solved (colour-coded) |
| `index.html` | Redirect to the latest week |

## generate_html.py Usage

```bash
# Pick new problems for today and generate all pages
.venv/bin/python generate_html.py

# Pick for a specific date
.venv/bin/python generate_html.py --date 2026-03-22

# Rebuild HTML from weeks_data.json WITHOUT re-picking
.venv/bin/python generate_html.py --rebuild-only
```

**Critical:** Never run without `--rebuild-only` on an existing week — it picks NEW problems and appends them to `processed.csv`, corrupting history. Use `--rebuild-only` whenever updating HTML styling or structure.

## Supabase Integration

Progress is stored in Supabase (optional — pages degrade gracefully without it).

- `progress(user_id, problem_id, done, updated_at)` — per-user completion
- `profiles(user_id, username, avatar_url)` — auto-populated on GitHub OAuth sign-in via trigger
- Both tables have **public SELECT** so the leaderboard works without auth
- Credentials: `SUPABASE_URL`, `SUPABASE_ANON_KEY` env vars
- Writes are locked down: users can upsert/delete only their own `progress` rows (`problem_id` must match `^(qoj:)?[0-9]{1,7}$`) and can only `UPDATE` their own `profiles.qoj_handle` (no insert/delete, `username`/`avatar_url` come from the SECURITY DEFINER trigger)
- Existing DB: run `supabase_hardening.sql` once (idempotent) to reach the same state as a fresh `supabase_schema.sql` install

## Design System

Dark theme CSS variables used across all pages:

```
--bg #0f1117 · --surface #1a1d27 · --border #2a2d3a · --text #e8eaf0
--hard #ef4444 · --medium #f59e0b · --easy #22c55e · --accent #6366f1
```

## GitHub Actions

Runs every Sunday 06:00 UTC → picks new week → commits `weeks/` and `index.html`.
Workflow: `.github/workflows/weekly.yml`

## QOJ Premier Weekly (`qoj/`)

Second site under `qoj/` (see `qoj/README.md` for the full contract): weekly picks from the QOJ Premier Lists (D 4 / C 3 per week).

| File | Purpose |
|------|---------|
| `qoj/premier.py` | `PREMIER_LISTS` config, paths, load/pick helpers |
| `qoj/scraper.py` | Saved QOJ list HTML (stdlib parser) → `qoj/problems.csv` |
| `qoj/generate.py` | Picks a week + writes `problems.json`, `assets/config.js`, week/all/rank/index pages |
| `qoj/processed.csv`, `qoj/weeks_data.json` | **Append-only** pick log / source of truth for rebuilds |

```bash
.venv/bin/python qoj/generate.py --rebuild-only   # safe; regenerates pages only
.venv/bin/python -m unittest discover -s qoj/tests -v
```

**Critical:** never run `qoj/generate.py` without `--rebuild-only` against an existing week — it picks NEW problems and appends them to `qoj/processed.csv`. Workflow: `.github/workflows/qoj-weekly.yml`.
