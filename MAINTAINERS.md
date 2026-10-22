# MAINTAINERS.md — geo-skills

For the people who maintain this repository. Editors and agents do not need this file.

This repository is a **skills library**. The agents moved to `geo-explorers/geo-agents` in migration step 6. This file records what belongs here and what does not. It also holds the procedures for changing a skill, how releases happen, and the release automation.

## Bucket list — what belongs in this repository

**Inventory date:** 13 October 2026 · **commit:** `4aa5d75` · **tracked files:** 234.

Every tracked file sits in exactly one bucket. The rule for each bucket:

| Bucket | Rule | Files |
|---|---|---|
| **A · Skill** | Inside a skill folder, or one of the three skill index files. Stays. | 88 |
| **B · Shared code** | Outside a skill folder, and at least one skill calls it or points to it, or it maintains such a file. Stays for now. | 14 |
| **C · Library tooling** | Needed to build, check or install the library itself. Stays. | 21 |
| **D · Removed at cut-over** | Neither a skill nor called by one. Removed in migration step 6. | 49 |
| **E · Temporary** | Migration working notes. Removed when the migration finished, 15 October 2026. | 62 |

The migration plan names three buckets: skill, shared code, neither. Bucket C is added here because files such as `package.json` and `skill-dev/` are none of the three. Bucket E is separate from D because it leaves later.

### A · Skills — stay (88 files)

| Path | Files | Note |
|---|---|---|
| `skills/actionable/geo-claim-grouping/` | 6 | |
| `skills/actionable/geo-clean/` | 4 | |
| `skills/actionable/geo-discovery/` | 16 | |
| `skills/actionable/geo-mirror/` | 12 | |
| `skills/actionable/geo-orchestrate/` | 2 | |
| `skills/actionable/geo-publish/` | 2 | |
| `skills/non-actionable/daily-report/` | 3 | |
| `skills/non-actionable/geo-claim-grouping-notion/` | 7 | |
| `skills/non-actionable/geo-describe/` | 7 | |
| `skills/non-actionable/geo-mirror-and-group/` | 3 | |
| `skills/non-actionable/geo-press-review/` | 2 | |
| `skills/non-actionable/geo-query/` | 2 | |
| `skills/non-actionable/image-banner-recompose/` | 5 | |
| `skills/non-actionable/notion-operations/` | 5 | |
| `skills/non-actionable/ontology-advisor/` | 9 | |
| `skills/README.md` | 1 | Skills index |
| `skills/SKILL-VERSIONS.json` | 1 | Integrity manifest |
| `skills/versions.md` | 1 | Changelog |

Fifteen skills, 85 files, plus three index files.

### B · Shared code a skill calls — stays for now (14 files)

Each row names the skills that depend on the file. A file leaves this bucket only when no skill depends on it.

| Path | Used by |
|---|---|
| `src/functions.ts` | geo-publish, geo-clean, geo-claim-grouping, geo-claim-grouping-notion, geo-mirror, geo-orchestrate, geo-query |
| `src/constants.ts` | geo-clean, geo-claim-grouping, geo-orchestrate, geo-query |
| `src/entity_ops.ts` | geo-clean, geo-orchestrate |
| `src/select_canonical.ts` | geo-clean |
| `src/xlsx-to-csv.cjs` | geo-publish |
| `lib/gql.mjs` | geo-query, geo-claim-grouping-notion |
| `lib/gql-cli.mjs` | geo-query |
| `lib/inject.ts` | geo-publish (inject mode) |
| `validate_migration.ts` | geo-clean |
| `scripts/notion-read.mjs` | notion-operations |
| `scripts/press-review-coverage-map.ts` | geo-press-review |
| `scripts/inject-publish-example.ts` | geo-publish (named as the inject-mode example) |
| `scripts/check-space-list.ts` | No skill. Read-only check that the space list in `src/constants.ts` still matches Geo; kept as upkeep for that file |
| `knowledge-graph-ontology.md` | geo-publish, geo-query (reference document) |

None of these files imports anything from bucket D.

### C · Library tooling and repository files — stay (21 files)

| Path | Files | What it is |
|---|---|---|
| `skill-dev/` | 8 | Linter, integrity manifest tools, Markdown manifest check, local install script |
| `MD-FILES.md` | 1 | Manifest of this library's Markdown files. Moved out of `agents/` in step 6, when that folder was removed |
| `.github/workflows/verify-skills.yml` | 1 | Integrity check |
| `.github/workflows/discord-notify.yml` | 1 | Change feed to Discord |
| `.claude/settings.json` | 1 | Auto-approve allowlist |
| `CLAUDE.md` | 1 | Entry file: routing and hard rules |
| `README.md` | 1 | Setup runbook |
| `LICENSE` | 1 | |
| `package.json`, `package-lock.json`, `bun.lock`, `tsconfig.json` | 4 | Toolchain |
| `.gitignore`, `.env.example` | 2 | |

### D · Removed at cut-over, migration step 6 (49 files)

| Path | Files | Where it goes |
|---|---|---|
| `01_entity_operations.ts` … `11_fix_duplicate_subtopics.ts` | 13 | Deleted. Git history keeps them. Includes `02.3_export_no_type.ts` and `02.5_full_space_scan.ts` |
| `testing.ts` | 1 | Deleted |
| `todo.md` | 1 | Deleted |
| `scripts/2026-07-28-sdk-v020-migration-check.ts` | 1 | Deleted. A dated one-off check for the July SDK migration; no skill calls it |
| `output/` | 26 | Deleted. Output of one past clean-up run |
| `agents/geo-research.md` | 1 | Moves to `geo-agents/agents/geo-research/` in step 5 |
| `agents/geo-mirror-refresh.md` | 1 | Moves to `geo-agents/agents/geo-mirror-refresh/` in step 5 |
| `agents/AGENT-WORKFLOW.md` | 1 | Moves to `geo-agents/workflow/` in step 5; its ids go to `ids.json` |
| `agents/README.md` | 1 | Replaced by the `geo-agents` README |
| `documentation/` | 3 | Moves to `geo-agents/docs/` in step 5. All three files belong to geo-research |

No skill runs any of these files. One skill, geo-orchestrate, names `03_merge_duplicates.ts` in a sentence as a style example.

**Done in the same step 6 pull request.** `MD-FILES.md` moved to the repository root, and its path changed in `skill-dev/check_md_manifest.py` and `.github/workflows/verify-skills.yml`. `CLAUDE.md`, `README.md` and `skill-dev/README.md` now point to `geo-agents` instead of the removed folders, and the README no longer documents the numbered scripts.

### E · Temporary — removed when the migration finished (62 files)

| Path | Files |
|---|---|
| `audit/` | 46 |
| `audit-2/` | 16 |

Working notes from the 9 and 11 October audit sessions. They were the source of the migration plan and were removed on 15 October 2026, once the migration was finished. Git history keeps them.

## Changing a skill

Every change under `skills/` or `skill-dev/` goes through a pull request. Nothing is pushed straight to `main`. Versions, changelog headings and the integrity manifest are written by a bot, not by hand.

1. **Branch from `main`** and make the change.
2. **Lint the skill** against the authoring standard:
   ```bash
   python3 skill-dev/skill-quality-check/scripts/check_skill.py skills/<tier>/<skill> --format table
   ```
3. **Add a row to `MD-FILES.md`** for any new Markdown file.
4. **Open the pull request.** If the change is more than a fix, add a label: `bump:minor` for a new capability, `bump:major` for a breaking change to how the skill is used. No label means patch.
5. **The bot bumps the version.** The `skill-bump` workflow runs `skill-dev/bump_skills.py` and pushes one commit, "Bump skill versions (<level>)", that:
   - sets each changed skill's `version` to its version on `main` bumped by the level, unless the `SKILL.md` already has a higher one (it never lowers a version);
   - adds a `### <skill> — <version>` entry to `skills/versions.md` with the pull request's title and number;
   - updates the skill's version in `MD-FILES.md`;
   - regenerates `skills/SKILL-VERSIONS.json`.

   It then starts the `verify` check on its own commit. The first `verify`, on your push, is red (`DRIFT` or `UNLISTED`) until then: expected. Reword the bot's changelog line to say what changed and why if you like; keep the heading.
6. **Review and merge.** It can merge only when the `verify` check passes and another team member has approved. A new commit on the pull request, including the bot's, cancels earlier approvals. Merging releases the library (see "How releases happen"): run `python3 skill-dev/suggest_release.py --to HEAD --no-fetch` on the branch to see which release that will be.

Changing a label after the bot ran re-runs it. Removing a label never lowers a version the bot already set; lower it by hand if needed. Pull requests from forks can't be pushed to: their authors bump `version`, add the changelog entry, update `MD-FILES.md` and run `python3 skill-dev/skill_versions.py generate` by hand.

What the `verify` check proves: every skill folder matches the content fingerprint recorded for it in `skills/SKILL-VERSIONS.json`, and every Markdown file is listed in the manifest. The fingerprint covers the skill folders only, not the shared code in `src/`, `lib/` and `scripts/`.

### Adding a skill

Everything in "Changing a skill" applies, plus:

- **Pick the tier.** `skills/actionable/` if the skill can change Geo, otherwise `skills/non-actionable/`.
- **Frontmatter.** `SKILL.md` starts with `name`, a `description` that carries the phrases that should trigger it, and `version: 0.1.0`.
- **List it.** Add a row to the index in `skills/README.md` and a row in `MD-FILES.md` for every new Markdown file. The bot adds its `skills/versions.md` entry.
- **Route to it,** if editors should be sent to it by default: add a row to the routing table in `CLAUDE.md`.
- **Expect `UNLISTED`.** `verify` reports the new skill as unlisted until the bot regenerates the manifest.
- **It releases as a minor version** of the library at least, because a skill was added.

### A skill built for one agent

A skill that only one agent needs starts in that agent's folder in `geo-agents` (`agents/<name>/`). It moves into this library once it is stable and has been evaluated, following "Adding a skill". This keeps unproven skills out of the release that every agent pins.

### How a change reaches the people and agents who use it

- **Nothing downloads skills while it runs.** No agent fetches or overwrites skill files during a task. If a skill is missing, the agent stops and asks a person.
- **A person updates a local install**, from a checkout of a release tag: `bash skill-dev/sync-skills.sh`, then restart the app.
- **`geo-agents` updates through its own pull request, opened and merged by a bot.** It keeps a copy of the skills pinned to one release tag and one commit, with a fingerprint per file in `skills.lock.json`. Each release notifies it; its `sync-skills-release` workflow vendors the release and merges once its own `verify-vendored` check passes. Editors' checkouts then offer the update at their next Claude Code session.

## How releases happen

A release is an annotated tag `vX.Y.Z` on `main`, plus a GitHub Release page. It is the only thing consumers pin to. **Nobody tags by hand.** The `release` workflow (`.github/workflows/release.yml`) does it on every merge to `main`:

1. **Gate.** It re-runs `skill_versions.py verify`, `check_md_manifest.py` and the release calculator's tests on the merged commit. No release from a red commit.
2. **Decide.** `skill-dev/suggest_release.py` compares the commit with the last release tag. A release is made only when a file inside a skill folder changed. Merges that change only tooling, docs or CI end green with "waiting for a skill change"; their changes count toward the next release's version.
3. **Version.** The highest of these signals:

   | Bump | When |
   |---|---|
   | Major | A skill is removed or renamed, or a skill's own version had a major bump |
   | Minor | A skill is added, a skill's own version had a minor bump, or files outside the skill folders are added or removed |
   | Patch | Anything else |

   `v1.0.0` is the library as it stood before the agents moved out. `v1.1.0` follows the cut-over in migration step 6.
4. **Tag** `vX.Y.Z` on the merged commit, annotated and unsigned, as the release app's bot user.
5. **Release page** with the full commit hash, each changed skill with its `skills/versions.md` entries, and every skill's version.
6. **Notify `geo-agents`** through GitHub's repository-dispatch API (`{tag, commit}`). Its `sync-skills-release` workflow vendors the release.

Rules:
- **Exact `vX.Y.Z` only.** Suffixed tags such as `v1.2.0-test` are never created and never synced.
- **Never move or delete a published tag.** A mistake in a release is fixed by the next version.
- **Manual run:** Actions → release → Run workflow, on `main`. It releases even without a skill change; `level` overrides the computed level (a lower one prints a warning); `dry_run` only prints what would happen.
- **Re-running a failed run is safe.** A commit that is already tagged only gets its release page and notification again.
- **Preview** what merging a branch will release: `python3 skill-dev/suggest_release.py --to HEAD --no-fetch`.

## Release automation

The automation acts as one **GitHub App** owned by the `geo-explorers` organisation, not as a person. There are no personal access tokens: each workflow run asks the app for a token that expires after one hour and carries only the permissions that job needs.

| Piece | Where | What it does |
|---|---|---|
| Release app | Organisation settings → Developer settings → GitHub Apps. Installed on `geo-skills` and `geo-agents` only | Repository permissions: Contents read and write, Pull requests read and write (Metadata read comes with them). No webhook. The only actor allowed to create `v*` tags here, and to merge in `geo-agents` without an approval |
| `RELEASE_APP_ID` (variable) and `RELEASE_APP_PRIVATE_KEY` (secret) | This repository's environment `release`, and `geo-agents`' environment `skills-sync`. Both environments: deployment branch `main` only | The workflows turn them into a one-hour token with `actions/create-github-app-token`. Here: Contents write on both repositories (tag, release page, notify `geo-agents`). In `geo-agents`: Contents and Pull requests write there only |
| Tag ruleset | This repository, Settings → Rules → Rulesets | Targets `refs/tags/v*`. Restricts creation, update and deletion. Bypass: the release app only |
| Labels | This repository | `bump:minor` and `bump:major`, read by the `skill-bump` workflow |

The `skill-bump` workflow needs no app: it pushes with the workflow's built-in token and then starts `verify` itself.

**Rotating the private key.** The key does not expire, so rotate it once a year, or at once if it may have leaked: in the app's settings, generate a new private key, paste it into both environment secrets, check that the next `release` or `sync-skills-release` run is green, then delete the old key in the app's settings. A deleted or wrong key shows as a red run at the "Get a one-hour token" step; after fixing it, re-run that run.

## Branch protection on `main`

These settings live in the repository settings on GitHub, not in a file. They are what makes the procedures above binding.

| Setting | Value |
|---|---|
| Require a pull request before merging | On |
| Require approvals | On, at least one, from a team member other than the author |
| Dismiss stale pull request approvals when new commits are pushed | On |
| Require status checks to pass before merging | On, with the check `verify` |
| Do not allow bypassing the above settings | On, so the rules apply to administrators too |
