import { NextRequest, NextResponse } from 'next/server'
import { getSB } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const documentId = params.id
  if (!documentId) return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })

  try {
    const supabase = await getSB()
    const { data, error } = await supabase
      .from('doc_citations')
      .select('id, document_id, project_citation_id, start_pos, end_pos, project_citations ( cite_key )')
      .eq('document_id', documentId)
    if (error) throw error

    const anchors = (data || []).map((row: any) => ({
      id: row.id,
      document_id: row.document_id,
      project_citation_id: row.project_citation_id,
      start_pos: row.start_pos,
      end_pos: row.end_pos,
      citeKey: row.project_citations?.cite_key || null,
    }))

    return NextResponse.json({ anchors })
  } catch (e: any) {
    return NextResponse.json({ error: 'FETCH_FAILED', details: e?.message ?? String(e) }, { status: 500 })
  }
}