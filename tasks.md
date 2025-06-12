Here’s a consolidated, “best‐of‐all” **GenPaper V3 Roadmap**—12 atomic, testable tasks grouped into four epics, each drawing on the strongest ideas from every proposal:

---

## 🧰 Epic 1: Prompt Library & Modular Pipeline

**TASK 1: Prompt Schema & Loader**

* **What:** Define a JSON schema (`promptSchema.json`) for all paper-type & section prompts; build a `loadPrompts()` util that reads, validates, and types them.
* **Why:** Guarantees consistent, maintainable prompt templates.
* **Done When:**

  * Schema validates sample “researchArticle” & “literatureReview.”
  * `loadPrompts()` returns typed templates or throws clear errors.
* **Effort:** S

**TASK 2: Section-Specific Prompt Templates**

* **What:** Implement real templates in code for each `paperType` + `sectionKey` (e.g. introduction, literatureReview, methodology), embedding explicit depth cues (“critique,” “compare,” “gaps,” “statistics”).
* **Why:** Drives critical analysis rather than shallow summarization.
* **Done When:**

  * Unit tests confirm each template contains its required depth keywords.
* **Effort:** S

**TASK 3: Outline Generation Module**

* **What:** Build `generateOutline(paperType, topic, sourceIds, config)` that uses the outline prompt to return a structured array of `{ sectionKey, title, candidatePaperIds[] }`.
* **Why:** Puts structure in users’ hands before any drafting.
* **Done When:**

  * Pipeline emits an outline stage with JSON‐parsable sections.
  * E2E mock verifies correct workflow.
* **Effort:** M

**TASK 4: Section Drafting Module**

* **What:** Build `generateSection(sectionKey, contextChunks, promptTemplate)` to call the AI SDK per section and return `{ content, citations[] }`.
* **Why:** Encapsulates section‐by‐section generation with its own focused RAG context.
* **Done When:**

  * Integration test with dummy chunks verifies extraction of inline citations.
* **Effort:** M

---

## 🔍 Epic 2: Smart RAG & Regional Boost

**TASK 5: Paper Ingestion → Region Tagging**

* **What:** Extend your ingestion RPC to detect (or stub) `metadata.region` from venue/affiliation.
* **Why:** Enables truly localized search & context for every user.
* **Done When:**

  * Unit test ensures sample venues like “Univ. Lagos” yield `region='Nigeria'`.
* **Effort:** S

### TASK-6: Boost Local Papers in enhancedSearch (universal)

**Purpose:**  
Reorder `enhancedSearch()` results so country-tagged papers matching the user’s `localRegion` appear first.

**Steps/Subtasks:**  
1. In your RAG pipeline, after fetching and filtering papers, read each paper’s `metadata.region`.  
2. Partition the result array into those where `region === localRegion` and the rest.  
3. Concatenate back together: `[localPapers…, otherPapers…]`.  
4. Add a unit test: mock three papers with regions `['Brazil','USA','Brazil']`, call with `localRegion='Brazil'`, and assert the two Brazil papers come first in output.

**Acceptance Criteria:**  
- Calling `enhancedSearch(topic, { localRegion: 'Japan' })` yields all `metadata.region === 'Japan'` entries at the front.  
- If no papers match that region, original order is unchanged.

**Effort:** S  
**Dependencies:** TASK-5 (global region detection)


---

## 🔄 Epic 3: Depth, Quality & QA

**TASK 7: Citation‐Density & Depth Checker**

* **What:** After each section draft, run `checkCitationDensity(content, minPerPara)` and regex‐scan for your depth cues (“compare,” “critique,” etc.). If either fails, emit a `review` progress event (and optionally auto-retry with a stronger prompt).
* **Why:** Guarantees both scholarly rigor (citations) and critical depth in every paragraph.
* **Done When:**

  * Unit test: sample text lacking citations or “compare” triggers a review event.
* **Effort:** M

* **Status:** ✅ **COMPLETED** - Citation density checker and depth cue scanner implemented with review event emission

**TASK 8: Few-Shot Examples & Final Polish**

* **What:** For high-stakes paper types (e.g. thesis/dissertation), prepend 1–2 gold-standard few-shot examples to the section prompt; then after all sections, run a “stitch & polish” prompt to ensure transitions & overall flow.
* **Why:** Leverages real exemplars to elevate style and coherence.
* **Done When:**

  * Prompt loader includes examples when `options.fewShot=true`.
  * Final polish pass merges sections into a fluid narrative.
* **Effort:** M

* **Status:** ✅ **COMPLETED** - Few-shot examples and final polish functionality implemented for high-stakes paper types with comprehensive testing

---

## 🎨 Epic 4: UI, Workflow & Testing

**TASK 9: Paper-Type Selector & Outline Review UI**

* **What:** In your `PaperGenerator` form add a “Paper Type” dropdown (Research Article, Lit Review, Thesis, etc.) and a step where users review/adjust the AI-generated outline before drafting.
* **Why:** Gives users structural control and tailors the backend pipeline accordingly.
* **Done When:**

  * UI dropdown passes `paperType` downstream; outline review step appears.
* **Effort:** S

**TASK 10: Section-Level Progress Bar & Controls**

* **What:** Extend your streaming hook and `<Progress>` UI to show distinct stages: “Outline → Introduction → Lit Review → … → Finalizing.” Allow “Regenerate Section” per block.
* **Why:** Improves transparency and user control.
* **Done When:**

  * Frontend displays labeled progress for each outline section.
  * “Regenerate” button triggers only that section.
* **Effort:** M

**TASK 11: Unit & Prompt-Library Tests**

* **What:** Write Jest tests covering: prompt‐schema validation, presence of depth cues, outline structure, section invocation stubbing, citation‐density checker.
* **Why:** Ensures regressions can’t silently break your core pipeline.
* **Done When:**

  * 100% coverage on `src/prompts` and core generation utilities.
* **Effort:** M

**TASK 12: E2E “Smoke” & Quality Gate**

* **What:** Create a Playwright (or Cypress) script to run `/generate`, select “Lit Review,” verify: outline appears, each section returns with ≥1 citation/para, final markdown contains all headings and a bibliography. Hook this into CI as a quality gate.
* **Why:** Catches integration issues and validates the full, multi-stage flow automatically.
* **Done When:**

  * CI pipeline runs E2E without errors and asserts structure & citation regex.
* **Effort:** L

---

### **Next Steps**

1. **Triage & Prioritize**: Move these 12 tasks into your backlog and rank by immediate user impact.
2. **Sprint 1**: Kick off with TASK-1 → TASK-4 to get your prompt library and modular pipeline wired.
3. **Sprints 2–3**: Layer in localization (TASK-5/6), depth checks (TASK-7), and UI enhancements (TASK-9/10).
4. **Sprint 4**: Harden with few-shot (TASK-8) and comprehensive tests (TASK-11/12).

By following this roadmap, you’ll transform GenPaper into a **flexible, multi-stage “Paper Factory”** that produces reviewer-ready literature reviews, research articles, theses, and beyond—grounded in local context, deep critical analysis, and rock-solid quality controls.
