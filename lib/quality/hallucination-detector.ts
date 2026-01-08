import 'server-only'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { cosineSimilarity } from '@/lib/rag/base-retrieval'
import { logHallucinationCheck } from '@/lib/utils/logger'

/**
 * Hallucination Detection Service
 * 
 * Verifies that generated content is grounded in source material.
 * Uses semantic similarity to detect claims that aren't supported by evidence.
 */

export interface Claim {
  text: string
  startOffset: number
  endOffset: number
  citation?: {
    paperId: string
    marker: string
  }
}

export interface EvidenceChunk {
  paper_id: string
  content: string
  score?: number
}

export interface HallucinationCheckResult {
  claim: Claim
  isGrounded: boolean
  confidence: number
  bestMatch?: {
    paperId: string
    content: string
    similarity: number
  }
  issues: string[]
}

export interface HallucinationReport {
  sectionTitle: string
  totalClaims: number
  groundedClaims: number
  ungroundedClaims: number
  overallScore: number // 0-1, 1 = fully grounded
  results: HallucinationCheckResult[]
  unverifiedCitations: string[]
  passed: boolean
}

// Configuration
const GROUNDING_THRESHOLD = 0.45 // Semantic similarity threshold
const CITATION_THRESHOLD = 0.5  // Higher threshold for cited claims
const MIN_CLAIM_LENGTH = 30     // Minimum characters for a claim
const PASS_THRESHOLD = 0.7      // 70% of claims must be grounded

/**
 * Extract claims from generated text
 * Claims are sentences that make factual assertions
 */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = []
  
  // Split into sentences
  const sentenceRegex = /[^.!?]+[.!?]+/g
  let match
  let offset = 0
  
  while ((match = sentenceRegex.exec(text)) !== null) {
    const sentence = match[0].trim()
    
    // Skip very short sentences
    if (sentence.length < MIN_CLAIM_LENGTH) {
      continue
    }
    
    // Skip sentences that are clearly not claims
    if (isLikelyNotClaim(sentence)) {
      continue
    }
    
    // Check for citation
    const citationMatch = sentence.match(/\(([^)]+),\s*(\d{4})\)/)
    
    claims.push({
      text: sentence,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      citation: citationMatch ? {
        paperId: '', // Will be resolved later
        marker: citationMatch[0]
      } : undefined
    })
  }
  
  return claims
}

/**
 * Check if a sentence is likely NOT a factual claim
 */
function isLikelyNotClaim(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  
  // Structural/transitional sentences
  if (lower.startsWith('this section') || 
      lower.startsWith('in this') ||
      lower.startsWith('the following') ||
      lower.startsWith('we will') ||
      lower.startsWith('as mentioned') ||
      lower.includes('this paper')) {
    return true
  }
  
  // Questions
  if (sentence.trim().endsWith('?')) {
    return true
  }
  
  // Very generic statements
  if (lower.includes('is important') && lower.split(' ').length < 10) {
    return true
  }
  
  return false
}

/**
 * Check if a claim is grounded in the evidence
 */
export async function checkClaimGrounding(
  claim: Claim,
  evidence: EvidenceChunk[],
  threshold: number = GROUNDING_THRESHOLD
): Promise<HallucinationCheckResult> {
  const issues: string[] = []
  
  if (evidence.length === 0) {
    return {
      claim,
      isGrounded: false,
      confidence: 0,
      issues: ['No evidence available for verification']
    }
  }
  
  try {
    // Generate embedding for the claim
    const [claimEmbedding] = await generateEmbeddings([claim.text])
    
    // Generate embeddings for evidence (or use pre-computed)
    const evidenceTexts = evidence.map(e => e.content)
    const evidenceEmbeddings = await generateEmbeddings(evidenceTexts)
    
    // Find best match
    let bestSimilarity = 0
    let bestMatch: { paperId: string; content: string; similarity: number } | undefined
    
    for (let i = 0; i < evidenceEmbeddings.length; i++) {
      const similarity = cosineSimilarity(claimEmbedding, evidenceEmbeddings[i])
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = {
          paperId: evidence[i].paper_id,
          content: evidence[i].content.slice(0, 200) + '...',
          similarity
        }
      }
    }
    
    // Use higher threshold for cited claims
    const effectiveThreshold = claim.citation ? CITATION_THRESHOLD : threshold
    const isGrounded = bestSimilarity >= effectiveThreshold
    
    // Generate issues
    if (!isGrounded) {
      if (bestSimilarity < 0.2) {
        issues.push('Claim appears to be fabricated - no similar content in sources')
      } else if (bestSimilarity < threshold) {
        issues.push(`Claim weakly supported (similarity: ${bestSimilarity.toFixed(2)})`)
      }
      
      if (claim.citation) {
        issues.push(`Citation ${claim.citation.marker} may not support this claim`)
      }
    }
    
    return {
      claim,
      isGrounded,
      confidence: bestSimilarity,
      bestMatch,
      issues
    }
  } catch (error) {
    return {
      claim,
      isGrounded: false,
      confidence: 0,
      issues: [`Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
    }
  }
}

/**
 * Run hallucination detection on a generated section
 */
export async function detectHallucinations(
  sectionTitle: string,
  generatedContent: string,
  evidence: EvidenceChunk[],
  projectId?: string,
  options: {
    threshold?: number
    maxClaimsToCheck?: number
    skipShortClaims?: boolean
  } = {}
): Promise<HallucinationReport> {
  const {
    threshold = GROUNDING_THRESHOLD,
    maxClaimsToCheck = 20,
    skipShortClaims = true
  } = options
  
  // Extract claims
  let claims = extractClaims(generatedContent)
  
  // Filter short claims if requested
  if (skipShortClaims) {
    claims = claims.filter(c => c.text.length >= MIN_CLAIM_LENGTH)
  }
  
  // Limit number of claims to check (for performance)
  if (claims.length > maxClaimsToCheck) {
    // Prioritize claims with citations
    const citedClaims = claims.filter(c => c.citation)
    const uncitedClaims = claims.filter(c => !c.citation)
    
    claims = [
      ...citedClaims.slice(0, Math.ceil(maxClaimsToCheck / 2)),
      ...uncitedClaims.slice(0, Math.floor(maxClaimsToCheck / 2))
    ]
  }
  
  // Check each claim
  const results: HallucinationCheckResult[] = []
  const unverifiedCitations: string[] = []
  
  for (const claim of claims) {
    const result = await checkClaimGrounding(claim, evidence, threshold)
    results.push(result)
    
    // Track unverified citations
    if (claim.citation && !result.isGrounded) {
      unverifiedCitations.push(claim.citation.marker)
    }
  }
  
  // Calculate summary
  const groundedClaims = results.filter(r => r.isGrounded).length
  const overallScore = claims.length > 0 ? groundedClaims / claims.length : 1
  const passed = overallScore >= PASS_THRESHOLD
  
  const report: HallucinationReport = {
    sectionTitle,
    totalClaims: claims.length,
    groundedClaims,
    ungroundedClaims: claims.length - groundedClaims,
    overallScore,
    results,
    unverifiedCitations,
    passed
  }
  
  // Log the check
  logHallucinationCheck({
    projectId: projectId || 'unknown',
    sectionTitle,
    claimsChecked: claims.length,
    hallucinationsFound: claims.length - groundedClaims,
    unverifiedCitations
  })
  
  return report
}

/**
 * Run hallucination detection on multiple sections
 */
export async function detectHallucinationsInPaper(
  sections: Array<{
    title: string
    content: string
    evidence: EvidenceChunk[]
  }>,
  projectId?: string
): Promise<{
  overallPassed: boolean
  overallScore: number
  sectionReports: HallucinationReport[]
}> {
  const sectionReports: HallucinationReport[] = []
  
  for (const section of sections) {
    const report = await detectHallucinations(
      section.title,
      section.content,
      section.evidence,
      projectId
    )
    sectionReports.push(report)
  }
  
  // Calculate overall score
  const totalClaims = sectionReports.reduce((sum, r) => sum + r.totalClaims, 0)
  const totalGrounded = sectionReports.reduce((sum, r) => sum + r.groundedClaims, 0)
  const overallScore = totalClaims > 0 ? totalGrounded / totalClaims : 1
  const overallPassed = overallScore >= PASS_THRESHOLD
  
  return {
    overallPassed,
    overallScore,
    sectionReports
  }
}

/**
 * Quick check - just returns pass/fail without detailed analysis
 */
export async function quickHallucinationCheck(
  content: string,
  evidence: EvidenceChunk[],
  threshold: number = GROUNDING_THRESHOLD
): Promise<{ passed: boolean; score: number }> {
  const claims = extractClaims(content).slice(0, 10) // Check first 10 claims
  
  if (claims.length === 0) {
    return { passed: true, score: 1 }
  }
  
  let groundedCount = 0
  
  for (const claim of claims) {
    const result = await checkClaimGrounding(claim, evidence, threshold)
    if (result.isGrounded) {
      groundedCount++
    }
  }
  
  const score = groundedCount / claims.length
  return {
    passed: score >= PASS_THRESHOLD,
    score
  }
}
