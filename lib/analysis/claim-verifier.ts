import 'server-only'
import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'

/**
 * Claim Verifier - Verifies claims against source evidence
 * 
 * Every claim in the synthesis should be traceable to a specific quote
 * in a source paper. This module:
 * - Links claims to exact quotes
 * - Rates verification confidence
 * - Flags unsupported claims
 */

export type VerificationStatus = 'verified' | 'partial' | 'unsupported' | 'contradicted'

export interface VerifiedClaim {
  claim: string
  status: VerificationStatus
  confidence: number
  evidence: Array<{
    paper_id: string
    paper_title: string
    quote: string
    relevance: number
  }>
  warnings?: string[]
}

export interface VerificationResult {
  claims: VerifiedClaim[]
  overall_confidence: number
  unsupported_count: number
  processing_time_ms: number
  error?: string
}

const EvidenceMatchSchema = z.object({
  matches: z.array(z.object({
    claim_index: z.number(),
    paper_id: z.string(),
    quote: z.string().describe('The exact quote from the paper that supports this claim'),
    relevance: z.number().min(0).max(1).describe('How relevant this quote is to the claim'),
    supports: z.boolean().describe('Whether this quote supports or contradicts the claim')
  }))
})

/**
 * Verify a list of claims against source papers
 */
export async function verifyClaims(
  claims: string[],
  paperIds: string[]
): Promise<VerificationResult> {
  const startTime = Date.now()
  
  try {
    const supabase = await getSB()
    
    // Fetch paper content and chunks
    const { data: papers } = await supabase
      .from('papers')
      .select('id, title, abstract, pdf_content')
      .in('id', paperIds)

    if (!papers || papers.length === 0) {
      return {
        claims: claims.map(c => ({
          claim: c,
          status: 'unsupported' as VerificationStatus,
          confidence: 0,
          evidence: []
        })),
        overall_confidence: 0,
        unsupported_count: claims.length,
        processing_time_ms: Date.now() - startTime,
        error: 'No papers found for verification'
      }
    }

    // Build context for verification
    const paperContext = papers.map(p => ({
      id: p.id,
      title: p.title,
      content: (p.pdf_content || p.abstract || '').slice(0, 8000)
    }))

    // Use GPT to find evidence for each claim
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: EvidenceMatchSchema,
      prompt: buildVerificationPrompt(claims, paperContext),
      temperature: 0.1,
    })

    // Process matches into verified claims
    const verifiedClaims: VerifiedClaim[] = claims.map((claim, index) => {
      const matches = object.matches.filter(m => m.claim_index === index)
      const supportingMatches = matches.filter(m => m.supports)
      const contradictingMatches = matches.filter(m => !m.supports)

      let status: VerificationStatus = 'unsupported'
      let confidence = 0

      if (supportingMatches.length > 0) {
        const avgRelevance = supportingMatches.reduce((sum, m) => sum + m.relevance, 0) / supportingMatches.length
        if (avgRelevance > 0.7) {
          status = 'verified'
          confidence = avgRelevance
        } else {
          status = 'partial'
          confidence = avgRelevance
        }
      }

      if (contradictingMatches.length > 0 && supportingMatches.length === 0) {
        status = 'contradicted'
        confidence = contradictingMatches[0].relevance
      }

      const evidence = matches.map(m => {
        const paper = papers.find(p => p.id === m.paper_id)
        return {
          paper_id: m.paper_id,
          paper_title: paper?.title || 'Unknown',
          quote: m.quote,
          relevance: m.relevance
        }
      })

      const warnings: string[] = []
      if (status === 'unsupported') {
        warnings.push('No supporting evidence found in source papers')
      }
      if (contradictingMatches.length > 0) {
        warnings.push('Some sources contradict this claim')
      }

      return {
        claim,
        status,
        confidence,
        evidence,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    })

    const unsupportedCount = verifiedClaims.filter(c => c.status === 'unsupported').length
    const overallConfidence = verifiedClaims.reduce((sum, c) => sum + c.confidence, 0) / verifiedClaims.length

    return {
      claims: verifiedClaims,
      overall_confidence: overallConfidence,
      unsupported_count: unsupportedCount,
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('Claim verification failed:', error)
    return {
      claims: claims.map(c => ({
        claim: c,
        status: 'unsupported' as VerificationStatus,
        confidence: 0,
        evidence: []
      })),
      overall_confidence: 0,
      unsupported_count: claims.length,
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Find evidence for a single claim using semantic search
 */
export async function findEvidenceForClaim(
  claim: string,
  paperIds: string[],
  limit: number = 5
): Promise<Array<{ paper_id: string; content: string; score: number }>> {
  const supabase = await getSB()
  
  // Generate embedding for the claim
  const [claimEmbedding] = await generateEmbeddings([claim])
  
  // Search for relevant chunks
  const { data, error } = await supabase.rpc('match_paper_chunks', {
    query_embedding: claimEmbedding,
    match_count: limit * 2 // Get more to filter by paper
  })

  if (error || !data) {
    console.error('Evidence search failed:', error)
    return []
  }

  // Filter to requested papers
  const filtered = data
    .filter((chunk: { paper_id: string }) => paperIds.includes(chunk.paper_id))
    .slice(0, limit)

  return filtered.map((chunk: { paper_id: string; content: string; score: number }) => ({
    paper_id: chunk.paper_id,
    content: chunk.content,
    score: chunk.score
  }))
}

/**
 * Verify a synthesis output, linking each claim to evidence
 */
export async function verifySynthesis(
  synthesisMarkdown: string,
  paperIds: string[]
): Promise<{
  verified_markdown: string
  verification_report: VerificationResult
}> {
  // Extract claims from the synthesis
  const claims = extractClaimsFromMarkdown(synthesisMarkdown)
  
  // Verify each claim
  const verification = await verifyClaims(claims, paperIds)
  
  // Annotate the markdown with verification status
  let verifiedMarkdown = synthesisMarkdown
  
  for (const vc of verification.claims) {
    if (vc.status === 'verified' && vc.evidence.length > 0) {
      // Add citation after verified claims
      const citation = `[${vc.evidence[0].paper_title.slice(0, 30)}...]`
      verifiedMarkdown = verifiedMarkdown.replace(
        vc.claim,
        `${vc.claim} ${citation}`
      )
    } else if (vc.status === 'unsupported') {
      // Mark unsupported claims
      verifiedMarkdown = verifiedMarkdown.replace(
        vc.claim,
        `${vc.claim} ⚠️`
      )
    }
  }
  
  return {
    verified_markdown: verifiedMarkdown,
    verification_report: verification
  }
}

// Helper functions

function buildVerificationPrompt(
  claims: string[],
  papers: Array<{ id: string; title: string; content: string }>
): string {
  return `You are a research verification assistant. Your task is to find evidence for claims in academic papers.

CLAIMS TO VERIFY:
${claims.map((c, i) => `${i}. ${c}`).join('\n')}

SOURCE PAPERS:
${papers.map(p => `
--- Paper ID: ${p.id} ---
Title: ${p.title}
Content:
${p.content}
---
`).join('\n')}

For each claim:
1. Search the papers for supporting evidence
2. Extract the EXACT quote that supports or contradicts the claim
3. Rate relevance (0-1) based on how directly the quote supports the claim
4. Indicate whether the quote supports (true) or contradicts (false) the claim

Only include matches where you find relevant evidence. Do not make up quotes - use exact text from the papers.
If no evidence is found for a claim, do not include any matches for it.`
}

function extractClaimsFromMarkdown(markdown: string): string[] {
  const claims: string[] = []
  
  // Split into sentences
  const sentences = markdown
    .replace(/#{1,6}\s+[^\n]+/g, '') // Remove headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
    .replace(/\*([^*]+)\*/g, '$1') // Remove italic
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20) // Filter short fragments
  
  // Filter to factual claims (not introductory phrases)
  const claimIndicators = [
    /\b(found|showed|demonstrated|indicated|revealed|suggests|reported)\b/i,
    /\b(significant|correlation|effect|impact|result|increase|decrease)\b/i,
    /\b\d+%/,
    /\b(study|research|analysis|experiment)\b/i
  ]
  
  for (const sentence of sentences) {
    if (claimIndicators.some(pattern => pattern.test(sentence))) {
      claims.push(sentence)
    }
  }
  
  return claims.slice(0, 20) // Limit to avoid API overload
}
