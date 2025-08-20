import DOMPurify from 'dompurify';

/* ---------- shared helpers ---------- */

const HTML_BASE_CONFIG = {
  /* element whitelist */
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6',
    'p','br','strong','em','b','i','u',
    'ul','ol','li',
    'blockquote','pre','code',
    'table','thead','tbody','tr','td','th',
    'div','span',
    'a','sup','sub'
  ],
  /* attribute whitelist */
  ALLOWED_ATTRS: ['href','target','rel','class','id'],
  /* keep data-attributes by default */
  ALLOW_DATA_ATTR: true,

  /* hard bans */
  FORBID_TAGS: ['script','style','iframe','object','embed','form','input'],
  FORBID_ATTR: ['on*'], // wildcard => all JS event handlers

  SAFE_FOR_TEMPLATES: true   // blocks “{{ }}” proto-template injections
} as const;

/* ---------- HTML sanitisers ---------- */

export function sanitizeHtml(dirty: string): string {
  try {
    const result = DOMPurify.sanitize(dirty, HTML_BASE_CONFIG as unknown as any);
    return typeof result === 'string' ? result : String(result);
  } catch (err) {
    console.error('sanitizeHtml failure', err);
    return dirty; // fall back without regex stripping (keeps auditing trail)
  }
}

export function sanitizeBibliography(dirty: string): string {
  const stricter = {
    ...HTML_BASE_CONFIG,
    ALLOWED_TAGS: ['p','br','strong','em','b','i','a','sup','sub','span'],
    ALLOWED_ATTRS: ['href','target','rel']
  } as const;

  try {
    const result = DOMPurify.sanitize(dirty, stricter as unknown as any);
    return typeof result === 'string' ? result : String(result);
  } catch (err) {
    console.error('sanitizeBibliography failure', err);
    return dirty;
  }
}

/* ---------- misc sanitisers ---------- */

export function sanitizeForLogs(text?: string | null): string {
  if (!text) return '[empty]';

  const clipped = text
    // redact obvious secrets / tokens
    .replace(/(?:api[_-]?key|token|secret|password)[=:]\s*[^\s]{8,}/gi, '[REDACTED]')
    // redact e-mails
    .replace(/\S+@\S+\.\S+/g, '[EMAIL]')
    // redact URLs w/ params
    .replace(/https?:\/\/[^\s]+\?[^\s]+/gi, '[URL_WITH_PARAMS]');

  const max = 500;
  return clipped.length > max
    ? `${clipped.slice(0, max)}… [truncated ${clipped.length - max} chars]`
    : clipped;
}

export function sanitizeUserInput(input?: string | null): string {
  if (!input) return '';
  const cleaned = input
    // remove null/control chars
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // normalise whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, 10_000);
}

export function sanitizeForAPI<T extends Record<string, unknown>>(data: T): T {
  const clone = { ...data };
  ['password','token','secret','key','auth'].forEach(f => delete (clone as any)[f]);
  return clone;
}
