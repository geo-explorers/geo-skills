# Notion review feedback

This is the body layout for Notion review reports, including the supplementary history records described in [review-history.md](review-history.md). Notion recipient delivery still requires an explicit current-review request; Geo datasets remain the default destination. An existing mirror or historical Notion review does not authorize a delivery exception. Use `notion-operations` when available, or the authorized connector's documented identity, pagination and write/readback procedures. Confirm the actual destination and existing content before writing. Reuse the exact matching record; preserve submissions, comments, human decisions and Editor feedback.

## Required page structure

Keep the title in the page name only. The body consists of exactly these blocks, with no preamble, repeated title, audit appendix, separate date/status heading or extra summary sections:

1. **Three concise introductory bullets**, in this order, labelled **Accepted**, **Needs correction**, **Next steps**. Each value is one short plain-text line (at most 200 characters), with no embedded newline or `<br>`. Accepted starts with an accurate unique story/item count, “recommended for acceptance:”, and a brief specific rundown, for example “2 stories recommended for acceptance: Atlas wallet launch; Council staking rules. 1 still needs correction.” Never substitute generic categories or “Review recommendation:” for that rundown. For a large batch, preview a few recognizable items and state exactly how many more. Accepted is a review recommendation, never an approval, publication, payout or message. Keep nuanced findings and rejection reasons in the table rather than expanding the bullets.
2. **One native simple table** matching Geo's review structure, with these exact seven columns in order:

| Review | Related entities | Full original statement | Exact excerpt under review | Issue | Sources | Evidence detail |
|---|---|---|---|---|---|---|
| Linked Geo finding name | Specific linked submitted entity | Complete captured original, or an explicit missing-field requirement | Verbatim disputed excerpt, or a truthful missing-field explanation | Complete finding, process question, useful correction and prevention guidance | Every direct citation and useful locator | Complete relevant quote or evidence detail, with necessary qualifiers |

3. **Four final collapsed toggles**, in this order: **Submissions reviewed**, **Submissions accepted (N stories/items)**, **Submissions rejected (N stories/items)**, **Submissions requiring changes (N stories/items)**. Retain all constituent proposal/submission links in reviewed. The other three lists classify unique reviewed items, not proposals or finding examples; one proposal may contain several differently classified items. Use actual useful titles and captured item/submission links, retaining different items even when they share a URL. Empty groups contain `None.` with count 0. Use documented Notion syntax:

```text
<details>
<summary>Submissions reviewed</summary>
\t- [Atlas wallet launch and Council staking rules](https://example.org/submission)
</details>
<details>
<summary>Submissions accepted (2 stories)</summary>
\tRecommendations only; editor approval, publication and payment are separate.
\t- [Atlas wallet launch](https://example.org/atlas)
\t- [Council staking rules](https://example.org/council) — accepted in review; correction still required.
</details>
<details>
<summary>Submissions rejected (0 stories)</summary>
\tRejection recommendations only.
\t- None.
</details>
<details>
<summary>Submissions requiring changes (1 story)</summary>
\tAccepted items with repairs also appear in the accepted list; do not add these counts together.
\t- [Council staking rules](https://example.org/council) — also accepted in review.
</details>
```

Classification follows each scoped item's independent `selection` when present: `qualifies` is accepted, `does_not_qualify` is rejected. Otherwise `meets_requirements` is accepted, `does_not_meet_requirements` is rejected, and `needs_correction` is returned for correction without acceptance. Requiring changes includes non-rejected items with `coverage.outcome:needs_correction` or an explicitly repair-eligible finding. Record the correction outcome on **every affected item's coverage**, even though the findings table shows one example per error type. Accepted stories needing metadata repairs remain accepted and also appear under requiring changes, with both entries labeled. Rejected items receiving future-prevention guidance do not appear as repair requests. These lists overlap; do not sum them into a misleading total. Unresolved decisions still block completed reports.

The indentation above is a literal tab in generated content. Keep metadata—publication date, curator identity, bounty, outcome, Geo report URL and stable review key—in database properties and the durable journal. Do not duplicate it in new body sections. For explicitly requested standalone Notion delivery without a Geo publication, the Review cell may be an unlinked finding name; never invent a Geo finding URL. Use the same table and completion checks manually when the Geo-backed offline helper is inapplicable.

Cover **every distinct verified error type**, prioritizing significance; do not impose a numerical cap. Include a neutral question about the checking process, a useful correction where applicable and a prevention step in Issue. Show **one specific example per recurring problem**. Keep the detailed audit of other occurrences in the internal record; retain their titles/links in the final decision lists. Never replace a finding example with a group label or add a “What to fix” column. The final decision lists retain item titles/links, while the table keeps one complete example per error type. Do not truncate the original statement, Issue paragraphs, citations or evidence to make cells shorter. The concise introduction does not reduce research or evidence coverage.

Keep the tone factual, kind and specific. Do not assume dishonesty or manufacture errors. Each row must make sense on its own and preserve the submitted statement's relevant qualifiers.

Read the connector's Markdown specification before writing. Use its native `<table header-row="true">` format and `<br>` within cells to retain paragraph breaks. Use native mentions for Notion entities where supported; never use a child-page tag just to link an existing page. `scripts/notion-report.mjs` renders and validates the Geo-backed history layout; `scripts/review-history.mjs` uses it for every newly prepared entry. Verify the fetched structure and full cell contents after saving, accounting for documented Markdown normalization.

## Evidence across submission types

- **Factual assertion:** quote the passage establishing the discrepancy, with enough context to avoid misrepresentation.
- **Duplicate:** link both submissions and give comparable submission timestamps and evidence that they cover the same event/item. A matching topic alone is insufficient.
- **Relevance or significance:** cite the actual bounty/space criterion and source content; explain the connection between those facts and the judgment in Issue. Do not present an editorial judgment as a factual contradiction.
- **Missing or structural field:** cite the requirement and exact submitted record; give the observed field value/state. The blank field alone does not establish a requirement to populate it.
- **X posts/blogs:** read surrounding thread/quoted context and apply the actual bounty; an opinion may qualify. Do not import news-only event requirements or arbitrary engagement cutoffs.

Quotes must be exact excerpts from retrieved evidence. Observe source quotation limits; use a short excerpt plus locator or a labeled paraphrase when needed. Do not put paraphrases in quotation marks. Leave unavailable quotations unquoted and supply meaningful evidence detail; missing access stays unresolved internally and is not evidence of a curator defect.

## Exceptions and internal records

If no supported issue is established, retain the three truthful bullets and four final submission toggles, with no empty or fabricated findings table and no invented process question. A partial investigation or empty scan gets a private editor handoff, not a completed Notion review. Honor explicit requests for another format or delivery location; record that exception internally.

Keep the review brief, inventory, all checks, other affected entities, repeated occurrences, verification status, severity, technical QA and editor decisions in a separate internal record. The four submission lists are the compact decision inventory; do not append a long audit or general incomplete-review disclaimer. Include uncertainty within an individual row when it changes that finding. Keep dates and assessment codes in metadata.

Record each finding's target, original content, criterion, evidence/locator, effect, resolution criterion and history. Keep agent findings separate from human decisions. Preserve dismissals and comments; match reruns by entity and underlying issue without deleting history. **Editor feedback** is human-owned rich text for recording agent mistakes; omit it from every generated property payload, including empty defaults. Keep it visible in Latest reviews, By curator and All review records without duplicating existing properties or views. A content update must preserve the current human property rather than writing back a stale copy. Formatting changes alone never create a new review key or authorize rewriting old reports.

This approved format takes precedence over a general report template's TOC, executive memo, heading hierarchy or visible quality checklist. Preserve evidence and authorization requirements.

## Completion gate

1. Confirm a saved page exists in the editor's supplied or established review location. Ask for a destination only when it cannot be determined; report access failures accurately.
2. Fetch the saved content using the writing identity. Check title, exactly three concise single-line labelled bullets, one table with the exact seven headers and complete findings, and four final collapsed submission lists, accurate item counts and explicit accepted/repair overlap. Verify every distinct error type, process question, prevention step, citation and original statement. Apply the documented no-findings exception when appropriate.
3. Verify each entity and evidence link, quotations/locators, responsibility and relevant qualifiers. Confirm there is no fix column, audit appendix, extra body section or internal audit; metadata, Editor feedback and human comments remain intact.
4. Inspect layout when available: readable widths, wrapped text, clickable evidence. Verify requested filters. Report visual inspection only when actually performed.
5. Fix any mismatch and read back again. Return the saved page link as the main deliverable. If saving failed, label delivery incomplete; do not substitute a chat/file draft and claim success.

For a timeout or unknown write outcome, inspect the parent and search for the intended page before retrying. Page creation does not authorize sending it to the contributor.
