/**
 * Query Translation Service
 * 
 * Detects non-English topics and translates them for academic API searches.
 * Preserves original language for paper generation output.
 */

import { generateText } from 'ai'
import { getLanguageModel } from '@/lib/ai/vercel-client'

// Unicode ranges for non-Latin scripts
const NON_LATIN_PATTERNS = [
  /[\u0600-\u06FF]/,  // Arabic, Persian, Urdu
  /[\u0750-\u077F]/,  // Arabic Supplement
  /[\u4E00-\u9FFF]/,  // Chinese (CJK)
  /[\u3040-\u30FF]/,  // Japanese (Hiragana + Katakana)
  /[\uAC00-\uD7AF]/,  // Korean (Hangul)
  /[\u0400-\u04FF]/,  // Cyrillic (Russian, etc.)
  /[\u0370-\u03FF]/,  // Greek
  /[\u0900-\u097F]/,  // Devanagari (Hindi, Sanskrit)
  /[\u0980-\u09FF]/,  // Bengali
  /[\u0A80-\u0AFF]/,  // Gujarati
  /[\u0E00-\u0E7F]/,  // Thai
  /[\u0590-\u05FF]/,  // Hebrew
]

export interface TranslationResult {
  /** Original topic as entered by user */
  originalTopic: string
  /** English version for API searches */
  searchTopic: string
  /** Detected language name (e.g., "Persian", "Chinese", "Arabic") */
  outputLanguage: string
  /** Whether translation was performed */
  wasTranslated: boolean
}

/**
 * Detect if text contains non-Latin scripts that require translation
 */
export function containsNonLatinScript(text: string): boolean {
  return NON_LATIN_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Detect the likely language of the text based on script analysis
 */
export function detectLanguage(text: string): string | null {
  // Arabic/Persian/Urdu detection
  if (/[\u0600-\u06FF]/.test(text)) {
    // Persian-specific characters: پ چ ژ گ ک
    if (/[پچژگک]/.test(text)) return 'Persian'
    // Urdu-specific characters: ٹ ڈ ڑ ں ے
    if (/[ٹڈڑںے]/.test(text)) return 'Urdu'
    return 'Arabic'
  }
  
  // East Asian languages
  if (/[\u4E00-\u9FFF]/.test(text)) {
    // Check for Japanese-specific characters
    if (/[\u3040-\u30FF]/.test(text)) return 'Japanese'
    return 'Chinese'
  }
  if (/[\u3040-\u30FF]/.test(text)) return 'Japanese'
  if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean'
  
  // Other scripts
  if (/[\u0400-\u04FF]/.test(text)) return 'Russian'
  if (/[\u0370-\u03FF]/.test(text)) return 'Greek'
  if (/[\u0900-\u097F]/.test(text)) return 'Hindi'
  if (/[\u0980-\u09FF]/.test(text)) return 'Bengali'
  if (/[\u0590-\u05FF]/.test(text)) return 'Hebrew'
  if (/[\u0E00-\u0E7F]/.test(text)) return 'Thai'
  
  return null
}

/**
 * Translate a non-English topic to English for academic API searches.
 * Returns both the translated version (for search) and original (for output).
 * 
 * @param topic - The research topic, potentially in a non-English language
 * @returns TranslationResult with original, translated topic, and detected language
 */
export async function translateTopicForSearch(topic: string): Promise<TranslationResult> {
  const trimmedTopic = topic.trim()
  
  // Check if translation is needed
  if (!containsNonLatinScript(trimmedTopic)) {
    return {
      originalTopic: trimmedTopic,
      searchTopic: trimmedTopic,
      outputLanguage: 'English',
      wasTranslated: false
    }
  }
  
  const detectedLanguage = detectLanguage(trimmedTopic) || 'non-English'
  
  console.log(`🌐 Non-English topic detected: ${detectedLanguage}`)
  console.log(`   Original: "${trimmedTopic.slice(0, 80)}${trimmedTopic.length > 80 ? '...' : ''}"`)
  
  // If no API key, return original (search will likely fail but gracefully)
  if (!process.env.OPENAI_API_KEY) {
    console.warn(`   ⚠️ No API key available for translation - proceeding with original topic`)
    return {
      originalTopic: trimmedTopic,
      searchTopic: trimmedTopic,
      outputLanguage: detectedLanguage,
      wasTranslated: false
    }
  }
  
  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: `You are an academic translator specializing in research topics. 
Translate the given research topic to English while:
- Preserving academic terminology and meaning
- Maintaining proper nouns (names, places) in their commonly used English forms
- Keeping technical terms accurate
Return ONLY the English translation, nothing else.`,
      prompt: `Translate this ${detectedLanguage} research topic to English:

"${trimmedTopic}"

English translation:`,
      temperature: 0.1,
      maxOutputTokens: 300
    })
    
    // Clean up the translation (remove quotes, extra whitespace)
    const translatedTopic = text
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^English translation:\s*/i, '')
      .trim()
    
    console.log(`   Translated: "${translatedTopic.slice(0, 80)}${translatedTopic.length > 80 ? '...' : ''}"`)
    
    return {
      originalTopic: trimmedTopic,
      searchTopic: translatedTopic,
      outputLanguage: detectedLanguage,
      wasTranslated: true
    }
  } catch (err) {
    console.error(`   ⚠️ Translation failed:`, err instanceof Error ? err.message : err)
    console.log(`   Proceeding with original topic`)
    
    return {
      originalTopic: trimmedTopic,
      searchTopic: trimmedTopic,
      outputLanguage: detectedLanguage,
      wasTranslated: false
    }
  }
}

/**
 * Translate key findings from non-English to English for search enhancement.
 * Used when user has original research with findings in their native language.
 */
export async function translateKeyFindings(
  keyFindings: string,
  sourceLanguage: string
): Promise<string> {
  if (!keyFindings || sourceLanguage === 'English') {
    return keyFindings
  }
  
  if (!containsNonLatinScript(keyFindings)) {
    return keyFindings
  }
  
  if (!process.env.OPENAI_API_KEY) {
    return keyFindings
  }
  
  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: `You are an academic translator. Translate research findings to English while preserving scientific accuracy and terminology.`,
      prompt: `Translate these ${sourceLanguage} research findings to English:

"${keyFindings.slice(0, 1000)}"

English translation:`,
      temperature: 0.1,
      maxOutputTokens: 500
    })
    
    return text.trim().replace(/^["']|["']$/g, '')
  } catch {
    return keyFindings
  }
}
