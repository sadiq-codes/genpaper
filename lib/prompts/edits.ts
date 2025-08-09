import { z } from 'zod'
import { EditProposalZ } from '@/lib/schemas/edits'

export const SYSTEM_EDITS = `You are a precise editing assistant. Return only JSON matching the provided schema. Do not include explanations or markdown fences. Prefer minimal, localized edits. Do not change citations unless explicitly instructed.`

export function userEditsPrompt(params: {
  baseText: string
  selection?: { start: number; end: number }
  instruction: string
}) {
  const selInfo = params.selection ? `Selection: ${params.selection.start}..${params.selection.end}` : 'Selection: none'
  return [
    `Instruction: ${params.instruction}`,
    selInfo,
    'BaseText:\n' + params.baseText,
    'Schema (TypeScript):',
    `EditProposal = { baseSha: string, operations: Array<{ id: string, range?: {start:number,end:number}, anchor?: {before:string,after:string}, replacement: string, note?: string, confidence?: number }>} `,
    'Return only valid JSON per schema.',
  ].join('\n\n')
}

export function validateEditProposal(jsonText: string) {
  let obj: unknown
  try { obj = JSON.parse(jsonText) } catch (e) { return { ok: false as const, error: 'INVALID_JSON' } }
  const parsed = EditProposalZ.safeParse(obj)
  if (!parsed.success) return { ok: false as const, error: 'SCHEMA_MISMATCH', details: parsed.error.flatten() }
  return { ok: true as const, value: parsed.data }
}