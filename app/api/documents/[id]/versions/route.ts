import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { VersionStore } from '@/lib/core/editor-versions'

const CreateVersionSchema = z.object({
  contentMd: z.string(),
  actor: z.enum(['user', 'ai']),
  baseVersionId: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional()
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const documentId = params.id
  if (!documentId) {
    return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const parsed = CreateVersionSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Get the latest version to use as base
    let baseVersionId: string | null = parsed.data.baseVersionId || null
    if (!baseVersionId) {
      try {
        const latest = await VersionStore.getLatest(documentId)
        baseVersionId = latest.id !== 'baseline' ? latest.id : null
      } catch {
        // If no latest version exists, baseVersionId stays null
        baseVersionId = null
      }
    }

    const version = await VersionStore.createVersion({
      documentId,
      baseVersionId,
      contentMd: parsed.data.contentMd,
      actor: parsed.data.actor,
      prompt: parsed.data.prompt || null,
      model: parsed.data.model || null
    })

    return NextResponse.json(version)
  } catch (error) {
    console.error('Failed to create version:', error)
    return NextResponse.json(
      { error: 'CREATE_FAILED', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}