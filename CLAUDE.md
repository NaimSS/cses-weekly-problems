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

## Design System

Dark theme CSS variables used across all pages:

```
--bg #0f1117 · --surface #1a1d27 · --border #2a2d3a · --text #e8eaf0
--hard #ef4444 · --medium #f59e0b · --easy #22c55e · --accent #6366f1
```

## GitHub Actions

Runs every Sunday 06:00 UTC → picks new week → commits `weeks/` and `index.html`.
Workflow: `.github/workflows/weekly.yml`
