export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const ProposeBody = z.object({
  documentId: z.string().uuid(),
  prompt: z.string().min(1),
  selection: z.object({ start: z.number(), end: z.number() })
})

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'AI_DISABLED' }, { status: 503 })
    }

    const body = await req.json()
    const parsed = ProposeBody.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
    }

    const raw = parsed.data.prompt.trim()
    const match = /^\s*(rewrite|expand)\s*:\s*(.*)$/i.exec(raw)
    const mode = match?.[1]?.toLowerCase() as 'rewrite' | 'expand' | undefined
    const selected = (match?.[2] || raw).slice(0, 1500) // guard length

    const system = `You are an academic writing assistant. Keep citations intact, preserve factual meaning, and respond with plain text only.`
    const user = mode === 'expand'
      ? `Expand this passage in a concise academic tone (2-4 sentences). Text: """${selected}"""`
      : `Rewrite this passage in a clearer academic tone, same length. Text: """${selected}"""`

    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      system,
      prompt: user,
      temperature: mode === 'expand' ? 0.5 : 0.3,
      maxTokens: 400
    })

    const newText = (text || '').trim()
    if (!newText) {
      return NextResponse.json({ error: 'EMPTY_RESPONSE' }, { status: 502 })
    }

    return NextResponse.json({ newText })
  } catch (e) {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
