"""
Shared config and data helpers for QOJ Premier Weekly.
Imported by scraper.py and generate.py.
"""

import csv
import json
import os
import random
import sys
import tempfile
from pathlib import Path

QOJ_DIR = Path(__file__).resolve().parent
REPO_ROOT = QOJ_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from common import load_processed_ids, pick  # noqa: E402

PROBLEMS_CSV    = QOJ_DIR / "problems.csv"
PROBLEMS_JSON   = QOJ_DIR / "problems.json"
PROCESSED_CSV   = QOJ_DIR / "processed.csv"
WEEKS_DATA_JSON = QOJ_DIR / "weeks_data.json"
WEEKS_DIR       = QOJ_DIR / "weeks"
CONFIG_JS       = QOJ_DIR / "assets" / "config.js"
INDEX_HTML      = QOJ_DIR / "index.html"
ALL_HTML        = QOJ_DIR / "all.html"
RANK_HTML       = QOJ_DIR / "rank.html"

PROBLEM_FIELDS   = ["id", "name", "list", "source", "tags", "url"]
PROCESSED_FIELDS = ["id", "name", "list", "url"]

# Display order, easy -> hard.
PREMIER_LISTS = [
    {"key": "D",  "label": "Beginners", "count": 4, "enabled": True},
    {"key": "C",  "label": "Easy I",    "count": 3, "enabled": True},
    {"key": "C2", "label": "Easy II",   "count": 0, "enabled": False},
    {"key": "B",  "label": "Medium I",  "count": 0, "enabled": False},
    {"key": "B2", "label": "Medium II", "count": 0, "enabled": False},
    {"key": "A",  "label": "Hard",      "count": 0, "enabled": False},
]
LIST_KEYS = [l["key"] for l in PREMIER_LISTS]

# A problem in several lists is kept only in the hardest one (first = hardest).
HARDNESS = ["A", "B2", "B", "C2", "C", "D"]

# Warn when fewer than this many weeks of picks remain in a list's pool.
MIN_WEEKS_LEFT = 4


def load_problems(path: Path = PROBLEMS_CSV) -> list[dict]:
    """Load problems.csv; `tags` becomes a list."""
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["tags"] = [t for t in (r.get("tags") or "").split(";") if t]
    return rows


def save_problems_csv(path: Path, problems: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PROBLEM_FIELDS)
        w.writeheader()
        for p in problems:
            row = dict(p)
            row["tags"] = ";".join(p.get("tags") or [])
            w.writerow({k: row.get(k, "") for k in PROBLEM_FIELDS})


def load_weeks_data(path: Path = WEEKS_DATA_JSON) -> dict:
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return {}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save_weeks_data(data: dict, path: Path = WEEKS_DATA_JSON) -> None:
    """Write weeks_data.json atomically (temp file in the same dir + os.replace)."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(tmp, 0o644)  # mkstemp creates 0600
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def week_ids(weeks_data: dict) -> set[str]:
    """Every problem id picked in any week."""
    return {p["id"] for wd in weeks_data.values() for ps in wd.values() for p in ps}


def save_processed(path: Path, problems: list[dict]) -> None:
    """Append newly picked problems to the processed.csv log."""
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PROCESSED_FIELDS)
        if write_header:
            w.writeheader()
        for p in problems:
            w.writerow({k: p.get(k, "") for k in PROCESSED_FIELDS})


def pick_week(available: list[dict], rng: random.Random,
              lists: list[dict] = PREMIER_LISTS) -> dict[str, list[dict]]:
    """Pick this week's problems for every enabled list with count > 0."""
    result = {}
    for lst in lists:
        if not lst["enabled"] or lst["count"] <= 0:
            continue
        pool = [p for p in available if p["list"] == lst["key"]]
        try:
            result[lst["key"]] = pick(pool, lst["count"], rng)
        except ValueError as e:
            raise ValueError(f"List {lst['key']} ({lst['label']}): {e}") from None
        left = len(pool) - lst["count"]
        if left < MIN_WEEKS_LEFT * lst["count"]:
            # GitHub Actions annotation; still readable as a plain log line locally.
            print(f"::warning::list {lst['key']} has only {left} unpicked problems left "
                  f"after this week (< {MIN_WEEKS_LEFT} weeks of picks).")
    return result
