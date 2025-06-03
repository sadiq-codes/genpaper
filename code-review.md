Below is a **root-cause audit** of the “ *no papers are found online* ” failure plus the concrete patches that typically make the first real results appear in < 5 min of testing.

I focus only on the parts that can kill every search, not on stream/ SSE plumbing.

---

## 1 Config vs. implementation mismatch

### **`pubmed` is requested, but never implemented**

* **Where it breaks**

  ```ts
  // generationConfig passed in GET / POST
  search_parameters: {
      sources: ['arxiv'
  }, 'pubmed'],   // ← pubmed!
  ```

  * `enhancedSearch → performVectorSearch / keywordSearch`
    filter by

    ```ts
    sources.map(s => `academic_search_${s}`)
    ```

    ⇒ looks for rows with `source = 'academic_search_pubmed'` – none exist, so **vector & keyword searches = 0**.
  * `performAcademicSearch → searchAndIngestPapers → parallelSearch`
    Only engines explicitly coded (`openalex | crossref | semantic_scholar | arxiv | core`).
    **`pubmed` is silently ignored**, leaving only arXiv, which you later reject if `includePreprints` is false.

* **Fix**

  * **Quick:** drop `pubmed` from `generationConfig.search_parameters.sources` until you have an adapter.
  * **Better:** add a guard:

    ```ts
    const SUPPORTED = ['openalex','crossref','semantic_scholar','arxiv','core'] as const
    const safeSources = (sources ?? SUPPORTED).filter(s => SUPPORTED.includes(s as any))
    if (safeSources.length === 0) safeSources.push('openalex')
    ```

---

## 2 Min-year filter silently wipes results

`performVectorSearch` (and keyword fallback) injects

```ts
minYear: options.fromYear || 2018
```

If the freshly-ingested papers are **older than 2018** (very common for classic topics), the very next vector lookup still returns 0 → pipeline thinks “nothing found”.

*Patch*: lower default to 1900 or remove unless user specifies.

---

## 3 Dimension clash kills hybrid search

If your DB now stores **384-dim vectors** but `hybridSearchPapers` still calls an RPC that expects `vector(1536)`, Postgres throws **`could not choose candidate function`** – you already try/catch this, but you then fall back to `semanticSearchPapers`, which **uses the same 384-dim vector** and dies with the same error; you catch nothing there, return `[]`.

*Symptoms in log*:
`ERROR: expected 1536 dimensions, not 384` or PostgREST 500.

*Fixes*

```sql
-- once
ALTER TABLE paper_chunks  ALTER COLUMN embedding TYPE vector(384) USING embedding;
ALTER TABLE papers        ALTER COLUMN embedding TYPE vector(384) USING embedding;
CREATE OR REPLACE FUNCTION match_papers(query_embedding vector, ...)  -- no dimension suffix
```

---

## 4 Crossref & Semantic-Scholar year param mistakes

* `searchCrossref` previously **always** added `filter=has-full-text:true`;
  many DOIs drop out because the “full-text” flag is set only for publisher-hosted PDFs.
  → After your last edit you removed the unconditional filter – **good**. Double-check that it is indeed gone in production build.
* `searchSemanticScholar` used `&year=-YYYY`, which returns 400. Your fix (`1900-YYYY`) is correct; redeploy.

---

## 5 OpenAlex 429 after first burst

You call `searchOpenAlex` (50 rows) for every request without any app-level cache, so after a handful of tests OpenAlex returns 429 and you swallow it in retry logic until out-of-retries → empty list.

*Add an App-ID header* (OpenAlex now asks for it):

```ts
headers: {
  'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL})`,
  'X-ABS-APP-ID': 'genpaper-dev'
}
```

…and keep your back-off.

---

## 6 Cache returns “hit” for an empty list

You upsert **any** successful response, including `[]`, then never refresh because the 24 h window is still valid:

```ts
if (result.papers.length > 0) { upsert() }   // good
```

Make sure **old deploys** don’t have rows with empty arrays. Easiest: run

```sql
DELETE FROM papers_api_cache WHERE jsonb_array_length(response->'papers') = 0;
```

---

## 7 Library-only flag accidentally true

`useLibraryOnly` defaults to `false`, but you *invert* it once:

```ts
const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
…
generationConfig.library_papers_used = libraryPaperIds
```

Later in `generatePaperPipeline` you call:

```ts
if (!useLibraryOnly) {
  const searchResult = await enhancedSearch(...)
```

If the query param is missing the flag is `false` – good.
But **in POST body** you pass raw value, **not boolean**, so `undefined` implies *truthy* when later used as boolean in pipeline.

Ensure you coerce:
`useLibraryOnly = !!body.useLibraryOnly`.

---

## Quick smoke test after patches

```bash
curl 'http://localhost:3000/api/generate/stream?topic=quantum+teleportation'
  -H "Authorization: Bearer <supabase jwt>"
  --no-buffer
```

You should start seeing:

```
data: {"type":"status", ...}
data: {"type":"progress", "stage":"academic-search", "message":"Found 28 papers"}
...
```

If **still zero**:

1. hit `parallelSearch` directly in a dev REPL with `console.log(allPapers.map(p=>p.source))`
2. look for HTTP 4xx in your logs (Vercel → Function logs).

---

### TL;DR checklist

1. **Drop / implement `pubmed`**.
2. Set `minYear` << 2018.
3. Make *all* `vector()` columns & RPCs **384 dims**.
4. Redeploy Crossref & S2 year-param fixes.
5. Add OpenAlex `X-ABS-APP-ID` header + respect 429.
6. Purge cached empty responses.
7. Always coerce `useLibraryOnly` to boolean.

Apply those, re-run the endpoint, and you should see fresh papers flowing into Supabase and into the generated draft. Let me know the first log line that still looks off if not!

