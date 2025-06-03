Below is a **battle-tested playbook** for finding high-quality papers programmatically and piping them into your Supabase-based RAG loop. I group it into: (1) where to search, (2) how to query & deduplicate, and (3) how to slot the results into your existing ingestion code.

---

## 1 Public scholarly APIs worth wiring up

| API                     | Coverage / strengths                                           | Free limits & auth                                                                                          | Best filters                                                                                          |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **OpenAlex `/works`**   | >240 M docs (journals, books, datasets) + solid citation graph | No key needed; 100 k calls / day if you add `mailto=` param ([docs.openalex.org][1])                        | `search=`, `filter=from_publication_date:2024-01-01,type:journal-article`, `sort=cited_by_count:desc` |
| **Crossref `/works`**   | DOIs from \~12 k publishers; fastest DOI look-ups              | No auth; polite rate ≈50 req/s when you pass `mailto` header ([www.crossref.org][2], [www.crossref.org][3]) | `query.bibliographic=`, `filter=has-full-text:true`                                                   |
| **Semantic Scholar V1** | Titles + abstracts + influence metrics                         | Key gives 1 req/s; no-key pool is 1000 rps shared ([Semantic Scholar][4], [Semantic Scholar][5])            | `query`, `fields=year,citationCount,isOpenAccess,url`                                                 |
| **arXiv API**           | 2.5 M preprints (STEM heavy)                                   | No key; follow 30 s rule of thumb; Atom feed ([arXiv Info][6])                                              | `search_query=all:"quantum error correction" AND submittedDate:[2024 TO 2025]`                        |
| **Unpaywall**           | OA flag + direct PDF links for any DOI                         | Free; just add `?email=`; 20 M OA copies ([Unpaywall][7])                                                   | `/v2/<doi>` (one-shot lookup)                                                                         |
| **CORE**                | 300 M OA PDFs harvested from repositories                      | Free key; JSON search endpoint ([CORE][8], [CORE][9])                                                       | `q=title:climate AND year:[2020 TO 2025]`                                                             |

> *Premium options (Dimensions, Scopus, Lens.org) add paywalled abstracts, but the free stack above is enough for most student workflows.*

---

## 2 Query & deduplication workflow

```
topic text
   │
   ├─► expand_keywords()      // synonyms, ACM terms, etc.
   │
   └─► parallel_search()
        ├ OpenAlex
        ├ Crossref
        ├ Semantic Scholar
        └ arXiv
             ↓
   merge_and_rank()
        ├ 1️⃣ canonicalise DOI
        ├ 2️⃣ if DOI missing → md5(title+year)
        ├ 3️⃣ drop duplicates (same canonical_id)
        └ 4️⃣ score = bm25 + log10(citationCount+1) + recency_boost
             ↓
   top-K JSON  ➜  ingestPaper()   // the upsert you already wrote
```

### Canonical-ID tip

`coalesce(doi, md5(lower(normalise(title))))` keeps arXiv preprints and later journal versions from clashing.

### Ranking heuristics

```ts
score =
  bm25TitleAbstract            // text relevance
+ 0.5 * log10(citationCount+1) // authority
+ (2025 - year) * 0.1          // freshness
```

Adjust weights until the Source-Review screen “feels” right.

---

## 3 Edge Function aggregator (pseudo-code)

```ts
// /supabase/functions/fetchSources.ts
export const fetchSources = async (topic: string) => {
  const [oa, cr, ss, ax] = await Promise.all([
    openAlexSearch(topic),
    crossrefSearch(topic),
    semschSearch(topic),
    arxivSearch(topic)
  ])

  const merged = dedupeAndRank([...oa, ...cr, ...ss, ...ax])
  const top = merged.slice(0, 25)          // show in Source Review UI

  // Upsert into 'papers' so embeddings run downstream
  await Promise.all(top.map(ingestPaper))

  return top                                // JSON to the client
}
```

Each `…Search()` helper:

```ts
async function openAlexSearch(q: string) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=50&mailto=me@example.com`
  const { results } = await fetch(url).then(r => r.json())
  return results.map(x => ({
    canonical_id: x.doi ?? md5(x.display_name + x.publication_year),
    title: x.display_name,
    abstract: x.abstract_inverted_index ? deInvert(x.abstract_inverted_index) : '',
    year: x.publication_year,
    venue: x.primary_location?.source?.display_name,
    doi: x.doi,
    url: x.primary_location?.landing_page_url,
    citationCount: x.cited_by_count
  }))
}
```

(Write similar wrappers for Crossref, Semantic Scholar, etc.; keep them thin and stateless so they can run in parallel.)

---

## 4 Caching and rate-limit hygiene

| Strategy            | Implementation                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **Request caching** | `papers_api_cache(id TEXT PK, response JSONB, fetched_at TIMESTAMPTZ)`; expire after 48 h. |
| **Backoff**         | If 429 from Semantic Scholar, wait `retry-after` header and drop to Crossref fallback.     |
| **Contact header**  | Both Crossref & OpenAlex ask for `User-Agent: GenPaper/1.0 (mailto:you@uni.edu)`.          |

---

## 5 Unpaywall & PDF harvesting (optional but nice)

After you’ve stored a DOI, hit Unpaywall:

```ts
const oadoi = await fetch(`https://api.unpaywall.org/v2/${doi}?email=me@example.com`).then(r=>r.json())
if (oadoi.is_oa && oadoi.best_oa_location?.url_for_pdf) {
  downloadAndStorePDF(oadoi.best_oa_location.url_for_pdf, bucketKey)
  await supabase.from('papers').update({ pdf_url: publicUrl }).eq('doi', doi)
}
```

Now the Library can preview full-text instantly.

---

## 6 Fallback keyword search

If `match_papers()` (vector search) fetches < N items, rerun **keyword** search via `search_vector @@ plainto_tsquery(topic)` so the model never sees an empty source list.

---

### TL;DR

1. **Use OpenAlex + Crossref as your backbone;** spice it with Semantic Scholar (citations) and arXiv (preprints).
2. Wrap each API in a thin edge-function call, **deduplicate by DOI**, and rank with a simple relevance + citations formula.
3. Upsert the top results into your `papers` table and let your existing `ingestPaper()` pathway take care of embeddings.
4. Add Unpaywall & CORE calls only when you need OA PDFs.

Wire it once, cache aggressively, and your Source-Review step will feel instantaneous while staying completely within free-tier quotas. Happy hunting for papers—let me know if you need concrete SQL for the cache table or the de-inversion helper for OpenAlex abstracts!

[1]: https://docs.openalex.org/how-to-use-the-api/api-overview?utm_source=chatgpt.com "API Overview | OpenAlex technical documentation"
[2]: https://www.crossref.org/documentation/retrieve-metadata/rest-api/?utm_source=chatgpt.com "REST API - Crossref"
[3]: https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/?utm_source=chatgpt.com "Tips for using the Crossref REST API"
[4]: https://www.semanticscholar.org/product/api?utm_source=chatgpt.com "Semantic Scholar Academic Graph API"
[5]: https://www.semanticscholar.org/product/api%2Ftutorial?utm_source=chatgpt.com "Tutorial | Semantic Scholar Academic Graph API"
[6]: https://info.arxiv.org/help/api/user-manual.html?utm_source=chatgpt.com "arXiv API User's Manual"
[7]: https://unpaywall.org/products/api?utm_source=chatgpt.com "REST API - Unpaywall"
[8]: https://core.ac.uk/?utm_source=chatgpt.com "CORE – Aggregating the world's open access research papers"
[9]: https://core.ac.uk/services/api?utm_source=chatgpt.com "CORE API"
