#!/usr/bin/env python3
"""
CSES Problem Set Scraper
Parses a locally saved CSES problem-list HTML and ranks problems
by number of solves, least → most solved (hardest → easiest).
"""

import csv
import re
import sys
import argparse
from pathlib import Path
from bs4 import BeautifulSoup

CSES_BASE = "https://cses.fi"

DEFAULT_HTML = Path.home() / "Downloads" / "CSES - CSES Problem Set - Tasks.html"


def parse_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    problems = []

    for li in soup.select("li.task"):
        a = li.find("a")
        if not a:
            continue

        href = a.get("href", "")
        name = a.get_text(strip=True)

        match = re.search(r"/task/(\d+)", href)
        if not match:
            continue
        problem_id = int(match.group(1))

        url = href if href.startswith("http") else CSES_BASE + href

        # e.g. "159862 / 167244"  →  solves / attempts
        detail = li.find("span", class_="detail")
        solves = attempts = None
        if detail:
            nums = re.findall(r"[\d,]+", detail.get_text())
            if len(nums) >= 2:
                solves   = int(nums[0].replace(",", ""))
                attempts = int(nums[1].replace(",", ""))
            elif len(nums) == 1:
                solves = int(nums[0].replace(",", ""))

        # Section heading that precedes this list
        section = None
        for parent in li.parents:
            h2 = parent.find_previous_sibling("h2")
            if h2:
                section = h2.get_text(strip=True)
                break

        problems.append({
            "id":       problem_id,
            "name":     name,
            "url":      url,
            "section":  section,
            "solves":   solves,
            "attempts": attempts,
        })

    return problems


def rank_by_difficulty(problems: list[dict]) -> list[dict]:
    """Least solved first (hardest). Problems with no data go to the end."""
    no_data   = [p for p in problems if p["solves"] is None]
    with_data = [p for p in problems if p["solves"] is not None]
    return sorted(with_data, key=lambda p: p["solves"]) + no_data


def write_csv(ranked: list[dict], output: str, top: int | None = None) -> None:
    subset = ranked[:top] if top else ranked
    out_path = Path(output)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["rank", "id", "name", "section", "solves", "attempts", "url"])
        for i, p in enumerate(subset, 1):
            writer.writerow([
                i,
                p["id"],
                p["name"],
                p["section"] or "",
                p["solves"] if p["solves"] is not None else "",
                p["attempts"] if p["attempts"] is not None else "",
                p["url"],
            ])
    print(f"Saved {len(subset)} problems to {out_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Rank CSES problems by difficulty (least → most solved)."
    )
    parser.add_argument(
        "--file", "-f",
        metavar="HTML_FILE",
        default=str(DEFAULT_HTML),
        help=f"Path to saved CSES problem-set HTML (default: {DEFAULT_HTML}).",
    )
    parser.add_argument(
        "--top", "-n",
        type=int,
        metavar="N",
        help="Include only the N hardest problems in the output.",
    )
    parser.add_argument(
        "--output", "-o",
        metavar="OUTPUT.csv",
        default="cses_difficulty_ranking.csv",
        help="Output CSV file path (default: cses_difficulty_ranking.csv).",
    )
    args = parser.parse_args()

    html_path = Path(args.file)
    if not html_path.exists():
        print(f"ERROR: File not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing {html_path} …")
    problems = parse_html(html_path.read_text(encoding="utf-8"))

    if not problems:
        print("No problems found. Make sure this is a CSES problem-set page.")
        sys.exit(1)

    ranked = rank_by_difficulty(problems)
    print(f"Found {len(ranked)} problems, ranked least → most solved.")
    write_csv(ranked, args.output, args.top)


if __name__ == "__main__":
    main()
