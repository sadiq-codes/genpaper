import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { EditOpZ as _EditOpZ, EditProposalZ as _EditProposalZ, type EditProposal } from '@/lib/schemas/edits'
// Edits API is always enabled
import { editsProposeLimiter } from '@/lib/utils/rate-limiter'
import { ai } from '@/lib/ai/vercel-client'
import { generateText } from 'ai'
import { SYSTEM_EDITS, userEditsPrompt, validateEditProposal } from '@/lib/prompts/edits'

const ProposeBodyZ = z.object({
  documentId: z.string().uuid(),
  baseSha: z.string(),
  prompt: z.string().min(1).max(2000),
  selection: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
  model: z.string().optional()
})

export async function POST(request: NextRequest) {
  // Always enabled

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const parsed = ProposeBodyZ.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', details: parsed.error.flatten() }, { status: 400 })
  }

  const { documentId, baseSha, prompt, selection, model } = parsed.data

  // Rate limit per document
  const rl = editsProposeLimiter.checkLimit(documentId, 1)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'RATE_LIMIT', retryAfter: rl.retryAfter }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } })
  }

  // If no model requested, return stubbed proposal
  if (!model) {
    const operations = [{ id: crypto.randomUUID(), range: selection ?? { start: 0, end: 0 }, replacement: '', note: 'stub', confidence: 0.0 }]
    const proposal: EditProposal = { baseSha, operations }
    return NextResponse.json(proposal)
  }

  // Model-backed path
  try {
    const input = userEditsPrompt({ baseText: '', selection, instruction: prompt })
    const { text } = await generateText({
      model: ai(model),
      system: SYSTEM_EDITS,
      prompt: input,
      temperature: 0.2,
      maxTokens: 800
    })
    const result = validateEditProposal(text)
    if (!result.ok) {
      return NextResponse.json({ error: 'LLM_SCHEMA_FAILED', details: result }, { status: 422 })
    }

    // Ensure baseSha matches request
    const ensured: EditProposal = { ...result.value, baseSha }
    return NextResponse.json(ensured)
  } catch (e: any) {
    return NextResponse.json({ error: 'LLM_ERROR', details: e?.message ?? String(e) }, { status: 502 })
  }
}