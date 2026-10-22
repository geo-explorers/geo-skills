#!/usr/bin/env python3
"""bump_skills.py — bump the version of every skill a pull request changed.

The skill-bump workflow (.github/workflows/skill-bump.yml) runs this on each
pull request and pushes the result, so nobody edits version lines by hand.

For each skill whose folder differs from --base:
  changed  version := base version bumped by --level, unless the SKILL.md already
           has a higher one (a person's higher version is kept; never lowered)
  added    the author's version is kept (0.1.0 if there is none)
  removed  nothing to bump
Then, for each changed or added skill:
  - skills/versions.md gets "### <skill> — <version>" with "- <date> · <title> (#<pr>)",
    unless an entry for that version is already there
  - its version column in MD-FILES.md is updated
and the manifest is regenerated (skill_versions.py generate) if anything changed
or it no longer verifies. A second run changes nothing.

Usage:
  python3 skill-dev/bump_skills.py --base <merge-base> --level patch --title "Fix X" --pr 70
  python3 skill-dev/bump_skills.py --base origin/main --level minor --title "..." --dry-run
"""
import argparse
import datetime
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO / "skills"
CHANGELOG = SKILLS_DIR / "versions.md"
MD_FILES = REPO / "MD-FILES.md"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


release = _load("suggest_release")
parse_semver, bump = release.parse_semver, release.bump


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout


def base_versions(base):
    """{name: (tier, version)} from the manifest at --base."""
    try:
        skills = json.loads(git("show", f"{base}:skills/SKILL-VERSIONS.json")).get("skills", {})
    except subprocess.CalledProcessError:
        skills = {}
    out = {}
    for key, entry in skills.items():
        tier, _, name = key.rpartition("/")
        out[name] = (tier, entry.get("version"))
    return out


def current_skills():
    """{name: tier} for every skills/<tier>/<name>/SKILL.md in the working tree."""
    return {p.parent.name: p.parent.parent.name for p in SKILLS_DIR.glob("*/*/SKILL.md")}


def changed_names(base):
    names = set()
    for path in git("diff", "--name-only", base, "--", "skills/").splitlines():
        name = release.skill_folder(path)
        if name:
            names.add(name)
    return names


# ---------- file edits (pure on text) ----------

# [ \t] rather than \s: \s would match the newline before the closing --- and glue it to the version.
FRONTMATTER_VERSION = re.compile(r'^([ \t]*version:[ \t]*)["\']?([^"\'\s]*)["\']?[ \t]*$', re.M)


def read_version(text):
    if not text.startswith("---"):
        return None
    m = FRONTMATTER_VERSION.search(text.split("---", 2)[1])
    return m.group(2) if m else None


def set_version(text, version):
    """Set the frontmatter version, adding the line after `name:` if there is none."""
    _, fm, body = text.split("---", 2)
    if FRONTMATTER_VERSION.search(fm):
        fm = FRONTMATTER_VERSION.sub(lambda m: f"{m.group(1)}{version}", fm, count=1)
    elif re.search(r"^name:.*$", fm, re.M):
        fm = re.sub(r"^(name:.*)$", lambda m: f"{m.group(1)}\nversion: {version}", fm, count=1, flags=re.M)
    else:
        fm = f"{fm.rstrip()}\nversion: {version}\n"
    return f"---{fm}---{body}"


def add_changelog(text, tier, name, version, line):
    """Insert '### name — version' + line under '## <tier>/', once."""
    if re.search(rf"^###\s+{re.escape(name)}\s+—\s+{re.escape(version)}\s*$", text, re.M):
        return text
    entry = f"### {name} — {version}\n{line}\n\n"
    m = re.search(rf"^## {re.escape(tier)}/\s*\n\n?", text, re.M)
    if not m:
        return f"{text.rstrip()}\n\n## {tier}/\n\n{entry}"
    return text[:m.end()] + entry + text[m.end():]


def set_md_version(text, tier, name, version):
    """Update the version cell of the skill's row in MD-FILES.md. Returns (text, found)."""
    path = f"skills/{tier}/{name}/SKILL.md"
    pattern = re.compile(rf"(\|\s*`{re.escape(path)}`\s*\|\s*)([0-9][0-9A-Za-z.\-]*)(\s*\|)")
    if not pattern.search(text):
        return text, False
    return pattern.sub(lambda m: f"{m.group(1)}{version}{m.group(3)}", text, count=1), True


# ---------- the run ----------

def plan(base, level):
    old = base_versions(base)
    now = current_skills()
    steps = []
    for name in sorted(changed_names(base)):
        if name not in now:
            steps.append({"name": name, "change": "removed"})
            continue
        tier = now[name]
        skill_md = SKILLS_DIR / tier / name / "SKILL.md"
        current = read_version(skill_md.read_text(encoding="utf-8"))
        if name not in old:
            steps.append({"name": name, "tier": tier, "change": "added", "from": None,
                          "current": current, "target": current if parse_semver(current) else "0.1.0"})
            continue
        base_v = old[name][1]
        if not parse_semver(base_v):
            steps.append({"name": name, "tier": tier, "change": "changed", "from": base_v, "current": current,
                          "target": current, "warning": f"base version {base_v!r} is not X.Y.Z; left as is"})
            continue
        target = bump(base_v, level)
        if parse_semver(current) and parse_semver(current) > parse_semver(target):
            target = current
        steps.append({"name": name, "tier": tier, "change": "changed", "from": base_v, "current": current, "target": target})
    return steps


def verifies():
    r = subprocess.run([sys.executable, str(REPO / "skill-dev" / "skill_versions.py"), "verify"],
                       cwd=REPO, capture_output=True, text=True)
    return r.returncode == 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--base", required=True, help="the pull request's merge-base with main")
    p.add_argument("--level", choices=["patch", "minor", "major"], default="patch")
    p.add_argument("--title", default="", help="pull request title, for the changelog line")
    p.add_argument("--pr", default="", help="pull request number, for the changelog line")
    p.add_argument("--date", default=datetime.date.today().isoformat())
    p.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    args = p.parse_args(argv)

    steps = plan(args.base, args.level)
    if not steps:
        print("No skill changed. Nothing to bump.")
        return 0

    title = " ".join(args.title.split()) or "Update"
    line = f"- {args.date} · {title}" + (f" (#{args.pr})" if args.pr else "")
    changelog = CHANGELOG.read_text(encoding="utf-8")
    md_files = MD_FILES.read_text(encoding="utf-8")
    edited = []
    for s in steps:
        if s["change"] == "removed":
            print(f"  {s['name']}: removed")
            continue
        if s.get("warning"):
            print(f"  ⚠ {s['name']}: {s['warning']}")
        tier, name, target = s["tier"], s["name"], s["target"]
        note = f"{s['from']} → {target}" if s["change"] == "changed" else f"{target} (new)"
        print(f"  {name}: {note}")
        if args.dry_run:
            continue
        skill_md = SKILLS_DIR / tier / name / "SKILL.md"
        text = skill_md.read_text(encoding="utf-8")
        if read_version(text) != target:
            skill_md.write_text(set_version(text, target), encoding="utf-8")
            edited.append(skill_md)
        changelog = add_changelog(changelog, tier, name, target, line)
        md_files, found = set_md_version(md_files, tier, name, target)
        if not found:
            print(f"  ⚠ {name}: no row for skills/{tier}/{name}/SKILL.md in MD-FILES.md; add it by hand")

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    for path, text in ((CHANGELOG, changelog), (MD_FILES, md_files)):
        if path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
            edited.append(path)
    if edited or not verifies():
        subprocess.run([sys.executable, str(REPO / "skill-dev" / "skill_versions.py"), "generate"], cwd=REPO, check=True)
        print("Manifest regenerated.")
    else:
        print("Everything already up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
