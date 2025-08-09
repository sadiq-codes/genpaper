"use client"
import React from 'react'
import type { EditOp } from '@/lib/schemas/edits'

export interface DiffOverlayProps {
  baseText: string
  operations: EditOp[]
}

export function DiffOverlay({ baseText, operations }: DiffOverlayProps) {
  // Render naive inline markup: show deletions [..] and insertions {..}
  // For now, compute only from range (anchor-only ops are not visualized here)
  const segments: Array<{ t: string; kind: 'keep'|'del'|'ins' }> = []
  let cursor = 0
  const sorted = [...operations].sort((a, b) => (a.range?.start ?? 0) - (b.range?.start ?? 0))

  for (const op of sorted) {
    const s = op.range?.start ?? null
    const e = op.range?.end ?? null
    if (s === null || e === null) continue
    if (s > cursor) {
      segments.push({ t: baseText.slice(cursor, s), kind: 'keep' })
    }
    // deletion
    if (e > s) {
      segments.push({ t: baseText.slice(s, e), kind: 'del' })
    }
    // insertion
    if (op.replacement.length > 0) {
      segments.push({ t: op.replacement, kind: 'ins' })
    }
    cursor = e
  }
  if (cursor < baseText.length) {
    segments.push({ t: baseText.slice(cursor), kind: 'keep' })
  }

  return (
    <pre className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        if (seg.kind === 'keep') return <span key={i}>{seg.t}</span>
        if (seg.kind === 'del') return <mark key={i} className="bg-red-200 line-through">{seg.t}</mark>
        return <mark key={i} className="bg-green-200">{seg.t}</mark>
      })}
    </pre>
  )
}