import { NextRequest, NextResponse } from 'next/server'
import { VersionStore } from '@/lib/core/editor-versions'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const documentId = resolvedParams.id
  if (!documentId) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })
  }

  try {
    const latest = await VersionStore.getLatest(documentId)
    return NextResponse.json(latest)
  } catch (error) {
    console.error('Failed to get latest version:', error)
    return NextResponse.json(
      { error: 'FETCH_FAILED', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}