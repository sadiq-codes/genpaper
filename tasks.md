Below is a focused **code-quality & architecture review** of the files you shared.
I’ve organised feedback by layer so you can jump straight to what matters.

---

## 1. Data-model & DB layer (Supabase / PostgreSQL)

| Area                       | What’s good                                                                                                                                                                                                | What to improve                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hybrid citation schema** | • Clear split between `project_citations` (paper-UUID based) and `citations` + `citation_links` (tool-added).<br>• Positional info (`start_pos`, `end_pos`, `section`) is great for future inline-editing. | • **Missing FK on `citation_links.citation_id` → `citations.id`** – add to prevent orphan links.<br>• `citations.key` is **unique** in the fn `upsert_citation`, but you don’t enforce it at DB level. Create a **UNIQUE index** on `(project_id, key)` and make the RPC a trivial `INSERT … ON CONFLICT`. |
| **Denormalisation**        | • Storing CSL-JSON directly keeps flexibility.                                                                                                                                                             | • You re-store `authors` in three places (paper row, CSL-JSON, `paper_authors`). Pick one canonical source and derive the rest in views.                                                                                                                                                                   |

---

## 2. Supabase helpers (`lib/db/research.ts`, `lib/db/papers.ts`, …)

### ✅ Strengths

* Consistent naming (`addProjectVersion`, `getProjectVersions`).
* Good use of *edge-caching*: `limit(...)` and `range(...)` to bound result sets.
* Error information is preserved (`error.code`, `.details`).

### ⚠️ Issues & suggestions

1. **Duplicate files**
   You posted *two copies* of `lib/db/research.ts` (one older, one newer). Keep one source of truth or you’ll import the wrong one.

2. **Client creation cost**
   You call `await createClient()` inside *every* db helper. That spins up a new Supabase client on each call inside the same request (≈ two extra network handshakes).
   **Fix**: build a tiny singleton wrapper:

   ```ts
   let _sb: SupabaseClient | null = null;
   export const getSB = () => (_sb ??= createClient());
   ```

3. **Parallel inserts vs. for-loop**
   In `generateDraftWithRAG` you use `Promise.all` for `addProjectCitation`.

   > *Is it better than the for-loop with try/catch?*
   > Yes – the loop serialises I/O for no benefit. Keep `Promise.all`, but protect it:

   ```ts
   await Promise.all(
     validCitations.map(c => addProjectCitation(...).catch(e => ({err:e, c})))
   )
   ```

   so one bad row doesn’t abort the whole batch.

4. **N+1 queries**
   `getUserResearchProjects` fetches each project’s latest version with a loop. Use a **`DISTINCT ON`** query or a materialised view – you’re adding 20 extra round-trips per page.

---

## 3. Citation tool (`addCitation.ts`)

| 👍 Good                                                                      | ⚠️ Risks / fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| • Zod validation catches bad input early. <br>• Generates CSL automatically. | • **`crypto.subtle.digest`** is browser-only. In Node (Edge runtime) this call fails silently in older versions. Import `node:crypto` when `globalThis.crypto.subtle` is undefined. <br>• Citation keys are truncated to 12 chars. Collisions grow quickly – consider 16-char or **`base64url(sha1)`** (11 chars for 5 bytes) for similar length but lower collision rate. <br>• RPC `upsert_citation` returns `any`; define `returns jsonb` in SQL so TypeScript infers correctly. |

---

## 4. Generation pipeline (`generateDraftWithRAG`)

### positives

* Clear progress callbacks (`onProgress`) – good UX for SSE.
* **Domain stop-word filtering** – avoids off-topic retrieval.
* Automatic chunk ingestion when missing – reduces cold-start friction.

### bottlenecks & bugs

1. **Search path ignores `useLibraryOnly` in the *first* call**
   You compute `remainingSlots` before checking `useLibraryOnly`. When users tick “library only”, `hybridSearchPapers` is still hit if there are *zero* pinned papers. Guard at the top:

   ```ts
   if (useLibraryOnly) discoveredPapers = [];
   else { … }
   ```

2. **Chunk explosion**
   `match_paper_chunks` limit is `Math.max(50, getChunkLimit())`. For `long` papers that’s 80 chunks → GPT-4 will truncate context. Scale by *token budget* instead: `Math.min(20, Math.floor(8192 / avgTokPerChunk))`.

3. **Citation ratio check**
   You force a retry if `citations.length < minCitations`, but you **don’t loop / retry** – the error bubbles up. Either wrap with an exponential back-off loop or downgrade to a warning.

4. **Tool call registration**
   You expose `addCitation` in `tools` but **never read its returns**. When the model emits a tool-call you aren’t persisting that citation. Capture `stream.fullStream` events of type `tool-call`, validate via Zod, and write to DB.

---

## 5. Rendering layer (`CitationCore`, `CitationRenderer`)

#### Good

* Lazy-loading `citation-js` keeps bundle smaller.
* Fallback citation formatting (author-year) when the lib fails.

#### Problems / security

* `dangerouslySetInnerHTML` prints Markdown HTML w/o sanitising. Users could inject `<script>`. Add **DOMPurify** or `sanitize-html` before injection.
* **Citation regex** matches `[CITE: xyz]` inside code fences & URLs. Pre-scan tokens in `markdown-it` instead.
* Global mutable `citeCache` leaks memo between React roots (fast-refresh). Use a `Map<string, Cite>` keyed by hash.

---

## 6. Front-end UX (PaperViewer)

* Nice inline copy/share actions.
* Count of *unique* cited papers uses a regex on raw Markdown. That over-counts when citations repeat. Use the `citations` table instead – you already fetch it.

---

## 7. Testing & CI

You asked earlier about test infra – current code has **zero automated tests**. Minimum set:

| Layer                     | Tool                                | What to test                                             |
| ------------------------- | ----------------------------------- | -------------------------------------------------------- |
| **DB RPCs & constraints** | `pg-tap` in Supabase                | `upsert_citation` dedupe, FK integrity                   |
| **Server utils**          | `vitest` + `@testing-library/react` | `paperToCSL`, `filterOnTopicPapers`, citation extraction |
| **End-to-end**            | `Playwright`                        | Generate paper → verify citations render & change style  |

A small **GitHub Actions** matrix (`vitest`, `supabase start`) prevents regressions.

---

## 8. Miscellaneous

* Remove deprecated `punycode` import (comes from `citation-js` v0.5). Upgrade to ≥ v0.6 or alias with `npm alias` to silence the warning.
* Consider **Edge runtime** limits: `crypto.subtle` + 90 seconds CPU. Heavy vector filtering might exceed.

---

# TL;DR — Priority Fix List 🚀

1. **Enforce DB constraints & indexes** on citation keys and FK links.
2. **Sanitise HTML** before injecting paper content.
3. Capture & persist **`addCitation` tool-calls** in the stream loop.
4. Respect `useLibraryOnly` in the very first retrieval pass.
5. Replace per-function `createClient()` with a cached client.
6. Add automated tests (start with CSL utils & citation extraction).

Tackle those and your hybrid citation workflow will be robust, secure, and future-proof. Happy hacking!
