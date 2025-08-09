"use client"
import React, { useEffect, useMemo, useState } from 'react'

export interface CitationChip {
  id: string
  start_pos: number
  end_pos: number
  citeKey?: string
}

export function CitationChips({
  text,
  anchors,
}: {
  text: string
  anchors: CitationChip[]
}) {
  const segments = useMemo(() => {
    const list = [...anchors].sort((a, b) => a.start_pos - b.start_pos)
    const parts: Array<{ t: string; kind: 'text'|'cite'; id?: string; citeKey?: string }> = []
    let cursor = 0
    for (const a of list) {
      if (a.start_pos > cursor) parts.push({ t: text.slice(cursor, a.start_pos), kind: 'text' })
      parts.push({ t: a.citeKey ? `[${a.citeKey}]` : '[cite]', kind: 'cite', id: a.id, citeKey: a.citeKey })
      cursor = a.end_pos
    }
    if (cursor < text.length) parts.push({ t: text.slice(cursor), kind: 'text' })
    return parts
  }, [text, anchors])

  return (
    <pre className="whitespace-pre-wrap break-words">
      {segments.map((p, i) => p.kind === 'text' ? (
        <span key={i}>{p.t}</span>
      ) : (
        <span key={i} className="px-1 py-0.5 rounded bg-blue-100 text-blue-800 text-xs align-baseline">{p.t}</span>
      ))}
    </pre>
  )
}