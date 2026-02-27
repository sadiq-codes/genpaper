/**
 * Paper Profile Intelligence Service
 * 
 * Generates a contextual profile for a paper based on topic, type, and discipline.
 * This profile guides all downstream generation and validation, replacing hardcoded rules
 * with dynamic, discipline-aware intelligence.
 */

import 'server-only'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { info, warn, error as logError } from '@/lib/utils/logger'
import type { 
  PaperProfile, 
  ProfileGenerationInput,
  ProfileValidationResult
} from './paper-profile-types'
import { getPaperProfilePrompt, PAPER_PROFILE_JSON_SCHEMA } from './paper-profile-prompts'
import { 
  suggestVoiceProfile, 
  getVoiceProfile,
  type VoiceProfileId 
} from './voice-profiles'
import { getPaperTypeConfig, getPaperTypeGuardrails, resolveSectionType } from './paper-type-config'

/** Maximum retry attempts for profile generation */
const MAX_PROFILE_RETRIES = 3

/** Exponential backoff base delay between retries (ms) */
const BASE_RETRY_DELAY_MS = 1000

/** Cap retry delays to keep total latency bounded */
const MAX_RETRY_DELAY_MS = 8000

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const err = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
    cause?: unknown
  }

  const candidates = [err.status, err.statusCode, err.response?.status]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }

  if (err.cause && typeof err.cause === 'object') {
    const cause = err.cause as {
      status?: unknown
      statusCode?: unknown
      response?: { status?: unknown }
    }
    const causeCandidates = [cause.status, cause.statusCode, cause.response?.status]
    for (const candidate of causeCandidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

function isPermanentProviderError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error)
  if (typeof statusCode === 'number') {
    // Retry transient classes; fail fast for non-rate-limited 4xx.
    if (statusCode === 429 || statusCode >= 500) return false
    if (statusCode >= 400 && statusCode < 500) return true
  }

  // Fallback for providers that only expose message text.
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('invalid schema') ||
    message.includes('http 400') ||
    message.includes('status code 400') ||
    message.includes('invalid_request') ||
    message.includes('response_format')
  )
}

function getRetryDelayMs(attempt: number): number {
  if (attempt <= 0) return 0
  return Math.min(BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS)
}

/**
 * Generate a comprehensive paper profile for the given topic and paper type.
 * This is the main entry point for the paper intelligence system.
 * 
 * Includes retry logic - if the LLM fails, we retry before failing.
 * No fallback profile: if profile generation fails after retries, the pipeline should fail
 * because a degraded profile produces a degraded paper.
 * 
 * @param input - Topic, paper type, and optional context
 * @returns A complete PaperProfile to guide generation
 * @throws Error if profile generation fails after all retries
 */
export async function generatePaperProfile(
  input: ProfileGenerationInput
): Promise<PaperProfile> {
  const { topic, paperType, hasOriginalResearch, userContext, length, signal } = input
  
  info({ topic: topic.slice(0, 100), paperType, hasOriginalResearch, length }, 'Generating paper profile')
  
  const prompt = await getPaperProfilePrompt({
    topic,
    paperType,
    hasOriginalResearch: hasOriginalResearch || false,
    userContext,
    length,
  })
  
  const model = getLanguageModel()
  
  let lastError: Error | undefined
  
  for (let attempt = 0; attempt <= MAX_PROFILE_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Run was cancelled')
    }
    try {
      if (attempt > 0) {
        const retryDelayMs = getRetryDelayMs(attempt)
        warn({ attempt, maxRetries: MAX_PROFILE_RETRIES, retryDelayMs }, 'Retrying paper profile generation')
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
      if (signal?.aborted) {
        throw new Error('Run was cancelled')
      }

      // If we're retrying, tell the model what failed so it can correct it.
      // This is critical for failures originating from post-generation validation.
      const retryFeedback =
        attempt > 0 && lastError
          ? `\n\nRETRY FEEDBACK (you must fix this):\n- Previous output failed validation with error: ${String(lastError.message).slice(0, 800)}\n\nReturn valid JSON matching the schema exactly.`
          : ''
      
      const response = await model.doGenerate({
        prompt: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: [{ type: 'text', text: prompt.user + retryFeedback }] }
        ],
        responseFormat: {
          type: 'json',
          schema: PAPER_PROFILE_JSON_SCHEMA
        },
        temperature: 0.3,  // Lower temperature for consistency
        maxOutputTokens: 8000  // Increased to accommodate outline with subsections
      })
      
      // In v3, response has content array with text parts
      const textPart = response.content?.find((p: { type: string }) => p.type === 'text')
      const responseText = textPart && 'text' in textPart ? textPart.text : undefined
      
      if (!responseText) {
        throw new Error('No response text from model')
      }
      
      const rawProfile = JSON.parse(responseText)
      
      // Add metadata and validate
      const profile: PaperProfile = {
        ...rawProfile,
        generatedAt: new Date().toISOString(),
        topic,
        paperType,
        hasOriginalResearch: hasOriginalResearch || false
      }
      
      // Validate and apply sensible defaults
      const validatedProfile = validateAndEnrichProfile(profile)
      
      info({
        discipline: validatedProfile.discipline.primary,
        sectionCount: validatedProfile.structure.appropriateSections.length,
        inappropriateSectionCount: validatedProfile.structure.inappropriateSections.length,
        minSources: validatedProfile.sourceExpectations.minimumUniqueSources,
        recencyProfile: validatedProfile.sourceExpectations.recencyProfile,
        qualityCriteriaCount: validatedProfile.qualityCriteria.length,
        requiredThemes: validatedProfile.coverage.requiredThemes.length,
        paperSubtype: validatedProfile.paperSubtype?.name,
        paperSubtypeId: validatedProfile.paperSubtype?.type,
        attempt: attempt > 0 ? attempt + 1 : undefined
      }, 'Paper profile generated successfully')
      
      return validatedProfile
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const statusCode = getErrorStatusCode(error)
      
      logError({ 
        error: lastError.message, 
        attempt: attempt + 1, 
        maxRetries: MAX_PROFILE_RETRIES + 1,
        statusCode,
        topic: topic.slice(0, 100), 
        paperType 
      }, 'Paper profile generation attempt failed')
      
      // Fail fast for permanent provider/request errors (e.g. schema/request 4xx).
      // Keep retrying validation/content errors because retry feedback can fix them.
      if (isPermanentProviderError(error)) {
        warn({ statusCode, attempt: attempt + 1 }, 'Stopping retries due to permanent provider error')
        break
      }
    }
  }
  
  // All retries exhausted - fail explicitly
  const errorMessage = `Paper profile generation failed after ${MAX_PROFILE_RETRIES + 1} attempts: ${lastError?.message || 'Unknown error'}`
  logError({ topic: topic.slice(0, 100), paperType, lastError: lastError?.message }, errorMessage)
  
  throw new Error(errorMessage)
}

/**
 * Scale outline word targets to match the requested total word count.
 * Computes a ratio (target / profile total) and applies it proportionally
 * to every section and subsection.  Skips scaling when the profile is
 * already within 5 % of the target.
 */
export function scaleProfileOutlineForLength(
  profile: PaperProfile,
  targetWords: number
): PaperProfile {
  if (!profile.outline?.sections || profile.outline.sections.length === 0) {
    return profile
  }

  const currentTotal = profile.outline.totalEstimatedWords || 0
  if (currentTotal <= 0 || targetWords <= 0) {
    return profile
  }

  const ratio = targetWords / currentTotal

  // If already within 5 %, skip unnecessary mutation
  if (Math.abs(ratio - 1) < 0.05) {
    return profile
  }

  const scaleWords = (n: number, min: number) => Math.max(min, Math.round(n * ratio))

  const scaledSections = profile.outline.sections.map((section) => ({
    ...section,
    expectedWords: scaleWords(section.expectedWords || 300, 200),
    subsections: section.subsections?.map((sub) => ({
      ...sub,
      expectedWords: scaleWords(sub.expectedWords || 150, 100),
    })),
  }))

  const totalEstimatedWords = scaledSections.reduce((sum, s) => sum + (s.expectedWords || 0), 0)

  return {
    ...profile,
    outline: {
      ...profile.outline,
      sections: scaledSections,
      totalEstimatedWords,
    },
  }
}

/**
 * Validate the generated profile and apply sensible defaults where needed
 */
function validateAndEnrichProfile(profile: PaperProfile): PaperProfile {
  const typeConfig = getPaperTypeConfig(profile.paperType)
  const SAFETY_MIN_SOURCES = typeConfig.safetyMinSources
  
  if (!profile.sourceExpectations.minimumUniqueSources || profile.sourceExpectations.minimumUniqueSources < SAFETY_MIN_SOURCES) {
    warn({ 
      originalValue: profile.sourceExpectations.minimumUniqueSources,
      paperType: profile.paperType,
      newMinimum: SAFETY_MIN_SOURCES
    }, `Profile minimum sources below safety floor for ${profile.paperType} (${SAFETY_MIN_SOURCES}), adjusting`)
    profile.sourceExpectations.minimumUniqueSources = SAFETY_MIN_SOURCES
  }
  
  const idealMultiplier = typeConfig.idealSourceMultiplier
  const minimumIdeal = Math.round(profile.sourceExpectations.minimumUniqueSources * idealMultiplier)
  
  if (!profile.sourceExpectations.idealSourceCount || profile.sourceExpectations.idealSourceCount < minimumIdeal) {
    profile.sourceExpectations.idealSourceCount = minimumIdeal
  }
  
  // Ensure at least some quality criteria exist
  if (!profile.qualityCriteria || profile.qualityCriteria.length === 0) {
    profile.qualityCriteria = [
      {
        criterion: 'Evidence-based reasoning',
        description: 'Claims should be supported by cited evidence',
        howToAchieve: 'Cite relevant sources for key claims and assertions'
      },
      {
        criterion: 'Logical coherence',
        description: 'Arguments should flow logically and build on each other',
        howToAchieve: 'Use clear transitions and ensure each section connects to the thesis'
      },
      {
        criterion: 'Scholarly depth',
        description: 'Analysis should go beyond surface-level description',
        howToAchieve: 'Provide critical analysis, not just summary of sources'
      }
    ]
  }
  
  // Ensure sections have reasonable word counts
  for (const section of profile.structure.appropriateSections) {
    if (!section.minWords || section.minWords < 100) {
      section.minWords = 200
    }
    if (!section.maxWords || section.maxWords < section.minWords) {
      section.maxWords = section.minWords * 3
    }
  }
  
  // Ensure coverage arrays exist
  if (!profile.coverage.requiredThemes) profile.coverage.requiredThemes = []
  if (!profile.coverage.recommendedThemes) profile.coverage.recommendedThemes = []
  if (!profile.coverage.debates) profile.coverage.debates = []
  if (!profile.coverage.methodologicalConsiderations) profile.coverage.methodologicalConsiderations = []
  if (!profile.coverage.commonPitfalls) profile.coverage.commonPitfalls = []
  
  // Ensure genre rules exist
  if (!profile.genreRules || profile.genreRules.length === 0) {
    profile.genreRules = [
      {
        rule: 'Maintain academic tone throughout',
        rationale: 'Scholarly writing requires formal, objective language'
      }
    ]
  }
  
  // Validate outline if present
  if (profile.outline && profile.outline.sections) {
    // CRITICAL: Ensure outline covers ALL sections from structure.appropriateSections.
    // The LLM sometimes generates 6 appropriate sections but only puts 2 in the outline.
    const structureSections = profile.structure?.appropriateSections || []
    if (structureSections.length > 0) {
      const outlineKeys = new Set(profile.outline.sections.map(s => s.sectionKey.toLowerCase()))
      const outlineTitles = new Set(profile.outline.sections.map(s => s.title.toLowerCase()))
      const missingSections = structureSections.filter(
        s => !outlineKeys.has(s.key.toLowerCase()) && !outlineTitles.has(s.title.toLowerCase())
      )
      if (missingSections.length > 0) {
        const missingNames = missingSections.map(s => `"${s.title}" (key: ${s.key})`).join(', ')
        throw new Error(
          `Profile outline incomplete: structure.appropriateSections has ${structureSections.length} sections but outline only has ${profile.outline.sections.length}. Missing: ${missingNames}. The outline MUST contain one entry for every section in structure.appropriateSections.`
        )
      }
    }

    const requiresSubsectionsForLongSections = typeConfig.requiresSubsections

    // Ensure all sections have required fields
    const subsectionViolations: string[] = []
    for (const section of profile.outline.sections) {
      if (!section.expectedWords || section.expectedWords < 100) {
        section.expectedWords = 300
      }
      if (!section.keyPoints || section.keyPoints.length === 0) {
        section.keyPoints = [`Cover key aspects of ${section.title}`]
      }

      // For thesis-type papers, every section must have subsections.
      if (requiresSubsectionsForLongSections) {
        const subCount = Array.isArray(section.subsections) ? section.subsections.length : 0
        if (subCount < 2) {
          subsectionViolations.push(`"${section.title}" (expectedWords=${section.expectedWords}, got ${subCount} subsections)`)
        }
      }

      // Normalize subsections: schema requires the field, but downstream prefers undefined when empty
      if (section.subsections && section.subsections.length > 0) {
        for (const sub of section.subsections) {
          if (!sub.expectedWords || sub.expectedWords < 50) {
            sub.expectedWords = Math.round(section.expectedWords / section.subsections.length)
          }
          if (!sub.keyPoints || sub.keyPoints.length === 0) {
            sub.keyPoints = [`Address ${sub.title}`]
          }
        }
      } else {
        section.subsections = undefined
      }
    }

    // Throw all subsection violations at once so retry feedback covers every failing section.
    if (subsectionViolations.length > 0) {
      throw new Error(
        `Profile outline invalid: these sections need at least 2 subsections each: ${subsectionViolations.join('; ')}`
      )
    }
    
    // Recalculate totalEstimatedWords from sections if missing
    if (!profile.outline.totalEstimatedWords) {
      profile.outline.totalEstimatedWords = profile.outline.sections.reduce(
        (sum, s) => sum + (s.expectedWords || 0), 0
      )
    }
    
    info({
      outlineSections: profile.outline.sections.length,
      totalSubsections: profile.outline.sections.reduce((sum, s) => sum + (s.subsections?.length || 0), 0),
      totalEstimatedWords: profile.outline.totalEstimatedWords
    }, 'Profile outline validated')
  } else {
    warn({ paperType: profile.paperType }, 'Profile generated without outline - pipeline will need fallback')
  }
  
  // Ensure voice configuration exists
  // If LLM didn't provide voice, use heuristic suggestion based on paper type and discipline
  if (!profile.voice || !profile.voice.profileId) {
    const suggestion = suggestVoiceProfile({
      paperType: profile.paperType,
      discipline: profile.discipline.primary,
      academicLevel: inferAcademicLevel(profile.paperType)
    })
    
    profile.voice = {
      profileId: suggestion.suggestedProfile,
      rationale: suggestion.rationale
    }
    
    info({
      profileId: profile.voice.profileId,
      paperType: profile.paperType,
      discipline: profile.discipline.primary
    }, 'Voice profile auto-assigned based on paper type and discipline')
  } else {
    // Validate that the profileId is valid
    const validIds: VoiceProfileId[] = ['conservative-reviewer', 'confident-researcher', 'senior-scholar', 'balanced-academic']
    if (!validIds.includes(profile.voice.profileId as VoiceProfileId)) {
      warn({
        invalidProfileId: profile.voice.profileId,
        defaultingTo: 'balanced-academic'
      }, 'Invalid voice profile ID from LLM, defaulting to balanced-academic')
      profile.voice.profileId = 'balanced-academic'
    }
  }
  
  return profile
}

function inferAcademicLevel(paperType: string): 'undergraduate' | 'masters' | 'doctoral' | 'faculty' {
  return getPaperTypeConfig(paperType).academicLevel
}



/**
 * Build profile guidance text for use in prompts.
 * This formats the profile into BINDING instructions that guide generation.
 * Genre rules and forbidden content are emphasized as non-negotiable constraints.
 * 
 * @param profile - The paper profile
 * @param mode - 'outline' for outline generation (emphasizes structure constraints),
 *               'section' for section generation (emphasizes writing guidance)
 */
export function buildProfileGuidanceForPrompt(
  profile: PaperProfile, 
  mode: 'outline' | 'section' = 'section'
): string {
  const sections = profile.structure.appropriateSections
    .map(s => mode === 'outline'
      ? `- **${s.title}** (key: ${s.key}): ${s.purpose} [${s.minWords}-${s.maxWords} words]`
      : `- **${s.title}** (${s.key}): ${s.purpose} [${s.minWords}-${s.maxWords} words, citations: ${s.citationExpectation}]`
    )
    .join('\n')
  
  const inappropriate = profile.structure.inappropriateSections.length > 0
    ? profile.structure.inappropriateSections
        .map(s => `- "${s.name}": ${s.reason}`)
        .join('\n')
    : 'None specified'
  
  const qualityCriteria = profile.qualityCriteria
    .map(q => `- **${q.criterion}**: ${q.description}`)
    .join('\n')
  
  // Make genre rules very explicit with rationales
  const genreRules = profile.genreRules
    .map(r => `- **${r.rule}**\n  Rationale: ${r.rationale}`)
    .join('\n')
  
  const themes = profile.coverage.requiredThemes.length > 0
    ? profile.coverage.requiredThemes.join(', ')
    : 'As appropriate for the topic'
  
  const pitfalls = profile.coverage.commonPitfalls.length > 0
    ? profile.coverage.commonPitfalls.map(p => `- ${p}`).join('\n')
    : 'None specified'
  
  const typeWarning = getPaperTypeWarning(profile.paperType, profile.hasOriginalResearch)
  
  // For outline mode, use a more structured format emphasizing constraints
  if (mode === 'outline') {
    const needsLitReviewGuidance = profile.paperType === 'literatureReview' || 
      profile.structure.appropriateSections.some(s => 
        resolveSectionType(s) === 'literature'
      )
    
    const litReviewOrgGuidance = needsLitReviewGuidance ? `

LITERATURE REVIEW ORGANIZATIONAL APPROACH:
Choose structure based on the topic:
- Thematic (most common)
- Chronological
- Methodological
- Theoretical

Use theme analysis from collected literature when available.
Subsection titles must be descriptive and topic-specific (not generic placeholders).
` : ''

    // Build title contract guidance for outline mode
    const outlineTitleContractGuidance = profile.titleContract ? `
═══════════════════════════════════════════════════════════════════════════════
🎯 TITLE CONTRACT - THE PAPER MUST DELIVER ON THIS PROMISE
═══════════════════════════════════════════════════════════════════════════════

**The title promises:** ${profile.titleContract.promise}

**Required deliverables (structure your outline to include these):**
${profile.titleContract.requiredDeliverables.map((d, i) => `${i + 1}. ${d}`).join('\n')}

**Failure mode to avoid:** ${profile.titleContract.failureMode}

Your outline MUST include sections that deliver on these requirements.
═══════════════════════════════════════════════════════════════════════════════
` : ''

    return `
${outlineTitleContractGuidance}
═══════════════════════════════════════════════════════════════════════════════
MANDATORY PAPER PROFILE CONSTRAINTS - YOU MUST FOLLOW THESE EXACTLY
═══════════════════════════════════════════════════════════════════════════════

This is a ${profile.paperType} in ${profile.discipline.primary}.

MANDATORY STRUCTURE - USE ONLY THESE SECTIONS:
Your outline MUST use sections from this list. Do not invent other sections.
${sections}

FORBIDDEN SECTIONS - DO NOT CREATE THESE UNDER ANY CIRCUMSTANCES:
The following sections are INAPPROPRIATE for this paper type and MUST NOT appear:
${inappropriate}

If you create any of the forbidden sections, the paper will be REJECTED.

GENRE RULES - INVIOLABLE CONSTRAINTS:
${genreRules || 'Follow standard academic conventions for this paper type.'}

REQUIRED THEME COVERAGE:
The paper must address these themes: ${themes}
${litReviewOrgGuidance}
DISCIPLINE CONTEXT:
- Field: ${profile.discipline.primary}
- Related fields: ${profile.discipline.related.join(', ')}
- Pace of change: ${profile.discipline.fieldCharacteristics.paceOfChange}
- Theory vs Empirical balance: ${profile.discipline.fieldCharacteristics.theoryVsEmpirical}
- Practitioner relevance: ${profile.discipline.fieldCharacteristics.practitionerRelevance}

SOURCE EXPECTATIONS:
- Minimum unique sources required: ${profile.sourceExpectations.minimumUniqueSources}
- Ideal source count: ${profile.sourceExpectations.idealSourceCount}
- Recency profile: ${profile.sourceExpectations.recencyProfile}

═══════════════════════════════════════════════════════════════════════════════
CREATE YOUR OUTLINE USING ONLY THE MANDATORY SECTIONS ABOVE
═══════════════════════════════════════════════════════════════════════════════`
  }

  // Build voice guidance if voice profile is configured
  // Note: Voice profile details are injected separately via the skeleton.yaml template
  // This section provides a brief summary for the profile guidance
  const voiceGuidance = profile.voice ? buildVoiceGuidanceSummary(profile.voice.profileId as VoiceProfileId, profile.voice.rationale) : ''

  // Build title contract guidance if present
  const titleContractGuidance = profile.titleContract ? `
═══════════════════════════════════════════════════════════════════════════════
🎯 TITLE CONTRACT - WHAT THIS PAPER MUST DELIVER
═══════════════════════════════════════════════════════════════════════════════

**The title promises:** ${profile.titleContract.promise}

**To fulfill this promise, the paper MUST include:**
${profile.titleContract.requiredDeliverables.map((d, i) => `${i + 1}. ${d}`).join('\n')}

**Success criteria - the paper delivers when:**
${profile.titleContract.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**⚠️ FAILURE MODE (what to avoid):**
${profile.titleContract.failureMode}

A paper that covers related background but fails to deliver on these requirements
is INCOMPLETE, regardless of how well-written it is.
═══════════════════════════════════════════════════════════════════════════════
` : ''

  // Build paper subtype guidance if present
  const subtypeGuidance = profile.paperSubtype 
    ? `**Paper Subtype:** ${profile.paperSubtype.name} (${profile.paperSubtype.type})
**Subtype Rationale:** ${profile.paperSubtype.rationale}
` 
    : ''

  // Section mode - full guidance for content generation
  return `## PAPER PROFILE GUIDANCE - BINDING CONSTRAINTS
${titleContractGuidance}${typeWarning}
**Discipline:** ${profile.discipline.primary}
**Paper Type:** ${profile.paperType}
${subtypeGuidance}**Field Characteristics:** ${profile.discipline.fieldCharacteristics.paceOfChange} pace of change, ${profile.discipline.fieldCharacteristics.theoryVsEmpirical}, ${profile.discipline.fieldCharacteristics.practitionerRelevance} practitioner relevance
${voiceGuidance}
### Recommended Structure
${sections}

### ⛔ FORBIDDEN CONTENT - DO NOT GENERATE
The following sections and content are INAPPROPRIATE for this ${profile.paperType}:
${inappropriate}

If you generate any of the above content, the paper will be INVALID.

### 📜 GENRE RULES - INVIOLABLE CONSTRAINTS
These rules MUST be followed. Violating them makes the paper genre-inappropriate:
${genreRules}

### Quality Criteria for This Paper
${qualityCriteria}

### Required Theme Coverage
The paper must address: ${themes}

### Citation Guidance
Cite whenever you include:
- Statistics, data, or numerical findings from a source
- Another author's theories, frameworks, or models
- Another author's research methods, procedures, or findings
- Opinions, predictions, or interpretations from a source
- Case studies or specific examples from the literature

Do NOT cite:
- Your own analysis, synthesis, or conclusions
- Common knowledge widely accepted in the field
- Your own research results (in Results sections)

**Recency guidance:** ${profile.sourceExpectations.recencyProfile} - ${profile.sourceExpectations.recencyGuidance}

### Common Pitfalls to Avoid
${pitfalls}`
}

function getPaperTypeWarning(paperType: string, hasOriginalResearch?: boolean): string {
  const text = getPaperTypeGuardrails(paperType, hasOriginalResearch)
  return text ? `\n${text}\n` : ''
}

/**
 * Build a brief voice guidance summary for profile guidance
 * Full voice details are injected via skeleton.yaml template separately
 */
function buildVoiceGuidanceSummary(profileId: VoiceProfileId, rationale?: string): string {
  const profile = getVoiceProfile(profileId)
  
  return `
### Authorial Voice: ${profile.name}
**Persona:** ${profile.description}
**Literature stance:** ${profile.literatureStance} | **Hedging:** ${profile.hedging.density} | **Risk:** ${profile.intellectualRisk}
${rationale ? `**Rationale:** ${rationale}` : ''}

Note: Detailed voice rules are provided in a separate AUTHORIAL VOICE section below.
`
}

/**
 * Validate paper content against the profile.
 * This is the profile-based replacement for hardcoded validation rules.
 */
export function validatePaperWithProfile(
  content: string,
  profile: PaperProfile,
  citedPaperIds?: string[]
): ProfileValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  const found: string[] = []
  const missing: string[] = []
  const recommendations: string[] = []
  
  // Check for inappropriate sections
  for (const inappropriate of profile.structure.inappropriateSections) {
    // Create flexible patterns to match section headings
    const patterns = [
      new RegExp(`^#{1,2}\\s*${escapeRegex(inappropriate.name)}\\b`, 'im'),
      new RegExp(`^#{1,2}\\s*${escapeRegex(inappropriate.name)}\\s*$`, 'im')
    ]
    
    const found = patterns.some(pattern => pattern.test(content))
    if (found) {
      issues.push(
        `Found inappropriate section "${inappropriate.name}": ${inappropriate.reason}`
      )
      recommendations.push(
        `Remove or rename the "${inappropriate.name}" section to align with ${profile.paperType} conventions`
      )
    }
  }
  
  // Check for required sections
  for (const section of profile.structure.appropriateSections) {
    // Use robust extraction rather than simple heading regex.
    // This avoids matching only a table-of-contents / outline header list.
    const sectionContent = extractSectionContent(content, section.title, section.key)
    const sectionFound = sectionContent.length > 0
    
    if (sectionFound) {
      found.push(section.title)
      
      // Check word count - try both title and key since headings may use either
      const wordCount = countWords(sectionContent)
      
      if (wordCount < section.minWords * 0.7) {  // Allow some flexibility
        warnings.push(
          `${section.title} section appears brief (approximately ${wordCount} words, recommended minimum: ${section.minWords})`
        )
      }
    } else {
      missing.push(section.title)
      recommendations.push(`Consider adding "${section.title}": ${section.purpose}`)
    }
  }
  
  // Check citation count against profile expectations
  // Prefer pipeline-provided paper IDs (more reliable than [N] markers which often reset per section).
  const uniqueSources = citedPaperIds && citedPaperIds.length > 0
    ? new Set(citedPaperIds).size
    : countUniqueCitations(content)
  const citationAdequate = uniqueSources >= profile.sourceExpectations.minimumUniqueSources
  
  if (!citationAdequate) {
    issues.push(
      `Insufficient citation diversity: found ${uniqueSources} unique sources, minimum ${profile.sourceExpectations.minimumUniqueSources} expected for this ${profile.paperType}`
    )
    recommendations.push(
      `Add more citations from diverse sources. ${profile.sourceExpectations.recencyGuidance}`
    )
  } else if (uniqueSources < profile.sourceExpectations.idealSourceCount) {
    warnings.push(
      `Citation count (${uniqueSources}) is adequate but below ideal (${profile.sourceExpectations.idealSourceCount}) for comprehensive coverage`
    )
  }
  
  // Check for required themes coverage
  const coveredThemes: string[] = []
  const missingThemes: string[] = []
  
  for (const theme of profile.coverage.requiredThemes) {
    if (contentMentionsTheme(content, theme)) {
      coveredThemes.push(theme)
    } else {
      missingThemes.push(theme)
      warnings.push(`May not adequately cover required theme: "${theme}"`)
    }
  }
  
  // Check title contract deliverables
  const deliverablesCovered: string[] = []
  const deliverablesMissing: string[] = []
  
  if (profile.titleContract && profile.titleContract.requiredDeliverables) {
    for (const deliverable of profile.titleContract.requiredDeliverables) {
      // Use a more flexible check - look for key terms from the deliverable
      if (contentMentionsTheme(content, deliverable)) {
        deliverablesCovered.push(deliverable)
      } else {
        deliverablesMissing.push(deliverable)
        warnings.push(`Title contract deliverable may be missing: "${deliverable}"`)
      }
    }
    
    // If most deliverables are missing, it's an issue, not just a warning
    if (deliverablesMissing.length > deliverablesCovered.length && profile.titleContract.requiredDeliverables.length >= 2) {
      issues.push(
        `Paper may not fulfill its title contract. Missing ${deliverablesMissing.length} of ${profile.titleContract.requiredDeliverables.length} required deliverables. The title promises: "${profile.titleContract.promise}"`
      )
      recommendations.push(
        `Ensure the paper delivers on its title by including: ${deliverablesMissing.join('; ')}`
      )
    }
  }
  
  // Calculate score
  const totalSections = profile.structure.appropriateSections.length
  const foundCount = found.length
  const sectionScore = totalSections > 0 ? (foundCount / totalSections) * 100 : 100
  
  const citationScore = Math.min(100, (uniqueSources / profile.sourceExpectations.minimumUniqueSources) * 100)
  
  const themeScore = profile.coverage.requiredThemes.length > 0
    ? (coveredThemes.length / profile.coverage.requiredThemes.length) * 100
    : 100
  
  // Calculate title contract score
  const totalDeliverables = profile.titleContract?.requiredDeliverables?.length || 0
  const titleContractScore = totalDeliverables > 0
    ? (deliverablesCovered.length / totalDeliverables) * 100
    : 100
  
  // Weighted average: sections 30%, citations 25%, themes 20%, title contract 25%
  // Title contract is important - if the paper doesn't answer its own question, it fails
  const score = Math.round(
    (sectionScore * 0.30) + 
    (citationScore * 0.25) + 
    (themeScore * 0.20) +
    (titleContractScore * 0.25)
  )
  
  // Major issues reduce validity
  const hasInappropriateSections = profile.structure.inappropriateSections.some(inappropriate => {
    const patterns = [
      new RegExp(`^#{1,2}\\s*${escapeRegex(inappropriate.name)}\\b`, 'im')
    ]
    return patterns.some(pattern => pattern.test(content))
  })
  
  return {
    valid: issues.length === 0 && !hasInappropriateSections,
    score,
    issues,
    warnings,
    sectionAnalysis: { found, missing, recommendations },
    citationAnalysis: {
      uniqueSourceCount: uniqueSources,
      minimumRequired: profile.sourceExpectations.minimumUniqueSources,
      adequate: citationAdequate
    },
    themeCoverage: {
      covered: coveredThemes,
      missing: missingThemes
    },
    titleContractCoverage: totalDeliverables > 0 ? {
      covered: deliverablesCovered,
      missing: deliverablesMissing,
      promise: profile.titleContract?.promise || ''
    } : undefined
  }
}

// Helper functions

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeHeadingTitle(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSectionContent(content: string, sectionTitle: string, sectionKey?: string): string {
  const targetTitles = [sectionTitle, sectionKey].filter(Boolean) as string[]
  const normalizedTargets = new Set(targetTitles.map(normalizeHeadingTitle))

  // Parse all markdown headings, then choose the best (longest) matching slice.
  // This avoids false matches in a table-of-contents or outline-only header list.
  const headingRe = /^(#{1,6})\s*(?:\d+(?:\.\d+)*)?\s*[:.\-–)]?\s*(.+?)\s*$/gm
  const headings: Array<{ idx: number; level: number; title: string; raw: string }> = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(content)) !== null) {
    const raw = m[0]
    const level = m[1].length
    const title = (m[2] || '').trim()
    headings.push({ idx: m.index, level, title, raw })
  }

  let bestSlice = ''
  let bestWords = 0

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const normalized = normalizeHeadingTitle(h.title)
    if (!normalizedTargets.has(normalized)) continue

    // End at the next heading of same-or-higher rank (e.g., next ## when current is ##).
    let end = content.length
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].idx
        break
      }
    }

    const slice = content.slice(h.idx, end).trim()
    const wc = countWords(slice)
    if (wc > bestWords) {
      bestWords = wc
      bestSlice = slice
    }
  }

  if (bestSlice) return bestSlice

  // Fallback: simple regex matching (handles non-standard heading formats).
  // Uses a lookahead for the next heading OR true end-of-string (not end-of-line).
  // We split the logic: find the heading line with multiline, then grab content until next heading.
  const escapedTitle = escapeRegex(sectionTitle)
  const headingStartRe = new RegExp(
    `^#{1,6}\\s*(?:\\d+(?:\\.\\d+)*)?\\s*[:.\\-–)]?\\s*${escapedTitle}\\b`,
    'im'
  )
  const headingMatch = headingStartRe.exec(content)
  if (!headingMatch) return ''

  // From the heading position, grab everything up to the next heading of any level or end of string.
  const rest = content.slice(headingMatch.index)
  const nextHeadingRe = /\n#{1,6}\s/
  const nextMatch = nextHeadingRe.exec(rest.slice(headingMatch[0].length))
  if (nextMatch) {
    return rest.slice(0, headingMatch[0].length + nextMatch.index).trim()
  }
  return rest.trim()
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length
}

function countUniqueCitations(content: string): number {
  // Match citation markers like [CITE: uuid]
  const citeMarkers = content.match(/\[CITE:\s*([^\]]+)\]/g) || []
  const uniqueCiteIds = new Set(
    citeMarkers.map(marker => {
      const match = marker.match(/\[CITE:\s*([^\]]+)\]/)
      return match ? match[1].trim() : null
    }).filter(Boolean)
  )
  
  // Match storage format citations like [@paperId#instanceId]
  const storageMarkers = content.match(/\[@([^\]#]+)#[^\]]*\]/g) || []
  const uniqueStorageIds = new Set(
    storageMarkers.map(marker => {
      const match = marker.match(/\[@([^\]#]+)/)
      return match ? match[1].trim() : null
    }).filter(Boolean)
  )
  
  // Match numbered citation markers like [1], [2], [3] (generated by LLM)
  const numberedMarkers = content.match(/\[(\d{1,3})\]/g) || []
  const uniqueNumbers = new Set(
    numberedMarkers.map(marker => {
      const match = marker.match(/\[(\d{1,3})\]/)
      return match ? match[1] : null
    }).filter(Boolean)
  )
  
  // Also check for already-formatted citations like (Smith et al., 2023)
  const formattedCitations = content.match(/\([^)]*\d{4}[^)]*\)/g) || []
  
  // Return the highest count from any format detected
  // Content may be at different pipeline stages using different marker formats
  const counts = [
    uniqueCiteIds.size,
    uniqueStorageIds.size,
    uniqueNumbers.size,
    Math.floor(formattedCitations.length * 0.7)  // Assume some overlap
  ]
  
  return Math.max(...counts)
}

function contentMentionsTheme(content: string, theme: string): boolean {
  // Create variations of the theme to search for
  const words = theme.toLowerCase().split(/\s+/)
  const contentLower = content.toLowerCase()
  
  // Check if most key words from the theme appear in content
  const foundWords = words.filter(word => 
    word.length > 3 && contentLower.includes(word)
  )
  
  return foundWords.length >= Math.ceil(words.length * 0.6)
}
