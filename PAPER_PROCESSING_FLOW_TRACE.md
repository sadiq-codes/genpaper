# Complete Paper Addition & Processing Flow Trace

## Executive Summary

This document traces the **complete flow** of how papers get added to research projects and how their processing status transitions from `pending` → `processing` → `processed`. The goal is to identify why papers can get stuck in "pending" status indefinitely.

---

## 1. PROJECT CREATION FLOW

### 1.1 API Endpoint: `POST /api/projects`
**File:** `app/api/projects/route.ts` (lines 70-111)

**Flow:**
1. User submits project creation form with `topic`, `paperType`, `selectedPapers`, `generationMode`
2. Calls `createResearchProject()` from `lib/db/research.ts`
3. Creates project record in `research_projects` table
4. **Does NOT auto-add papers** - papers are linked separately

**Key Finding:** Project creation does NOT automatically add papers. Papers must be linked via `project_citations` table.

---

## 2. PAPER ADDITION TO PROJECT

### 2.1 Primary Method: `POST /api/editor/papers`
**File:** `app/api/editor/papers/route.ts` (lines 118-229)

**Flow:**
1. Receives `{ projectId, paperId }`
2. Verifies user owns project
3. Checks if paper exists in `papers` table
4. Checks if already linked via `project_citations` table
5. **Calls `CitationService.add()`** to create `project_citations` entry
6. Returns paper data

**Key Finding:** Adding a paper to a project ONLY creates a `project_citations` entry. It does NOT trigger processing.

### 2.2 Background Paper Search (Write Mode)
**File:** `components/editor/hooks/useBackgroundPaperSearch.ts` (lines 38-147)

**Flow:**
1. When `isWriteMode=true` and project has a topic, hook auto-runs
2. Calls `/api/papers?search={topic}&maxResults=10&ingest=true`
3. For each found paper:
   - Calls `POST /api/editor/papers` to add to project
   - Papers are ingested with `ingest=true` flag

**Key Finding:** Background search DOES ingest papers (creates them in DB), but ingestion may leave them in `pending` status if no PDF URL is provided.

### 2.3 Project Creation with Selected Papers
**File:** `components/dashboard/actions.ts` (lines 30-166)

**Flow:**
1. User creates project with uploaded PDFs or selected library papers
2. After project creation, loops through `allPaperIds`
3. For each paper, calls `CitationService.add()` to link to project
4. **Does NOT trigger processing** - papers remain in their current status

**Key Finding:** Papers added during project creation are linked but NOT processed.

---

## 3. PAPER INGESTION PIPELINE

### 3.1 Search & Ingest Flow
**File:** `app/api/papers/route.ts` → `handleExternalSearch()` (lines 280-351)

**Flow:**
1. User searches via `/api/papers?search=...&ingest=true`
2. Calls `searchAndIngestPapers()` from `lib/services/paper-aggregation.ts`
3. Searches external APIs (OpenAlex, Crossref, etc.)
4. For each paper found, calls `processPaperWithPdf()` (line 585)
5. Which calls `processPaperWithPdfInternal()` (line 648)

### 3.2 Paper Creation: `createPaperMetadata()`
**File:** `lib/db/papers.ts` (lines 473-574)

**Flow:**
1. Creates paper record in `papers` table
2. **Sets `processing_status: 'pending'`** (line 502) ⚠️ **CRITICAL**
3. Generates embedding from title+abstract for Qdrant
4. Seeds abstract chunk if abstract exists (lines 534-571)
5. Returns `paperId`

**Key Finding:** All new papers start with `processing_status: 'pending'`.

### 3.3 PDF Processing Decision: `ingestPaper()`
**File:** `lib/db/papers.ts` (lines 401-456)

**Flow:**
1. Checks if paper exists (by DOI/title)
2. If new, calls `createPaperMetadata()` → sets status to `pending`
3. **Decision point:**
   - If `options.pdfUrl` exists → calls `queuePdfProcessing()` → sets status to `processing`
   - If `options.fullText` exists → calls `processContentImmediately()` → sets status to `processed`
   - If neither → **status remains `pending`** ⚠️ **CRITICAL BUG**

**Key Finding:** Papers without PDF URL or fullText remain `pending` forever.

### 3.4 PDF Processing: `queuePdfProcessing()`
**File:** `lib/db/papers.ts` (lines 613-653)

**Flow:**
1. Sets status to `processing` (line 620)
2. Downloads PDF from storage
3. Extracts text via `getOrExtractFullText()`
4. Calls `createChunksForPaper()` to create chunks
5. Sets status to `processed` (line 634) OR `failed` on error (line 648)

**Key Finding:** PDF processing DOES update status correctly, but only if PDF URL exists.

---

## 4. PROCESSING STATUS LIFECYCLE

### 4.1 Status Transitions

```
pending → processing → processed ✅
pending → processing → failed ❌
pending → (stuck forever) ⚠️ BUG
```

### 4.2 Where Status Gets Set

1. **`pending`** - Set in `createPaperMetadata()` (line 502)
2. **`processing`** - Set in:
   - `queuePdfProcessing()` (line 620)
   - `processContentImmediately()` (line 588)
   - `processPaper()` in background-processor.ts (line 63)
3. **`processed`** - Set in:
   - `queuePdfProcessing()` after chunks created (line 634)
   - `processContentImmediately()` after chunks created (line 597)
   - `createChunksFromContent()` in background-processor.ts (line 209)
   - `ingestPaper()` for metadata-only papers (line 452)
4. **`failed`** - Set on errors in all processing functions

### 4.3 Background Processing Trigger: `POST /api/papers/process`
**File:** `app/api/papers/process/route.ts` (lines 42-171)

**Flow:**
1. Receives `{ projectId }` or `{ paperIds }`
2. If `waitForCompletion=false` (async mode):
   - Calls `processProjectPapers(projectId)` in background (line 146)
   - Returns immediately
3. If `waitForCompletion=true` (sync mode):
   - Waits for `processProjectPapers()` to complete
   - Returns results

**Key Finding:** Processing is triggered by calling `/api/papers/process`, but this is NOT automatic when papers are added to projects.

### 4.4 Background Processor: `processProjectPapers()`
**File:** `lib/content/background-processor.ts` (lines 342-377)

**Flow:**
1. Fetches all papers linked to project via `project_citations`
2. Filters to papers where `processing_status != 'processed'`
3. Calls `processMultiplePapers()` with pending paper IDs
4. Each paper processed via `processPaper()` (line 32)

**Key Finding:** Only processes papers that are NOT already `processed`. Papers stuck in `pending` WILL be processed.

### 4.5 Individual Paper Processing: `processPaper()`
**File:** `lib/content/background-processor.ts` (lines 32-190)

**Flow:**
1. Fetches paper record
2. **Skips if `processing_status === 'processed'`** (line 49)
3. If `pdf_content` exists → calls `createChunksFromContent()`
4. If `pdf_url` exists → downloads PDF, extracts text, creates chunks
5. If no PDF URL → sets status to `failed` (line 73)
6. Updates status to `processed` after chunks created (line 209)

**Key Finding:** Papers without PDF URL get marked as `failed`, not `processed`. This is correct behavior.

---

## 5. WRITE MODE PROCESSING TRIGGER

### 5.1 ResearchEditor Effect
**File:** `components/editor/ResearchEditor.tsx` (lines 233-262)

**Flow:**
1. When `isWriteMode=true` and `projectId` exists, effect runs
2. Calls `POST /api/papers/process` with `{ projectId, waitForCompletion: false }`
3. This triggers background processing of all project papers

**Key Finding:** Write mode DOES trigger processing, but only if the effect runs successfully.

### 5.2 Status Polling: `usePaperProcessingStatus`
**File:** `components/editor/hooks/usePaperProcessingStatus.ts` (lines 44-252)

**Flow:**
1. Polls `GET /api/papers/process?projectId={projectId}` every 3 seconds
2. Updates UI with current statuses
3. Stops polling when all papers are `processed`

**Key Finding:** UI polls for status, but doesn't trigger processing itself.

---

## 6. ROOT CAUSES OF "PENDING" STUCK PAPERS

### 6.1 Papers Created Without PDF URL or FullText
**Location:** `lib/db/papers.ts` - `ingestPaper()` (lines 446-455)

**Problem:**
- Papers created via `createPaperMetadata()` start as `pending`
- If no `pdfUrl` or `fullText` provided, status never changes
- `ingestPaper()` returns `status: 'processed'` but doesn't update DB (line 455)

**Fix Needed:** Update status to `processed` for metadata-only papers in DB.

### 6.2 Background Processing Not Triggered
**Location:** Multiple places where papers are added to projects

**Problem:**
- Papers added via `POST /api/editor/papers` don't trigger processing
- Papers added during project creation don't trigger processing
- Only write mode triggers processing via ResearchEditor effect

**Fix Needed:** Trigger processing automatically when papers are added to projects.

### 6.3 Processing Fails Silently
**Location:** `app/api/papers/process/route.ts` (lines 145-148)

**Problem:**
- Async processing uses `.catch()` but only logs errors
- No retry mechanism for failed processing
- User never notified of failures

**Fix Needed:** Add retry logic and user notifications.

### 6.4 Papers Without PDF URL Marked as Failed
**Location:** `lib/content/background-processor.ts` (lines 67-74)

**Problem:**
- Papers without PDF URL get marked as `failed`
- But metadata-only papers should be `processed` (they have abstract chunks)

**Fix Needed:** Check for abstract chunks before marking as failed.

---

## 7. COMPLETE FLOW DIAGRAM

```
User Action: Create Project with Papers
    ↓
POST /api/projects → createResearchProject()
    ↓
Project Created
    ↓
For each paper: CitationService.add() → project_citations entry
    ↓
Papers linked to project (status: pending)
    ↓
[IF write mode] ResearchEditor effect → POST /api/papers/process
    ↓
processProjectPapers() → finds pending papers
    ↓
processPaper() for each paper
    ↓
[IF pdf_url exists] Download PDF → Extract text → Create chunks → processed ✅
[IF no pdf_url] Mark as failed ❌ OR [IF abstract exists] processed ✅
```

---

## 8. SPECIFIC BREAKPOINTS

### Breakpoint 1: Paper Created Without Content
- **File:** `lib/db/papers.ts:502`
- **Issue:** Status set to `pending` but never updated if no PDF/fullText
- **Fix:** Update status to `processed` for metadata-only papers

### Breakpoint 2: Paper Added to Project Without Processing Trigger
- **File:** `app/api/editor/papers/route.ts:189`
- **Issue:** `CitationService.add()` doesn't trigger processing
- **Fix:** Call `/api/papers/process` after adding paper

### Breakpoint 3: Background Processing Not Triggered in Non-Write Mode
- **File:** `components/editor/ResearchEditor.tsx:234`
- **Issue:** Processing only triggered in write mode
- **Fix:** Trigger processing for all projects, not just write mode

### Breakpoint 4: Papers Without PDF URL Marked Failed Instead of Processed
- **File:** `lib/content/background-processor.ts:67`
- **Issue:** Should check for abstract chunks before failing
- **Fix:** Check chunk count before marking as failed

---

## 9. RECOMMENDED FIXES

### Fix 1: Update Metadata-Only Papers to Processed
**File:** `lib/db/papers.ts:446-455`

```typescript
// No content provided - this is a metadata-only paper
// Mark as 'processed' since there's nothing more to process
const supabase = getServiceClient()
await supabase
  .from('papers')
  .update({ processing_status: 'processed' })
  .eq('id', newPaperId)

return { paperId: newPaperId, isNew: true, status: 'processed' }
```

**Status:** Already implemented! But verify it's working.

### Fix 2: Auto-Trigger Processing When Paper Added to Project
**File:** `app/api/editor/papers/route.ts:189-201`

Add after `CitationService.add()`:
```typescript
// Trigger background processing for this paper
try {
  await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/papers/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paperIds: [paperId],
      waitForCompletion: false,
    }),
  })
} catch (err) {
  console.warn('Failed to trigger paper processing:', err)
  // Non-fatal - paper is still added to project
}
```

### Fix 3: Check for Chunks Before Marking as Failed
**File:** `lib/content/background-processor.ts:67-74`

```typescript
// 5. Get PDF from storage
if (!paper.pdf_url) {
  // Check if paper has chunks (abstract chunks count as processed)
  const { count: chunkCount } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('paper_id', paperId)
  
  if (chunkCount && chunkCount > 0) {
    // Paper has chunks, mark as processed
    await supabase
      .from('papers')
      .update({ processing_status: 'processed' })
      .eq('id', paperId)
    return { paperId, status: 'processed' }
  }
  
  // No chunks and no PDF - mark as failed
  await supabase
    .from('papers')
    .update({ processing_status: 'failed' })
    .eq('id', paperId)
  return { paperId, status: 'failed', error: 'No PDF URL available' }
}
```

---

## 10. TESTING CHECKLIST

- [ ] Create project with papers → verify papers are `pending`
- [ ] Add paper to project → verify processing is triggered
- [ ] Paper without PDF URL → verify status becomes `processed` (if abstract exists)
- [ ] Paper with PDF URL → verify status becomes `processed` after extraction
- [ ] Write mode → verify processing is triggered automatically
- [ ] Non-write mode → verify processing is still triggered
- [ ] Check for papers stuck in `pending` status in production DB

---

## Conclusion

The main issue is that papers can get stuck in `pending` status when:
1. They're created without PDF URL or fullText (metadata-only)
2. Processing is never triggered after adding to project
3. Background processing fails silently

The fixes above address all three issues.
