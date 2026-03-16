# CSES Picks — Claude Instructions

## Python Environment

Always use the local virtual environment when running Python commands:

```bash
.venv/bin/python generate_html.py
```

Never use the system `python` or `python3` directly. The venv is at `.venv/`.

## Project Overview

Weekly competitive-programming practice site for a group of friends. Each week 9 CSES problems are picked (2 hard / 3 medium / 4 easy, ranked by solve count) and published as static HTML on GitHub Pages.

## Key Files

| File | Purpose |
|------|---------|
| `cses_difficulty_ranking.csv` | Full CSES problem list ranked by solve count (rank, id, name, section, solves, attempts, url) |
| `processed.csv` | Append-only log of every problem ever picked (`id, name, section, url`) — prevents repeats |
| `weeks_data.json` | Maps each week date → `{hard, medium, easy}` problem lists with `id, name, section, url` — source of truth for rebuilds and the rank page |
| `generate_html.py` | Main generator — picks problems, writes HTML, updates all index/rank pages |
| `scraper.py` | Parses CSES HTML exports to build `cses_difficulty_ranking.csv` |
| `pick_problems.py` | Standalone problem-picker utility |
| `supabase_schema.sql` | Supabase schema: `progress` + `profiles` tables with RLS |

## Difficulty Bands (by rank)

| Tier | Rank range | Count/week |
|------|-----------|-----------|
| Hard | 1 – 100 | 2 |
| Medium | 101 – 250 | 3 |
| Easy | 251 – 400 | 4 |

## Generated Pages

| File | Description |
|------|-------------|
| `weeks/YYYY-MM-DD.html` | Weekly problems page — "Problems" tab + "Rankings" tab |
| `all.html` | Index of all weeks with a "Group Rankings" button |
| `rank.html` | Overall leaderboard: rows = users, columns = weeks, cells = problems solved (colour-coded) |
| `index.html` | Redirect to the latest week |

## generate_html.py Usage

```bash
# Pick new problems for today and generate pages
.venv/bin/python generate_html.py

# Pick for a specific date
.venv/bin/python generate_html.py --date 2026-03-22

# Rebuild all existing week pages from weeks_data.json WITHOUT re-picking
.venv/bin/python generate_html.py --rebuild-only
```

**Important:** Never run without `--rebuild-only` to regenerate an existing week — it will pick NEW problems and append them to `processed.csv`. Use `--rebuild-only` whenever you only want to update the HTML styling/structure.

## Supabase Integration

Progress is stored in Supabase (optional — pages degrade gracefully without it).

- `progress(user_id, problem_id, done, updated_at)` — per-user problem completion
- `profiles(user_id, username, avatar_url)` — auto-populated on GitHub OAuth sign-in via trigger
- Both tables have **public SELECT** policies so the rank/leaderboard pages work without auth
- Credentials via env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Design System

Dark theme CSS variables used across all pages:

```
--bg #0f1117 · --surface #1a1d27 · --border #2a2d3a · --text #e8eaf0
--hard #ef4444 · --medium #f59e0b · --easy #22c55e · --accent #6366f1
```

## GitHub Actions

Runs every Sunday 06:00 UTC → picks new week → commits `weeks/`, `index.html`, etc.
Workflow: `.github/workflows/weekly.yml`
