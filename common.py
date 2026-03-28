"""
Shared utilities for CSES weekly problem picking.
Imported by generate_html.py and pick_problems.py.
"""

import csv
import random
from pathlib import Path

# Difficulty band configuration — single source of truth for rank boundaries and counts.
DIFFICULTY_BANDS = {
    "hard":   {"min": 1,   "max": 100, "count": 2},
    "medium": {"min": 101, "max": 250, "count": 3},
    "easy":   {"min": 251, "max": 400, "count": 4},
}


def load_ranking(path: Path) -> list[dict]:
    """Load all problems from the difficulty-ranking CSV."""
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_processed_ids(path: Path) -> set[str]:
    """Return a set of problem IDs (as strings) that have already been picked."""
    if not path.exists():
        return set()
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Accept a column named 'id' or 'problem_id'
        id_col = next((c for c in (reader.fieldnames or [])
                       if c.strip().lower() in ("id", "problem_id")), None)
        if id_col is None:
            # Fall back: treat first column as ID
            f.seek(0)
            reader = csv.reader(f)
            next(reader, None)          # skip header
            return {row[0].strip() for row in reader if row}
        return {row[id_col].strip() for row in reader}


def pick(pool: list[dict], n: int, rng: random.Random) -> list[dict]:
    """Randomly sample n problems from pool; raises ValueError if pool is too small."""
    if len(pool) < n:
        raise ValueError(
            f"Not enough problems in pool: need {n}, have {len(pool)}."
        )
    return rng.sample(pool, n)


def pick_all_tiers(available: list[dict], rng: random.Random) -> dict[str, list[dict]]:
    """Pick problems for all difficulty tiers from the available pool.

    Returns a dict with keys 'hard', 'medium', 'easy', each mapping to a list of picked problems.
    """
    result = {}
    for tier, band in DIFFICULTY_BANDS.items():
        pool = [p for p in available if band["min"] <= int(p["rank"]) <= band["max"]]
        result[tier] = pick(pool, band["count"], rng)
    return result
