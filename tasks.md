# tasks.md
VERY IMPORTANT: 
The user prefers that the assistant not create new files unnecessarily, instead update existing ones or merge files when necessary and delete files that are no longer needed or duplicate usage, to avoid redundancy and complexity. When you make replacement of a feature delete the old code, when you replace a file delete the old. i want the code base to be clean. but before you delete a file make sure it's not used. I don't used all prefixes like "simplyfied" or "unified" etc. the folder you don't need to create all the files in the folder structure below, you can just update what I have, you can rename files too.



Yes — when you remove a feature flag, there’s almost always old code to delete or migrate.
A flag means you’ve been running two (or more) code paths in parallel:
Old path → the “pre-flag” behavior.
New path → the refactored or improved behavior.
When you remove the flag, you’re deciding that the new path is now the only path. That usually means:

1. Delete old logic
Remove the old service calls, DB queries, or utility functions that existed only for the “off” side of the flag.
Remove API routes or UI flows that were only used when the flag was false.
Delete any “adapter” code that was shuffling between the two implementations.

2. Migrate any leftover state
If the old path wrote to a different DB schema or table, you migrate or backfill all data to the new schema before flag removal.
Example:
Old citation flow stored citation_number.
New unified service computes numbering dynamically.
Before deleting old code, you remove or archive the unused column.

3. Clean up test code
Remove tests that check both old and new behavior.
Keep only the tests for the new code path.
If you had parity tests between old and new, those can be archived.

4. Update configs / infra
Remove the env var or feature flag entry from your config management.
Remove any LaunchDarkly/ConfigCat/Unleash keys if you use a feature flag service.
Drop any conditional build or deploy steps that depended on the flag.

5. Remove telemetry comparisons
If you were logging metrics for both old and new (e.g., search_latency_old vs search_latency_new), keep only the new metrics.
Stop emitting “flag on/off” dimensions in analytics.

:bulb: In short:
 Removing a flag isn’t just flipping it to true everywhere — it’s deleting the entire alternative code path, cleaning up leftover tests, migrations, and configs so the repo is lean again.

If you want, I can give you a micro-task list for “flag removal” so that when we roll off CITATIONS_UNIFIED or EDITOR_DIFF_MODE, you don’t miss any hidden old code. This would keep your repo from accumulating “ghost” logic.


tasks.md
Removal plan for all feature flags we introduced. Each task is atomic, testable, and ordered. Flags covered:
 CITATIONS_UNIFIED, GENPIPE_UNIFIED_CITATIONS, GENPIPE_BATCHED_CITES, GENPIPE_RETRIEVAL_SVC, SEARCH_ORCH_ONLY, SERVICE_LAYER_ONLY, PROJECT_SERVICE_API, EDITOR_DIFF_MODE, EDITS_API_ENABLED, CITATION_OFFSET_MODE.
Note: CITATIONS_UNIFIED and GENPIPE_UNIFIED_CITATIONS are duplicates in intent. We’ll merge then remove.

Epic 0 — Pre-Removal Safety & Hygiene
R0.1 Merge duplicate flags (citations)
Purpose: Avoid removing two flags that guard the same path.
 Steps: Alias GENPIPE_UNIFIED_CITATIONS to CITATIONS_UNIFIED in config → replace uses of the former with the latter → delete alias.
 Acceptance criteria:
Grep shows 0 references to GENPIPE_UNIFIED_CITATIONS.
Unit test proves behavior unchanged with CITATIONS_UNIFIED.
 Effort: S
 Dependencies: none
R0.2 Add “flag removal” CI check
Purpose: Prevent zombie flag usage after removal.
 Steps: ESLint rule or custom script failing CI if removed flag names appear in code.
 Acceptance criteria:
CI fails on a test branch that imports a removed flag name.
 Effort: S
 Dependencies: none

Epic A — Citations Unified (CITATIONS_UNIFIED)
R1.1 Delete legacy direct-DB citation writes
Purpose: Ensure single write path via CitationService.
 Steps: Remove old DB calls in editor/tool code; keep only /api/citations/*.
 Acceptance criteria:
Grep shows no db.* usage in citations UI/tool code.
Contract test UI vs AI citation parity still passes.
 Effort: S
 Dependencies: R0.1
R1.2 Remove flag branches & config
Purpose: Make unified path permanent.
 Steps: Delete CITATIONS_UNIFIED checks; remove env var/docs.
 Acceptance criteria:
Build succeeds; CI rule (R0.2) passes; no references remain.
 Effort: S
 Dependencies: R1.1

Epic B — Batched Citation Resolution (GENPIPE_BATCHED_CITES)
R2.1 Remove per-citation tool calls
Purpose: Make batch the only code path.
 Steps: Delete single-citation fallback pipeline; keep batchAddCitations + post-processor.
 Acceptance criteria:
SSE timeline shows one batch call per section; none per-citation.
p95 generation latency not worse than baseline from last week.
 Effort: M
 Dependencies: A done
R2.2 Remove flag branches & config
Purpose: Lock batch mode on.
 Steps: Delete GENPIPE_BATCHED_CITES checks and env var.
 Acceptance criteria:
No references remain; E2E stream test passes.
 Effort: S
 Dependencies: R2.1

Epic C — Shared Retrieval Service (GENPIPE_RETRIEVAL_SVC)
R3.1 Delete legacy PromptBuilder DB queries
Purpose: Ensure retrieval goes through ContextRetrievalService.
 Steps: Remove direct DB lookups; import service only.
 Acceptance criteria:
Grep shows no DB client imports in PromptBuilder.
Prompt snapshots unchanged on same inputs.
 Effort: S
 Dependencies: none
R3.2 Remove flag branches & config
Purpose: Make shared retrieval mandatory.
 Steps: Delete GENPIPE_RETRIEVAL_SVC checks/env.
 Acceptance criteria:
CI rule passes; no references remain.
 Effort: S
 Dependencies: R3.1

Epic D — Search Orchestrator Only (SEARCH_ORCH_ONLY)
R4.1 Delete LibraryAPI direct-search code
Purpose: Single search path through orchestrator.
 Steps: Remove SQL/FTS calls in LibraryAPI; call orchestrator only.
 Acceptance criteria:
LibraryAPI contains only orchestrator calls.
Search parity test (result set size ±5%) passes.
 Effort: S
 Dependencies: orchestrator stable
R4.2 Remove flag branches & config
Purpose: Make orchestrator-only permanent.
 Steps: Delete SEARCH_ORCH_ONLY checks/env.
 Acceptance criteria:
Grep shows 0 references; E2E search tests green.
 Effort: S
 Dependencies: R4.1

Epic E — Service Layer Only (SERVICE_LAYER_ONLY)
R5.1 Enforce repo-only imports (delete exceptions)
Purpose: No app/tool talks to DB directly.
 Steps: Remove // eslint-disable exceptions; fix offenders to use services.
 Acceptance criteria:
Lint boundary rules pass with no suppressions.
 Effort: M
 Dependencies: services in place
R5.2 Remove flag branches & config
Purpose: Make service layer mandatory.
 Steps: Delete SERVICE_LAYER_ONLY checks/env.
 Acceptance criteria:
No references remain; unit tests green.
 Effort: S
 Dependencies: R5.1

Epic F — Project Service Stream (PROJECT_SERVICE_API)
R6.1 Delete old multi-endpoint write flow
Purpose: One SSE endpoint for write + citations.
 Steps: Remove direct usage of GenerateAPI/per-citation calls in editor; route to /api/project/:id/write.
 Acceptance criteria:
Editor uses exactly one SSE connection during generation.
E2E write test passes; no extra citation network calls.
 Effort: M
 Dependencies: batch citations live
R6.2 Remove flag branches & config
Purpose: Make project service the only path.
 Steps: Delete PROJECT_SERVICE_API checks/env.
 Acceptance criteria:
No references remain; telemetry dashboards show expected single-stream events.
 Effort: S
 Dependencies: R6.1

Epic G — Diff-Driven Editor (EDITOR_DIFF_MODE)
R7.1 Remove block editor write paths
Purpose: Fully deprecate block persistence.
 Steps: Delete block mutations; keep optional read-only viewer behind dev-only route.
 Acceptance criteria:
Any attempt to write blocks is impossible (greps + runtime check).
Users can create versions via diff editor only.
 Effort: M
 Dependencies: document_versions live
R7.2 Remove flag branches & config
Purpose: Make diff editor default.
 Steps: Delete EDITOR_DIFF_MODE checks/env; remove toggle UI.
 Acceptance criteria:
Editor always loads diff mode; no toggle present.
 Effort: S
 Dependencies: R7.1

Epic H — Edits API Always On (EDITS_API_ENABLED)
R8.1 Delete legacy “generate & overwrite” path
Purpose: Require propose→review→apply flow.
 Steps: Remove endpoints/UI that write raw text without EditOps.
 Acceptance criteria:
All AI edits come through /edits/propose + /edits/apply.
E2E edit cycle test passes.
 Effort: S
 Dependencies: diff editor live
R8.2 Remove flag branches & config
Purpose: Make edits API permanent.
 Steps: Delete EDITS_API_ENABLED checks/env.
 Acceptance criteria:
No references remain; unit tests green.
 Effort: S
 Dependencies: R8.1

Epic I — Citation Offsets Always (CITATION_OFFSET_MODE)
R9.1 Migrate/cleanup old block_citations
Purpose: Use offset anchors exclusively.
 Steps: Backfill doc_citations from block data; verify counts; delete write code to block_citations.
 Acceptance criteria:
100% of citations present in doc_citations; 0 new writes to old table.
 Effort: M
 Dependencies: doc_citations table live
R9.2 Remove flag branches & config
Purpose: Make offsets mandatory.
 Steps: Delete CITATION_OFFSET_MODE checks/env; remove old table in follow-up migration (or archive).
 Acceptance criteria:
No references remain; migration plan for table drop approved.
 Effort: S
 Dependencies: R9.1

Epic Z — Final Cleanup & Documentation
R10.1 Remove env keys from configs/secret stores
Purpose: Eliminate dead configuration.
 Steps: Delete keys from .env*, Vercel/Supabase/Secrets Manager; update config schema.
 Acceptance criteria:
Boot fails if old keys reintroduced; current deploys unaffected.
 Effort: S
 Dependencies: all flag removals done
R10.2 Delete parity dashboards & dual metrics
Purpose: Simplify observability.
 Steps: Remove old vs new panels; keep single-source metrics.
 Acceptance criteria:
Dashboards reflect only the new paths; alerts still fire correctly.
 Effort: S
 Dependencies: major removals (A–H) done
R10.3 Update ADRs & Architecture docs
Purpose: Lock in the final design.
 Steps: Remove “behind-flag” language; update diagrams; add “Flags retired” section.
 Acceptance criteria:
Docs merged; contributors can’t find references to removed flags.
 Effort: S
 Dependencies: all above

Kanban Ordering
Ready: R0.1, R0.2, R1.1, R3.1
 Next: R1.2, R3.2, R4.1, R5.1
 Then: R4.2, R5.2, R2.1, R2.2, R6.1, R6.2
 After: R7.1, R7.2, R8.1, R8.2, R9.1, R9.2
 Cleanup: R10.1, R10.2, R10.3

Notes
Each “Remove flag branches & config” task must include deleting the env var, removing it from the typed config, and passing the CI check from R0.2.
Where acceptance mentions parity/latency, validate in staging for 24h (or your agreed window) before shipping the removal PR.