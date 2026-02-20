export type PaperProcessingStatus =
  | 'pending'
  | 'abstract_ready'
  | 'full_text_ready'
  | 'failed'

export const FULL_TEXT_READY_MIN_CHARS = 500
const FULL_TEXT_READY_ALLOWED_SOURCES = new Set(['pdf', 'html'])

export function normalizePaperProcessingStatus(
  status: string | null | undefined
): PaperProcessingStatus {
  if (status === 'abstract_ready' || status === 'full_text_ready' || status === 'failed') {
    return status
  }
  if (status === 'processed') {
    // Legacy mapping from old enum.
    return 'full_text_ready'
  }
  if (status === 'processing') {
    // Legacy mapping from old enum.
    return 'pending'
  }
  return 'pending'
}

export function isChunkReadyStatus(status: PaperProcessingStatus): boolean {
  return status === 'abstract_ready' || status === 'full_text_ready'
}

export function isFullTextReadyStatus(status: PaperProcessingStatus): boolean {
  return status === 'full_text_ready'
}

export function canMarkFullTextReady(
  pdfContent: string | null | undefined,
  contentSource: string | null | undefined
): boolean {
  return (
    typeof pdfContent === 'string' &&
    pdfContent.length >= FULL_TEXT_READY_MIN_CHARS &&
    typeof contentSource === 'string' &&
    FULL_TEXT_READY_ALLOWED_SOURCES.has(contentSource)
  )
}
