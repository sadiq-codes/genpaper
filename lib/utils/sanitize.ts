import DOMPurify from 'dompurify'

/**
 * Sanitize HTML content to prevent XSS attacks
 * Used for safely rendering content with dangerouslySetInnerHTML
 */
export function sanitizeHtml(dirty: string): string {
  // Configure DOMPurify for academic content
  const config = {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'em', 'b', 'i', 'u',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'div', 'span',
      'a', 'sup', 'sub'
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'class', 'id',
      'data-*', // Allow data attributes for citation tracking
    ],
    ALLOW_DATA_ATTR: true,
    // Keep citations and academic formatting
    KEEP_CONTENT: true,
    // Remove scripts and event handlers
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input']
  }

  try {
    return DOMPurify.sanitize(dirty, config)
  } catch (error) {
    console.error('HTML sanitization failed:', error)
    // Fallback: strip all HTML tags as last resort
    return dirty.replace(/<[^>]*>/g, '')
  }
}

/**
 * Sanitize bibliography HTML with more restrictive rules
 */
export function sanitizeBibliography(dirty: string): string {
  const config = {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i',
      'a', 'sup', 'sub', 'span'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    // Very restrictive for bibliography
    KEEP_CONTENT: true,
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'class', 'id'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'div']
  }

  try {
    return DOMPurify.sanitize(dirty, config)
  } catch (error) {
    console.error('Bibliography sanitization failed:', error)
    return dirty.replace(/<[^>]*>/g, '')
  }
}

/**
 * Sanitize a string for logging by removing characters that could be used for log injection.
 * This is NOT for preventing XSS. It's to ensure log integrity.
 */
export function sanitizeForLogs(input: string): string {
  if (!input) {
    return ''
  }
  // Remove newlines, carriage returns, and other control characters
  // that could be used to forge log entries.
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\r\n\x00-\x1F\x7F]/g, '')
} 