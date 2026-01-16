/**
 * Analysis Module - Research Assistant Core
 * 
 * This module provides the core analysis capabilities:
 * - Claim extraction from papers (sentence-level)
 * - Research gap identification
 * - Synthesis generation
 */

export {
  extractClaimsFromPaper,
  extractAndStoreClaimsForPapers,
  getClaimsForPaper,
  getClaimsByType,
  findSimilarClaims,
  type ExtractedClaim,
  type ClaimType,
  type ClaimExtractionResult
} from './claim-extractor'

export {
  findResearchGaps,
  storeResearchGaps,
  getGapsForProject,
  findContradictions, // @deprecated - use findResearchGaps which includes contradiction detection
  analyzeGapAddressing,
  type ResearchGap,
  type GapType,
  type GapAnalysisResult,
  type GapAddressingResult,
  type UserClaim
} from './gap-finder'

export {
  generateSynthesis,
  generateLiteratureReview,
  storeAnalysis,
  getAnalysisForProject,
  type SynthesisResult,
  type AnalysisOutput
} from './synthesis'

export {
  verifyClaims,
  findEvidenceForClaim,
  verifySynthesis,
  type VerifiedClaim,
  type VerificationStatus,
  type VerificationResult
} from './claim-verifier'
