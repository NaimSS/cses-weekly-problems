#!/usr/bin/env python3
"""
CSES Problem Picker
Selects a daily set of problems from the difficulty ranking CSV,
skipping any already-processed problems.

Picks (seed=42):
  2 hard   — top 100   (ranks   1–100)
  3 medium — ranks 101–250
  4 easy   — ranks 251–400
"""

import random
import argparse
from pathlib import Path

from common import DIFFICULTY_BANDS, load_processed_ids, load_ranking, pick_all_tiers

SEED = 42

RANKING_CSV   = Path(__file__).parent / "cses_difficulty_ranking.csv"
PROCESSED_CSV = Path(__file__).parent / "processed.csv"


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

    pool_sizes = {
        tier: len([p for p in available if band["min"] <= int(p["rank"]) <= band["max"]])
        for tier, band in DIFFICULTY_BANDS.items()
    }
    print(f"Available pool  →  hard: {pool_sizes['hard']}  medium: {pool_sizes['medium']}  easy: {pool_sizes['easy']}")

    rng = random.Random(args.seed)

    try:
        picked = pick_all_tiers(available, rng)
    except ValueError as e:
        print(f"ERROR: {e}")
        raise SystemExit(1)

    hard_label   = f"HARD   ({DIFFICULTY_BANDS['hard']['count']} problems — ranks {DIFFICULTY_BANDS['hard']['min']}–{DIFFICULTY_BANDS['hard']['max']})"
    medium_label = f"MEDIUM ({DIFFICULTY_BANDS['medium']['count']} problems — ranks {DIFFICULTY_BANDS['medium']['min']}–{DIFFICULTY_BANDS['medium']['max']})"
    easy_label   = f"EASY   ({DIFFICULTY_BANDS['easy']['count']} problems — ranks {DIFFICULTY_BANDS['easy']['min']}–{DIFFICULTY_BANDS['easy']['max']})"

    print("\n╔══════════════════════════════════════╗")
    print("║       Today's CSES Problem Set       ║")
    print("╚══════════════════════════════════════╝")
    print_results(hard_label,   picked["hard"])
    print_results(medium_label, picked["medium"])
    print_results(easy_label,   picked["easy"])
    print()


if __name__ == "__main__":
    main()
