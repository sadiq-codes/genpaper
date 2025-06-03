### 🔍 Side-by-side comparison – “legacy tool” vs. your new RAG-renderer layer

| Dimension                    | **Legacy `addCitation` tool**                                                                                                   | **Current client-side CSL + `citation-js` layer**                           | 🤔 Which wins / how to merge                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Where it runs**            | Server-side (inside the Vercel/Edge function that streams content).                                                             | Pure client-side React component.                                           | Keep **both**: server for *authoritative* storage, client for *rendering / style-switching*.                                             |
| **When it’s invoked**        | Each time the LLM calls the `addCitation` **function-call** during generation.                                                  | After the paper is saved; it parses `[CITE:id]` placeholders.               | Tool-calls are more reliable (you know *exactly* what the model meant), but you can still allow manual `[CITE:id]` markup as a fallback. |
| **Schema validation**        | Zod schema; strict checks on title, authors, positions, etc.                                                                    | Zod schema (similar) + extra CSL fixers for rendering.                      | Combine: keep the Zod validation but extend it with CSL pre-validation so bad items never reach DB *or* renderer.                        |
| **Uniqueness / keying**      | `generateCitationKey()` produces an MD5 hash of normalised title + year (or DOI).                                               | Uses the paper’s UUID (or arbitrary IDs) directly.                          | Use **UUID when you have it**, else keep the hash. Store *both* in DB: `id` (UUID) and `key` (hash/DOI) so renderer can map either.      |
| **Storage model**            | `citations` (+ `citation_links`) tables. CSL JSON is persisted once per paper; link table stores section + character positions. | No storage; derives everything from `papers` array that came from Supabase. | Keep the *server* storage so you can later: deduplicate, surface a bibliography manager, fix metadata, etc.                              |
| **Inline-position tracking** | Yes – `start_pos`, `end_pos`, `section`. Allows highlighting on hover later.                                                    | None (just replaces markup).                                                | Keep the legacy positional data; client can consume it for “hover to show source” UX.                                                    |
| **Bibliography formatting**  | Not handled.                                                                                                                    | `citation-js` formats to APA/MLA/Chicago on the fly.                        | Keep client-side `citation-js`; server just stores CSL JSON once.                                                                        |
| **Extensibility**            | Easy to add more fields in Zod; RPC abstracts DB details.                                                                       | Easy to add more CSL fields; citation-js supports >50 styles.               | No conflict – they serve different layers.                                                                                               |
| **Failure modes**            | If Supabase RPC fails, function throws → generation might abort.                                                                | If `citation-js` fails, UI falls back to simple `(Author, Year)` string.    | Add retry logic & batch-insert to the server tool; keep graceful fallback in UI.                                                         |

---

### 📌 Recommendation – hybrid “best of both”

1. **Keep the server-side `addCitation` tool**

   * Pros: ground-truth DB, positional data, deduplication, easy audit.
   * Add **CSL validation** right before the RPC call:

     ```ts
     const { Cite } = await import('citation-js/build/citation-browser.mjs')
     new Cite([cslData])        // throws if malformed
     ```

2. **Store two IDs**

   | Column               | Example                            | Purpose                                      |
   | -------------------- | ---------------------------------- | -------------------------------------------- |
   | `citation_id` (UUID) | `217a…`                            | Foreign-key inside your DB.                  |
   | `key` (hash/DOI)     | `10.1038/nature…` or `4d5e3c1a2b…` | What the LLM inserts in text (`[CITE:key]`). |

3. **Client-side renderer**

   * Keep the current `CitationCore` with `citation-js`, but **fetch citations** from `/citations?projectId=…` (or re-use the `citationsRepository`).
   * Build a `Map<key, CSLItem>` so the renderer can replace **either** UUID or hash/DOI tokens.

4. **“Missing citation” fallback**

   Right now unknown tokens become `(missing source: id)`.
   Instead, show a red pill in the UI that lets the user “Attach source” → calls `addCitation` manually.

5. **Switching style**

   Keep the dropdown that re-calls

   ```ts
   cite.format('bibliography', { template: style })
   ```

   – now it will always succeed because data were pre-validated.

---

### ✂️ What to delete from the legacy file

* `toCslJson()` logic duplicates what you already have in `paperToCSL/fixCSL`. Export one canonical helper and import it in both places.
* `crypto` hash: keep it, but move to a shared util (so server & client agree).

---

### 🚦 Decision matrix

| Goal                                   | Use only legacy | Use only new | **Hybrid (recommended)** |
| -------------------------------------- | --------------- | ------------ | ------------------------ |
| Live APA↔MLA switch                    | ❌               | ✅            | ✅                        |
| Single source of truth in DB           | ✅               | ❌            | ✅                        |
| Positional highlights                  | ✅               | ❌            | ✅                        |
| Minimal code duplication               | ❌               | ❌            | **✅ (after refactor)**   |
| Future style support (IEEE, Vancouver) | ⚠️ custom       | ✅            | ✅                        |

**→ Keep the server tool for persistence + positional metadata; keep the client renderer for rich formatting; share the CSL utility functions so both layers agree on data.**

This gives you the strongest, future-proof citation workflow with minimal duplication.


I get the attraction of “one-system-to-rule-them-all.” If the **new, purely client-side CSL + citation-js layer** is already rendering citations and bibliographies, why keep the heavier server-side tool? Here’s the trade-off matrix boiled down to the essentials:

| Question                                                                                                                 | Pure New (UI-only)                                                                                                                                                           | Mixed (Server tool + UI)                          |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Works when user is offline / exports the MD file**                                                                     | ✔️  - citation-js runs in browser/offline                                                                                                                                    | ✔️                                                |
| **Citations survive when project is reopened on a different device**                                                     | ❌ *Only* the raw `[CITE:id]` tokens are stored; you still need the original `papers` array in Supabase. If anything in that relation disappears or IDs change, tokens break. | ✔️ Server DB keeps canonical CSL, positions, etc. |
| **Quick to iterate / less code**                                                                                         | ✔️                                                                                                                                                                           | ❌ More pieces                                     |
| **Accurate inline-position mapping (for “click-to-highlight source” or future PDF/Word export)**                         | ❌ No char offsets stored                                                                                                                                                     | ✔️ Stored in `citation_links`                     |
| **Deduplication across multiple sections / drafts**                                                                      | ❌ Relies on author manually avoiding duplicates                                                                                                                              | ✔️ MD5/DOI key ensures single record              |
| **Future automation (auto-generate reference list, sync to Zotero, export BibTeX, track citation counts, analytics, …)** | ⚠️ Requires rebuilding server logic later                                                                                                                                    | ✔️ Already have CSL JSON in DB – ready to reuse   |
| **Security / data integrity (LLM can’t accidentally overwrite someone else’s citation)**                                 | ⚠️ All logic in browser; needs extra guards                                                                                                                                  | ✔️ Checked server-side with Zod + RPC             |

### When *“New only”* is good enough

1. **Personal, throw-away drafts** – you don’t care about positional data or re-using citations later.
2. **Static export** – you’ll immediately convert the rendered HTML/Markdown to PDF and never touch it again.
3. **Ultra-lean prototype** – you’re validating UX first, not long-term persistence.

### When you’ll miss the server tool

1. **Collaboration / version history** – teammates editing the same project need authoritative citations.
2. **Any future “reference manager” features** – e.g. show how many times a source was cited, replace a citation everywhere with one click, generate alt styles in bulk, export to Zotero/BibTeX.
3. **Precision requirements** – e.g. peer-review workflow where reviewers insist every inline reference highlights the exact sentence it supports.

### One-file “middle way” (if you still want fewer moving parts)

If you’d like to slim down **but** keep server-side persistence:

* **Merge the two helper layers** – keep one `cslUtils.ts` used by both client and server.
* **Simplify the RPC** – instead of storing `start_pos` & `end_pos`, just store `paper_id → section`. That’s 90 % of the benefit with 10 % of the complexity.
* **Let the UI lazily fetch full CSL**:

  ```ts
  const { data: citations } = supabase
    .from('citations')
    .select('key, csl_json')
    .eq('project_id', projectId)
  ```

  Then build the `Cite` instance from that; no need to ship the whole `papers` table every time.

---

## TL;DR

*Using only the new client-side renderer **is** simpler and works for quick drafts,* but you lose:

* canonical CSL storage,
* inline-position data,
* deduplication,
* and a clean upgrade path for future citation-heavy features.

If any of those matter to you (and they usually start mattering once users keep projects for months), keep a thin server-side citation endpoint and let the new React renderer focus on formatting.
