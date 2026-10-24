import argparse
import contextlib
import io
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
                 date="2026-10-25", seed=42, rebuild_only=False, skip_existing=False)
        d.update(kw)
        return argparse.Namespace(**d)

    def run_gen(self, **kw):
        generate.run(self.args(**kw))

    def weeks(self):
        return json.loads((self.dir / "weeks_data.json").read_text(encoding="utf-8"))

    def run_quiet(self, **kw) -> str:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.run_gen(**kw)
        return buf.getvalue()


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

    def test_consecutive_weeks_not_adjacent(self):
        # Regression: one fixed seed over a slowly shrinking id-sorted pool picked
        # (nearly) the same positions every week -> adjacent ids week after week.
        premier.save_problems_csv(self.dir / "problems.csv", make_problems(60))
        dates = ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]
        for d in dates:
            self.run_quiet(date=d)
        w = self.weeks()
        near_pairs = 0
        for a, b in zip(dates, dates[1:]):
            ia = sorted(int(p["id"]) for p in w[a]["C"])
            ib = sorted(int(p["id"]) for p in w[b]["C"])
            if all(abs(x - y) <= 2 for x, y in zip(ia, ib)):
                near_pairs += 1
        self.assertLessEqual(near_pairs, 1)

    def test_seed_is_per_week_and_deterministic(self):
        self.run_quiet(date="2026-10-25")
        first = self.weeks()["2026-10-25"]
        (self.dir / "weeks_data.json").unlink()
        (self.dir / "processed.csv").unlink()
        self.run_quiet(date="2026-10-25")
        self.assertEqual(self.weeks()["2026-10-25"], first)

    def test_skip_existing_exits_cleanly(self):
        self.run_quiet()
        before = ((self.dir / "processed.csv").read_text(encoding="utf-8"), self.weeks())
        out = self.run_quiet(skip_existing=True)  # no SystemExit
        self.assertIn("already exists", out)
        self.assertEqual(((self.dir / "processed.csv").read_text(encoding="utf-8"), self.weeks()), before)
        self.assertTrue((self.dir / "index.html").exists())

    def test_skip_existing_still_picks_new_week(self):
        self.run_quiet(date="2026-10-25")
        self.run_quiet(date="2026-11-01", skip_existing=True)
        self.assertEqual(sorted(self.weeks()), ["2026-10-25", "2026-11-01"])

    def test_low_pool_emits_actions_warning(self):
        premier.save_problems_csv(self.dir / "problems.csv", make_problems(5))
        out = self.run_quiet()
        self.assertRegex(out, r"(?m)^::warning::list C has only 3 unpicked")

    def test_pool_exhausted_writes_nothing(self):
        premier.save_problems_csv(self.dir / "problems.csv", [p for p in make_problems() if p["list"] != "B2"])
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(io.StringIO()) as buf:
            self.run_gen()
        self.assertIn("::error::", buf.getvalue())
        self.assertFalse((self.dir / "processed.csv").exists())
        self.assertFalse((self.dir / "weeks_data.json").exists())

    def test_writes_weeks_data_atomically_before_processed(self):
        calls = []
        orig_w, orig_p = premier.save_weeks_data, premier.save_processed
        premier.save_weeks_data = lambda *a, **k: (calls.append("weeks"), orig_w(*a, **k))
        premier.save_processed = lambda *a, **k: (calls.append("processed"), orig_p(*a, **k))
        try:
            self.run_quiet()
        finally:
            premier.save_weeks_data, premier.save_processed = orig_w, orig_p
        self.assertEqual(calls, ["weeks", "processed"])
        self.assertEqual([f.name for f in self.dir.iterdir() if f.name.endswith(".tmp")], [])

    def test_consistency_warning(self):
        self.run_quiet()
        self.assertNotIn("disagree", self.run_quiet(rebuild_only=True))
        with (self.dir / "processed.csv").open("a", encoding="utf-8") as f:
            f.write("999,Ghost,C,u\n")
        out = self.run_quiet(rebuild_only=True)  # warns, does not fail
        self.assertIn("::warning::", out)
        self.assertIn("'999'", out)

    def test_refuses_existing_week(self):
        self.run_gen()
        before = (self.dir / "processed.csv").read_text(encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.run_gen()
        self.assertEqual((self.dir / "processed.csv").read_text(encoding="utf-8"), before)


class DateArgTests(unittest.TestCase):
    def test_iso_date_valid_and_normalised(self):
        self.assertEqual(generate.iso_date("2026-10-25"), "2026-10-25")

    def test_iso_date_rejects_garbage(self):
        for bad in ('x"><script>', "2026-13-01", "../../etc", "", "2026-10-25/../x"):
            with self.assertRaises(argparse.ArgumentTypeError):
                generate.iso_date(bad)

    def test_cli_rejects_bad_date(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
            sys.argv = ["generate.py", "--date", 'x"><script>']
            generate.main()
        self.assertEqual(cm.exception.code, 2)


class PageTests(TmpCase):
    def test_redirect_escaped(self):
        html = generate.build_redirect('x"><script>alert(1)</script>')
        self.assertEqual(html.count("</script>"), 1)  # only the real closing tag
        self.assertNotIn("alert(1)</script>", html)
        self.assertIn('url=weeks/x&quot;&gt;&lt;script&gt;', html)
        self.assertIn('location.replace("weeks/x\\"><script>alert(1)<\\/script>.html")', html)
        self.assertIn('name="viewport"', html)

    def test_redirect_normal(self):
        html = generate.build_redirect("2026-10-25")
        self.assertIn('content="0; url=weeks/2026-10-25.html"', html)
        self.assertIn('location.replace("weeks/2026-10-25.html")', html)

    def test_preconnect_links(self):
        self.run_quiet()
        html = (self.dir / "all.html").read_text(encoding="utf-8")
        self.assertIn('<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>', html)
        origin = generate.urlsplit(generate.SUPABASE_URL)
        self.assertIn(f'<link rel="preconnect" href="{origin.scheme}://{origin.netloc}" crossorigin>', html)
        self.assertLess(html.index("preconnect"), html.index("stylesheet"))

    def test_problems_json_keeps_past_picks(self):
        self.run_quiet()
        picked = {p["id"] for ps in self.weeks()["2026-10-25"].values() for p in ps}
        # re-scrape that no longer contains the picked problems
        rest = [p for p in make_problems() if p["id"] not in picked]
        premier.save_problems_csv(self.dir / "problems.csv", rest)
        self.run_quiet(rebuild_only=True)
        probs = json.loads((self.dir / "problems.json").read_text(encoding="utf-8"))
        ids = [p["id"] for p in probs]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(picked <= set(ids))
        self.assertEqual(len(probs), 6 * 20)


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
            self.assertEqual(html.count("</script>"), 6)  # the 6 real tags only
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
