"use client"
import React from 'react'
import type { EditOp } from '@/lib/schemas/edits'

export interface HunkListProps {
  operations: EditOp[]
  acceptedIds: Set<string>
  onToggle: (id: string) => void
}

export function HunkList({ operations, acceptedIds, onToggle }: HunkListProps) {
  return (
    <div className="space-y-2">
      {operations.map((op) => (
        <label key={op.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptedIds.has(op.id)}
            onChange={() => onToggle(op.id)}
          />
          <span>
            <span className="font-mono text-xs text-muted-foreground">[{op.range?.start ?? '?'}..{op.range?.end ?? '?'}]</span>
            {' '}
            {op.note || 'proposed change'}
          </span>
        </label>
      ))}
    </div>
  )
}