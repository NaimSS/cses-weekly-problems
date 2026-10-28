import csv
import sys
import tempfile
import unittest
from pathlib import Path

QOJ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(QOJ_DIR))

import premier  # noqa: E402
import scraper  # noqa: E402


def page(list_key, rows, link=True):
    head_link = (f'<a href="https://qoj.ac/problems?premier_list={list_key}&amp;sort=id&amp;order=desc">ID</a>'
                 if link else '<a href="https://qoj.ac/problems?sort=id">ID</a>')
    body = "".join(rows)
    return f"""<html><body><table><thead><tr><th>{head_link}</th>
<th>Problem <a class="uoj-problem-tag" href="x"><span class="badge badge-pill badge-success">Interactive</span></a>
<a class="uoj-problem-tag" href="y"><span class="badge badge-pill badge-success">Output Only</span></a></th>
<th>Rating</th></tr></thead><tbody>{body}</tbody></table></body></html>"""


def row(pid, name, sources=(), tags=()):
    badges = "".join(f'<a class="uoj-problem-tag" href="t"><span class="badge badge-pill badge-secondary">{s}</span></a>'
                     for s in sources)
    badges += "".join(f'<a class="uoj-problem-tag" href="t"><span class="badge badge-pill badge-success">{t}</span></a>'
                      for t in tags)
    return (f'<tr class="text-center"><td>#{pid}</td><td class="text-left">'
            f'<a href="https://qoj.ac/problem/{pid}">{name}</a>{badges}</td>'
            f'<td class="text-left"><div><a href="https://qoj.ac/problems?premier_list=C#" class="up">'
            f'<span class="glyphicon">x</span></a> 3</div></td></tr>')


class ParseTests(unittest.TestCase):
    def test_parse_row_fields(self):
        html = page("C", [row(63, "Meetings", ["JOISC 2019 Day 1"], ["Interactive"])])
        key, probs = scraper.parse_html(html)
        self.assertEqual(key, "C")
        self.assertEqual(probs, [{
            "id": "63", "name": "Meetings", "source": "JOISC 2019 Day 1", "tags": ["Interactive"],
            "url": "https://qoj.ac/problem/63", "list": "C"}])

    def test_thead_tags_ignored(self):
        _, probs = scraper.parse_html(page("C", [row(1, "A")]))
        self.assertEqual(len(probs), 1)
        self.assertEqual(probs[0]["tags"], [])

    def test_entities_and_multiple_sources(self):
        html = page("B", [row(5, "Tom &amp; Jerry &lt;3&gt;", ["ICPC &amp; Co", "Day 2"])])
        _, probs = scraper.parse_html(html)
        self.assertEqual(probs[0]["name"], "Tom & Jerry <3>")
        self.assertEqual(probs[0]["source"], "ICPC & Co · Day 2")

    def test_url_normalised(self):
        rel = row(7, "Rel").replace("https://qoj.ac/problem/7", "/problem/7")
        bad = row(8, "Bad").replace("https://qoj.ac/problem/8", "javascript:alert(1)")
        evil = row(9, "Evil").replace("https://qoj.ac/problem/9", "https://qoj.ac.evil.com/x")
        _, probs = scraper.parse_html(page("C", [rel, bad, evil]))
        self.assertEqual([p["url"] for p in probs],
                         [f"https://qoj.ac/problem/{i}" for i in (7, 8, 9)])

    def test_list_detection_and_fallback(self):
        self.assertEqual(scraper.parse_html(page("B2", [row(1, "A")]))[0], "B2")
        self.assertEqual(scraper.parse_html(page("x", [row(1, "A")], link=False), "D")[0], "D")
        with self.assertRaises(ValueError):
            scraper.parse_html(page("x", [row(1, "A")], link=False))

    def test_page_key_beats_flag(self):
        self.assertEqual(scraper.parse_html(page("C2", [row(1, "A")]), "A")[0], "C2")


class DedupeAndCsvTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "c.html").write_text(page("C", [row(1, "Shared"), row(2, "Only C")]), encoding="utf-8")
        (self.dir / "b.html").write_text(page("B", [row(1, "Shared"), row(10, "Only B", ["S1", "S2"], ["Interactive"])]),
                                         encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_dedupe_hardest_wins_and_order(self):
        probs, raw, removed = scraper.scrape([self.dir / "c.html", self.dir / "b.html"])
        self.assertEqual(removed, 1)
        self.assertEqual(raw, {"C": 2, "B": 2})
        # display order: C before B, numeric id within list
        self.assertEqual([(p["list"], p["id"]) for p in probs], [("C", "2"), ("B", "1"), ("B", "10")])

    def test_non_numeric_ids_sort(self):
        probs = [{"id": i, "list": "C"} for i in ("10", "abc", "2", "1a")] + [{"id": "5", "list": "B"}]
        self.assertEqual([p["id"] for p in scraper.sort_problems(probs)], ["2", "10", "1a", "abc", "5"])

    def test_dropped_rows_counted(self):
        html = page("C", [row(1, "A"), row(2, "")])
        (self.dir / "d.html").write_text(html, encoding="utf-8")
        stats = {"dropped": 0}
        probs, _, _ = scraper.scrape([self.dir / "d.html"], stats=stats)
        self.assertEqual([p["id"] for p in probs], ["1"])
        self.assertEqual(stats["dropped"], 1)

    def test_csv_round_trip(self):
        probs, _, _ = scraper.scrape([self.dir / "c.html", self.dir / "b.html"])
        out = self.dir / "problems.csv"
        premier.save_problems_csv(out, probs)
        with out.open(encoding="utf-8") as f:
            self.assertEqual(next(csv.reader(f)), ["id", "name", "list", "source", "tags", "url"])
        self.assertEqual(premier.load_problems(out), probs)
        self.assertIn("S1 · S2", out.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
