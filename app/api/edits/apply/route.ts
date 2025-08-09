import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { EditProposalZ } from '@/lib/schemas/edits'
import { VersionStore } from '@/lib/core/editor-versions'
import { applyOps } from '@/lib/core/apply-ops'
import { isEditsApiEnabled } from '@/lib/config/feature-flags'
import { createHash } from 'crypto'
import { getSB } from '@/lib/supabase/server'

const ApplyBodyZ = EditProposalZ.extend({
  documentId: z.string().uuid(),
})

default export async function handler(request: NextRequest) {
  if (!isEditsApiEnabled()) {
    return NextResponse.json({ error: 'EDITS_API_DISABLED' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const parsed = ApplyBodyZ.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', details: parsed.error.flatten() }, { status: 400 })
  }

  const { documentId, baseSha, operations } = parsed.data

  // Load latest version
  const latest = await VersionStore.getLatest(documentId)
  if (latest.sha !== baseSha) {
    return NextResponse.json({ error: 'STALE_BASE' }, { status: 409 })
  }

  // Apply operations
  const result = applyOps(latest.content_md, operations)
  if (result.conflicts.length > 0) {
    return NextResponse.json({ error: 'CONFLICT', conflicts: result.conflicts }, { status: 409 })
  }

  const newSha = createHash('sha256').update(result.text, 'utf8').digest('hex')

  // Persist new version
  const supabase = await getSB()
  const { data: inserted, error } = await supabase
    .from('document_versions')
    .insert({
      document_id: documentId,
      base_version_id: latest.id !== 'baseline' ? latest.id : null,
      sha: newSha,
      content_md: result.text,
      actor: 'user',
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return NextResponse.json({ error: 'PERSIST_FAILED', details: error?.message }, { status: 500 })
  }

  // 7.2: Remap citation offsets in DB using old→new mapping
  try {
    const { data: anchors } = await supabase
      .from('doc_citations')
      .select('id, start_pos, end_pos')
      .eq('document_id', documentId)
    
    if (anchors && anchors.length > 0) {
      const updates = anchors.map((a: any) => ({
        id: a.id,
        start_pos: result.mapOldToNew(a.start_pos),
        end_pos: result.mapOldToNew(a.end_pos),
      }))
      // Batch update; fallback to per-row if necessary
      for (const u of updates) {
        await supabase.from('doc_citations').update({ start_pos: u.start_pos, end_pos: u.end_pos }).eq('id', u.id)
      }
    }
  } catch (e) {
    console.warn('Citation remap failed:', e)
  }

  return NextResponse.json({ newVersionId: inserted.id, newSha })
}

export const POST = handler