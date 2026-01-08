/**
 * Prompt Safety Utilities
 * 
 * Filters user input before it's injected into LLM prompts to prevent
 * prompt injection attacks and jailbreak attempts.
 */

// Common prompt injection patterns to detect
const INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  
  // Role manipulation
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /act\s+as\s+(a|an|the)\s+/i,
  /roleplay\s+as\s+/i,
  
  // System prompt extraction
  /what\s+(is|are)\s+your\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?your\s+(system\s+)?prompt/i,
  /reveal\s+(your\s+)?(system\s+)?instructions/i,
  /print\s+(your\s+)?instructions/i,
  
  // Jailbreak attempts
  /\bdan\s*mode\b/i,
  /\bdeveloper\s*mode\b/i,
  /\bjailbreak\b/i,
  /\bunlock\b.*\bmode\b/i,
  
  // Delimiter injection
  /```\s*(system|assistant|user)\s*:/i,
  /<\|?(system|assistant|user|im_start|im_end)\|?>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  
  // Output manipulation
  /respond\s+(only\s+)?with\s+(the\s+)?(word|phrase|text)/i,
  /your\s+response\s+must\s+(only\s+)?(be|contain|include)/i,
]

// Characters that could be used to break prompt structure
const DANGEROUS_SEQUENCES = [
  '```system',
  '```assistant', 
  '```user',
  '<|system|>',
  '<|user|>',
  '<|assistant|>',
  '<<SYS>>',
  '<</SYS>>',
  '[INST]',
  '[/INST]',
]

/**
 * Sanitize a topic string for safe prompt injection
 */
export function sanitizeTopic(topic: string): string {
  let sanitized = topic

  // 1. Truncate to max length
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500)
    console.warn(`Topic truncated from ${topic.length} to 500 chars`)
  }

  // 2. Remove dangerous sequences
  for (const seq of DANGEROUS_SEQUENCES) {
    if (sanitized.toLowerCase().includes(seq.toLowerCase())) {
      sanitized = sanitized.replace(new RegExp(escapeRegex(seq), 'gi'), '[FILTERED]')
      console.warn(`Removed dangerous sequence: ${seq}`)
    }
  }

  // 3. Filter injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      sanitized = sanitized.replace(pattern, '[FILTERED]')
      console.warn(`Detected injection pattern in topic`)
    }
  }

  // 4. Remove newlines and normalize whitespace
  sanitized = sanitized.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

  // 5. Remove control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '')

  return sanitized
}

// Helper to escape regex special characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
