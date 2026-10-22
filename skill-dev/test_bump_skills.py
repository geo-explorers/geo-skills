#!/usr/bin/env python3
"""Tests for bump_skills.py, against a throwaway git repository.

  python3 skill-dev/test_bump_skills.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

CHANGELOG = """# Skill versions & changelog

---

## non-actionable/

### alpha — 0.1.0
- 2026-01-01 · First.

## actionable/

### beta — 1.2.0
- 2026-01-01 · First.
"""

MD_FILES = """# MD file manifest

| Skill | Version | Contents | Key needed |
|---|---|---|---|
| `skills/non-actionable/alpha/SKILL.md` | 0.1.0 | Alpha | no |
| `skills/actionable/beta/SKILL.md` | 1.2.0 | Beta | yes |

Other files: `MD-FILES.md`, `skills/versions.md`, `skill-dev/README.md`, `skills/actionable/beta/references/notes.md`.
"""


def skill_md(name, version, body="Body.\n"):
    return f"---\nname: {name}\ndescription: test skill\nversion: {version}\n---\n\n# {name}\n\n{body}"


class BumpSkills(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="bump-skills-"))
        gitconfig = self.dir / "gitconfig"
        gitconfig.write_text("[user]\n\tname = Test\n\temail = test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n")
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": str(gitconfig), "HOME": str(self.dir)}
        self.repo = self.dir / "repo"
        shutil.copytree(HERE, self.repo / "skill-dev", ignore=shutil.ignore_patterns("__pycache__", "skill-quality-check"))
        self.write("skills/non-actionable/alpha/SKILL.md", skill_md("alpha", "0.1.0"))
        self.write("skills/actionable/beta/SKILL.md", skill_md("beta", "1.2.0"))
        self.write("skills/actionable/beta/references/notes.md", "notes\n")
        self.write("skills/versions.md", CHANGELOG)
        self.write("MD-FILES.md", MD_FILES)
        self.git("init", "--quiet")
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", "base")
        self.py("skill-dev/skill_versions.py", "generate")
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", "manifest")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "--quiet", "-c", "feature")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, rel, text):
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def read(self, rel):
        return (self.repo / rel).read_text(encoding="utf-8")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env, capture_output=True, text=True, check=True).stdout

    def py(self, script, *args):
        r = subprocess.run([sys.executable, str(self.repo / script), *args], cwd=self.repo, env=self.env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def commit(self, msg="change"):
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", msg)

    def bump(self, level="patch", title="Fix the thing", pr="7"):
        return self.py("skill-dev/bump_skills.py", "--base", self.base, "--level", level,
                       "--title", title, "--pr", pr, "--date", "2026-10-20")

    def version(self, tier, name):
        for line in self.read(f"skills/{tier}/{name}/SKILL.md").splitlines():
            if line.startswith("version:"):
                return line.split(":", 1)[1].strip()

    def verify(self):
        self.py("skill-dev/skill_versions.py", "verify")
        self.py("skill-dev/check_md_manifest.py")

    def test_levels_from_base(self):
        for level, want in (("patch", "1.2.1"), ("minor", "1.3.0"), ("major", "2.0.0")):
            with self.subTest(level=level):
                self.git("checkout", "--quiet", "-f", self.base, "--", ".")
                self.write("skills/actionable/beta/references/notes.md", f"notes {level}\n")
                self.commit(level)
                self.bump(level)
                self.assertEqual(self.version("actionable", "beta"), want)
                self.assertEqual(self.version("non-actionable", "alpha"), "0.1.0")
                self.git("reset", "--quiet", "--hard", "HEAD")

    def test_a_higher_version_set_by_hand_is_kept(self):
        self.write("skills/actionable/beta/SKILL.md", skill_md("beta", "1.5.0", "Changed.\n"))
        self.commit()
        self.bump("minor")
        self.assertEqual(self.version("actionable", "beta"), "1.5.0")

    def test_version_line_keeps_the_closing_fence(self):
        self.write("skills/actionable/beta/references/notes.md", "changed\n")
        self.commit()
        self.bump()
        self.assertIn("version: 1.2.1\n---\n", self.read("skills/actionable/beta/SKILL.md"))

    def test_changelog_md_files_and_manifest(self):
        self.write("skills/non-actionable/alpha/SKILL.md", skill_md("alpha", "0.1.0", "Changed.\n"))
        self.commit()
        out = self.bump()
        self.assertIn("alpha: 0.1.0 → 0.1.1", out)
        log = self.read("skills/versions.md")
        self.assertIn("## non-actionable/\n\n### alpha — 0.1.1\n- 2026-10-20 · Fix the thing (#7)\n\n### alpha — 0.1.0", log)
        self.assertEqual(log.count("### alpha — 0.1.1"), 1)
        self.assertIn("| `skills/non-actionable/alpha/SKILL.md` | 0.1.1 |", self.read("MD-FILES.md"))
        self.verify()

    def test_second_run_changes_nothing(self):
        self.write("skills/actionable/beta/references/notes.md", "changed\n")
        self.commit()
        self.bump()
        self.commit("bot bump")
        before = self.git("rev-parse", "HEAD")
        out = self.bump()
        self.assertIn("already up to date", out)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.verify()

    def test_added_skill_keeps_its_version(self):
        self.write("skills/non-actionable/gamma/SKILL.md", skill_md("gamma", "0.3.0"))
        md = self.read("MD-FILES.md") + "| `skills/non-actionable/gamma/SKILL.md` | 0.3.0 | Gamma | no |\n"
        self.write("MD-FILES.md", md)
        self.commit()
        out = self.bump("major")
        self.assertIn("gamma: 0.3.0 (new)", out)
        self.assertEqual(self.version("non-actionable", "gamma"), "0.3.0")
        self.assertIn("### gamma — 0.3.0\n- 2026-10-20", self.read("skills/versions.md"))
        self.verify()

    def test_added_skill_without_a_version_gets_0_1_0(self):
        self.write("skills/non-actionable/delta/SKILL.md", "---\nname: delta\ndescription: d\n---\n\nBody.\n")
        self.write("MD-FILES.md", self.read("MD-FILES.md") + "| `skills/non-actionable/delta/SKILL.md` | 0.1.0 | Delta | no |\n")
        self.commit()
        self.bump()
        self.assertEqual(self.version("non-actionable", "delta"), "0.1.0")
        self.verify()

    def test_removed_skill(self):
        shutil.rmtree(self.repo / "skills/non-actionable/alpha")
        self.write("MD-FILES.md", self.read("MD-FILES.md").replace("| `skills/non-actionable/alpha/SKILL.md` | 0.1.0 | Alpha | no |\n", ""))
        self.commit()
        out = self.bump()
        self.assertIn("alpha: removed", out)
        self.assertNotIn("alpha", self.read("skills/SKILL-VERSIONS.json"))
        self.verify()

    def test_no_skill_change_is_a_no_op(self):
        self.write("README.md", "docs\n")
        self.commit()
        out = self.bump()
        self.assertIn("No skill changed", out)
        self.assertEqual(self.git("status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
