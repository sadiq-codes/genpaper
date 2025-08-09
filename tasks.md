# tasks.md
VERY IMPORTANT: The user prefers that the assistant not create new files unnecessarily, instead update existing ones or merge files when necessary and delete files that are no longer needed or duplicate, to avoid redundancy and complexity.


# tasks.md

Atomic, testable micro-tasks to implement the review’s recommendations (unify citations, centralize search, introduce a service layer, and make PromptBuilder pure). Ordered for safe rollout; each task has clear value, boundaries, and tests.

---

## Epic A — Feature Flags & Guardrails

1. **Add architecture feature flags**

* **Purpose:** Gate risky changes.
* **Steps:** Add `CITATIONS_UNIFIED`, `SEARCH_ORCH_ONLY`, `SERVICE_LAYER_ONLY`, `PROJECT_SERVICE_API`.
* **Acceptance:**

  * Flags load from typed config (server & client when needed).
  * Unit test toggles a dummy code path.
* **Effort:** S
* **Deps:** —

2. **Enforce module boundaries (ESLint + dep-cruiser)**

* **Purpose:** Prevent direct DB access from UI/tools.
* **Steps:** Rules: apps can import `@services/*` only; no `db/*` outside services.
* **Acceptance:**

  * Violations fail CI on sample forbidden import.
* **Effort:** S
* **Deps:** 1

---

## Epic B — Unified Citation Service (single write path)

3. **Scaffold `@services/citations`**

* **Purpose:** Single citation entry point.
* **Steps:** Export typed stubs: `add`, `suggest`, `renderInline`, `renderBibliography`, `resolveSourceRef`.
* **Acceptance:**

  * Package builds; functions exist with TODOs and tests pass.
* **Effort:** S
* **Deps:** 1

4. **Implement `resolveSourceRef` (DOI/title→paper)**

* **Purpose:** One resolver for UI & AI.
* **Steps:** Normalize DOI; fallback title+year fuzzy match; prefer user library on tie.
* **Acceptance:**

  * Given DOI variants → same `paper_id`.
  * Title±punctuation within Levenshtein≤2 matches in tests.
* **Effort:** M
* **Deps:** 3

5. **Implement `citations.add` (idempotent UPSERT)**

* **Purpose:** Stop duplicate project citations.
* **Steps:** UPSERT on `(project_id, paper_id)`; generate stable `citeKey`; set `first_seen_order`.
* **Acceptance:**

  * 10 parallel adds ⇒ 1 row, 9 “existing” responses (test).
* **Effort:** M
* **Deps:** 4

6. **Normalize CSL JSON**

* **Purpose:** Consistent formatting downstream.
* **Steps:** Zod schema; normalize authors, issued date, container-title; ensure DOI/URL.
* **Acceptance:**

  * Invalid CSL rejected; golden output stable across runs.
* **Effort:** M
* **Deps:** 3

7. **Implement `renderInline` & `renderBibliography`**

* **Purpose:** One renderer for all styles.
* **Steps:** Style plug-ins (APA/MLA/Chicago); numeric uses computed order.
* **Acceptance:**

  * Snapshot tests pass per style.
* **Effort:** S
* **Deps:** 5, 6

8. **Refactor CitationsAPI to call service**

* **Purpose:** Make manual path use same logic.
* **Steps:** Replace DB calls in `/api/citations/*` with service calls; guard by `CITATIONS_UNIFIED`.
* **Acceptance:**

  * Existing UI adds/reads citations unchanged with flag ON.
* **Effort:** M
* **Deps:** 5–7

9. **Make AI `addCitation` tool call CitationsAPI**

* **Purpose:** Remove second write path.
* **Steps:** Tool posts to `/api/citations/add`; remove direct DB import.
* **Acceptance:**

  * Contract test: UI vs AI produce identical `citeKey` for same paper.
* **Effort:** S
* **Deps:** 8

---

## Epic C — Search Centralization (SearchOrch only)

10. **Extract `@services/search-orchestrator`**

* **Purpose:** Single hub for Library/Hybrid/Academic.
* **Steps:** API: `search({query, projectId})` returning unified results + provenance.
* **Acceptance:**

  * Library & API searches callable via one function in tests.
* **Effort:** M
* **Deps:** 1

11. **Refactor SearchAPI to use orchestrator**

* **Purpose:** Thin API; no duplicate logic.
* **Steps:** Replace internals with orchestrator call.
* **Acceptance:**

  * Output parity ±5% ordering; latency within ±10% baseline.
* **Effort:** S
* **Deps:** 10

12. **Refactor LibraryAPI to call orchestrator**

* **Purpose:** Remove parallel search code.
* **Steps:** Route library queries through orchestrator; enable `SEARCH_ORCH_ONLY`.
* **Acceptance:**

  * Grep shows no LibraryAPI direct DB search.
* **Effort:** S
* **Deps:** 10

13. **Introduce per-request retrieval cache**

* **Purpose:** Avoid duplicate hits in same request.
* **Steps:** In-memory cache keyed by normalized query+projectId.
* **Acceptance:**

  * > 90% hit rate in repeated-call unit test.
* **Effort:** S
* **Deps:** 10

---

## Epic D — Service Layer for DB Access

14. **Create `@services/db` repositories**

* **Purpose:** Single DB gateway.
* **Steps:** Repos: `PapersRepo`, `ProjectsRepo`, `CitationsRepo`, `AuthorsRepo`, `ChunksRepo`.
* **Acceptance:**

  * Services import repos; apps/tools don’t import DB client (lint rule passes).
* **Effort:** M
* **Deps:** 2

15. **Migrate AI tools off direct DB**

* **Purpose:** Respect service boundaries.
* **Steps:** Replace DB imports in tools with repos/services.
* **Acceptance:**

  * Lint: no forbidden imports; tests green.
* **Effort:** S
* **Deps:** 14

---

## Epic E — PromptBuilder Purification

16. **Extract `@core/prompt-builder` (pure)**

* **Purpose:** Reuse without side effects.
* **Steps:** Move templates; remove any I/O; accept context as arg.
* **Acceptance:**

  * No network/DB imports; snapshots pass.
* **Effort:** S
* **Deps:** —

17. **Wire PromptBuilder to SearchOrch via Context service**

* **Purpose:** Remove duplicate retrieval logic.
* **Steps:** New `ContextRetrieval` wrapper that calls orchestrator; PromptBuilder receives its output (DI).
* **Acceptance:**

  * Prompts unchanged on same inputs (snapshot).
* **Effort:** S
* **Deps:** 10, 16

---

## Epic F — Project Service API (aggregated endpoint)

18. **Add `/api/project/:id/write` (SSE)**

* **Purpose:** One endpoint for writing + citations stream.
* **Steps:** Compose PromptBuilder + AI stream + Citations service; emit SSE with text & inline renders.
* **Acceptance:**

  * End-to-end stream works; editor displays text + citations without extra calls.
* **Effort:** M
* **Deps:** 7, 17

19. **Route editor to Project Service API**

* **Purpose:** Simplify frontend wiring.
* **Steps:** Replace direct GenerateAPI/CitationsAPI calls during writing with single endpoint behind `PROJECT_SERVICE_API`.
* **Acceptance:**

  * Network shows one SSE; output matches old flow in manual test.
* **Effort:** S
* **Deps:** 18

---

## Epic G — Data Flow Corrections

20. **Ensure UnifiedGen uses Chunks via orchestrator**

* **Purpose:** Make implicit dependency explicit.
* **Steps:** Retrieval requests include chunk IDs/scores; use `ChunksRepo`.
* **Acceptance:**

  * Generator unit test asserts chunk usage in context payload.
* **Effort:** S
* **Deps:** 10, 14

21. **Expose Authors to citation formatting**

* **Purpose:** Accurate inline/bibliography rendering.
* **Steps:** `AuthorsRepo` join in Citations service; enrich CSL authors.
* **Acceptance:**

  * Inline `(Author, Year)` correct for multi-author cases (tests).
* **Effort:** S
* **Deps:** 6, 14

---

## Epic H — Auth Consolidation

22. **Make SupabaseAuth the sole auth source**

* **Purpose:** Avoid double maintenance.
* **Steps:** Remove direct writes to `users`; use auth webhooks/functions to mirror metadata.
* **Acceptance:**

  * Creating/updating a user flows through Supabase; no direct `users` mutations found via grep.
* **Effort:** M
* **Deps:** 1

23. **Harden API auth helper**

* **Purpose:** Consistent protection.
* **Steps:** Single server helper to validate user/session; apply in Search, Citations, Project Service routes.
* **Acceptance:**

  * Unauthed calls 401; authed paths green (Supertest).
* **Effort:** S
* **Deps:** 22

---

## Epic I — Observability & Tests

24. **Add structured logs & timings**

* **Purpose:** See where time goes.
* **Steps:** Log spans: `resolver`, `renderInline`, `search`, `writeSSE`; include requestId/projectId.
* **Acceptance:**

  * Logs show p95 per span in local run.
* **Effort:** S
* **Deps:** 8, 11, 18

25. **Contract test: UI vs AI citation parity**

* **Purpose:** Prevent drift forever.
* **Steps:** Add same paper via UI and AI; compare `citeKey` & CSL.
* **Acceptance:**

  * Test passes with `CITATIONS_UNIFIED=on`.
* **Effort:** S
* **Deps:** 9

26. **End-to-end write flow test (SSE)**

* **Purpose:** Validate aggregated endpoint.
* **Steps:** Simulate prompt → receive stream → verify citations rendered inline.
* **Acceptance:**

  * Single SSE stream; no per-citation API calls; text & citations appear in order.
* **Effort:** M
* **Deps:** 18, 19

---

## Epic J — Cleanup & Docs

27. **Remove legacy search paths**

* **Purpose:** Eliminate duplication.
* **Steps:** Delete LibraryAPI direct queries; mark deprecated modules removed.
* **Acceptance:**

  * CI/lint sees no references; tests pass.
* **Effort:** S
* **Deps:** 12

28. **Remove direct DB writes from tools**

* **Purpose:** Enforce service layer.
* **Steps:** Delete leftover imports; replace with services.
* **Acceptance:**

  * Boundary lints clean; grep shows no `db.*` in tools.
* **Effort:** S
* **Deps:** 15

29. **Author ADRs & Architecture.md update**

* **Purpose:** Keep team & LLMs aligned.
* **Steps:** ADRs: “Unified Citation Service”, “SearchOrchestrator”, “Project Service API”; update diagrams.
* **Acceptance:**

  * Docs merged; links in README; contributors can implement a new citation style from docs alone.
* **Effort:** S
* **Deps:** 7, 11, 18

---

### Kanban Snapshot

* **Ready:** 1, 2, 3, 10, 16
* **Next:** 4–7, 11–12, 14
* **Then:** 8–9, 13, 17–19, 20–21
* **Hardening:** 22–26
* **Cleanup:** 27–29

> Executing this sequence unifies citations, makes search single-sourced, introduces a clean service layer, and simplifies the frontend to one Project Service stream—removing the duplication and drift highlighted in your review.
