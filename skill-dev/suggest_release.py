#!/usr/bin/env python3
"""suggest_release.py — compute the next geo-skills release from what changed.

The release workflow (.github/workflows/release.yml) runs this on every merge to
main and tags the result. People run it to see what merging a pull request will
release. It never creates tags.

The rule (MAINTAINERS.md, "How releases happen"):
  major  a skill removed or renamed, or a skill's major version bump
  minor  a skill added, a skill's minor bump, or files outside the skill
         folders added or removed
  patch  anything else
The level is the highest signal. A release is needed only when a file inside a
skill folder (skills/<tier>/<skill>/) changed; other merges wait and count
toward the next release.

Usage:
  python3 skill-dev/suggest_release.py                       # origin/main vs the last release
  python3 skill-dev/suggest_release.py --to HEAD --no-fetch  # what merging this branch releases
  python3 skill-dev/suggest_release.py --from v1.1.0 --to v1.2.0 --json
  python3 skill-dev/suggest_release.py --level minor         # override (warns if lower than computed)

Exit 0 with a result, 2 on a usage or git error.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = "skills/SKILL-VERSIONS.json"
CHANGELOG = "skills/versions.md"
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
LEVELS = ["none", "patch", "minor", "major"]


class GitError(Exception):
    pass


def git(*args):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


# ---------- versions ----------

def parse_semver(v):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", str(v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def bump(version, level):
    major, minor, patch = parse_semver(version)
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    if level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    return f"{major}.{minor}.{patch}"


def bump_level(old, new):
    """Which part went up between two versions: major, minor, patch, same or down (None if unparsable)."""
    a, b = parse_semver(old), parse_semver(new)
    if a is None or b is None:
        return None
    if b == a:
        return "same"
    if b < a:
        return "down"
    return "major" if b[0] > a[0] else "minor" if b[1] > a[1] else "patch"


def highest(*levels):
    return max(levels, key=LEVELS.index, default="none")


# ---------- classification (pure) ----------

def by_name(manifest):
    """{"tier/name": {...}} -> {name: {tier, version, sha}}"""
    out = {}
    for key, entry in (manifest or {}).items():
        tier, _, name = key.rpartition("/")
        out[name] = {"tier": tier, "version": entry.get("version"), "sha": entry.get("content_sha256")}
    return out


def classify_skills(old, new, touched):
    """old/new: {name: {tier, version, sha}}; touched: names whose folder had file changes.

    Returns (skills, warnings): one entry per changed, added or removed skill."""
    skills, warnings = [], []
    for name in sorted(set(old) | set(new)):
        a, b = old.get(name), new.get(name)
        if a and not b:
            skills.append({"name": name, "change": "removed", "tier": a["tier"], "from": a["version"], "to": None, "level": "major"})
            continue
        if b and not a:
            skills.append({"name": name, "change": "added", "tier": b["tier"], "from": None, "to": b["version"], "level": "minor"})
            continue
        if name not in touched and a["sha"] == b["sha"] and a["version"] == b["version"] and a["tier"] == b["tier"]:
            continue
        step = bump_level(a["version"], b["version"])
        entry = {"name": name, "change": "changed", "tier": b["tier"], "from": a["version"], "to": b["version"]}
        if step in ("major", "minor", "patch"):
            entry["level"] = step
        else:
            entry["level"] = "patch"
            if step == "same":
                warnings.append(f"{name}: content changed but its version stayed {a['version']}")
            elif step == "down":
                warnings.append(f"{name}: version went backwards, {a['version']} → {b['version']}")
            else:
                warnings.append(f"{name}: unreadable version ({a['version']} → {b['version']})")
        if a["tier"] != b["tier"]:
            warnings.append(f"{name}: moved from {a['tier']}/ to {b['tier']}/")
        skills.append(entry)
    return skills, warnings


def skill_folder(path):
    """'skills/<tier>/<name>/...' -> name, for files inside a skill folder; else None."""
    parts = path.split("/")
    return parts[2] if len(parts) >= 4 and parts[0] == "skills" else None


def classify_non_skill(name_status):
    """[(status, path)] for files outside skill folders -> (level, counts)."""
    counts = {"added": 0, "removed": 0, "modified": 0}
    for status, _ in name_status:
        key = "added" if status.startswith("A") else "removed" if status.startswith("D") else "modified"
        counts[key] += 1
    if counts["added"] or counts["removed"]:
        return "minor", counts
    return ("patch" if counts["modified"] else "none"), counts


def decide(skills, non_skill_level):
    return highest(*(s["level"] for s in skills), non_skill_level)


# ---------- changelog ----------

def changelog_entries(text):
    """{(name, version): [lines]} from skills/versions.md."""
    entries, key = {}, None
    for line in text.splitlines():
        m = re.match(r"^###\s+(\S+)\s+—\s+(\S+)\s*$", line)
        if m:
            key = (m.group(1), m.group(2))
            entries.setdefault(key, [])
        elif line.startswith("#") or line.strip() == "---":
            key = None
        elif key and line.strip():
            entries[key].append(line)
    return entries


def notes_for(skill, entries):
    lo = parse_semver(skill["from"]) if skill["from"] else None
    hi = parse_semver(skill["to"])
    picked = []
    for (name, version), lines in entries.items():
        v = parse_semver(version)
        if name == skill["name"] and v and hi and v <= hi and (lo is None or v > lo):
            picked.append((v, version, lines))
    return sorted(picked, reverse=True)


def release_note(result, entries, all_skills):
    out = [f"geo-skills **{result['suggested']}**, from {result['from']} ({result['level']}).", "",
           f"Commit: `{result['commit']}`", ""]
    if result["skills"]:
        out += ["## Skills that changed", ""]
        for s in result["skills"]:
            if s["change"] == "removed":
                out += [f"### {s['name']} — removed (was {s['from']})", ""]
                continue
            label = f"{s['from']} → {s['to']}" if s["change"] == "changed" else f"{s['to']} (new)"
            out += [f"### {s['name']} {label}", ""]
            notes = notes_for(s, entries)
            for _, version, lines in notes:
                out += [f"{version}:", *lines, ""]
            if not notes:
                out += ["No changelog entry.", ""]
    n = result["nonSkill"]
    if any(n.values()):
        out += [f"Other files: {n['added']} added, {n['removed']} removed, {n['modified']} modified.", ""]
    if result["warnings"]:
        out += ["## Warnings", "", *[f"- {w}" for w in result["warnings"]], ""]
    out += ["## All skills in this release", "", "| Skill | Tier | Version |", "|---|---|---|"]
    out += [f"| {name} | {s['tier']} | {s['version']} |" for name, s in sorted(all_skills.items())]
    return "\n".join(out) + "\n"


# ---------- git side ----------

def exact_tags(args):
    return [t for t in git("tag", "--list", "v*", *args).split() if TAG_RE.match(t)]


def latest(tags):
    return max(tags, key=lambda t: parse_semver(t), default=None)


def manifest_at(ref):
    try:
        return json.loads(git("show", f"{ref}:{MANIFEST}")).get("skills", {})
    except GitError:
        return {}


def compute(from_tag, to_ref, level_override=None):
    to_sha = git("rev-parse", "--verify", f"{to_ref}^{{commit}}").strip()
    at_to = exact_tags(["--points-at", to_sha])
    later = [t for t in exact_tags(["--contains", to_sha]) if t not in at_to]
    if from_tag is None:
        from_tag = latest([t for t in exact_tags(["--merged", to_sha]) if t not in at_to])
        if from_tag is None:
            raise GitError(f"no vX.Y.Z release tag is reachable from {to_ref}")
    elif not TAG_RE.match(from_tag):
        raise GitError(f"--from must be an exact release tag (vX.Y.Z), not {from_tag}")
    from_sha = git("rev-parse", "--verify", f"{from_tag}^{{commit}}").strip()

    old, new = by_name(manifest_at(from_sha)), by_name(manifest_at(to_sha))
    known = set(old) | set(new)
    name_status = []
    touched = set()
    for line in git("diff", "--name-status", "--no-renames", from_sha, to_sha).splitlines():
        status, _, path = line.partition("\t")
        name = skill_folder(path)
        if name is not None and name in known:
            touched.add(name)
        elif name is None:
            name_status.append((status, path))
    skills, warnings = classify_skills(old, new, touched)
    non_level, counts = classify_non_skill(name_status)
    computed = decide(skills, non_level)
    level = computed
    if level_override:
        if LEVELS.index(level_override) < LEVELS.index(computed):
            warnings.append(f"level overridden to {level_override}, lower than the computed {computed}")
        level = level_override
    if level == "none":
        level = "patch"

    result = {
        "from": from_tag, "to": to_ref, "commit": to_sha,
        "skill_changed": bool(touched),
        "release_needed": bool(touched) and not at_to and not later,
        "already_released": latest(at_to),
        "released_later_in": min(later, key=parse_semver) if later else None,
        "computed_level": computed if computed != "none" else "patch",
        "level": level,
        "suggested": "v" + bump(from_tag, level),
        "reasons": [], "skills": skills, "nonSkill": counts, "warnings": warnings,
    }
    for s in skills:
        if s["change"] == "changed":
            result["reasons"].append(f"{s['level']}: {s['name']} {s['from']} → {s['to']}")
        else:
            result["reasons"].append(f"{s['level']}: {s['name']} {s['change']}")
    if counts["added"] or counts["removed"]:
        result["reasons"].append(f"minor: {counts['added']} file(s) added, {counts['removed']} removed outside skill folders")
    elif counts["modified"]:
        result["reasons"].append(f"patch: {counts['modified']} file(s) modified outside skill folders")
    if level_override:
        result["reasons"].append(f"{level}: set by hand")

    try:
        entries = changelog_entries(git("show", f"{to_sha}:{CHANGELOG}"))
    except GitError:
        entries = {}
    result["releaseNote"] = release_note(result, entries, by_name(manifest_at(to_sha)))
    return result


def print_human(r):
    if r["already_released"]:
        print(f"{r['commit'][:12]} is already released as {r['already_released']}.")
    elif r["released_later_in"]:
        print(f"{r['commit'][:12]} is already part of {r['released_later_in']}.")
    print(f"From {r['from']} to {r['to']} ({r['commit'][:12]}):\n")
    if r["skills"]:
        print(f"  {'skill':<28} {'change':<8} {'from':>8} {'to':>8}  level")
        for s in r["skills"]:
            print(f"  {s['name']:<28} {s['change']:<8} {s['from'] or '-':>8} {s['to'] or '-':>8}  {s['level']}")
    else:
        print("  No skill changed.")
    n = r["nonSkill"]
    print(f"\n  Other files: {n['added']} added, {n['removed']} removed, {n['modified']} modified.")
    for w in r["warnings"]:
        print(f"  ⚠ {w}")
    print()
    if r["release_needed"]:
        print(f"Merging releases {r['suggested']} ({r['level']}).")
    elif not (r["already_released"] or r["released_later_in"]):
        print(f"No release: no skill changed. If one does, the next release is at least {r['suggested']} ({r['level']}).")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--from", dest="from_tag", help="last release tag (default: highest vX.Y.Z reachable from --to)")
    p.add_argument("--to", default="origin/main", help="commit or ref to release (default: origin/main)")
    p.add_argument("--level", choices=["patch", "minor", "major"], help="override the computed level")
    p.add_argument("--no-fetch", action="store_true", help="don't fetch origin first")
    p.add_argument("--json", action="store_true", help="print one JSON object")
    args = p.parse_args(argv)
    try:
        if not args.no_fetch:
            git("fetch", "--quiet", "--tags", "origin")
        result = compute(args.from_tag, args.to, args.level)
    except GitError as err:
        print(f"suggest_release: {err}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print_human(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
