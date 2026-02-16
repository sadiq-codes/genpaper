import { getStyleById, isNumericStyleId } from './csl-styles'

export type CitationStyleFamily = 'apa' | 'mla' | 'chicago' | 'harvard' | 'ieee'

function normalizeStyle(style: string): string {
  return (style || 'apa').toLowerCase().trim()
}

/**
 * Numeric-like styles include classic numeric formats (IEEE/Vancouver),
 * plus note/label families which are rendered as numbered references in-app.
 */
export function isNumericLikeCitationStyle(style: string): boolean {
  const normalized = normalizeStyle(style)

  const known = getStyleById(normalized)
  if (known && (known.category === 'numeric' || known.category === 'note' || known.category === 'label')) {
    return true
  }

  if (isNumericStyleId(normalized)) return true

  return (
    normalized.includes('ieee') ||
    normalized.includes('vancouver') ||
    normalized.includes('number') ||
    normalized.includes('numeric') ||
    normalized.includes('superscript')
  )
}

/**
 * Collapse arbitrary CSL IDs into a rendering family we support in server logic.
 * This keeps behavior stable for all styles while allowing richer IDs.
 */
export function resolveCitationStyleFamily(style: string): CitationStyleFamily {
  const normalized = normalizeStyle(style)

  if (isNumericLikeCitationStyle(normalized)) return 'ieee'

  if (
    normalized === 'mla' ||
    normalized.includes('modern-language-association') ||
    normalized.includes('mla')
  ) {
    return 'mla'
  }

  if (
    normalized.includes('chicago') ||
    normalized.includes('turabian')
  ) {
    return 'chicago'
  }

  if (normalized.includes('harvard')) {
    return 'harvard'
  }

  return 'apa'
}

