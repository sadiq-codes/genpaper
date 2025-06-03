### Code-review TL;DR

* ✅ Great start: validates auth, size & MIME, chunks text for RAG, deterministic UUIDs, batch embeds.
* 🚨 Biggest risks: **runtime incompatibility (Edge vs Node), un-scalable loops, and long-running PDF→buffer memory use**.
* ✨ Quickest wins: **stream → tmp file**, **one DB round-trip per table**, **batch author inserts**, **move embeddings out of tight loops**, **add PG FTS trigger**.

Below I group feedback in priority order. Each bullet ends with a ✦ if it’s a 5-min change, ★ for medium effort, and 🚧 if it needs redesign.

---

## 1  Request handler & runtime

| Issue                                                                                                                                                          | Fix                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edge vs Node** – `pdf-parse` depends on Node streams and `fs`; it *will* crash in `runtime="edge"` (the default in Next.js App Router). 🚨                   | Export `config = { runtime: "nodejs" }` at the top of the `/upload` route **or** move parsing into a Server Action / Route Handler under `app/api/.../route.ts` with `export const dynamic = "force-dynamic"`. ✦ |
| Reads **entire PDF into memory** (`await file.arrayBuffer()`). 10 MB *per* request is fine locally, but two users uploading 50 MB each will OOM the Lambda. 🐏 | Stream to a temp file (e.g. `tmp-promise`) then pass the path to `pdf-parse`, which also streams. ★                                                                                                              |
| 10 MB limit is enforced only in JS.  Add **Nginx / Vercel edge limit** or `content-length` guard to reject big uploads sooner. ✦                               |                                                                                                                                                                                                                  |

---

## 2  Metadata extractor

### Title / author / abstract regexes

* Regexes are **English-centric** and break on non-Latin titles. Consider falling back to \[GROBID’s `/processHeaderDocument` endpoint] later. 🚧
* `authorPatterns[1]` matches any two words at start of doc – you’ll often capture the *title*. Tighten with a comma or ORCID look-ahead. ✦
* DOI regex: `match[1]` fails if the first pattern is the global one (`\b(10\.\d+...)`); safe-guard with `(match[1] || match[0])`. ✦

### Year pick

* `Math.max(...years)` biases toward the *most recent* year in the whole PDF (e.g. copyright footer 2025).  Prefer the **first** match within first 300 lines.  ✦

### Chunker

* Overlap logic is fine, but `start = end - overlap` can become negative on first loop if `end` was trimmed back by 200. Add `Math.max(0, end - overlap)`. ✦
* Consider **token-based** chunking (e.g. `gpt-3ish tokens≈4 chars`) to keep embedding token counts predictable. 🚧

---

## 3  Supabase DB round-trips

| Pattern                                                                                                                                                    | Improvement                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `for` loop calling `createOrGetAuthor` (network per author).                                                                                               | Fetch existing authors **in one `IN (...)` query**, diff client-side, then `insert` new authors with `onConflict: 'name'`. ★ |
| Re-deleting & upserting `paper_authors` for every ingest.                                                                                                  | Use `DELETE … WHERE paper_id = $1 AND author_id NOT IN (…)` then `INSERT … ON CONFLICT DO NOTHING`. ★                        |
| Chunk embeddings: you already batch 100, but you still **insert per chunk**. Use a single `.insert(chunkRecords)` per batch (already almost there) – good. |                                                                                                                              |

---

## 4  Embeddings & vectors

* OpenAI `text-embedding-3-small` returns **1536 dims** by default; you request `dimensions: 384`. That’s okay, but pgvector index must be declared `VECTOR(384)`. Just be sure both sides match. ✦
* You call `embeddings.create` **inside** `ingestPaperWithChunks` loop even when you had the embedding above. Pass pre-generated embedding into helper to avoid double calls. (You already do this in `ingestPaperWithEmbedding`; refactor to reuse.) ★
* After inserting embeddings, run `REFRESH MATERIALIZED VIEW` or `VACUUM ANALYZE papers` to keep ivfflat index performant (can be a Supabase **postgrest function** trigger). ★

---

## 5  Search & RPC

* `.textSearch('search_vector', query)` uses raw lexemes; wrap `plainto_tsquery('english', query)` on the SQL side or call Supabase’s `fts` operator (`@@`). Otherwise phrase queries won’t rank well. ✦
* `semanticSearchPapers` passes `match_count` 8 but later `.slice(0, limit)`; pass `limit` straight into RPC to save DB work. ✦
* Add RLS policy: `authors` & `papers` are global, but `library_papers` rows must be `user_id = auth.uid()`. ★

---

## 6  Security / robustness

* Escape/minimise **log prints** of ld leak co`fullText` (copyrighted content to your logs). Only log first 200 chars in production. ✦
* Sanitise `fileName`; right now an attacker could upload `"../../../../etc/passwd.pdf"` and the string flows into logs & metadata. Use `path.basename` or simply `crypto.randomUUID()+'.pdf'` for Storage key. ✦
* Add **content-type sniffing** (e.g. `file.arrayBuffer()` then `file-type` npm) to reject disguised `.exe` uploads. ★
* Virus scan PDFs if you ever let others download them back – ClamAV Lambda layer or similar. 🚧

---

## 7  Code style / maintenance

* The single file is \~1000 LoC – consider **modules**:
  `lib/pdf/extract.ts`, `lib/db/papers.ts`, `app/api/upload/route.ts` etc. ★
* Move *string-manip* helpers (`chunkText`, DOI regexes) into `utils/text.ts` for unit testing. ✦
* Add `zod` schema for `PaperDTO` – you already type it, but runtime validation protects the API boundary. ★
* Replace repeated `console.log` blocks with `debug('pdf', ...)` using `DEBUG=*` or `pino` levels in production. ✦

---

## 8  Nice-to-have

1. **Progress events** – return a JSON stream `{stage:"parsing"}`, `{stage:"embedding"}` so the UI can show a progress bar.
2. **Retry queue** – failed chunk-embeddings currently just `console.error`.  Insert into `failed_chunks` table and schedule a Edge Function cron to retry.
3. **GROBID opt-in** – provide a “Use advanced parsing” toggle; fall back to current regex path if GROBID container down.


---

### Suggested next refactor order

1. **Split  parsifiles** + moveng to Node runtime.
2. Batch author insert & paper\_author upsert.
3. Stream PDF → tmpfile to cap memory.
4. Add RLS + FTS trigger (search\_vector update).
5. Replace logging & hard-coded env prints with `pino` & `DEBUG`.

Implementing those four will make the upload pipeline stable under load, cheap to run, and easy to extend later with OCR or GROBID.  Happy hacking—ping me when you’re ready to add the OCR fallback or if any RPCs misbehave!
