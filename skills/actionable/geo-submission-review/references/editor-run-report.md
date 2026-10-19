# Standard editor run report

Mohammed adopted this fixed output on 6 October 2026. The canonical layout is [assets/editor-run-report.md](../assets/editor-run-report.md). Keep its section names and order in every environment. Replace Crypto with the actual space (or a clear multi-space label); use UTC. Repair line-wrap artifacts rather than splitting words. The report is private editor material; never publish it, its points, or its JSON to Geo/Notion recipient pages or Discord.

## Generate and deliver

At the end of every overall run (including no change, partial failure, an approval wait or a specified submission), assemble one JSON input from the dated intake/review/delivery/action receipts and render:

```bash
node /absolute/path/to/skill/scripts/editor-run-report.mjs /absolute/path/to/run-summary.json /absolute/path/to/run
```

The integrated runner also accepts `summary --summary RUN_SUMMARY_JSON --state STATE --out RUN`. It writes `EDITOR-RUN-REPORT.md` and `EDITOR-RUN-REPORT.json`. The standalone renderer uses only Node built-ins, resolves its template relative to itself, and has no network, SDK, account or workspace-path dependency. It does not perform a review, verify online evidence, or execute actions. Its validation cannot prove input claims; the agent must reconcile the receipts first.

Return the rendered report or an accessible private artifact link in the host's output surface. A notification may be shorter and point to this report. A scheduled no-change run still saves it and remains quiet. If the host has no Node or filesystem, fill every section of the bundled template directly in the private editor response/host artifact; disclose which generation or persistence capability was unavailable. Never claim an artifact was saved when it was only displayed. If the host is abruptly terminated, generate a clearly marked interrupted-run report at recovery; no skill can guarantee output while its process is not running.

Use `None`, `Not applicable`, or an explicit unknown/blocker instead of dropping empty sections. No-change runs ask for no unnecessary decisions. A failed scan is incomplete coverage, never zero submissions by inference. Specified submissions use no scan window and retain their actual reviewed scope. Completed review and verified report delivery are separate; a publication failure belongs in the completed case row with its delivery blocker, not a fabricated report link. Cases still under investigation have their own section and no final recommendation. Previously published reports do not certify this run's revised findings.

Prepare exact vote links/reasons and feedback artifacts before listing them. Whole-proposal mixed outcomes need a Hold/split plan; accepted eligibility alone cannot imply a safe YES. State fast-vote publication or later execution consequences explicitly. Recommended counts/points do not establish approval, execution or payment. Preserve separate approvals; only receipt-backed actions appear under completed actions. Refresh this report after approved actions. In partial multi-space runs, name affected spaces in coverage and blockers.

## Input contract (schemaVersion 1)

All fields below are required; arrays may be empty. Numbers may be `null` for unknown, never silently default to zero. Counts refer to this run's stated scope, not all historical drafts. `ready` contains complete reviews being handed off, even if delivery failed. Include carried pending cases only when relevant and label them as carried; do not call their proposals new.

- `schemaVersion: 1`, `audience: "editor_only"`, `runId`, `space`, `reviewedAt` (ISO with timezone).
- `scan: {start,end}` (ISO with timezone), or `null` for a specified submission. `coverage: {status: "complete"|"incomplete"|"not_applicable", detail}`. Detail states the actual scope and any limitation.
- `newProposals`, `caseCount`: captured new proposal count and cases those proposals group into; integer or null. Completed, investigation and identification counts are derived from the respective arrays.
- `ready: [{caseId, fingerprint, reviewComplete:true, curator, bounty, recommendation, points, report}]`. Without a bounty, name the supplied brief. Recommendation is readable and includes relevant item counts; points states the supported calculation or its precise limitation. `report` is either `{status:"verified", url, verifiedAt, fingerprint}` matching the current case, or `{status:"draft"|"failed"|"not_published", detail}`. Only verified links appear as delivered Geo reports. For an explicitly authorized non-Geo exception, retain its link in a feedback/detail artifact and describe that exception; do not mark it as Geo verified.
- `actions: [{caseId, proposalId, vote:"YES"|"NO"|"Hold", label, url, reason}]`. One action per exact proposal; include only proposed actions still applicable, not executed ones.
- `executionConsequence`: explicit readable consequence or why no execution is proposed.
- `feedback: [{caseId, curator, draftUrl, detail}]`. Draft links must resolve in the editor's environment. Explain mixed outcomes and any missing-publication-link blocker; do not imply messages were sent.
- `investigations: [{caseId, label, blocker, nextStep}]` and `identification: [{label, blocker, nextStep}]`. Preserve affected items/curators; use exact investigation and identification records to avoid duplicates.
- `decisions: [text]`: the specific decisions needed; empty when none.
- `completedActions: [{detail, receiptUrl}]`: only confirmed actions this run; `awaitingApproval: [text]`: still-unapproved actions; `payoutStatus`: explicit actual status.

Use real source-derived values, not the illustrative Curator A/B names, example counts or placeholder links. The generator escapes plain text for Markdown and rejects stale delivery fingerprints, unfinished ready cases and duplicate proposal actions. Receipt-backed review judgment, scoring and authorization remain agent responsibilities.
