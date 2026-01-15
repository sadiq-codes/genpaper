import 'server-only'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { ExtractedClaim, ClaimRelationship } from '@/components/editor/types'

/**
 * User Claim Extractor - Extracts claims from user's original research inputs
 * 
 * This extracts structured claims from:
 * - Research question → hypothesis claim
 * - Key findings → finding/contribution claims
 * 
 * These claims are then used to:
 * 1. Display in the Research tab sidebar
 * 2. Compare against literature claims
 * 3. Identify which gaps the user's research addresses
 */

// Schema for user's extracted claims
const UserClaimSchema = z.object({
  claim_text: z.string().describe('The claim or assertion extracted'),
  claim_type: z.enum(['hypothesis', 'finding', 'contribution', 'implication', 'limitation'])
    .describe('The type of claim'),
  confidence: z.number().min(0).max(1).describe('How clearly this claim is stated (0-1)'),
  key_terms: z.array(z.string()).describe('Key terms/concepts in this claim for matching')
})

const UserClaimsResponseSchema = z.object({
  claims: z.array(UserClaimSchema).describe('List of claims extracted from user input')
})

// Schema for relationship analysis
const RelationshipSchema = z.object({
  claim_id: z.string().describe('ID of the literature claim'),
  relationship: z.enum(['supports', 'extends', 'contradicts', 'unrelated'])
    .describe('How the literature claim relates to user research'),
  explanation: z.string().describe('Brief explanation of the relationship')
})

const RelationshipAnalysisSchema = z.object({
  relationships: z.array(RelationshipSchema)
})

export interface UserClaimExtractionResult {
  claims: ExtractedClaim[]
  processing_time_ms: number
  error?: string
}

/**
 * Extract claims from user's research question and key findings
 */
export async function extractUserClaims(
  researchQuestion: string,
  keyFindings: string,
  topic: string
): Promise<UserClaimExtractionResult> {
  const startTime = Date.now()
  
  try {
    if (!researchQuestion && !keyFindings) {
      return {
        claims: [],
        processing_time_ms: Date.now() - startTime,
        error: 'No research question or key findings provided'
      }
    }

    // Use GPT to extract structured claims
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: UserClaimsResponseSchema,
      prompt: buildUserClaimPrompt(topic, researchQuestion, keyFindings),
      temperature: 0.1,
    })

    // Transform to ExtractedClaim format
    const claims: ExtractedClaim[] = object.claims.map((claim, index) => ({
      id: `user-claim-${index}-${Date.now()}`,
      paper_id: undefined, // No paper for user's claims
      claim_text: claim.claim_text,
      claim_type: claim.claim_type,
      confidence: claim.confidence,
      source: 'original_research' as const,
      paper_title: 'Your Research',
      paper_authors: ['You'],
      paper_year: new Date().getFullYear(),
      relationship_to_user: undefined, // Not applicable for user's own claims
    }))

    // TODO: Consider generating embeddings for semantic comparison with literature claims
    // if (claims.length > 0) {
    //   const claimTexts = claims.map(c => c.claim_text)
    //   const embeddings = await generateEmbeddings(claimTexts)
    // }

    return {
      claims,
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('User claim extraction failed:', error)
    return {
      claims: [],
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Analyze how literature claims relate to user's research
 */
export async function analyzeClaimRelationships(
  userClaims: ExtractedClaim[],
  literatureClaims: ExtractedClaim[]
): Promise<Map<string, { relationship: ClaimRelationship; explanation: string }>> {
  const relationships = new Map<string, { relationship: ClaimRelationship; explanation: string }>()
  
  if (userClaims.length === 0 || literatureClaims.length === 0) {
    // Mark all literature claims as not analyzed
    for (const claim of literatureClaims) {
      relationships.set(claim.id, { 
        relationship: 'not_analyzed', 
        explanation: 'No user claims available for comparison' 
      })
    }
    return relationships
  }

  try {
    // Prepare context for analysis
    const userClaimsSummary = userClaims
      .map(c => `- [${c.claim_type}] ${c.claim_text}`)
      .join('\n')
    
    // Process in batches to avoid token limits
    const batchSize = 10
    for (let i = 0; i < literatureClaims.length; i += batchSize) {
      const batch = literatureClaims.slice(i, i + batchSize)
      
      const literatureClaimsList = batch
        .map(c => `ID: ${c.id}\nType: ${c.claim_type}\nClaim: ${c.claim_text}`)
        .join('\n\n')

      const { object } = await generateObject({
        model: getLanguageModel(),
        schema: RelationshipAnalysisSchema,
        prompt: buildRelationshipPrompt(userClaimsSummary, literatureClaimsList),
        temperature: 0.1,
      })

      // Store relationships
      for (const rel of object.relationships) {
        relationships.set(rel.claim_id, {
          relationship: rel.relationship as ClaimRelationship,
          explanation: rel.explanation
        })
      }
    }
  } catch (error) {
    console.error('Claim relationship analysis failed:', error)
    // Mark remaining as not analyzed
    for (const claim of literatureClaims) {
      if (!relationships.has(claim.id)) {
        relationships.set(claim.id, { 
          relationship: 'not_analyzed', 
          explanation: 'Analysis failed' 
        })
      }
    }
  }

  return relationships
}

/**
 * Generate research positioning analysis
 */
export async function generateResearchPositioning(
  userClaims: ExtractedClaim[],
  literatureClaims: ExtractedClaim[],
  relationships: Map<string, { relationship: ClaimRelationship; explanation: string }>
): Promise<{
  novelty: string[]
  alignments: string[]
  divergences: string[]
  suggestedDiscussionPoints: string[]
}> {
  // Categorize claims by relationship
  const supporting: ExtractedClaim[] = []
  const contradicting: ExtractedClaim[] = []
  const extending: ExtractedClaim[] = []

  for (const claim of literatureClaims) {
    const rel = relationships.get(claim.id)
    if (!rel) continue
    
    switch (rel.relationship) {
      case 'supports':
        supporting.push(claim)
        break
      case 'contradicts':
        contradicting.push(claim)
        break
      case 'extends':
        extending.push(claim)
        break
    }
  }

  // Generate positioning
  const novelty: string[] = []
  const alignments: string[] = []
  const divergences: string[] = []
  const suggestedDiscussionPoints: string[] = []

  // Extract novelty from user claims marked as 'contribution'
  for (const claim of userClaims) {
    if (claim.claim_type === 'contribution' || claim.claim_type === 'finding') {
      novelty.push(claim.claim_text)
    }
  }

  // Extract alignments from supporting literature
  for (const claim of supporting) {
    const rel = relationships.get(claim.id)
    if (rel) {
      alignments.push(`${claim.claim_text} - ${rel.explanation}`)
    }
  }

  // Extract divergences from contradicting literature  
  for (const claim of contradicting) {
    const rel = relationships.get(claim.id)
    if (rel) {
      divergences.push(`${claim.claim_text} - ${rel.explanation}`)
      suggestedDiscussionPoints.push(
        `Address the apparent contradiction with ${claim.paper_authors?.[0] || 'prior work'} (${claim.paper_year}) regarding: ${claim.claim_text.slice(0, 100)}...`
      )
    }
  }

  // Add discussion points for extensions
  for (const claim of extending) {
    const rel = relationships.get(claim.id)
    if (rel) {
      suggestedDiscussionPoints.push(
        `Discuss how your findings extend ${claim.paper_authors?.[0] || 'prior work'}'s finding: ${rel.explanation}`
      )
    }
  }

  // Add general discussion points
  if (supporting.length > 0) {
    suggestedDiscussionPoints.push(
      `Your findings are consistent with ${supporting.length} prior studies, strengthening the evidence for your conclusions.`
    )
  }

  return {
    novelty,
    alignments,
    divergences,
    suggestedDiscussionPoints
  }
}

// Helper functions

function buildUserClaimPrompt(topic: string, researchQuestion: string, keyFindings: string): string {
  return `You are a research assistant helping to structure a researcher's original work.

Topic: "${topic}"

The researcher has provided the following inputs about their original research:

RESEARCH QUESTION:
${researchQuestion || 'Not provided'}

KEY FINDINGS:
${keyFindings || 'Not provided'}

Extract structured claims from these inputs:

1. From the RESEARCH QUESTION, extract:
   - The main hypothesis (claim_type: "hypothesis")
   - Any implied research contributions (claim_type: "contribution")

2. From the KEY FINDINGS, extract:
   - Main findings/results (claim_type: "finding")
   - Novel contributions (claim_type: "contribution")
   - Practical implications (claim_type: "implication")
   - Any mentioned limitations (claim_type: "limitation")

For each claim:
- Write it as a clear, standalone statement
- Rate confidence based on how explicitly it's stated (1.0 = very clear, 0.5 = implied)
- Extract 2-3 key terms for matching

Extract 3-8 claims total, focusing on the most significant assertions.`
}

function buildRelationshipPrompt(userClaimsSummary: string, literatureClaimsList: string): string {
  return `You are analyzing how literature claims relate to a researcher's original findings.

THE RESEARCHER'S CLAIMS (from their original research):
${userClaimsSummary}

LITERATURE CLAIMS TO ANALYZE:
${literatureClaimsList}

For each literature claim, determine its relationship to the researcher's work:

- "supports": The literature claim provides evidence that aligns with the researcher's findings
- "extends": The researcher's work builds upon or extends this literature claim
- "contradicts": The literature claim conflicts with the researcher's findings (important to discuss!)
- "unrelated": The claim is not directly relevant to the researcher's specific findings

Provide a brief explanation (1-2 sentences) for each relationship.

Be thoughtful - contradictions are not bad, they're important discussion points.
Focus on substantive relationships, not superficial topic overlap.`
}
