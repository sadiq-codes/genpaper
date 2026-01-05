import 'server-only'
import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'

/**
 * Claim Extractor - Extracts claims from papers at sentence level
 * 
 * This is a core component of the Research Assistant that identifies:
 * - Key findings and results
 * - Methodological approaches
 * - Stated limitations
 * - Future work suggestions
 * - Background context
 */

// Claim types we extract
export type ClaimType = 'finding' | 'method' | 'limitation' | 'future_work' | 'background'

// Schema for extracted claims
const ClaimSchema = z.object({
  claim_text: z.string().describe('The claim or statement extracted from the paper'),
  evidence_quote: z.string().describe('The exact quote from the paper that supports this claim'),
  section: z.string().describe('The section of the paper (abstract, introduction, methodology, results, discussion, conclusion)'),
  claim_type: z.enum(['finding', 'method', 'limitation', 'future_work', 'background']).describe('The type of claim'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this extraction (0-1)')
})

const ClaimsResponseSchema = z.object({
  claims: z.array(ClaimSchema).describe('List of extracted claims from the paper')
})

export interface ExtractedClaim {
  id?: string
  paper_id: string
  claim_text: string
  evidence_quote: string
  section: string
  claim_type: ClaimType
  confidence: number
  embedding?: number[]
}

export interface ClaimExtractionResult {
  paper_id: string
  claims: ExtractedClaim[]
  processing_time_ms: number
  error?: string
}

/**
 * Extract claims from a paper's content
 */
export async function extractClaimsFromPaper(
  paperId: string,
  content: string,
  title: string,
  abstract?: string
): Promise<ClaimExtractionResult> {
  const startTime = Date.now()
  
  try {
    // Prepare the text for analysis
    const textToAnalyze = prepareTextForAnalysis(content, abstract)
    
    if (textToAnalyze.length < 100) {
      return {
        paper_id: paperId,
        claims: [],
        processing_time_ms: Date.now() - startTime,
        error: 'Insufficient content for claim extraction'
      }
    }

    // Use GPT to extract claims
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: ClaimsResponseSchema,
      prompt: buildExtractionPrompt(title, textToAnalyze),
      temperature: 0.1, // Low temperature for consistent extraction
    })

    // Add paper_id to each claim
    const claims: ExtractedClaim[] = object.claims.map(claim => ({
      ...claim,
      paper_id: paperId,
      claim_type: claim.claim_type as ClaimType
    }))

    // Generate embeddings for semantic search
    if (claims.length > 0) {
      const claimTexts = claims.map(c => c.claim_text)
      const embeddings = await generateEmbeddings(claimTexts)
      
      claims.forEach((claim, i) => {
        claim.embedding = embeddings[i]
      })
    }

    return {
      paper_id: paperId,
      claims,
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('Claim extraction failed:', error)
    return {
      paper_id: paperId,
      claims: [],
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Extract claims from multiple papers and store in database
 */
export async function extractAndStoreClaimsForPapers(
  paperIds: string[]
): Promise<{ success: number; failed: number; results: ClaimExtractionResult[] }> {
  const supabase = await getSB()
  const results: ClaimExtractionResult[] = []
  let success = 0
  let failed = 0

  // Fetch paper content
  const { data: papers, error } = await supabase
    .from('papers')
    .select('id, title, abstract, pdf_content')
    .in('id', paperIds)

  if (error || !papers) {
    console.error('Failed to fetch papers:', error)
    return { success: 0, failed: paperIds.length, results: [] }
  }

  // Process each paper
  for (const paper of papers) {
    const content = paper.pdf_content || paper.abstract || ''
    const result = await extractClaimsFromPaper(
      paper.id,
      content,
      paper.title,
      paper.abstract
    )
    results.push(result)

    if (result.error) {
      failed++
      continue
    }

    // Store claims in database
    if (result.claims.length > 0) {
      const { error: insertError } = await supabase
        .from('paper_claims')
        .insert(
          result.claims.map(claim => ({
            paper_id: claim.paper_id,
            claim_text: claim.claim_text,
            evidence_quote: claim.evidence_quote,
            section: claim.section,
            claim_type: claim.claim_type,
            confidence: claim.confidence,
            embedding: claim.embedding
          }))
        )

      if (insertError) {
        console.error('Failed to store claims:', insertError)
        failed++
      } else {
        success++
      }
    } else {
      success++ // No claims but no error
    }
  }

  return { success, failed, results }
}

/**
 * Get claims for a paper from database
 */
export async function getClaimsForPaper(paperId: string): Promise<ExtractedClaim[]> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('paper_claims')
    .select('*')
    .eq('paper_id', paperId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch claims:', error)
    return []
  }

  return data || []
}

/**
 * Get claims by type across papers
 */
export async function getClaimsByType(
  paperIds: string[],
  claimType: ClaimType
): Promise<ExtractedClaim[]> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('paper_claims')
    .select('*')
    .in('paper_id', paperIds)
    .eq('claim_type', claimType)
    .order('confidence', { ascending: false })

  if (error) {
    console.error('Failed to fetch claims by type:', error)
    return []
  }

  return data || []
}

/**
 * Find semantically similar claims
 */
export async function findSimilarClaims(
  queryText: string,
  paperIds: string[],
  limit: number = 10
): Promise<ExtractedClaim[]> {
  const supabase = await getSB()
  
  // Generate embedding for query
  const [queryEmbedding] = await generateEmbeddings([queryText])
  
  // Use RPC for vector similarity search
  const { data, error } = await supabase.rpc('match_paper_claims', {
    query_embedding: queryEmbedding,
    paper_ids: paperIds,
    match_count: limit
  })

  if (error) {
    console.error('Failed to find similar claims:', error)
    return []
  }

  return data || []
}

// Helper functions

function prepareTextForAnalysis(content: string, abstract?: string): string {
  // Combine and clean text
  let text = ''
  
  if (abstract) {
    text += `ABSTRACT:\n${abstract}\n\n`
  }
  
  if (content) {
    // Limit content to reasonable size for API
    const maxLength = 15000
    text += content.slice(0, maxLength)
    if (content.length > maxLength) {
      text += '\n[Content truncated...]'
    }
  }
  
  return text.trim()
}

function buildExtractionPrompt(title: string, content: string): string {
  return `You are a research assistant specializing in extracting key claims from academic papers.

Analyze the following paper and extract all significant claims. For each claim:
1. Identify the exact statement or finding
2. Quote the supporting evidence verbatim
3. Classify the claim type
4. Rate your confidence in the extraction

Paper Title: "${title}"

Paper Content:
${content}

Extract claims that are:
- FINDINGS: Key results, discoveries, or conclusions
- METHODS: Methodological approaches or techniques used
- LIMITATIONS: Stated limitations, weaknesses, or caveats
- FUTURE_WORK: Suggestions for future research
- BACKGROUND: Important context or prior work cited

Be precise and extract only clearly stated claims. Include the exact quote that supports each claim.
Aim to extract 5-15 claims per paper, focusing on the most significant ones.
Rate confidence based on how clearly the claim is stated (1.0 = very clear, 0.5 = somewhat ambiguous).`
}
