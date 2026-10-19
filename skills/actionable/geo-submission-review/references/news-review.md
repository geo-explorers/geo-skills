# News submission review

Use for a general review of specified News/story submissions. Keep the main skill's compact feedback format and internal coverage record. News selection is an editorial recommendation; it does not cast votes, award points, promote content or certify every embedded Claim.

## Establish the news scope

Identify the actual submission space, its canonical main space and companion datasets space where applicable, the story/proposal IDs, curator, review period and relevant bounty/editor rules. Do not substitute the agent's default space. A linked list of proposals is the review scope; other proposals and earlier coverage are comparison evidence, not permission to run the whole payout pipeline.

Retrieve the submitted payload as well as current content when available: a pending or subsequently edited proposal can differ from the live entity. Decode each story in a bundle. Keep source publication, event/announcement, proposal submission, execution and entity creation times distinct. Use the story's Publish date (`datetime`) and source dateline for recency; Geo creation time is only a labeled fallback, not proof of when the event happened.

## Apply these four checks to every story

| Check | What establishes it |
|---|---|
| Distinct development | Identify what happened, to whom and when, supported by an appropriate source. Check the agreed time window. A material announcement of a future plan is news about the announcement; implementation remains future. Opinion, speculation, a general explainer or a rewrite needs an identifiable new development to qualify. |
| Direct space relevance | Explain the concrete connection to the target space's subject and audience. A keyword, company name or incidental mention alone is insufficient. Use the space's current scope and priorities; do not copy Crypto criteria into another space without checking them. |
| Substantial significance | Identify a meaningful consequence for users, institutions, technology, policy, security or the relevant market. Exclude routine price moves, bare changing metrics, slight items and broad explainers without a new event. A number alone does not establish significance; a metric can support a distinct, consequential development. Do not invent monetary or engagement thresholds. |
| Event originality and precedence | Compare the underlying event against existing coverage and the whole relevant submission batch, using the procedure below. A changed headline, different publisher or new entity ID does not make the same event new. |

Read enough primary or reliable contemporaneous evidence to establish the event, relevance and significance. Keep confirmed selection failures separate from unresolved checks. An inaccessible source or unverified generated detail alone does not establish an irrelevant or trivial event. If the underlying event itself cannot be established, give the editor the evidence gap rather than fabricate a verdict or contributor repair.

## Check duplicates and precedence

Search both the target main and datasets spaces, relevant injector coverage, and other curators' submissions in the review batch/window. Include earlier coverage of matching events before the window. A known small set of curator links still requires comparison outside that set. Record which populations, periods and paginated results were checked; capped, failed or missing results cannot establish duplicate-free coverage.

Use exact names first, then normalized, News-type-scoped fuzzy searches and event terms such as actors, action, product, location and date. Similarity flags are candidates. Read both stories and their sources before deciding they report the same happening. A later ruling, completed acquisition or newly disclosed consequence can be a material follow-up even when its topic and actors match an earlier story.

| Case | Review treatment |
|---|---|
| Same entity ID appears in main and datasets | Dual residency: one entity in two spaces, not a duplicate submission merely because it is already live. Avoid recommending promotion again. |
| Different IDs describe the same event | Compare the original submissions and earlier coverage, including injector history. The first qualifying submission retains precedence. |
| Curator submitted before a matching injector story | Preserve the curator's precedence even if the injector entity is live at review time. Graph reuse/repair is a separate editor action. |
| Another curator or injector demonstrably had the same event first | Flag the later submission with both item links, the shared event and the earlier timing evidence. |
| Same curator repeats a story, including across bundles | Treat it as one story; link the repeated submissions. |
| Same topic, materially different development | Assess the new development on its merits; do not reject it solely for shared entities or title similarity. |
| Missing or conflicting timing, incomplete baseline | Mark precedence/coverage unresolved internally. Do not invent a winner or turn a similarity flag into a rejection. |

Use proposal submission timestamps for curator precedence. Retrieve original proposal/history evidence for injector coverage where available. If only an entity creation timestamp is available, label that proxy and its limit; do not confuse execution time or the article's publication date with when the curator submitted. Compare and display timestamps in UTC, with dates and source links; use date-only wording where hours add no value. Existing votes or execution status are not proof of editorial quality or precedence.

Use installed `geo-query` retrieval procedures. If the recurring `geo-bounty-review` pipeline is available and its scope fits, its Stage 0 output can supply evidence; require its completion record before claiming mechanical coverage. Its candidate flags still need judgment. This profile works without that pipeline and does not start scoring or payment workflows.

## Responsibility for submitted content

**Mohammed, 30 September 2026:** curators can review and edit injector output before submitting. Include verified factual, source, date, wording or other content inaccuracies in their feedback when they could inspect and correct them. The fact that content was generated does not exempt it from review. Apply the [repair-request gate](feedback-and-votes.md): request content fixes on eligible work or when the correction could change eligibility; for independently rejected stories, explain the rejection, identify verified error types with neutral process questions and checks for future submissions, and do not ask for futile current repairs. Keep repeated occurrences in the private editor/QA record. This replaces the earlier blanket Crypto injector-feedback exemption, with repair scope clarified on 11 October 2026.

Technical failures, such as edits not saving or inaccessible controls, belong with the editor/technical team. Recurring injector defects may also be logged internally while the curator receives evidence of the inaccurate submission. Do not assume a curator can repair backend structure; establish the actual opportunity to review/edit when responsibility is uncertain. Apply current space/bounty instructions and retain full accuracy/spec checks for datasets, original Claims and fact-checks.

Keep event selection and content quality as separate internal assessments. This feedback change does not change payout rates, selection/voting thresholds or authorize any governance action. A selected event does not certify all its generated Claims.

Policy provenance: Geo news-selection and first-submission rules, with the feedback responsibility revision approved on 30 September 2026. Apply newer explicit editor/space instructions when supplied.

## Record the review and prepare feedback

Internally record a selection recommendation for every story: **qualifies**, **does not qualify** with the failed criterion and evidence, or **unresolved** with the missing evidence. Preserve human decisions separately. Include comparison links and timing, relevance/significance reasons, coverage limits and QA ownership. A full review should not silently omit originality or relevance while reporting copy corrections.

For specified Notion reviews, forwardable output follows the main skill's exact four-column format: **Entity | Issue | Citations for quality checks | Relevant quote or evidence detail**. Show one specific example per recurring problem, covering every distinct verified error type with neutral process questions and concrete prevention guidance. For duplicates, cite the earlier submission and timing; for weak relevance/significance, explain the failed requirement using source content and the bounty criterion. For generated inaccuracies, show the submitted assertion and contrary evidence. Keep additional examples and technical QA internally. Never substitute a suggested rewrite for evidence of a problem, fabricate findings, or edit submissions automatically.

Space-discovery datasets reports use the six-field comparison in routine.md, including full original and exact excerpt; the same evidence and compact-feedback rules apply.

For routine multi-story cases, provide the editor-only tally and points calculation in routine.md. Generated-copy feedback remains separate from selection/credit: a verified wording defect alone does not reject an otherwise qualifying Crypto injector story under Mohammed’s current rule.
