#!/usr/bin/env python3
"""
Generates the QOJ Premier Weekly site data and page shells.
Picks a week (unless --rebuild-only) and writes: processed.csv, weeks_data.json,
problems.json, assets/config.js, weeks/<date>.html, all.html, rank.html, index.html.
"""

import argparse
import json
import os
import random
from datetime import date
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

import premier
from premier import PREMIER_LISTS

SEED = 42

# Load .env file if present (for local development)
_env_file = premier.REPO_ROOT / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SUPABASE_URL      = os.environ.get("SUPABASE_URL", "https://ugwnwhnuadolypyvrnsq.supabase.co")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_Df8xVwylhhWVQhW3hRtR_Q_wL9KM1-6")


# ── rendering ─────────────────────────────────────────────────────────────────

def js_json(obj) -> str:
    """JSON safe to embed in an inline <script> (no </script>, <!-- or U+2028 breakouts)."""
    s = json.dumps(obj, ensure_ascii=False)
    return (s.replace("</", "<\\/").replace("<!--", "<\\!--")
             .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def preconnect_links() -> str:
    """<link rel=preconnect> for the CDN and (if configured) the Supabase origin."""
    origins = []
    u = urlsplit(SUPABASE_URL or "")
    if u.scheme in ("http", "https") and u.netloc:
        origins.append(f"{u.scheme}://{u.netloc}")
    origins.append("https://cdn.jsdelivr.net")
    return "".join(f'  <link rel="preconnect" href="{escape(o)}" crossorigin>\n' for o in origins)


def build_shell(title: str, active: str, base: str, page: dict, script: str, seed: int = SEED) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
{preconnect_links()}  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="{base}assets/qoj.css">
</head>
<body>
  <div class="container">
    <div id="site-header" data-active="{active}"></div>
    <main id="page"><p class="text-muted">Loading…</p></main>
    <footer class="site-footer">
      Problems from <a href="https://qoj.ac/problems?premier_list=C" target="_blank">QOJ Premier List</a> · seed {seed} · <a href="https://github.com/NaimSS/cses-weekly-problems" target="_blank">source</a>
    </footer>
  </div>
  <script>window.QOJ_BASE = {js_json(base)}; window.QOJ_PAGE = {js_json(page)};</script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
  <script src="{base}assets/config.js"></script>
  <script src="{base}assets/app.js"></script>
  <script src="{base}assets/{script}.js"></script>
</body>
</html>
"""


def build_week(week_iso: str, problems: dict, seed: int = SEED) -> str:
    page = {"type": "week", "date": week_iso, "problems": problems}
    return build_shell(f"QOJ Premier Weekly · {week_iso}", "weekly", "../", page, "week", seed)


def build_all(weeks: list[str], seed: int = SEED) -> str:
    page = {"type": "all", "weeks": sorted(weeks, reverse=True)}
    return build_shell("QOJ Premier Weekly · All weeks", "all", "", page, "all", seed)


def build_rank(weeks_data: dict, seed: int = SEED) -> str:
    page = {"type": "rank", "weeks": weeks_data}
    return build_shell("QOJ Premier Weekly · Rankings", "rank", "", page, "rank", seed)


def build_redirect(latest: str) -> str:
    target = f"weeks/{latest}.html"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url={escape(target)}" />
  <title>QOJ Premier Weekly</title>
</head>
<body>
  <script>location.replace({js_json(target)});</script>
</body>
</html>"""


def build_config_js() -> str:
    return ("window.QOJ_CONFIG = " + js_json({"supabaseUrl": SUPABASE_URL, "supabaseKey": SUPABASE_ANON_KEY})
            + ";\nwindow.QOJ_LISTS = " + js_json(PREMIER_LISTS) + ";\n")


def merge_picked(problems: list[dict], weeks_data: dict) -> list[dict]:
    """problems + every picked problem missing from it, so past picks survive a re-scrape."""
    seen = {p["id"] for p in problems}
    extra = []
    for week_iso in sorted(weeks_data):
        for ps in weeks_data[week_iso].values():
            for p in ps:
                if p["id"] not in seen:
                    seen.add(p["id"])
                    extra.append(p)
    return problems + extra


def write_site(out: Path, weeks_data: dict, problems: list[dict], seed: int = SEED) -> None:
    """Write every generated file under `out` (the qoj/ directory)."""
    problems = merge_picked(problems, weeks_data)
    (out / "weeks").mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(parents=True, exist_ok=True)
    (out / "problems.json").write_text(json.dumps(problems, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (out / "assets" / "config.js").write_text(build_config_js(), encoding="utf-8")
    for week_iso, wd in weeks_data.items():
        (out / "weeks" / f"{week_iso}.html").write_text(build_week(week_iso, wd, seed), encoding="utf-8")
    (out / "all.html").write_text(build_all(list(weeks_data), seed), encoding="utf-8")
    (out / "rank.html").write_text(build_rank(weeks_data, seed), encoding="utf-8")
    if weeks_data:
        (out / "index.html").write_text(build_redirect(max(weeks_data)), encoding="utf-8")


# ── main ──────────────────────────────────────────────────────────────────────

def iso_date(s: str) -> str:
    """argparse type: a real YYYY-MM-DD date, normalised (also blocks path/HTML injection)."""
    try:
        return date.fromisoformat(s).isoformat()
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"invalid date {s!r}, expected YYYY-MM-DD") from None


def check_consistency(processed_path: Path, weeks_data: dict) -> bool:
    """Warn (don't fail) if processed.csv and weeks_data.json disagree on picked ids."""
    logged = premier.load_processed_ids(processed_path)
    picked = premier.week_ids(weeks_data)
    if logged == picked:
        return True
    only_log, only_weeks = sorted(logged - picked), sorted(picked - logged)
    print(f"::warning::{processed_path.name} and weeks_data.json disagree: "
          f"only in processed: {only_log or '-'}; only in weeks_data: {only_weeks or '-'}")
    return False


def run(args) -> None:
    out            = Path(args.output_dir)
    problems_path  = Path(args.problems)
    processed_path = Path(args.processed)
    weeks_path     = Path(args.weeks_data)
    weeks_data     = premier.load_weeks_data(weeks_path)

    if not problems_path.exists():
        raise SystemExit(f"ERROR: {problems_path} not found. Run qoj/scraper.py first.")
    problems = premier.load_problems(problems_path)
    check_consistency(processed_path, weeks_data)

    if not args.rebuild_only:
        week_iso = iso_date(args.date)
        # Guard: refuse to re-pick for an already-published week
        if week_iso in weeks_data and getattr(args, "skip_existing", False):
            print(f"Week {week_iso} already exists in {weeks_path.name}; skipping pick (--skip-existing).")
        elif week_iso in weeks_data:
            print(f"ERROR: Week {week_iso} already exists in {weeks_path.name}.")
            print("Use --rebuild-only to regenerate HTML without re-picking.")
            raise SystemExit(1)
        else:
            pick_and_save(args, week_iso, problems, weeks_data, processed_path, weeks_path)

    write_site(out, weeks_data, problems, args.seed)
    print(f"Wrote {len(weeks_data)} week page(s) + all/rank/problems.json/config.js → {out}")


def pick_and_save(args, week_iso, problems, weeks_data, processed_path, weeks_path) -> None:
    processed_ids = premier.load_processed_ids(processed_path)
    available = [p for p in problems if p["id"] not in processed_ids]
    # Seed per week: deterministic for a given date, but different every week.
    try:
        picked = premier.pick_week(available, random.Random(f"{args.seed}:{week_iso}"))
    except ValueError as e:
        print(f"::error::{e}")
        raise SystemExit(f"ERROR: {e}")

    # weeks_data.json is the source of truth: write it (atomically) first, then the log.
    weeks_data[week_iso] = picked
    premier.save_weeks_data(weeks_data, weeks_path)
    premier.save_processed(processed_path, [p for ps in picked.values() for p in ps])
    print(f"Picked {sum(len(v) for v in picked.values())} problems for {week_iso}")


def main():
    ap = argparse.ArgumentParser(description="Generate QOJ Premier Weekly picks and pages.")
    ap.add_argument("--problems",   "-r", default=str(premier.PROBLEMS_CSV))
    ap.add_argument("--processed",  "-p", default=str(premier.PROCESSED_CSV))
    ap.add_argument("--weeks-data", default=str(premier.WEEKS_DATA_JSON))
    ap.add_argument("--output-dir", default=str(premier.QOJ_DIR),
                    help="directory the generated pages/JSON are written to")
    ap.add_argument("--date", "-d", type=iso_date, default=str(date.today()),
                    help="ISO date for the week page (default: today)")
    ap.add_argument("--seed", "-s", type=int, default=SEED)
    ap.add_argument("--rebuild-only", action="store_true",
                    help="Regenerate pages from weeks_data.json without picking new problems")
    ap.add_argument("--skip-existing", action="store_true",
                    help="If the week already exists, print a notice and just rebuild (exit 0) "
                         "instead of failing; used by the scheduled workflow")
    run(ap.parse_args())


if __name__ == "__main__":
    main()
