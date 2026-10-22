# skill-dev — maintainer tooling

Developer-facing tools for **building** Geo skills. **Not shipped to editors** — editors only pull `../skills/`.

## ✅ Changing a skill

Lint it, open a pull request, and let the bot do the versioning:

```bash
python3 skill-dev/skill-quality-check/scripts/check_skill.py skills/<tier>/<skill> --format table
```

- **Don't edit `version:` lines, `skills/versions.md` headings or `skills/SKILL-VERSIONS.json` by hand.** The `skill-bump` workflow runs `bump_skills.py` on the pull request and pushes one commit with all of them. Patch by default; label the pull request `bump:minor` or `bump:major` for more.
- The first `verify` on a skill change is red (`DRIFT` or `UNLISTED`) until the bot's commit lands, about a minute later. That is expected.
- Merging releases the library automatically (`release` workflow). To see what merging will release: `python3 skill-dev/suggest_release.py --to HEAD --no-fetch`.

The full procedure, including adding a new skill, is in [`../MAINTAINERS.md`](../MAINTAINERS.md). Details below.

---

- **`skill-quality-check/`** — the Agent Skill authoring **standard** + a linter that checks a skill against it (dangling references, frontmatter, missing evals/ToC, weak descriptions). Form/quality only; it never judges domain content.

Run it before adding or editing anything under `../skills/`:

```bash
python3 skill-dev/skill-quality-check/scripts/check_skill.py skills/non-actionable/geo-query --format table
```

The full rule set is in `skill-quality-check/references/skill-quality-standard.md` — treat it as the standard for skill development in this repo.

## `check_md_manifest.py` — Markdown manifest verification

Checks `MD-FILES.md` against the repo: every tracked `.md` is listed, no listed file has been deleted, and each `SKILL.md` version matches the one recorded. Runs in CI on changes under `skills/` or `agents/`.

```bash
python3 skill-dev/check_md_manifest.py          # exit 0 = matches, 1 = drift
python3 skill-dev/check_md_manifest.py --list   # counts
```

A stale manifest is worse than none, because people check it instead of the files. Add a new `.md` to the right section in the same commit that creates it.

## `bump_skills.py` — per-skill version bumps (the bot)

Bumps every skill whose folder differs from a base commit, by one level from its base version, and never lowers a version a person set higher. A new skill keeps its version (`0.1.0` if it has none). For each, it adds the `skills/versions.md` entry and sets the version in `MD-FILES.md`, then regenerates the manifest. A second run changes nothing. The `skill-bump` workflow runs it on every pull request.

```bash
python3 skill-dev/bump_skills.py --base origin/main --level patch --title "What changed" --dry-run
python3 skill-dev/test_bump_skills.py       # its tests, against a throwaway repository
```

## `suggest_release.py` — the next release version

Computes the next library release from the changes since the last `vX.Y.Z` tag, using the rule in `MAINTAINERS.md` ("How releases happen"): major for a removed or renamed skill or a skill's major bump; minor for an added skill, a skill's minor bump, or files outside skill folders added or removed; patch otherwise. A release is needed only when a skill folder changed. The `release` workflow runs it on every merge to `main` and tags the result. It never creates tags itself.

```bash
python3 skill-dev/suggest_release.py --to HEAD --no-fetch            # what merging this branch releases
python3 skill-dev/suggest_release.py --from v1.2.0 --to v1.2.1 --json
python3 skill-dev/test_suggest_release.py                            # its tests
```

## `skill_versions.py` — approved-version verification

Proves an editor is running the exact skill version the team approved (not tampered, not stale) — important because `actionable/` skills can publish/delete on Geo.

How it works: `skills/SKILL-VERSIONS.json` records, per skill, the commit it was approved at + a sha256 content hash of its files. `verify` recomputes the hashes from the working copy and compares.

```bash
# maintainer — after reviewing/approving a skill change, on a CLEAN (committed) tree:
python3 skill-dev/skill_versions.py generate   # updates skills/SKILL-VERSIONS.json

# editor / CI — confirm local skills match the approved versions:
python3 skill-dev/skill_versions.py verify     # exit 0 = all match, 1 = drift
```

`verify` reports per skill: `OK` · `DRIFT` (modified since approval) · `MISSING` · `UNLISTED`. **CI runs it on every PR** (`.github/workflows/verify-skills.yml`) — any unreviewed change to a shipped skill fails the build. Re-run `generate` whenever you intentionally approve a change, and commit the updated manifest in the same pull request.
