Below is a **deep-dive code review**. I’ve organised it by layer so you can jump straight to what matters.

---

## 1. API Route `POST /fetchSources`

| 🔍 Problem                                                                                                       | 💡 Fix / Best practice                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Runtime mismatch** – route defaults to *edge* yet you call Node-only SDKs (`supabase-js` w/ fetch keep-alive). | Add at top: <br>`export const runtime = "nodejs"` (or move heavy logic to a server action). |
| No **schema validation** for body.                                                                               | Use `zod` ⇢ `const body = FetchSourcesSchema.parse(await req.json())`. Reject early.        |
| `console.log` of full `options` leaks PII.                                                                       | Log only keys; redact query.                                                                |
| **Cache key uses base64 of JSON** → can explode past 2-KB PK limit if options grow.                              | `md5(JSON.stringify({t:topic,o:options}))` (you already have a helper elsewhere – reuse).   |
| Supabase `papers_api_cache` select w/ `.gte('fetched_at', …)` relies on secondary index (none defined).          | Add `CREATE INDEX idx_cache_fetched_at ON papers_api_cache(fetched_at DESC);`.              |
| `cacheError` ignored-but-not-null could hide a 500.                                                              | If `cacheError && cacheError.code !== "PGRST116"` ➞ return 500.                             |
| Upsert into cache with full response: object may exceed Postgres row size.                                       | Store **paper IDs** + cursor into separate table; serve full list from `papers` table.      |
| **GET health check** calls every API each request.                                                               | Cache this health object for 5 min in `Edge KV` or `papers_api_cache`.                      |

---

## 2. Search services (OpenAlex / Crossref / …)

### Common issues

1. **Rate limits**
   *You already add “User-Agent”.* Also add `await sleep(100);` between bursts or you’ll get 429 when 3 users hit simultaneously.

2. **Back-off / Retry**
   Wrap `fetch` in `retry(fn, {retries:3, factor:2})` (exponential).

3. **Locale-dependent date parsing** (arXiv).
   Wrap with `new Date().toISOString().split('T')[0]` when building SQL.

### Specific bugs

| API              | Bug                                                                                                          | Patch                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Crossref         | `filter=has-full-text:true` removes many papers that *have DOI but gated*.                                   | Add as user option `openAccessOnly`.                          |
| Semantic Scholar | Your `&year=` param is wrong when *only* `toYear` present → becomes `&year=-YYYY` (API expects `year=YYYY`). | Use `yearStart`/`yearEnd` query params per docs.              |
| arXiv            | `sortBy=relevance` silently ignored; need `searchtype=all`.                                                  | Set: `&searchtype=all&sortBy=relevance&sortOrder=descending`. |

---

## 3. Ranking & Deduplication

### Scoring

* `BM25`: hard-coded `idf = log(1000/…)` – accuracy plummets on big lists.
  **Fix**: compute `N = total docs` once per query (`allPapers.length`) then `idf = log( (N – df + 0.5) / (df + 0.5) )`.

* `recencyScore` – negative years produce positives in BCE edge-case.
  Guard: `if (year < 1900) recency = 0`.

* `authorityWeight` T = 0.5 but you multiply by `0.5` again later – weight squared. Choose one.

### Deduplication

* Canonical ID collision: two unrelated titles that hash to same MD5 across year range.
  Add `source` to hash input.

* arXiv preprint vs journal DOI: treat as **siblings** – prefer DOI but keep arXiv in `metadata.preprint_id`.

---

## 4.  Database writes

| 🔥 Issue                                                                       | Mitigation                                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **N+1 author inserts** inside ingestion loop.                                  | Batch: `INSERT ... ON CONFLICT (name) DO NOTHING RETURNING id, name`. Use map to ordinal. |
| Upsert of `paper_authors` per author lacks unique constraint → duplicates.     | Add `PRIMARY KEY (paper_id, author_id)`.                                                  |
| `paperId` derivation: you sometimes use canonicalId but column type is `UUID`. | Decide: **all UUID v5** (deterministic) or use `TEXT` PK. Stay consistent.                |
| `impact_score` = `combinedScore` (unbounded). Add check constraint `>=0`.      |                                                                                           |

---

## 5.  Embeddings & Chunk insertion

* 
 
* Error handling for chunk insert: on fail you continue silently; but `papers` row exists w/o chunks → retrieval empty.
  – Insert into separate `failed_chunks` table for retry job.
  - You still embed chunk text > 8k tokens – OpenAI truncates; quality drops.
**Short answer: don’t rely on the `chunk.slice(0, 8000)` hard-cut any more—replace it with a *token-aware* guard that only fires when the chunk accidentally grows beyond the embedding model’s limit.**
If you keep your semantic chunks in the 400–1000-token range, that guard will almost never trip, and you avoid both wasted cost and quality loss.

---

## Why the 8 000-character hack is brittle

| Problem                  | Detail                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Characters ≠ tokens.** | In English 1 token ≈ 4 chars, but “æ”, emojis, CJK, RTL, or ligatures break that rule. 8 000 chars could be anywhere between 1 500 and 8 000 tokens. |
| **Uneven trimming.**     | `slice(0, 8000)` may cut sentences mid-word **after** you’ve already done careful sentence-based chunking.  Retrieval quality drops.                 |
| **Silent cost creep.**   | When you someday swap to an embedding model with a higher limit (e.g. 16 k tokens) you’ll still throw data away for no reason.                       |

---

## A safer pattern

```ts
import { encoding_for_model } from "@dqbd/tiktoken"   // tiny WASM tokenizer

const enc = encoding_for_model("text-embedding-3-small")
const MODEL_LIMIT = 8192          // tokens, not characters
const SOFT_LIMIT = 2000           // your target chunk size

function clampChunk(text: string) {
  const tokens = enc.encode(text)
  if (tokens.length <= SOFT_LIMIT) return text       // good size
  if (tokens.length > MODEL_LIMIT) {
    // Hard guard: prevent API error while preserving sentence boundaries
    const safe = enc.decode(tokens.slice(0, MODEL_LIMIT - 10))  // leave 10 tok margin
    return safe.replace(/[\s\S]+$/, s => s.split(/[.!?]\s/).shift() + " …")
  }
  // Chunk is > soft limit but < model limit.
  // Optional: split into two semantic chunks instead of truncating.
  return text
}
```

**Benefits**

* 🔒 Never exceeds the model’s true token limit.
* 🧠 Still keeps sentences intact.
* 🔄 One constant (`MODEL_LIMIT`) to update when you change models.

---

## Recommended workflow revisited

1. **Semantic chunker** ⟶ produce \~500-token overlaps (no slice needed).
2. **`clampChunk()`** guard ⟶ *only* activates if a PDF page or weird table sneaks in.
3. **Embedding call** with whatever dimension you choose (384 / 768 / 1536).

With this setup you can migrate to larger-context models later—**the chunk size you *retrieve* stays small for precision**, while your *generation prompt* can still spool multiple chunks into a 128 k context window.

---

### TL;DR

* Keep semantic chunks small (≈500 tokens).
* Replace `slice(0, 8000)` with a token-aware guard that checks the **model’s max tokens**, not characters.
* Update one constant if you ever switch embedding models—no more hidden truncation.

---

## 6.  Caching / Rate limiting utilities

* **In-memory rateLimitStore** – resets on every Vercel edge cold-start → ineffective.
  – Move to `Supabase KV` (beta) or Redis.
* `setCachedResponse` stores full JSON; some APIs return > 8 MB (Crossref rows=50). Postgres toast OK, but better to **compress**: `response: pako.deflate(JSON.stringify(data), {to:'string'})`, store `is_gzip=true`.
* `initializeCache` – custom RPC to create table, but you ship raw `createCacheTableSQL` elsewhere. Choose migrations only.

---

## 7.  Type safety & DRY

* You defined `AcademicPaper` interface thrice in different files. Export a single source of truth from `@/types/academic`.
* Many identical helper functions (`deInvertAbstract`, `createCanonicalId`) duplicated across Node & Deno. Factor into `shared/` and import via npm workspace / URL.

---

## 8.  Logging & Observability

* Switch from `console` to **pino** (`pinoHttp` in Next.js route / Deno serve) → JSON logs.
* Tag logs with `request_id` (trace header) so ingestion + embeddings can be traced across functions.

---

## 9.  Security / Compliance

* Cross-origin “\*\*” on **serve** edge function leaks PDF URLs to any site. Tighten with env `ALLOWED_ORIGINS` list.
* No API key check on public `/fetchSources` – someone can DDOS your quota. Require Supabase auth or at least `x-api-key`.

---

## 10. Suggested folder refactor

```
lib/
  api/
    academic/
      openalex.ts
      crossref.ts
      …
    indexing/
      rank.ts
      dedupe.ts
  db/
    ingest.ts
    search.ts
  utils/
    canonical-id.ts
    text.ts
app/
  api/fetch-sources/route.ts
  api/health/route.ts
edge/
  fetch-sources.ts  (Deno, bundle separately)
```

Keep **zero Node deps** in the Deno edge bundle; everything else in Node runtime.

---

## 11.  Quick wins (≤ 30 min)

1. `ALTER TABLE paper_chunks ALTER COLUMN embedding TYPE vector(384)` plus recreate index – aligns dims.
2. Add `zod` validation to `FetchSourcesRequest`.
3. Replace inner author loop with batch insert.
4. Cache key: `const cacheKey = md5(topic + JSON.stringify({maxResults,fromYear,toYear}))`.

---

### Final thoughts

You have a solid, feature-rich pipeline; most problems are **scalability foot-guns** (batching, cache size, per-author loops) and **edge-runtime mismatches**. Fix those, and you’ll have a reliable RAG ingestion layer ready for heavy student traffic.

Happy refactoring! Ping me if you want sample SQL for the new indexes or a pino logger setup.
