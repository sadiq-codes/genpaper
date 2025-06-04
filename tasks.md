Below is a **debug-checklist + concrete code tweaks** that will usually eliminate the three symptoms you’re seeing.

---

## 1  Library Only toggle is ignored

### Bug

```ts
const remainingSlots = Math.max(0, maxPapers - pinnedPapers.length)
const discoveredPapers = useLibraryOnly || remainingSlots === 0 ? [] :
  await hybridSearchPapers(...)
```

If the query returns **exactly** `maxPapers` library items `remainingSlots` becomes `0`, so the
short-circuit fails and `hybridSearchPapers` still runs the next time you call the pipeline (because `remainingSlots === 0` is true only **after** you fetched last run’s cache).

### Fix

Stop even *looking* at `remainingSlots` when the user clicked *Library-only*.

```ts
let discoveredPapers: PaperWithAuthors[] = []

if (!useLibraryOnly) {
  const remainingSlots = Math.max(0, maxPapers - pinnedPapers.length)
  if (remainingSlots > 0) {
    discoveredPapers = await hybridSearchPapers(topic, {
      limit: remainingSlots,
      excludePaperIds: pinnedIds
    })
  }
}
```

*Tip:* put this behind a unit test – given `useLibraryOnly=true` the SQL log must show **zero** calls to
`search_papers`, `hybridSearchPapers`, `openalex_*`, etc.

---

## 2  Cache returns unrelated papers

You cache by **topic string alone**, so any new pipeline run that re-uses
*exactly* the same topic but different filters (library-only, year cut-off, …) hits the old result.

```ts
const cacheKey = `search:${topic}` // ← too coarse
```

### Two-line fix

```ts
const cacheKey = `search:${topic}|${useLibraryOnly?'lib':'mix'}|${fromYear}`
```

*OR* hold the cache at the **front-end** only while the UI session is alive
(`React.useRef<Map>`); almost all confusion disappears immediately.

---

## 3  Only 2-6 citations & shallow content

### Why

1. **Prompt truncation** – you build a very long JSON string → OpenAI clips
   after `~16 k` tokens (gpt-4o) and the tail of the source list is gone.
2. **No hard requirement** – the model is *told* “use the provided sources”,
   but nothing penalises it for ignoring most.

### Tweaks

| Part                    | Change                                                                                 | Snippet                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Source list**         | Pass **IDs only** inside the JSON and stream the full CSL data via the vector-tool     | `json { "topic": "...", "sources": ["id1","id2",...]} `                                                   |
| **Prompt**              | Add a *budget* instruction                                                             | `"... incorporate **at least 12 distinct sources** and cite each with [CITE:id]"`                         |
| **Citation extraction** | At the end of `streamPaperGeneration` assert the ratio                                 | `ts if (citations.length < Math.min(12, papers.length/2)) throw new Error('Too few citations – retry'); ` |
| **Chunk feeding**       | Instead of a single 10-chunk blob, pass **one chunk per paper** to encourage coverage. |                                                                                                           |



Make the generated content meaningfully longer
What you have now	What to tweak	Why it helps
**`targetTotal = config.search_parameters.limit		10`** → at most 10 papers feed the LLM
chunks = searchPaperChunks(...limit: 20) → only 20 chunks (≈ 10–15 k tokens)	Scale limit with lengthts<br>const chunkLimit = {short:20, medium:40, long:80}[config.paper_settings.length];<br>	Gives the model enough raw material to write multi-paragraph sections
Section prompt hard-codes “200–300” / “400–600” / “800–1000” words	Drive length from the same table and emphasise depth:ts<br>words = {short:400, medium:900, long:1600}[len];<br>`Write ~${words} words … with sub-headings & bullet lists where helpful.`	The LLM usually obeys explicit numeric targets
max_tokens is capped at 8 000	Compute per-section:sectionMax = words*1.4/0.75 (rough 0.75 token/word)	Prevents truncation while keeping quota in check
Everything generated in one shot	Iterative section writing (you already stream). For each section: 1. feed outline + previous sections2. request the next section only	Allows GPT-4o to keep longer context without hitting 128 k window
Minimal code patch (section length)
const WORD_TARGET = { short: 400, medium: 900, long: 1600 };
const wordTarget = WORD_TARGET[config.paper_settings.length];

SECTION_PROMPTS.introduction = `
Write ≈${wordTarget} words for the introduction.
Break the text into 3-4 paragraphs. Provide data, cite at least 4 sources.`;
Do the same for every section and bump max_tokens accordingly (≈ wordTarget*1.4).
### Optional – “forced citing” shim

Insert a *pre-pass* after generation:

```ts
for (const p of papers) {
  if (!content.includes(p.id) && content.length < targetLength*1.2) {
    content += `\n\nAdditional insight from ${p.title} [CITE:${p.id}]`;
  }
}
```

This guarantees every paper is referenced at least once, gives the model extra
tokens to extend, and you can regenerate only those snippets instead of the
whole draft.

---

## Sanity-check table

| Symptom                               | After the fixes you should see                                                |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| “Library-only still mixes web papers” | `console.log(allPapers.filter(p => p.source!=='library'))` length **0**       |
| “Cache pollution”                     | Cache key contains `useLibraryOnly`, `fromYear` → unrelated results disappear |
| “Only 6 citations”                    | Generation fails and immediately retries until `citations.length ≥ 12`        |

---

### Final thought

Keep the **`addCitation` RPC / tool** as the *single source of truth* for what
counts as “used”.  Whether the paragraph is LLM-generated or manually pasted,
call the same endpoint – that way the renderer and the bibliography logic stay
identical and you avoid a second, parallel citation implementation.
