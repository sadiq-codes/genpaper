

## 🏗️ Architecture Overview

### AI Generation Pipeline

GenPaper uses a modular, service-oriented architecture for AI-powered content generation with robust citation management.

#### Core Services

**CitationService** (`lib/citations/immediate-bibliography.ts`)
- Centralized validation, CSL normalization, and persistence
- Methods: `add()`, `renderInline()`, `renderBibliography()`, `suggest()`
- Race-safe uniqueness with `UNIQUE(project_id, paper_id)` constraint
- Idempotent operations with graceful fallbacks

**ContextRetrievalService** (`lib/generation/context-retrieval-service.ts`)
- Unified embeddings + keyword search with per-request caching
- API: `retrieve({query, projectId, k})` → `{papers, chunks, scores}`
- Backward-compatible with existing `getRelevantChunks()` interface

**AIService** (`lib/ai/ai-service.ts`)
- Isolates Vercel AI SDK usage and streaming concerns
- Mockable interface: `streamText()` → `AsyncIterable<StreamEvent>`
- Error handling and event transformation layer

**PromptService** (`lib/prompts/prompt-service.ts`)
- Pure prompt construction with no network/DB calls
- Template caching, Mustache rendering, utility methods
- `buildUnified()`, `buildPlanningPrompt()`, `buildCritiquePrompt()`

#### Generation Orchestrator

**GenerationOrchestrator** (`lib/generation/generation-orchestrator.ts`)
- Composes PromptService + AIService + CitationService
- Supports immediate citations (current) and placeholder workflow (new)
- Real-time metrics: request IDs, span tracing, latency breakdown

```typescript
const result = await GenerationOrchestrator.generateSection({
  paperType: 'researchArticle',
  sectionKey: 'introduction', 
  projectId: 'uuid',
  topic: 'AI in Healthcare',
  contextChunks: [...],
  availablePapers: [...]
}, (event) => {
  // 'sentence', 'citation', 'batch_resolved', 'error', 'complete'
})
```

#### Citation Workflows

**Immediate Citations** (Current)
1. AI tool calls `/api/citations` with `paperId` + `reason`
2. CitationService validates, formats, persists citation
3. Returns formatted inline citation `(Author, Year)`

**Placeholder Citations** (New - Feature Flagged)
1. AI generates placeholders: `[[CITE:paperId:uuid]]`
2. StreamProcessor buffers content and extracts placeholders
3. Batch resolution via `/api/citations` with `refs[]` payload
4. Replace placeholders with formatted citations in final text

#### Feature Flags

```bash
GENPIPE_UNIFIED_CITATIONS=true   # Use CitationService for all paths
GENPIPE_BATCHED_CITES=true       # Enable placeholder workflow  
GENPIPE_RETRIEVAL_SVC=true       # Use ContextRetrievalService
```

#### Performance & Observability

- **Request IDs**: Track generations across logs/metrics
- **Span Tracing**: `prompt_building`, `llm_streaming`, `batch_resolution`
- **Latency Targets**: ≤200ms p95 for section generation under 100 RPS
- **Error Handling**: Graceful fallbacks, retry logic, backpressure protection

#### Database Schema

**project_citations** (Unified Table)
```sql
CREATE TABLE project_citations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  paper_id UUID NOT NULL,
  number INTEGER NOT NULL,           -- Sequential numbering (1,2,3...)
  cite_key TEXT NOT NULL,           -- Stable reference key
  first_seen_order INTEGER NOT NULL, -- Consistent ordering
  csl_json JSONB NOT NULL,          -- CSL-JSON for formatting
  reason TEXT NOT NULL,             -- Citation context
  quote TEXT,                       -- Optional exact quote
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id, paper_id),     -- One citation per paper per project
  UNIQUE(project_id, number)        -- Sequential numbering per project
);
```
