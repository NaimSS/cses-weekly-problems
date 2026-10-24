import argparse
import json
import random
import re
import sys
import tempfile
import unittest
from pathlib import Path

QOJ_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(QOJ_DIR))

import generate  # noqa: E402
import premier  # noqa: E402

PER_LIST = {"C": 2, "C2": 2, "B": 2, "B2": 1}


def make_problems(n=20):
    out = []
    i = 1
    for key in premier.LIST_KEYS:
        for _ in range(n):
            out.append({"id": str(i), "name": f"P{i}", "list": key, "source": "S", "tags": [],
                        "url": f"https://qoj.ac/problem/{i}"})
            i += 1
    return out


def extract_page(html):
    m = re.search(r"window\.QOJ_PAGE = (.*?);</script>", html, re.S)
    return json.loads(m.group(1))


class TmpCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        premier.save_problems_csv(self.dir / "problems.csv", make_problems())

    def tearDown(self):
        self.tmp.cleanup()

    def args(self, **kw):
        d = dict(problems=str(self.dir / "problems.csv"), processed=str(self.dir / "processed.csv"),
                 weeks_data=str(self.dir / "weeks_data.json"), output_dir=str(self.dir),
                 date="2026-10-25", seed=42, rebuild_only=False)
        d.update(kw)
        return argparse.Namespace(**d)

    def run_gen(self, **kw):
        generate.run(self.args(**kw))

    def weeks(self):
        return json.loads((self.dir / "weeks_data.json").read_text(encoding="utf-8"))


class PickTests(TmpCase):
    def test_counts_per_enabled_list(self):
        week = premier.pick_week(make_problems(), random.Random(1))
        self.assertEqual({k: len(v) for k, v in week.items()}, PER_LIST)
        for k, ps in week.items():
            self.assertTrue(all(p["list"] == k for p in ps))

    def test_pool_too_small(self):
        few = [p for p in make_problems() if p["list"] != "B2"]
        with self.assertRaises(ValueError) as cm:
            premier.pick_week(few, random.Random(1))
        self.assertIn("B2", str(cm.exception))

    def test_deterministic_with_seed(self):
        a = premier.pick_week(make_problems(), random.Random(7))
        b = premier.pick_week(make_problems(), random.Random(7))
        self.assertEqual(a, b)

    def test_no_repeats_across_weeks_and_processed_append_only(self):
        self.run_gen(date="2026-10-25")
        first = (self.dir / "processed.csv").read_text(encoding="utf-8")
        self.run_gen(date="2026-11-01")
        second = (self.dir / "processed.csv").read_text(encoding="utf-8")
        self.assertTrue(second.startswith(first))
        self.assertEqual(second.count("\n"), 1 + 7 * 2)
        w = self.weeks()
        ids = lambda wk: {p["id"] for ps in wk.values() for p in ps}
        self.assertEqual(len(ids(w["2026-10-25"])), 7)
        self.assertFalse(ids(w["2026-10-25"]) & ids(w["2026-11-01"]))

    def test_refuses_existing_week(self):
        self.run_gen()
        before = (self.dir / "processed.csv").read_text(encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.run_gen()
        self.assertEqual((self.dir / "processed.csv").read_text(encoding="utf-8"), before)


class PageTests(TmpCase):
    def test_week_shell(self):
        self.run_gen()
        html = (self.dir / "weeks" / "2026-10-25.html").read_text(encoding="utf-8")
        page = extract_page(html)
        self.assertEqual(page["type"], "week")
        self.assertEqual(page["date"], "2026-10-25")
        self.assertEqual({k: len(v) for k, v in page["problems"].items()}, PER_LIST)
        self.assertIn('window.QOJ_BASE = "../"', html)
        self.assertIn('href="../assets/qoj.css"', html)
        self.assertIn('data-active="weekly"', html)
        order = ["supabase.min.js", "../assets/config.js", "../assets/app.js", "../assets/week.js"]
        pos = [html.index(f'{s}"') for s in order]
        self.assertEqual(pos, sorted(pos))
        self.assertLess(html.index("window.QOJ_PAGE"), pos[0])
        self.assertIn("seed 42", html)

    def test_top_level_shells(self):
        self.run_gen(date="2026-10-25")
        self.run_gen(date="2026-11-01")
        al = (self.dir / "all.html").read_text(encoding="utf-8")
        self.assertIn('window.QOJ_BASE = ""', al)
        self.assertEqual(extract_page(al), {"type": "all", "weeks": ["2026-11-01", "2026-10-25"]})
        self.assertIn('src="assets/all.js"', al)
        rk = (self.dir / "rank.html").read_text(encoding="utf-8")
        page = extract_page(rk)
        self.assertEqual(page["type"], "rank")
        self.assertEqual(page["weeks"], self.weeks())
        self.assertIn('src="assets/rank.js"', rk)
        self.assertIn("weeks/2026-11-01.html", (self.dir / "index.html").read_text(encoding="utf-8"))

    def test_config_and_problems_json(self):
        self.run_gen()
        cfg = (self.dir / "assets" / "config.js").read_text(encoding="utf-8")
        self.assertIn("window.QOJ_CONFIG = ", cfg)
        m = re.search(r"window\.QOJ_LISTS = (.*?);\n", cfg, re.S)
        lists = json.loads(m.group(1))
        self.assertEqual([l["key"] for l in lists], premier.LIST_KEYS)
        self.assertEqual(set(lists[0]), {"key", "label", "count", "enabled"})
        probs = json.loads((self.dir / "problems.json").read_text(encoding="utf-8"))
        self.assertEqual(len(probs), 6 * 20)
        self.assertIsInstance(probs[0]["tags"], list)

    def test_script_injection_escaped(self):
        evil = "</script><script>alert(1)</script>"
        probs = make_problems()
        probs[0]["name"] = evil
        premier.save_problems_csv(self.dir / "problems.csv", probs)
        week = {"C": [probs[0]]}
        premier.save_weeks_data({"2026-10-25": week}, self.dir / "weeks_data.json")
        self.run_gen(rebuild_only=True)
        for f in ("weeks/2026-10-25.html", "rank.html"):
            html = (self.dir / f).read_text(encoding="utf-8")
            self.assertEqual(html.count("</script>"), 5)  # the 5 real tags only
            self.assertNotIn("alert(1)</script>", html)
        page = extract_page((self.dir / "weeks" / "2026-10-25.html").read_text(encoding="utf-8"))
        self.assertEqual(page["problems"]["C"][0]["name"], evil)

    def test_rebuild_only_with_empty_data(self):
        self.run_gen(rebuild_only=True)
        self.assertFalse((self.dir / "index.html").exists())
        self.assertFalse((self.dir / "processed.csv").exists())
        self.assertEqual(extract_page((self.dir / "all.html").read_text(encoding="utf-8")),
                         {"type": "all", "weeks": []})
        self.assertEqual(extract_page((self.dir / "rank.html").read_text(encoding="utf-8"))["weeks"], {})
        (self.dir / "weeks_data.json").write_text("{}", encoding="utf-8")
        self.run_gen(rebuild_only=True)

    def test_rebuild_does_not_repick(self):
        self.run_gen()
        before = self.weeks()
        processed = (self.dir / "processed.csv").read_text(encoding="utf-8")
        self.run_gen(rebuild_only=True)
        self.assertEqual(self.weeks(), before)
        self.assertEqual((self.dir / "processed.csv").read_text(encoding="utf-8"), processed)


if __name__ == "__main__":
    unittest.main()
