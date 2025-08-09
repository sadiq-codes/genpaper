# tasks.md
VERY IMPORTANT: 
The user prefers that the assistant not create new files unnecessarily, instead update existing ones or merge files when necessary and delete files that are no longer needed or duplicate usage, to avoid redundancy and complexity. When you make replacement of a feature delete the old code, when you replace a file delete the old. i want the code base to be clean. but before you delete a file make sure it's not used.

# tasks.md
Gotcha. If you want “Copilot-style: prompt → diff → apply” and your current block editor is fundamentally wrong for that, let’s pivot. Here’s a lean blueprint to replace blocks with a file-like, diff-driven editor that works for prose (Markdown) and code.
What to build instead
1) One canonical document format
* Store each document as a single blob (Markdown or ProseMirror JSON). No block rows.
* Version it like code.
Schema (new)
create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  base_version_id uuid references document_versions(id),
  sha text not null,                         -- sha256(content)
  content_md text not null,                  -- or content_json jsonb
  actor text not null,                       -- 'user' | 'ai'
  prompt text,                               -- if ai
  model text,
  created_at timestamptz default now()
);

create unique index on document_versions(document_id, sha);
Keep your old blocks table only for migration; stop writing to it.
2) A strict “edits” API (prompt → structured patch)
* Don’t ask the model for a raw unified diff (too brittle). Ask for structured edit ops then render a diff UI on the client.
Edits schema
// positions are UTF-16 code unit offsets in the original text
type EditOp = {
  id: string;                                // uuid
  range?: { start: number; end: number };    // primary targeting
  anchor?: { before: string; after: string };// fuzzy fallback
  replacement: string;                       // new text
  note?: string;                             // why
  confidence?: number;                       // 0..1
};

type EditProposal = {
  baseSha: string;                           // of user's current version
  operations: EditOp[];
};
API
* POST /api/edits/propose → EditProposal Inputs: { documentId, baseSha, prompt, selection?: {start,end} }
* POST /api/edits/apply → { newVersionId, newSha } Inputs: { documentId, baseSha, operations } (optimistic concurrency)
3) Patch application (robust + fast)
* Try range apply; if it fails (drift), anchor-match using before/after strings around the original range.
* If multiple anchors match, pick the closest Levenshtein distance around the old range.
* If still failing, mark the op “conflicted” for human review.
Apply (core)
function applyOps(baseText: string, ops: EditOp[]) {
  // sort by start desc so offsets don’t shift during replace
  const sorted = [...ops].sort((a,b) => (b.range?.start ?? 0) - (a.range?.start ?? 0));
  let text = baseText; const applied: string[] = [], conflicts: EditOp[] = [];
  for (const op of sorted) {
    const ok = tryDirectReplace() || tryAnchorReplace();
    ok ? applied.push(op.id) : conflicts.push(op);
  }
  return { text, applied, conflicts };
}
(You’ll implement tryDirectReplace/tryAnchorReplace with a small sliding-window search; diff-match-patch is fine for fallback and for rendering UI diffs.)
4) UI like Copilot
* Editor shows side-by-side diff (or inline) with hunk-level accept/reject.
* When the user accepts, call /apply with the subset of ops.
* Maintain a version timeline (like commits) with prompt + model metadata.
* Selection-aware prompts: send {selection} so ops stay localized and cheap.
5) Concurrency & conflicts
* Require baseSha on propose/apply (optimistic concurrency).
* If baseSha is stale: rebase by computing a 3-way merge (diff3 or patch → re-propose). If conflict remains, surface the conflicting hunks.
6) Citations without blocks
* Replace block_citations with offset anchors in the doc.
create table doc_citations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  project_citation_id uuid not null references project_citations(id) on delete cascade,
  start_pos int not null,
  end_pos int not null,
  created_at timestamptz default now()
);
create index on doc_citations(document_id, start_pos);
* After each apply, remap offsets using the same diff you used to render the UI (map old→new positions). If remap fails, flag anchors for review.
7) Migration off blocks (safe + incremental)
1. Freeze writes to blocks.
2. Export each document to Markdown (respect headings, lists, quotes; inline citations → placeholders).
3. Create an initial document_versions row (actor system).
4. Add a read-only toggle to view the old block doc (for parity checks).
5. Delete block writes after a week of no regressions.
8) Guardrails for LLM output
* Use Zod to validate EditProposal.
* Cap total changed chars and require a selection for risky prompts (“rewrite whole doc”).
* Auto-reject proposals that change citations unless the prompt explicitly mentions citations.
Zod
import { z } from 'zod';
export const EditOpZ = z.object({
  id: z.string().uuid(),
  range: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).partial().optional(),
  anchor: z.object({ before: z.string().max(200), after: z.string().max(200) }).partial().optional(),
  replacement: z.string(),
  note: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
}).refine(d => d.range || d.anchor, { message: 'range or anchor required' });

export const EditProposalZ = z.object({
  baseSha: z.string(),
  operations: z.array(EditOpZ).min(1)
});
9) Minimal server implementation (Next.js route handler)
// /app/api/edits/apply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { EditProposalZ } from '@/lib/schemas';
import { applyOps } from '@/lib/apply';
import { sha256 } from '@/lib/sha';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = EditProposalZ.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { documentId, baseSha, operations } = body;
  const base = await db.version.getLatest(documentId);
  if (base.sha !== baseSha) return NextResponse.json({ error: 'STALE_BASE' }, { status: 409 });

  const { text, conflicts } = applyOps(base.content_md, operations);
  if (conflicts.length) return NextResponse.json({ error: 'CONFLICT', conflicts }, { status: 409 });

  const newSha = sha256(text);
  const vId = await db.version.insert({ document_id: documentId, base_version_id: base.id, sha: newSha, content_md: text, actor: 'user' });
  return NextResponse.json({ newVersionId: vId, newSha });
}
10) Optional: unified diff export
* For interoperability, generate a unified diff from baseText → newText and store it alongside the version for audit/export. But don’t rely on the model to produce it.

TL;DR
* Ditch blocks. Treat each doc as a single versioned file.
* Model returns structured edit ops, not raw diffs.
* Apply with range→anchor fallback, show hunks to the user, version the result.
* Map citations by offsets and remap after edits.
* Use optimistic concurrency + conflict handling.
If you want, I’ll write:
* the /propose prompt template that consistently yields valid EditProposal,
* the applyOps implementation with anchor fallback,
* SQL migration to introduce document_versions and doc_citations.
  tasks.md
Atomic, testable micro-tasks to implement the file-like, diff-driven editor (Copilot-style). Ordered execution; grouped by epics. Each task lists purpose, steps, acceptance criteria, effort, and dependencies.

Epic 0 — Feature Flags & Scaffolding
0.1 Add editor feature flags
Purpose: Roll out safely behind toggles. Steps: Add EDITOR_DIFF_MODE, EDITS_API_ENABLED, CITATION_OFFSET_MODE to typed config (server + client read). Acceptance:
* Flags readable in server routes and client.
* Toggling flags switches code paths in a demo route. Effort: S Deps: —
0.2 Create packages & folders
Purpose: Establish boundaries. Steps: Create @core/editor-versions, @core/edits, @core/citations-map, @ui/diff-overlay. Export empty typed stubs. Acceptance:
* Build succeeds; imports compile in app. Effort: S Deps: 0.1

Epic 1 — Schema & Migrations
1.1 Create document_versions table
Purpose: Version documents as blobs. Steps: SQL migration per spec (id, document_id, base_version_id, sha, content_md, actor, prompt, model, created_at) + unique (document_id, sha). Acceptance:
* Migration applies on staging.
* Insert/select round-trip works. Effort: S Deps: 0.1
1.2 Create doc_citations table
Purpose: Offset-based citation anchors. Steps: SQL migration per spec + index (document_id, start_pos). Acceptance:
* FK to project_citations enforced.
* Insert/select round-trip works. Effort: S Deps: 1.1
1.3 Add DB trigger for updated_at on documents
Purpose: Keep doc metadata fresh on new versions. Steps: Trigger to bump documents.updated_at on insert into document_versions. Acceptance:
* Creating a new version updates documents.updated_at. Effort: S Deps: 1.1

Epic 2 — Version Store (Server)
2.1 Implement VersionStore.getLatest
Purpose: Fetch latest version for a document. Steps: Query newest by created_at; if none, synthesize from current documents content (if applicable). Acceptance:
* Returns {id, sha, content_md} or synthesized baseline. Effort: S Deps: 1.1
2.2 Implement VersionStore.createVersion
Purpose: Persist a new version atomically. Steps: Insert row with base_version_id, computed sha, actor. Acceptance:
* Returns new id + sha; row visible in DB. Effort: S Deps: 2.1
2.3 Implement sha256 util
Purpose: Deterministic content addressing. Steps: Node crypto wrapper with UTF-8 normalization. Acceptance:
* Known vectors produce expected hashes. Effort: S Deps: —

Epic 3 — Edits API (Contracts & Validation)
3.1 Define Zod schemas for EditOp & EditProposal
Purpose: Validate model outputs strictly. Steps: Implement schemas per spec; export type inference. Acceptance:
* Invalid payloads fail with field-level messages. Effort: S Deps: 0.2
3.2 Route: POST /api/edits/propose (stub)
Purpose: Establish endpoint contract. Steps: Validate input; return mocked proposal (no model call yet). Acceptance:
* 200 with well-formed proposal; 400 on invalid. Effort: S Deps: 3.1
3.3 Route: POST /api/edits/apply
Purpose: Apply edits with optimistic concurrency. Steps: Validate payload → load latest → call ApplyOps (next epic) → if no conflicts, persist new version. Acceptance:
* 200 with {newVersionId,newSha} on success.
* 409 with STALE_BASE when baseSha mismatched.
* 409 with CONFLICT when ops can’t apply. Effort: M Deps: 2.1, 2.2, 3.1, 4.x

Epic 4 — Patch Engine (ApplyOps)
4.1 Implement tryDirectReplace
Purpose: Fast path range replace. Steps: Replace substring by offsets; validate bounds. Acceptance:
* Unit tests pass for non-overlapping ops. Effort: S Deps: —
4.2 Implement anchor search (before/after)
Purpose: Fallback when ranges drift. Steps: Sliding window search for before then after; compute new offsets. Acceptance:
* Finds anchors within ±200 chars; applies replacement. Effort: M Deps: 4.1
4.3 Implement applyOps (sorted, stable)
Purpose: Deterministic multi-op application. Steps: Sort ops desc by start; apply direct→anchor; collect conflicts. Acceptance:
* Returns {text, appliedIds, conflicts}; tests cover overlap and drift. Effort: M Deps: 4.1, 4.2
4.4 Integrate diff-match-patch fallback (optional)
Purpose: Improve robustness on heavy drift. Steps: If anchor fails, compute patch from anchors context. Acceptance:
* Additional conflicts resolved in test corpus. Effort: S Deps: 4.3

Epic 5 — Frontend Editor & Diff UI
5.1 Mount CodeMirror editor with single-doc model
Purpose: Replace block editor baseline. Steps: Render text from latest version; save on Ctrl/Cmd-S to versions API (manual version). Acceptance:
* Editor loads content; manual save creates a version row. Effort: M Deps: 2.1, 2.2
5.2 DiffOverlay: render proposed hunks
Purpose: Visual review before apply. Steps: StateField + RangeSet decorations for insert/delete; gutter markers. Acceptance:
* Given proposal, overlay shows inline adds/removals at correct positions. Effort: M Deps: 5.1, 3.2
5.3 HunkList panel with accept/reject
Purpose: Hunk-level control. Steps: Right pane list; accept→subset ops; reject→drop op; keyboard shortcuts. Acceptance:
* Accepting updates overlay; rejecting removes hunk; selection scrolls to hunk. Effort: M Deps: 5.2
5.4 Apply flow wiring
Purpose: Persist accepted ops. Steps: POST /api/edits/apply with selected ops; update editor with new text; refresh baseSha. Acceptance:
* After apply, content matches server; overlay cleared; toast shows new version id. Effort: M Deps: 3.3, 5.3
5.5 Status bar & version switcher
Purpose: Usability & audit trail. Steps: Show word count, model name last used; dropdown to compare two versions. Acceptance:
* Switching versions updates editor; diff of two versions renders. Effort: S Deps: 2.1

Epic 6 — AI Propose Integration
6.1 Prompt template for structured edits
Purpose: Reliable EditProposal generation. Steps: System+user prompts with JSON schema; few-shot examples; refuse to modify citations unless asked. Acceptance:
* ≥95% of proposals validate against Zod in test harness. Effort: M Deps: 3.1
6.2 Implement /api/edits/propose model call
Purpose: Real proposals from LLM. Steps: Call model; validate against schema; trim oversized ops; return. Acceptance:
* Invalid outputs rejected with 422; valid proposals render overlay. Effort: M Deps: 6.1, 3.2
6.3 Selection-aware proposals
Purpose: Localize changes for speed & safety. Steps: Send current selection offsets and text to prompt; bound ops to selection. Acceptance:
* When selection provided, all ops fall within selection range in tests. Effort: S Deps: 6.2

Epic 7 — Citations without Blocks
7.1 Render inline citation chips from offsets
Purpose: Keep citations visible post-blocks. Steps: Decoration layer for [citeKey] chips using doc_citations ranges. Acceptance:
* Chips appear at expected offsets; hover shows metadata. Effort: M Deps: 1.2, 5.1
7.2 Remap citation offsets after apply
Purpose: Preserve anchors across edits. Steps: Use applyOps diff mapping to translate old {start,end} to new; patch DB. Acceptance:
* After edits, chips remain attached to correct text in integration test. Effort: M Deps: 4.3, 5.4
7.3 Guardrail: protect citations from unintended edits
Purpose: Avoid accidental citation deletions. Steps: If proposal touches a citation range and prompt didn’t opt-in, mark conflict. Acceptance:
* Proposal overlapping citation yields CONFLICT unless flagged. Effort: S Deps: 3.3, 7.1

Epic 8 — Concurrency & Conflicts
8.1 Stale base handling
Purpose: Safe optimistic concurrency. Steps: On 409 STALE_BASE, reload latest, re-request propose with new baseSha. Acceptance:
* UI recovers without data loss; banner explains refresh. Effort: S Deps: 3.3, 6.2
8.2 Diff3 fallback for manual edits during review
Purpose: Merge user keystrokes with pending proposal. Steps: Maintain local branch; on apply, attempt diff3 merge; unresolved → present as conflicts. Acceptance:
* Simulated concurrent typing produces merged result or explicit conflicts. Effort: M Deps: 4.3, 5.4

Epic 9 — Migration Off Blocks
9.1 Freeze block writes behind flag
Purpose: Stop drift. Steps: If EDITOR_DIFF_MODE on, short-circuit block mutations. Acceptance:
* Writes rejected with 409 + guidance; old views still readable. Effort: S Deps: 0.1
9.2 Export block docs to Markdown
Purpose: Create initial versions. Steps: Serializer for headings/lists/quotes; inline citations → placeholders. Acceptance:
* Golden tests: sample block trees serialize to expected Markdown. Effort: M Deps: 9.1
9.3 Seed initial document_versions
Purpose: Set baseline. Steps: Insert version rows (actor system, base null, sha of exported md). Acceptance:
* Each document has exactly one initial version; hashes stable. Effort: S Deps: 9.2, 1.1
9.4 Read-only legacy viewer toggle
Purpose: Parity checks. Steps: Button to open legacy block view (no edits) alongside current. Acceptance:
* Content parity verified on sample docs. Effort: S Deps: 5.1

Epic 10 — Observability & Guardrails
10.1 Structured logs & tracing
Purpose: Diagnose latency and failures. Steps: Trace spans: propose, apply, anchor_remap; include docId/versionId. Acceptance:
* Logs show p95 durations; errors include request ids. Effort: S Deps: 3.2, 3.3, 7.2
10.2 Rate limit propose/apply
Purpose: Protect backend. Steps: Token bucket per document; 429 + Retry-After. Acceptance:
* Load test triggers 429; client backs off. Effort: S Deps: 3.2, 3.3

Epic 11 — QA: Tests & Fixtures
11.1 ApplyOps corpus tests
Purpose: Prove robustness across edits. Steps: Fixtures: insert/delete/replace/overlap/large; assert text & conflicts. Acceptance:
* All cases pass; coverage >90% for applyOps. Effort: M Deps: 4.3
11.2 End-to-end edit cycle
Purpose: Validate full flow. Steps: Load doc → propose → review → apply → new version visible. Acceptance:
* E2E test passes under EDITS_API_ENABLED=on. Effort: M Deps: 5.4, 6.2
11.3 Citation remap integration test
Purpose: Ensure anchors survive edits. Steps: Add citations; apply edits around anchors; verify new positions. Acceptance:
* 100% anchors preserved or flagged for review; none silently lost. Effort: M Deps: 7.2

Kanban (initial)
Ready: 0.1, 0.2, 1.1, 1.2, 2.1, 3.1 Next: 4.1, 4.2, 3.3, 5.1 Then: 5.2, 5.3, 5.4, 6.1, 6.2 After: 7.1, 7.2, 8.1, 9.1, 9.2 Hardening: 10.1, 10.2, 11.1–11.3