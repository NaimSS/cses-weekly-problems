# CSES Weekly Picks

Weekly competitive-programming practice site for a group of friends. Every Sunday, 9 problems are automatically selected from [CSES](https://cses.fi/problemset/) and published as a static site on GitHub Pages.

**Live site:** https://naimss.github.io/cses-weekly-problems/

## How it works

- **9 problems/week** — 2 hard, 3 medium, 4 easy (difficulty = solve-count rank on CSES)
- Problems are never repeated (`processed.csv` tracks all previous picks)
- GitHub Actions runs every Sunday at 06:00 UTC and auto-commits the new week
- Progress is tracked per-user via Supabase; the leaderboard updates live in-browser
