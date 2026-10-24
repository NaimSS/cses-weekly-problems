#!/usr/bin/env python3
"""
QOJ Premier List scraper.
Parses locally saved qoj.ac premier-list pages (QOJ is behind Cloudflare, so
pages are saved from the browser) into qoj/problems.csv.
"""

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from premier import HARDNESS, LIST_KEYS, PROBLEMS_CSV, save_problems_csv

QOJ_BASE = "https://qoj.ac"


class _ListParser(HTMLParser):
    """Collects rows of <tbody> <tr class="text-center"> only; the thead is ignored."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.problems: list[dict] = []
        self.list_key: str | None = None
        self._in_thead = False
        self._row: dict | None = None
        self._td = -1
        self._link: str | None = None   # "name" | "tag" while inside such an <a>
        self._badge: str | None = None  # "source" | "tag" while inside a badge <span>
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if tag == "thead":
            self._in_thead = True
        elif self._in_thead:
            if tag == "a" and self.list_key is None:
                m = re.search(r"[?&]premier_list=([A-Za-z0-9]+)", a.get("href") or "")
                if m:
                    self.list_key = m.group(1)
        elif tag == "tr" and "text-center" in cls:
            self._row = {"id": "", "name": "", "source": [], "tags": [], "url": ""}
            self._td = -1
        elif self._row is not None:
            if tag == "td":
                self._td += 1
                self._buf = []
            elif self._td == 1 and tag == "a" and "uoj-problem-tag" not in cls:
                if not self._row["url"]:
                    self._row["url"] = a.get("href") or ""
                    self._link = "name"
                    self._buf = []
            elif self._td == 1 and tag == "span" and "badge" in cls:
                if "badge-secondary" in cls:
                    self._badge = "source"
                elif "badge-success" in cls:
                    self._badge = "tag"
                self._buf = []

    def handle_endtag(self, tag):
        if tag == "thead":
            self._in_thead = False
        elif self._row is None:
            return
        elif tag == "a" and self._link == "name":
            self._row["name"] = "".join(self._buf).strip()
            self._link = None
        elif tag == "span" and self._badge:
            text = "".join(self._buf).strip()
            if text:
                self._row["source" if self._badge == "source" else "tags"].append(text)
            self._badge = None
        elif tag == "td" and self._td == 0:
            self._row["id"] = "".join(self._buf).strip().lstrip("#")
        elif tag == "tr":
            row, self._row = self._row, None
            if row["url"] and not row["id"]:
                row["id"] = row["url"].rstrip("/").rsplit("/", 1)[-1]
            if row["id"] and row["name"]:
                if row["url"].startswith("/"):
                    row["url"] = QOJ_BASE + row["url"]
                row["source"] = " · ".join(row["source"])
                self.problems.append(row)

    def handle_data(self, data):
        if self._row is not None:
            self._buf.append(data)


def parse_html(html: str, list_key: str | None = None) -> tuple[str, list[dict]]:
    """Return (list_key, problems). The key comes from the page, else `list_key`."""
    p = _ListParser()
    p.feed(html)
    p.close()
    key = p.list_key or list_key
    if not key:
        raise ValueError("cannot determine the premier list of this page "
                         "(no premier_list= link in the table head); pass --list KEY")
    for prob in p.problems:
        prob["list"] = key
    return key, p.problems


def dedupe(problems: list[dict]) -> tuple[list[dict], int]:
    """Keep each problem only in its hardest list. Returns (kept, n_removed)."""
    rank = {k: i for i, k in enumerate(HARDNESS)}
    best: dict[str, dict] = {}
    for p in problems:
        cur = best.get(p["id"])
        if cur is None or rank.get(p["list"], 99) < rank.get(cur["list"], 99):
            best[p["id"]] = p
    kept = list(best.values())
    return kept, len(problems) - len(kept)


def sort_problems(problems: list[dict]) -> list[dict]:
    order = {k: i for i, k in enumerate(LIST_KEYS)}
    return sorted(problems, key=lambda p: (order.get(p["list"], 99), int(p["id"])))


def scrape(files: list[Path], list_key: str | None = None) -> tuple[list[dict], dict, int]:
    """Parse files -> (sorted deduped problems, raw per-list counts, dupes removed)."""
    allp: list[dict] = []
    raw: dict[str, int] = {}
    for f in files:
        html = Path(f).read_text(encoding="utf-8", errors="replace")
        key, probs = parse_html(html, list_key)
        raw[key] = raw.get(key, 0) + len(probs)
        allp.extend(probs)
    kept, removed = dedupe(allp)
    return sort_problems(kept), raw, removed


def main():
    ap = argparse.ArgumentParser(description="Parse saved QOJ premier-list pages into problems.csv.")
    ap.add_argument("files", nargs="+", help="saved QOJ premier-list HTML pages")
    ap.add_argument("--list", "-l", dest="list_key", default=None,
                    help="list key to use when it cannot be detected from the page")
    ap.add_argument("--output", "-o", default=str(PROBLEMS_CSV))
    args = ap.parse_args()

    try:
        problems, raw, removed = scrape([Path(f) for f in args.files], args.list_key)
    except (ValueError, OSError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(1)

    save_problems_csv(Path(args.output), problems)
    for k in LIST_KEYS + sorted(set(raw) - set(LIST_KEYS)):
        if k in raw:
            kept = sum(1 for p in problems if p["list"] == k)
            print(f"{k:>3}: {raw[k]} parsed, {kept} kept")
    print(f"Removed {removed} cross-list duplicates; {len(problems)} problems → {args.output}")


if __name__ == "__main__":
    main()
