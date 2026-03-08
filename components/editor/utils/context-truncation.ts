/**
 * Build a context-friendly truncated view of large editor content.
 * Keeps relevant middle content instead of dropping it entirely.
 */
export function truncateDocumentForAIContext(
  documentContent: string,
  options?: {
    maxChars?: number
    focusText?: string
  }
): string {
  const maxChars = options?.maxChars ?? 20_000
  if (documentContent.length <= maxChars) {
    return documentContent
  }

  const focusText = options?.focusText?.trim()
  if (focusText && focusText.length >= 16) {
    const lowerDoc = documentContent.toLowerCase()
    const lowerFocus = focusText.toLowerCase()
    const focusIndex = lowerDoc.indexOf(lowerFocus)

    if (focusIndex !== -1) {
      const start = Math.max(
        0,
        Math.min(
          focusIndex - Math.floor((maxChars - focusText.length) / 2),
          documentContent.length - maxChars
        )
      )
      const end = Math.min(documentContent.length, start + maxChars)
      const focusedSlice = documentContent.slice(start, end)
      return (
        `[Document truncated for speed: focused around selected text. Showing chars ${start}-${end} of ${documentContent.length}]\n\n` +
        focusedSlice
      )
    }
  }

  // Fallback: preserve beginning + middle + end to avoid blind spots.
  const segmentSize = Math.max(1, Math.floor(maxChars / 3))
  const head = documentContent.slice(0, segmentSize)
  const middleStart = Math.max(0, Math.floor(documentContent.length / 2 - segmentSize / 2))
  const middle = documentContent.slice(middleStart, middleStart + segmentSize)
  const tail = documentContent.slice(-segmentSize)

  return (
    `[Document truncated for speed: showing beginning, middle, and end excerpts of ${documentContent.length} chars]\n\n` +
    head +
    `\n\n--- [middle excerpt] ---\n\n` +
    middle +
    `\n\n--- [end excerpt] ---\n\n` +
    tail
  )
}
