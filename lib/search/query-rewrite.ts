/**
 * Query Rewrite Service
 * 
 * Uses centralized AI model configuration for query enhancement.
 */

import { generateText } from 'ai'
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
 * similar to the input query. Falls back to returning the original query if
 * no LLM key is present or API fails.
 */
export async function generateQueryRewrites(query: string, k = 3): Promise<string[]> {
  const rewrites: string[] = [query.trim()]

  if (!process.env.OPENAI_API_KEY) return rewrites

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: 'You are an academic search assistant.',
      prompt: `Generate ${k} alternative keyword-style academic search queries that would find papers similar to: "${query}".
Return the list as a JSON array of plain strings. Do not add any explanation.`,
      temperature: 0.7,
      maxTokens: 150
    })

    let arr: string[] = []
    try {
      arr = JSON.parse(text)
    } catch {
      // fallback: attempt to split by newline / dash
      arr = text.split(/\n|\r|-/).map((s: string) => s.trim()).filter(Boolean)
    }

    rewrites.push(...arr.slice(0, k))
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
 * @returns Array of search queries, deduplicated
 */
export async function buildEnhancedSearchQueries(
  topic: string,
  originalResearch?: OriginalResearchContext
): Promise<string[]> {
  const queries: string[] = [topic.trim()]

  // If no original research context, just return basic rewrites
  if (!originalResearch?.keyFindings) {
    return generateQueryRewrites(topic)
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

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: 'You are an academic search assistant helping find relevant research papers.',
      prompt: `A researcher is writing a paper with:

RESEARCH QUESTION: "${topic}"

KEY FINDINGS: "${originalResearch.keyFindings}"

Generate 4 different academic search queries to find relevant papers:

1. BACKGROUND: A query to find general background/context papers on this topic
2. METHODS: A query to find papers using similar methodologies
3. COMPARISON: A query to find papers with comparable findings to compare/contrast
4. RELATED: A query to find closely related recent work

Return ONLY a JSON array of 4 search query strings, one for each category.
Each query should be 5-15 words, keyword-focused (no full sentences).
Example format: ["query 1", "query 2", "query 3", "query 4"]`,
      temperature: 0.5,
      maxTokens: 300
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
    // Fallback to basic rewrites
    const basicRewrites = await generateQueryRewrites(topic)
    queries.push(...basicRewrites)
  }

  // Remove duplicates and empty strings, limit to reasonable number
  return Array.from(new Set(queries))
    .filter(q => q && q.length > 3)
    .slice(0, 6)
}
