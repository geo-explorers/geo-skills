#!/usr/bin/env python3
"""Tests for suggest_release.py.

  python3 skill-dev/test_suggest_release.py

The real-history cases need the release tags (a full clone). They are skipped
when the tags are missing, unless REQUIRE_RELEASE_TAGS=1 (set in CI).
"""
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("suggest_release", HERE / "suggest_release.py")
sr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sr)


def skill(tier, version, sha="h"):
    return {"tier": tier, "version": version, "sha": sha}


class Semver(unittest.TestCase):
    def test_bump(self):
        self.assertEqual(sr.bump("1.2.3", "patch"), "1.2.4")
        self.assertEqual(sr.bump("1.2.3", "minor"), "1.3.0")
        self.assertEqual(sr.bump("1.2.3", "major"), "2.0.0")
        self.assertEqual(sr.bump("v1.9.9", "minor"), "1.10.0")

    def test_bump_level(self):
        self.assertEqual(sr.bump_level("0.1.0", "0.1.1"), "patch")
        self.assertEqual(sr.bump_level("0.1.9", "0.2.0"), "minor")
        self.assertEqual(sr.bump_level("0.9.0", "1.0.0"), "major")
        self.assertEqual(sr.bump_level("0.2.0", "0.2.0"), "same")
        self.assertEqual(sr.bump_level("0.2.0", "0.1.0"), "down")
        self.assertIsNone(sr.bump_level("unversioned", "0.1.0"))

    def test_suffixed_versions_are_not_releases(self):
        self.assertIsNone(sr.parse_semver("1.2.0-test"))
        self.assertIsNone(sr.TAG_RE.match("v1.2.0-test"))


class Classify(unittest.TestCase):
    def run_case(self, old, new, touched, non_skill=()):
        skills, warnings = sr.classify_skills(old, new, set(touched))
        level, _ = sr.classify_non_skill(list(non_skill))
        return sr.decide(skills, level), skills, warnings

    def test_each_bump_level(self):
        for a, b, want in (("0.1.0", "0.1.1", "patch"), ("0.1.0", "0.2.0", "minor"), ("0.1.0", "1.0.0", "major")):
            level, _, _ = self.run_case({"x": skill("t", a, "1")}, {"x": skill("t", b, "2")}, ["x"])
            self.assertEqual(level, want)

    def test_added_skill_is_minor(self):
        level, skills, _ = self.run_case({}, {"x": skill("t", "0.1.0")}, ["x"])
        self.assertEqual(level, "minor")
        self.assertEqual(skills[0]["change"], "added")

    def test_removed_skill_is_major(self):
        level, skills, _ = self.run_case({"x": skill("t", "0.1.0")}, {}, ["x"])
        self.assertEqual(level, "major")
        self.assertEqual(skills[0]["change"], "removed")

    def test_rename_is_major(self):
        level, skills, _ = self.run_case({"old": skill("t", "0.1.0")}, {"new": skill("t", "0.1.0")}, ["old", "new"])
        self.assertEqual(level, "major")
        self.assertEqual({s["change"] for s in skills}, {"added", "removed"})

    def test_changed_without_bump_is_patch_with_warning(self):
        level, _, warnings = self.run_case({"x": skill("t", "0.1.0", "1")}, {"x": skill("t", "0.1.0", "2")}, ["x"])
        self.assertEqual(level, "patch")
        self.assertTrue(any("stayed 0.1.0" in w for w in warnings))

    def test_version_going_down_and_tier_move_warn(self):
        _, _, warnings = self.run_case({"x": skill("a", "0.2.0", "1")}, {"x": skill("b", "0.1.0", "2")}, ["x"])
        self.assertTrue(any("backwards" in w for w in warnings))
        self.assertTrue(any("moved" in w for w in warnings))

    def test_untouched_skills_are_ignored(self):
        level, skills, _ = self.run_case({"x": skill("t", "0.1.0")}, {"x": skill("t", "0.1.0")}, [])
        self.assertEqual((level, skills), ("none", []))

    def test_non_skill_files(self):
        self.assertEqual(sr.classify_non_skill([("M", "README.md")])[0], "patch")
        self.assertEqual(sr.classify_non_skill([("A", "docs/new.md")])[0], "minor")
        self.assertEqual(sr.classify_non_skill([("D", "old.md"), ("M", "x")])[0], "minor")
        self.assertEqual(sr.classify_non_skill([])[0], "none")

    def test_highest_signal_wins(self):
        level, _, _ = self.run_case({"x": skill("t", "0.1.0", "1")}, {"x": skill("t", "0.1.1", "2")}, ["x"], [("A", "new.txt")])
        self.assertEqual(level, "minor")

    def test_skill_folder(self):
        self.assertEqual(sr.skill_folder("skills/actionable/geo-publish/SKILL.md"), "geo-publish")
        self.assertIsNone(sr.skill_folder("skills/versions.md"))
        self.assertIsNone(sr.skill_folder("skills/SKILL-VERSIONS.json"))
        self.assertIsNone(sr.skill_folder("src/functions.ts"))


class Changelog(unittest.TestCase):
    TEXT = "## t/\n\n### x — 0.1.2\n- c\n\n### x — 0.1.1\n- b\n\n### x — 0.1.0\n- a\n\n### y — 0.1.1\n- y\n"

    def test_entries_between_versions(self):
        entries = sr.changelog_entries(self.TEXT)
        picked = sr.notes_for({"name": "x", "from": "0.1.0", "to": "0.1.2"}, entries)
        self.assertEqual([v for _, v, _ in picked], ["0.1.2", "0.1.1"])

    def test_added_skill_gets_all_entries(self):
        picked = sr.notes_for({"name": "x", "from": None, "to": "0.1.1"}, sr.changelog_entries(self.TEXT))
        self.assertEqual([v for _, v, _ in picked], ["0.1.1", "0.1.0"])


def has_tags(*tags):
    r = subprocess.run(["git", "tag", "--list", "v*"], cwd=HERE.parent, capture_output=True, text=True)
    return set(tags) <= set(r.stdout.split())


@unittest.skipUnless(has_tags("v1.0.0", "v1.1.0", "v1.2.0", "v1.2.1") or os.environ.get("REQUIRE_RELEASE_TAGS") == "1",
                     "release tags not present (shallow clone)")
class RealHistory(unittest.TestCase):
    def cli(self, *args):
        r = subprocess.run([sys.executable, str(HERE / "suggest_release.py"), "--no-fetch", "--json", *args],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_v1_1_0_to_v1_2_0_is_minor(self):
        r = self.cli("--from", "v1.1.0", "--to", "v1.2.0")
        self.assertEqual((r["level"], r["suggested"], r["skill_changed"]), ("minor", "v1.2.0", True))
        self.assertIn("minor: geo-publish 0.11.0 → 0.12.1", r["reasons"])
        self.assertEqual(r["already_released"], "v1.2.0")
        self.assertFalse(r["release_needed"])

    def test_v1_2_0_to_v1_2_1_is_patch(self):
        r = self.cli("--from", "v1.2.0", "--to", "v1.2.1")
        self.assertEqual((r["level"], r["suggested"], r["skill_changed"]), ("patch", "v1.2.1", True))
        self.assertEqual([s["name"] for s in r["skills"]], ["image-banner-recompose"])

    def test_v1_0_0_to_v1_1_0_needs_no_release_under_the_skill_gate(self):
        r = self.cli("--from", "v1.0.0", "--to", "v1.1.0")
        self.assertEqual((r["level"], r["suggested"], r["skill_changed"]), ("minor", "v1.1.0", False))
        self.assertEqual(r["skills"], [])

    def test_from_defaults_to_the_previous_release(self):
        r = self.cli("--to", "v1.2.1")
        self.assertEqual(r["from"], "v1.2.0")

    def test_suffixed_from_is_refused(self):
        r = subprocess.run([sys.executable, str(HERE / "suggest_release.py"), "--no-fetch", "--from", "v1.2.0-test", "--to", "v1.2.1"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
