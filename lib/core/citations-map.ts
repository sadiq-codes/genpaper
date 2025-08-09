export interface CitationAnchor {
  projectCitationId: string
  start_pos: number
  end_pos: number
}

export interface RemapResult {
  anchors: CitationAnchor[]
  remapped: number
  conflicts: number
}

/**
 * Remap citation anchors using an edits diff mapping (stub).
 * Replace with applyOps-produced mapping later.
 */
export function remapCitationAnchors(
  anchors: CitationAnchor[],
  _oldToNewOffset: (pos: number) => number
): RemapResult {
  // For now, pass-through
  return { anchors, remapped: 0, conflicts: 0 }
}