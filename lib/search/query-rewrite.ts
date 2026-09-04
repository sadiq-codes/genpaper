/**
 * Query Rewrite Service
 * 
 * Uses centralized AI model configuration for query enhancement.
 * Includes spell correction integrated into the rewrite prompt (single LLM call).
 */

import { fog } from '@/lib/ai/foglamp'

const { generateText } = fog.with({ traceName: "Query rewrite" })
import { getLanguageModel } from '@/lib/ai/vercel-client'

/**
 * Original research context for enhanced query generation
 */
export interface OriginalResearchContext {
  researchQuestion?: string
  keyFindings?: string
}

/**
 * Generate up to k alternative keyword search queries that are semantically
 * similar to the input query. Also corrects spelling errors in the same LLM call.
 * Falls back to returning the original query if no LLM key is present or API fails.
 * 
 * @param query - The original search query (may contain typos)
 * @param k - Number of alternative queries to generate (default: 3)
 * @param discipline - Optional academic discipline to focus the queries (e.g., "American Literature")
 */
export async function generateQueryRewrites(query: string, k = 3, discipline?: string): Promise<string[]> {
  const trimmedQuery = query.trim()
  const rewrites: string[] = [trimmedQuery]

  if (!process.env.OPENAI_API_KEY) return rewrites

  // Build discipline-aware prompt context - fully dynamic, no hardcoded discipline examples
  const disciplineContext = discipline 
    ? `\n\nSTRICT DISCIPLINE CONSTRAINT:
The topic is in "${discipline}".
- ALL queries MUST stay within ${discipline} — do NOT generate queries that could match papers from other fields
- Use terminology, journal names, and methodology keywords specific to ${discipline}
- If the topic involves a term that exists in multiple fields (e.g., "contamination", "growth", "culture"), always pair it with domain-specific terms to disambiguate`
    : ''

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: 'You are an academic search assistant. Generate keyword queries that are narrowly focused on the exact topic — never drift into adjacent or unrelated disciplines.',
      prompt: `First, correct any spelling errors in this query: "${trimmedQuery}"

Then generate ${k} alternative keyword-style academic search queries that would find papers on the SAME specific topic.${disciplineContext}

RULES:
- Every query must be about the same subject as the original
- Use specific scientific/academic terms, not generic words
- Do NOT broaden to adjacent fields or methodologies from other domains

Return a JSON array where:
- The FIRST element is the spell-corrected version of the original query
- The remaining ${k} elements are alternative search queries

Example format: ["corrected original query", "alternative 1", "alternative 2", "alternative 3"]

Return ONLY the raw JSON array. Do not use markdown code blocks or any formatting.`,
      temperature: 0.3,
      maxOutputTokens: 250
    })

    let arr: string[] = []
    try {
      arr = JSON.parse(text)
    } catch {
      // fallback: attempt to split by newline / dash
      arr = text.split(/\n|\r|-/).map((s: string) => s.trim()).filter(Boolean)
    }

    // First element is the corrected query, rest are alternatives
    if (arr.length > 0) {
      const correctedQuery = arr[0]
      if (correctedQuery && correctedQuery !== trimmedQuery) {
        console.log(`🔤 Spell correction: "${trimmedQuery}" → "${correctedQuery}"`)
      }
      // Replace the original with corrected, then add alternatives
      rewrites[0] = correctedQuery || trimmedQuery
      rewrites.push(...arr.slice(1, k + 1))
    }
  } catch (err) {
    console.warn('query-rewrite failed', err)
  }

  // Remove dups & empty, limit to k+1 items
  return Array.from(new Set(rewrites)).filter(Boolean).slice(0, k + 1)
}

/**
 * Build enhanced search queries from topic/research question and key findings.
 * 
 * For users with original research, this generates multiple targeted queries:
 * 1. Main topic/research question (broad search)
 * 2. Key concepts extracted from findings (comparative/related work search)
 * 3. Methodology-focused terms (methods search)
 * 
 * @param topic - The main topic or research question
 * @param originalResearch - Optional context with key findings
 * @param discipline - Optional academic discipline to focus the queries
 * @returns Array of search queries, deduplicated
 */
export async function buildEnhancedSearchQueries(
  topic: string,
  originalResearch?: OriginalResearchContext,
  discipline?: string
): Promise<string[]> {
  const queries: string[] = [topic.trim()]

  // If no original research context, just return basic rewrites
  if (!originalResearch?.keyFindings) {
    return generateQueryRewrites(topic, 3, discipline)
  }

  // Don't call LLM if no API key
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: combine topic with a simplified version of key findings
    const simplifiedFindings = originalResearch.keyFindings
      .slice(0, 200)
      .replace(/[^\w\s]/g, ' ')
      .trim()
    
    if (simplifiedFindings.length > 20) {
      queries.push(`${topic} ${simplifiedFindings.split(' ').slice(0, 10).join(' ')}`)
    }
    
    return Array.from(new Set(queries)).filter(Boolean)
  }

  const disciplineHint = discipline ? `\nDISCIPLINE: ${discipline} — ALL queries must stay within this field.` : ''

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: 'You are an academic search assistant. Generate search queries that are narrowly focused on the exact topic and discipline — never drift into unrelated fields.',
      prompt: `A researcher is writing a paper with:

RESEARCH QUESTION: "${topic}"${disciplineHint}

KEY FINDINGS (excerpt): "${originalResearch.keyFindings.slice(0, 500)}"

Generate 4 keyword-style academic search queries to find papers directly relevant to this specific research:

1. BACKGROUND: General context papers on this exact topic (not adjacent fields)
2. METHODS: Papers using the same type of methodology described in the findings
3. COMPARISON: Papers with comparable findings in the same domain
4. RELATED: Closely related recent work in the same field

RULES:
- Every query must be about the same subject as the research question
- Use domain-specific terminology from the findings (species names, technique names, etc.)
- Do NOT generate queries that could match papers from unrelated disciplines

Return ONLY a JSON array of 4 search query strings.
Each query should be 5-15 words, keyword-focused (no full sentences).
Example format: ["query 1", "query 2", "query 3", "query 4"]`,
      temperature: 0.3,
      maxOutputTokens: 300
    })
    
    let arr: string[] = []
    try {
      arr = JSON.parse(text)
    } catch {
      // Fallback: try to extract queries from text
      const matches = text.match(/"([^"]+)"/g)
      if (matches) {
        arr = matches.map(m => m.replace(/"/g, '').trim())
      }
    }

    // Add the generated queries
    queries.push(...arr.filter(q => typeof q === 'string' && q.length > 5))

  } catch (err) {
    console.warn('Enhanced query generation failed, falling back to basic rewrites:', err)
    // Fallback to basic rewrites with discipline context
    const basicRewrites = await generateQueryRewrites(topic, 3, discipline)
    queries.push(...basicRewrites)
  }

  // Remove duplicates and empty strings, limit to reasonable number
  return Array.from(new Set(queries))
    .filter(q => q && q.length > 3)
    .slice(0, 6)
}
