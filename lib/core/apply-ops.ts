import 'server-only'
import { type EditOp } from '@/lib/schemas/edits'

interface ApplyResult {
  text: string
  applied: string[]
  conflicts: EditOp[]
  mapOldToNew: (pos: number) => number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/**
 * Fast path: apply replacement using exact range offsets.
 */
export function tryDirectReplace(baseText: string, op: EditOp): { ok: boolean; text: string } {
  if (!op.range) return { ok: false, text: baseText }
  const { start = 0, end = 0 } = op.range
  if (start < 0 || end < 0 || start > end || end > baseText.length) {
    return { ok: false, text: baseText }
  }
  const before = baseText.slice(0, start)
  const after = baseText.slice(end)
  return { ok: true, text: before + op.replacement + after }
}

/**
 * Anchor fallback: find the anchor window near the original range and replace.
 * Searches within ±200 chars of the provided range start; if no range, searches whole text.
 */
export function tryAnchorReplace(baseText: string, op: EditOp): { ok: boolean; text: string } {
  const anchor = op.anchor
  if (!anchor || (!anchor.before && !anchor.after)) return { ok: false, text: baseText }

  const windowRadius = 200
  let searchStart = 0
  let searchEnd = baseText.length

  if (op.range && typeof op.range.start === 'number') {
    searchStart = clamp(op.range.start - windowRadius, 0, baseText.length)
    searchEnd = clamp(op.range.start + windowRadius, 0, baseText.length)
  }

  const haystack = baseText.slice(searchStart, searchEnd)

  // Find the before anchor first
  let beforeIdx = -1
  if (anchor.before) {
    beforeIdx = haystack.indexOf(anchor.before)
    if (beforeIdx >= 0) {
      beforeIdx += searchStart
    }
  }

  // Find after anchor relative to before or independently
  let afterIdx = -1
  if (anchor.after) {
    const startPos = beforeIdx >= 0 ? beforeIdx + (anchor.before?.length || 0) : searchStart
    const afterHay = baseText.slice(startPos, searchEnd)
    const relAfter = afterHay.indexOf(anchor.after)
    if (relAfter >= 0) {
      afterIdx = startPos + relAfter
    }
  }

  // Derive replacement bounds
  let replaceStart: number | null = null
  let replaceEnd: number | null = null

  if (beforeIdx >= 0 && anchor.before) {
    replaceStart = beforeIdx + anchor.before.length
  } else if (op.range) {
    replaceStart = op.range.start ?? 0
  }

  if (afterIdx >= 0) {
    replaceEnd = afterIdx
  } else if (op.range) {
    replaceEnd = op.range.end ?? replaceStart ?? 0
  }

  if (
    replaceStart === null ||
    replaceEnd === null ||
    replaceStart < 0 ||
    replaceEnd < replaceStart ||
    replaceEnd > baseText.length
  ) {
    return { ok: false, text: baseText }
  }

  const before = baseText.slice(0, replaceStart)
  const after = baseText.slice(replaceEnd)
  return { ok: true, text: before + op.replacement + after }
}

/**
 * Apply multiple operations deterministically (descending start offsets).
 */
export function applyOps(baseText: string, ops: EditOp[]): ApplyResult {
  const sortedDesc = [...ops].sort((a, b) => {
    const as = a.range?.start ?? 0
    const bs = b.range?.start ?? 0
    return bs - as
  })

  let text = baseText
  const applied: string[] = []
  const conflicts: EditOp[] = []

  for (const op of sortedDesc) {
    const direct = tryDirectReplace(text, op)
    if (direct.ok) {
      text = direct.text
      applied.push(op.id)
      continue
    }

    const anch = tryAnchorReplace(text, op)
    if (anch.ok) {
      text = anch.text
      applied.push(op.id)
      continue
    }

    conflicts.push(op)
  }

  // Build a simple offset mapping from old→new positions based on ranges
  // Assumes non-overlapping or already-resolved ops; anchor-only ops are ignored for mapping.
  type Span = { start: number; end: number; delta: number }
  const spans: Span[] = []
  const asc = [...ops]
    .filter(op => typeof op.range?.start === 'number' && typeof op.range?.end === 'number')
    .sort((a, b) => (a.range!.start! - b.range!.start!))

  for (const op of asc) {
    const s = op.range!.start!
    const e = op.range!.end!
    const repLen = op.replacement.length
    const delta = repLen - (e - s)
    spans.push({ start: s, end: e, delta })
  }

  // Precompute cumulative deltas
  const checkpoints: { pos: number; cum: number }[] = []
  let cum = 0
  for (const sp of spans) {
    checkpoints.push({ pos: sp.end, cum: (cum += sp.delta) })
  }

  const mapOldToNew = (pos: number): number => {
    let adj = 0
    for (const cp of checkpoints) {
      if (pos >= cp.pos) adj = cp.cum
      else break
    }
    return pos + adj
  }

  return { text, applied, conflicts, mapOldToNew }
}