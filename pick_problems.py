#!/usr/bin/env python3
"""
CSES Problem Picker
Selects a daily set of problems from the difficulty ranking CSV,
skipping any already-processed problems.

Picks (seed=42):
  2 hard   — top 100   (ranks   1–100)
  3 medium — ranks 101–200
  4 easy   — ranks 201–400
"""

import csv
import random
import argparse
from pathlib import Path

SEED = 42

RANKING_CSV   = Path(__file__).parent / "cses_difficulty_ranking.csv"
PROCESSED_CSV = Path(__file__).parent / "processed.csv"


# ── helpers ──────────────────────────────────────────────────────────────────

def load_ranking(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_processed_ids(path: Path) -> set[str]:
    """Return a set of problem IDs (as strings) that have already been done."""
    if not path.exists():
        return set()
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # accept a column named 'id' or 'problem_id'
        id_col = next((c for c in (reader.fieldnames or [])
                       if c.strip().lower() in ("id", "problem_id")), None)
        if id_col is None:
            # fall back: treat first column as ID
            f.seek(0)
            reader = csv.reader(f)
            next(reader, None)          # skip header
            return {row[0].strip() for row in reader if row}
        return {row[id_col].strip() for row in reader}


def pick(pool: list[dict], n: int, rng: random.Random) -> list[dict]:
    if len(pool) < n:
        raise ValueError(
            f"Not enough problems in pool: need {n}, have {len(pool)}."
        )
    return rng.sample(pool, n)


def print_results(label: str, problems: list[dict]) -> None:
    print(f"\n── {label} ──")
    for p in problems:
        print(f"  [{p['id']}] {p['name']}")
        print(f"        solves : {p['solves'] or 'N/A'}")
        print(f"        section: {p['section']}")
        print(f"        url    : {p['url']}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Pick 2 hard + 3 medium + 4 easy CSES problems, skipping processed ones."
    )
    parser.add_argument(
        "--ranking", "-r",
        default=str(RANKING_CSV),
        help=f"Difficulty ranking CSV (default: {RANKING_CSV}).",
    )
    parser.add_argument(
        "--processed", "-p",
        default=str(PROCESSED_CSV),
        help=f"CSV of already-processed problems to skip (default: {PROCESSED_CSV}).",
    )
    parser.add_argument(
        "--seed", "-s",
        type=int,
        default=SEED,
        help=f"Random seed (default: {SEED}).",
    )
    args = parser.parse_args()

    ranking_path   = Path(args.ranking)
    processed_path = Path(args.processed)

    if not ranking_path.exists():
        print(f"ERROR: Ranking CSV not found: {ranking_path}")
        print("Run scraper.py first to generate it.")
        raise SystemExit(1)

    all_problems  = load_ranking(ranking_path)
    processed_ids = load_processed_ids(processed_path)

    if processed_ids:
        print(f"Skipping {len(processed_ids)} already-processed problem(s).")

    # Filter out processed problems, then split by difficulty tier
    available = [p for p in all_problems if p["id"] not in processed_ids]

    hard   = [p for p in available if 1   <= int(p["rank"]) <= 100]
    medium = [p for p in available if 101 <= int(p["rank"]) <= 200]
    easy   = [p for p in available if 201 <= int(p["rank"]) <= 400]

    print(f"Available pool  →  hard: {len(hard)}  medium: {len(medium)}  easy: {len(easy)}")

    rng = random.Random(args.seed)

    try:
        picked_hard   = pick(hard,   2, rng)
        picked_medium = pick(medium, 3, rng)
        picked_easy   = pick(easy,   4, rng)
    except ValueError as e:
        print(f"ERROR: {e}")
        raise SystemExit(1)

    print("\n╔══════════════════════════════════════╗")
    print("║       Today's CSES Problem Set       ║")
    print("╚══════════════════════════════════════╝")
    print_results("HARD   (2 problems — ranks   1–100)", picked_hard)
    print_results("MEDIUM (3 problems — ranks 101–200)", picked_medium)
    print_results("EASY   (4 problems — ranks 201–400)", picked_easy)
    print()


if __name__ == "__main__":
    main()
