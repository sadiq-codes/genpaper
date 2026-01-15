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
// Core Functions
// ============================================================================

/**
 * Extract claims with their citations from content
 * Returns the sentence/context containing each citation marker
 */
export function extractCitedClaims(content: string): Array<{
  paperId: string
  claim: string
  marker: string
}> {
  const citedClaims: Array<{ paperId: string; claim: string; marker: string }> = []
  
  // Match [CITE: paper_id] markers
  const markerPattern = /\[CITE:\s*([a-f0-9-]+)\]/gi
  let match
  
  while ((match = markerPattern.exec(content)) !== null) {
    const paperId = match[1]
    const marker = match[0]
    const markerIndex = match.index
    
    // Extract surrounding context as the "claim"
    const start = Math.max(0, markerIndex - CLAIM_CONTEXT_CHARS)
    const end = Math.min(content.length, markerIndex + marker.length + CLAIM_CONTEXT_CHARS)
    
    let claim = content.slice(start, end).trim()
    
    // Try to get complete sentences
    // Find sentence start (look for . ! ? before the marker)
    const beforeMarker = content.slice(Math.max(0, markerIndex - 500), markerIndex)
    const sentenceStartMatch = beforeMarker.match(/[.!?]\s+([^.!?]*)$/)
    if (sentenceStartMatch) {
      const sentenceStart = markerIndex - sentenceStartMatch[1].length
      claim = content.slice(sentenceStart, end).trim()
    }
    
    // Find sentence end (look for . ! ? after the marker)
    const afterMarker = content.slice(markerIndex, Math.min(content.length, markerIndex + 500))
    const sentenceEndMatch = afterMarker.match(/[.!?]/)
    if (sentenceEndMatch && sentenceEndMatch.index) {
      const sentenceEnd = markerIndex + sentenceEndMatch.index + 1
      claim = content.slice(
        claim.length > CLAIM_CONTEXT_CHARS ? markerIndex - CLAIM_CONTEXT_CHARS : start,
        sentenceEnd
      ).trim()
    }
    
    // Remove the citation marker from the claim for cleaner comparison
    const cleanClaim = claim.replace(/\[CITE:\s*[a-f0-9-]+\]/gi, '').trim()
    
    if (cleanClaim.length > 20) { // Skip very short claims
      citedClaims.push({
        paperId,
        claim: cleanClaim,
        marker
      })
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
 */
export async function verifySectionCitations(
  sectionTitle: string,
  content: string,
  contextChunks: EvidenceChunk[]
): Promise<SectionCitationReport> {
  const citedClaims = extractCitedClaims(content)
  
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
