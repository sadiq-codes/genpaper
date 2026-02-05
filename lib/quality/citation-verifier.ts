import 'server-only'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { cosineSimilarity } from '@/lib/rag/base-retrieval'
import { info, warn } from '@/lib/utils/logger'

/**
 * Citation Verification Service
 * 
 * Verifies that citations are accurate - that the cited paper actually
 * supports the claim being made. This replaces the broader "hallucination
 * detection" approach with targeted citation verification.
 * 
 * Key differences from old hallucination detector:
 * - Only checks CITED claims (uncited synthesis is fine)
 * - Checks against the SPECIFIC cited paper's chunks (not all evidence)
 * - Designed to BLOCK and RETRY on failure (not just warn)
 */

// ============================================================================
// Types
// ============================================================================

export interface EvidenceChunk {
  paper_id: string
  content: string
  id?: string
}

export interface CitationVerificationResult {
  paperId: string
  claim: string
  isVerified: boolean
  confidence: number
  bestMatch?: {
    chunkContent: string
    similarity: number
  }
  issue?: string
}

export interface SectionCitationReport {
  sectionTitle: string
  totalCitations: number
  verifiedCitations: number
  failedCitations: Array<{
    paperId: string
    claim: string
    issue: string
  }>
  passed: boolean
  score: number // 0-1, percentage verified
}

// ============================================================================
// Configuration
// ============================================================================

/** Minimum similarity for a citation to be considered verified */
const VERIFICATION_THRESHOLD = 0.40

/** Percentage of citations that must pass for the section to pass */
const PASS_THRESHOLD = 0.70

/** Maximum citations to verify per section (for performance) */
const MAX_CITATIONS_TO_VERIFY = 15

/** Minimum characters around citation marker to extract as "claim" */
const CLAIM_CONTEXT_CHARS = 200

// ============================================================================
// Types for Structured Citations
// ============================================================================

/**
 * Citation from structured output (used during generation)
 */
export interface StructuredCitationInput {
  index: number
  paperId: string
  quote: string
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Helper to extract claim context around a citation marker
 */
function extractClaimContext(
  content: string,
  markerIndex: number,
  markerLength: number,
  cleanPattern: RegExp
): string | null {
  const start = Math.max(0, markerIndex - CLAIM_CONTEXT_CHARS)
  const end = Math.min(content.length, markerIndex + markerLength + CLAIM_CONTEXT_CHARS)
  
  let claim = content.slice(start, end).trim()
  
  // Try to get complete sentences
  const beforeMarker = content.slice(Math.max(0, markerIndex - 500), markerIndex)
  const sentenceStartMatch = beforeMarker.match(/[.!?]\s+([^.!?]*)$/)
  if (sentenceStartMatch) {
    const sentenceStart = markerIndex - sentenceStartMatch[1].length
    claim = content.slice(sentenceStart, end).trim()
  }
  
  const afterMarker = content.slice(markerIndex, Math.min(content.length, markerIndex + 500))
  const sentenceEndMatch = afterMarker.match(/[.!?]/)
  if (sentenceEndMatch && sentenceEndMatch.index) {
    const sentenceEnd = markerIndex + sentenceEndMatch.index + 1
    claim = content.slice(
      claim.length > CLAIM_CONTEXT_CHARS ? markerIndex - CLAIM_CONTEXT_CHARS : start,
      sentenceEnd
    ).trim()
  }
  
  const cleanClaim = claim.replace(cleanPattern, '').trim()
  return cleanClaim.length > 20 ? cleanClaim : null
}

/**
 * Extract claims with their citations from content.
 * 
 * Supported formats:
 * - [1], [2], [3] numbered markers (during generation, requires citations array)
 * - [@paperId#instanceId] storage format (for stored/verified content)
 * 
 * IMPORTANT: For numbered markers, this function consumes citations as an
 * "occurrence stream" - each marker is matched with the next available citation
 * entry that has the same index. This matches the contract where the LLM provides
 * one citation entry per occurrence (e.g., two [1] markers = two entries with index: 1).
 * 
 * @param content - Content with citation markers
 * @param citations - Optional structured citations array for numbered marker mapping
 * @returns Array of cited claims with paperId, claim text, and marker
 */
export function extractCitedClaims(
  content: string,
  citations?: StructuredCitationInput[]
): Array<{
  paperId: string
  claim: string
  marker: string
}> {
  const citedClaims: Array<{ paperId: string; claim: string; marker: string }> = []
  
  // Pattern to match all citation markers for cleaning
  const allMarkersPattern = /\[\d+\]|\[@[a-f0-9-]+(?:#[a-f0-9-]+)?\]/gi
  
  // 1. Match numbered [N] markers (during generation)
  // Use occurrence-stream approach: consume citation entries as we match markers
  if (citations && citations.length > 0) {
    // Create mutable queue - we'll consume entries as we match markers in order
    const citationQueue = [...citations]
    
    const numberedPattern = /\[(\d+)\]/g
    let match
    
    while ((match = numberedPattern.exec(content)) !== null) {
      const index = parseInt(match[1], 10)
      
      // Find and consume the first citation entry with this index
      const entryIdx = citationQueue.findIndex(c => c.index === index)
      if (entryIdx === -1) {
        // No citation entry for this marker - skip it
        continue
      }
      
      // Remove the entry from queue (consume it)
      const citation = citationQueue.splice(entryIdx, 1)[0]
      
      const claim = extractClaimContext(content, match.index, match[0].length, allMarkersPattern)
      if (claim) {
        citedClaims.push({ paperId: citation.paperId, claim, marker: match[0] })
      }
    }
  }
  
  // 2. Match storage format [@paperId#instanceId] (for stored content)
  const storagePattern = /\[@([a-f0-9-]+)(?:#[a-f0-9-]+)?\]/gi
  let match
  while ((match = storagePattern.exec(content)) !== null) {
    const paperId = match[1]
    const claim = extractClaimContext(content, match.index, match[0].length, allMarkersPattern)
    if (claim) {
      citedClaims.push({ paperId, claim, marker: match[0] })
    }
  }
  
  return citedClaims
}

/**
 * Verify a single citation - check if the cited paper supports the claim
 */
export async function verifyCitation(
  claim: string,
  paperId: string,
  allChunks: EvidenceChunk[]
): Promise<CitationVerificationResult> {
  // Filter chunks to only those from the cited paper
  const paperChunks = allChunks.filter(c => c.paper_id === paperId)
  
  // If no chunks from this paper, we can't verify
  if (paperChunks.length === 0) {
    return {
      paperId,
      claim,
      isVerified: false,
      confidence: 0,
      issue: 'No content available from cited paper (PDF may not have been processed)'
    }
  }
  
  try {
    // Generate embedding for the claim
    const [claimEmbedding] = await generateEmbeddings([claim])
    
    // Generate embeddings for paper's chunks
    const chunkTexts = paperChunks.map(c => c.content)
    const chunkEmbeddings = await generateEmbeddings(chunkTexts)
    
    // Find best matching chunk
    let bestSimilarity = 0
    let bestMatch: { chunkContent: string; similarity: number } | undefined
    
    for (let i = 0; i < chunkEmbeddings.length; i++) {
      const similarity = cosineSimilarity(claimEmbedding, chunkEmbeddings[i])
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = {
          chunkContent: paperChunks[i].content.slice(0, 300) + '...',
          similarity
        }
      }
    }
    
    const isVerified = bestSimilarity >= VERIFICATION_THRESHOLD
    
    return {
      paperId,
      claim,
      isVerified,
      confidence: bestSimilarity,
      bestMatch,
      issue: isVerified ? undefined : `Paper content doesn't strongly support this claim (similarity: ${(bestSimilarity * 100).toFixed(0)}%)`
    }
    
  } catch (error) {
    warn({ paperId, error }, 'Citation verification failed')
    return {
      paperId,
      claim,
      isVerified: false,
      confidence: 0,
      issue: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Verify all citations in a section
 * Returns a report indicating which citations verified and which failed
 * 
 * @param sectionTitle - Title of the section being verified
 * @param content - Content with citation markers ([1], [2] or [CITE:...] or [@...])
 * @param contextChunks - Evidence chunks to verify against
 * @param citations - Optional structured citations array for mapping numbered markers to paperIds
 */
export async function verifySectionCitations(
  sectionTitle: string,
  content: string,
  contextChunks: EvidenceChunk[],
  citations?: StructuredCitationInput[]
): Promise<SectionCitationReport> {
  const citedClaims = extractCitedClaims(content, citations)
  
  // No citations = automatic pass (uncited synthesis is allowed)
  if (citedClaims.length === 0) {
    return {
      sectionTitle,
      totalCitations: 0,
      verifiedCitations: 0,
      failedCitations: [],
      passed: true,
      score: 1
    }
  }
  
  // Limit citations to check for performance
  const claimsToCheck = citedClaims.slice(0, MAX_CITATIONS_TO_VERIFY)
  
  // Deduplicate by paperId (don't check same paper multiple times with same claim)
  const uniqueClaims = new Map<string, { paperId: string; claim: string; marker: string }>()
  for (const cited of claimsToCheck) {
    const key = `${cited.paperId}:${cited.claim.slice(0, 50)}`
    if (!uniqueClaims.has(key)) {
      uniqueClaims.set(key, cited)
    }
  }
  
  const failedCitations: SectionCitationReport['failedCitations'] = []
  let verifiedCount = 0
  
  // Verify each citation
  for (const cited of uniqueClaims.values()) {
    const result = await verifyCitation(cited.claim, cited.paperId, contextChunks)
    
    if (result.isVerified) {
      verifiedCount++
    } else {
      failedCitations.push({
        paperId: cited.paperId,
        claim: cited.claim.slice(0, 150) + (cited.claim.length > 150 ? '...' : ''),
        issue: result.issue || 'Citation could not be verified'
      })
    }
  }
  
  const totalChecked = uniqueClaims.size
  const score = totalChecked > 0 ? verifiedCount / totalChecked : 1
  const passed = score >= PASS_THRESHOLD
  
  info({
    sectionTitle,
    totalCitations: citedClaims.length,
    uniqueChecked: totalChecked,
    verified: verifiedCount,
    failed: failedCitations.length,
    score: (score * 100).toFixed(0) + '%',
    passed
  }, 'Citation verification completed')
  
  return {
    sectionTitle,
    totalCitations: citedClaims.length,
    verifiedCitations: verifiedCount,
    failedCitations,
    passed,
    score
  }
}

/**
 * Build feedback for regeneration when citations fail
 */
export function buildCitationFeedback(report: SectionCitationReport): string {
  if (report.passed || report.failedCitations.length === 0) {
    return ''
  }
  
  const failedList = report.failedCitations
    .slice(0, 5) // Limit feedback to top 5 failures
    .map(f => `- Claim: "${f.claim.slice(0, 100)}..." → Issue: ${f.issue}`)
    .join('\n')
  
  return `
CITATION VERIFICATION FAILED - Please fix the following issues:

${failedList}

Instructions:
1. Verify that each citation actually supports the claim being made
2. If a citation doesn't support the claim, either:
   - Find a different source that does support it
   - Modify the claim to accurately reflect what the source says
   - Remove the citation if no source supports the claim
3. Do not make claims that your sources don't support
`.trim()
}

/**
 * Quick check - just returns pass/fail without detailed report
 * Use this for fast checks; use verifySectionCitations for full report
 */
export async function quickCitationCheck(
  content: string,
  contextChunks: EvidenceChunk[]
): Promise<{ passed: boolean; score: number }> {
  const report = await verifySectionCitations('quick-check', content, contextChunks)
  return {
    passed: report.passed,
    score: report.score
  }
}
