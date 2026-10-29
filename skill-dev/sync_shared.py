#!/usr/bin/env python3
"""sync_shared.py — copy the shared helpers into every skill that uses them.

Why: each skill folder must be self-contained, so geo-agents can vendor it and
run its scripts with nothing else from this repository. A few files are needed
by several skills (the publish helpers in functions.ts, the well-known IDs in
constants.ts, ...). Their single source is skill-dev/shared/; each skill gets an
identical copy. skill-dev/shared/targets.json says which file goes where.

Edit the file in skill-dev/shared/, never a copy in a skill, then run this.

Usage:
  python3 skill-dev/sync_shared.py          # write the copies
  python3 skill-dev/sync_shared.py --check  # CI: exit 1 if any copy differs
"""
import json
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

REPO = Path(subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True).strip())
SHARED = REPO / "skill-dev" / "shared"
SKILLS_DIR = REPO / "skills"


def skill_dirs():
    """Skill folder name -> path, across tiers."""
    return {p.parent.name: p.parent for p in SKILLS_DIR.rglob("SKILL.md")}


def plan():
    """Every (source, destination) pair from targets.json."""
    targets = json.loads((SHARED / "targets.json").read_text())
    skills = skill_dirs()
    pairs = []
    for name, spec in sorted(targets.items()):
        src = SHARED / name
        if not src.is_file():
            sys.exit(f"targets.json names {name}, which is not in skill-dev/shared/")
        for skill in spec["skills"]:
            if skill not in skills:
                sys.exit(f"targets.json names skill {skill}, which does not exist")
            pairs.append((src, skills[skill] / spec["to"]))
    return pairs


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for src, dest in plan():
        want = src.read_bytes()
        if dest.is_file() and dest.read_bytes() == want:
            continue
        rel = dest.relative_to(REPO).as_posix()
        if check:
            stale.append(rel)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(want)
        print(f"wrote {rel}")
    if stale:
        print("These copies differ from skill-dev/shared/:")
        for rel in stale:
            print(f"  {rel}")
        print("Edit the file in skill-dev/shared/, then run: python3 skill-dev/sync_shared.py")
        return 1
    if check:
        print("OK: every shared copy matches skill-dev/shared/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
