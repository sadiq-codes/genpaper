Below is a **practical “recipe”** for plugging a retrieval-augmented-generation (RAG) loop into your current stack:

| Layer                 | Tech already chosen             | What you add for RAG                                               |
| --------------------- | ------------------------------- | ------------------------------------------------------------------ |
| **Data store**        | Supabase Postgres               | `pgvector` extension + IVFFLAT index                               |
| **Retrieval API**     | Supabase Edge Functions or RPC  | SQL similarity query + optional filters                            |
| **Embedding service** | —                               | OpenAI `text-embedding-3-small` (or any Llama-v3/Instructor model) |
| **Generation SDK**    | Your AI SDK (stream/tool-calls) | Prompt template that accepts *{topic, retrieved\_papers\[]}*       |
| **Front-end**         | Next.js App Router              | `useSWR` (Edge) for source list → stream draft via SSE/WebSocket   |

---

## 1 Ingest & vectorise papers

```ts
// /supabase/functions/ingestPaper.ts
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import md5 from 'crypto-js/md5'

export const ingestPaper = async (paperMeta: PaperDTO) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SERVICE_KEY)
  const openai   = new OpenAI({ apiKey: process.env.OPENAI_KEY })

  const text = `${paperMeta.title}\n${paperMeta.abstract || ''}`
  const { data: [{ embedding }] } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  })

  await supabase.from('papers').upsert({
    id: md5(paperMeta.doi || text).toString(),   // deterministic UUID-ish
    title: paperMeta.title,
    abstract: paperMeta.abstract,
    publication_date: paperMeta.date,
    venue: paperMeta.venue,
    doi: paperMeta.doi,
    url: paperMeta.url,
    pdf_url: paperMeta.pdf,
    metadata: paperMeta.extra,
    embedding
  })
}
```

*Run this* when you:

1. fetch search results from CrossRef / OpenAlex, **or**
2. a user uploads a PDF (extract the first \~3 k tokens with `pdf-parse`).

> **Tip:** batch‐upsert 100 embeddings at a time—OpenAI gives best throughput there.

---

## 2 Create the similarity index (one-off migration)

```sql
-- ✅ Ensure vector extension is enabled (Supabase-compatible)
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- ✅ Set inline storage for vector column to reduce TOAST overhead
ALTER TABLE papers
  ALTER COLUMN embedding SET STORAGE PLAIN;

-- ✅ Create cosine similarity index using ivfflat
-- Note: Run ANALYZE after populating data for this to work efficiently
CREATE INDEX IF NOT EXISTS papers_embedding_idx
ON papers USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ✅ Create GIN index for keyword search fallback
CREATE INDEX IF NOT EXISTS papers_search_idx
ON papers USING GIN (search_vector);

```

---

## 3 Similarity search RPC (edge-friendly)

```sql
create or replace function match_papers(
  query_embedding vector,
  match_count int default 8,
  min_year int default 2018
)
returns table (
  paper_id uuid,
  score    float
) language sql stable as $$
  select id, 1 - (embedding <=> query_embedding) as score
  from papers
  where publication_date >= make_date(min_year,1,1)
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

RLS example:

```sql
create policy "allow read for all"
  on papers for select
  using (true);
```

---

## 4 Back-end “generate draft” flow

```ts
export const generateDraft = async (topic: string, projectId: string) => {
  // 1️⃣ Embedding for the topic prompt
  const [{ embedding: qEmbed }] = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: topic
  }).then(r => r.data)

  // 2️⃣ Retrieve top K papers
  const { data: matches } = await supabase
    .rpc('match_papers', { query_embedding: qEmbed, match_count: 10 })

  const paperRows = await supabase
    .from('papers')
    .select('*')
    .in('id', matches.map(m => m.paper_id))

  // 3️⃣ Build system + user messages
  const systemMsg = `
You are an academic writing assistant.
Cite sources as (Author, Year).
At the end produce a "References" section in APA.
`
  const userMsg = JSON.stringify({
    topic,
    sources: paperRows.map(p => ({
      id: p.id,
      title: p.title,
      abstract: p.abstract,
      authors: await getAuthorList(p.id),        // join paper_authors
      year: new Date(p.publication_date).getFullYear(),
      doi: p.doi
    }))
  })

  // 4️⃣ Stream completion & write each chunk to `research_project_versions`
  const stream = openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user',   content: userMsg }
    ],
    tools: [ citationParseTool ]
  })

  let buffer = ''
  let version = 1
  for await (const delta of stream) {
    buffer += delta.choices[0].delta.content || ''
    if (buffer.length > 2000) {            // checkpoint ~2k chars
      await supabase.from('research_project_versions').insert({
        project_id: projectId,
        version,
        content: buffer
      })
      version++
      buffer = ''
    }
    // forward delta to SSE → client
  }
}
```

*Tool call example* (`citationParseTool`) returns the set of paper-IDs the model claims to cite; you then insert rows into `project_citations`.

---

## 5 Front-end streaming (Next.js client)

```tsx
const { data: eventSource } = useSWR(`/api/projects/${id}/stream`, fetchSSE)

eventSource.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data)
  if (type === 'delta') appendText(payload.text)
  if (type === 'checkpoint') mutate(`/api/projects/${id}/versions`)
}
```

*At each checkpoint* you revalidate the SWR hook that lists versions, giving the editor an incremental draft without WebSocket complexity.

---

## 6 Blending Library picks with auto-retrieval

In **Source Review** screen:

1. `SELECT * FROM library_papers WHERE user_id = … AND <tag/filter>`
2. Let the student *pin* any of those → push their paper IDs into the same `sources[]` you pass to the model.
3. Your RAG retrieval function **excludes** pinned IDs from similarity ranking to avoid duplicates.

---

## 7 Cost & performance notes

| Concern               | Mitigation                                                                    |
| --------------------- | ----------------------------------------------------------------------------- |
| **Embedding bill**    | Cache by DOI hash; batch requests.                                            |
| **Cold vector index** | `VACUUM ANALYZE papers; SET ivfflat.probes = 10;` at deploy.                  |
| **Long prompts**      | Only send **abstract** (≤ 3 k chars) and the *top-N* snippets you truly need. |
| **Latency to client** | Chunk every \~1 k chars; Edge Functions keep socket near user.                |

---

### 🧑‍🎓 TL;DR

1. **Store** title + abstract embeddings in `papers.embedding`.
2. **Retrieve** with a simple `match_papers()` SQL RPC.
3. **Feed** top-K results (plus any pinned Library papers) into your AI SDK prompt.
4. **Stream** output; checkpoint into `research_project_versions`; forward deltas via SSE.
5. **Parse tool calls** to keep `project_citations` in sync.

This wiring keeps **all heavy search inside Postgres**, uses **Supabase Edge** for low-latency glue, and stays fully in TypeScript so your Next.js codebase feels cohesive. Ping me if you want the PDF-to-text extractor snippet or the exact RLS policies!
