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

/** Maximum retry attempts for profile generation */
const MAX_PROFILE_RETRIES = 2

/** Delay between retries in ms */
const RETRY_DELAY_MS = 1000

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
  const { topic, paperType, hasOriginalResearch, userContext } = input
  
  info({ topic: topic.slice(0, 100), paperType, hasOriginalResearch }, 'Generating paper profile')
  
  const prompt = await getPaperProfilePrompt({
    topic,
    paperType,
    hasOriginalResearch: hasOriginalResearch || false,
    userContext
  })
  
  const model = getLanguageModel()
  
  let lastError: Error | undefined
  
  for (let attempt = 0; attempt <= MAX_PROFILE_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        warn({ attempt, maxRetries: MAX_PROFILE_RETRIES }, 'Retrying paper profile generation')
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      }
      
      const response = await model.doGenerate({
        inputFormat: 'messages',
        mode: {
          type: 'object-json',
          schema: PAPER_PROFILE_JSON_SCHEMA
        },
        prompt: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: [{ type: 'text', text: prompt.user }] }
        ],
        temperature: 0.3,  // Lower temperature for consistency
        maxTokens: 4000
      })
      
      if (!response.text) {
        throw new Error('No response text from model')
      }
      
      const rawProfile = JSON.parse(response.text)
      
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
        attempt: attempt > 0 ? attempt + 1 : undefined
      }, 'Paper profile generated successfully')
      
      return validatedProfile
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      logError({ 
        error: lastError.message, 
        attempt: attempt + 1, 
        maxRetries: MAX_PROFILE_RETRIES + 1,
        topic: topic.slice(0, 100), 
        paperType 
      }, 'Paper profile generation attempt failed')
      
      // Don't retry on certain errors (e.g., invalid input)
      if (lastError.message.includes('Invalid') || lastError.message.includes('400')) {
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
 * Validate the generated profile and apply sensible defaults where needed
 */
function validateAndEnrichProfile(profile: PaperProfile): PaperProfile {
  // Ensure minimum source requirements are reasonable
  // Safety floor: if LLM returned unreasonably low values, use sensible minimums
  // These are NOT targets - the LLM should set appropriate values based on discipline
  // This just catches edge cases where LLM might return unreasonably low values
  
  // Different paper types have different minimum requirements
  // Literature reviews are all about sources - they need MANY more than other types
  const SAFETY_MIN_BY_TYPE: Record<string, number> = {
    'literatureReview': 25,    // Literature reviews require comprehensive source coverage
    'mastersThesis': 20,       // Theses need substantial source base
    'phdDissertation': 30,     // Dissertations need extensive coverage
    'capstoneProject': 15,     // Capstones are practical but need sources
    'researchArticle': 10      // Research articles focus on original data
  }
  
  const SAFETY_MIN_SOURCES = SAFETY_MIN_BY_TYPE[profile.paperType] || 10
  
  if (!profile.sourceExpectations.minimumUniqueSources || profile.sourceExpectations.minimumUniqueSources < SAFETY_MIN_SOURCES) {
    warn({ 
      originalValue: profile.sourceExpectations.minimumUniqueSources,
      paperType: profile.paperType,
      newMinimum: SAFETY_MIN_SOURCES
    }, `Profile minimum sources below safety floor for ${profile.paperType} (${SAFETY_MIN_SOURCES}), adjusting`)
    profile.sourceExpectations.minimumUniqueSources = SAFETY_MIN_SOURCES
  }
  
  // Ideal should always be higher than minimum
  // For literature reviews, ideal should be significantly higher
  const idealMultiplier = profile.paperType === 'literatureReview' ? 2.0 : 1.5
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
  
  return profile
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
  
  // Build a strong warning section for literature reviews and other specific types
  let typeWarning = ''
  if (profile.paperType === 'literatureReview') {
    typeWarning = `
═══════════════════════════════════════════════════════════════════════════════
⚠️  CRITICAL: THIS IS A LITERATURE REVIEW - NOT AN EMPIRICAL RESEARCH PAPER  ⚠️
═══════════════════════════════════════════════════════════════════════════════

You MUST NOT:
- Describe data collection procedures (surveys, interviews, experiments, etc.)
- Present original findings or results from research you conducted
- Include a "Methodology" section describing empirical research methods
- Include a "Results" or "Findings" section presenting original data
- Write phrases like "we collected", "participants were", "data was analyzed"

You MUST:
- ONLY synthesize and analyze EXISTING published research
- Describe your LITERATURE SEARCH methodology (databases, search terms, etc.)
- Present themes and patterns found ACROSS the literature
- Provide critical analysis and synthesis of what OTHER researchers found
- Identify gaps in the EXISTING literature

This is not optional. Writing empirical content in a literature review is a GENRE VIOLATION.

═══════════════════════════════════════════════════════════════════════════════
📊 CRITICAL ANALYSIS REQUIREMENTS - WHAT MAKES A STRONG LITERATURE REVIEW
═══════════════════════════════════════════════════════════════════════════════

A literature review is NOT a summary of sources. It is a CRITICAL ANALYSIS.

REQUIRED CRITICAL ELEMENTS:
1. **Identify Contradictions**: When sources disagree, explicitly state this:
   "While [Author A] argues X, [Author B] presents contradictory evidence for Y"

2. **Evaluate Methodologies**: Assess the strength and limitations of different studies:
   "The large sample size in [Study A] provides robust evidence, whereas [Study B]'s 
   case study approach offers depth but limited generalizability"

3. **Discuss Debates**: Highlight unresolved tensions in the field:
   "A central debate in this literature concerns whether..."

4. **Synthesize Patterns**: Show what MULTIPLE sources together suggest:
   "Across these studies, a consistent pattern emerges..."

5. **Identify Gaps**: Note what remains unstudied or contested:
   "Despite extensive research on X, the relationship between X and Y remains unclear"

WHEN TO CITE IN LITERATURE REVIEWS:
Since you are synthesizing existing research, MOST claims require citations:
- ALWAYS cite: statistics, findings, theories, methods, opinions from sources
- ALWAYS cite: when comparing or contrasting what different authors found
- NO citation needed: your own synthesis or analytical observations
- NO citation needed: widely accepted common knowledge

Most paragraphs should contain multiple citations because you are reporting 
what the literature says. Integrate sources to show dialogue between scholars.

═══════════════════════════════════════════════════════════════════════════════
📚 ORGANIZATIONAL APPROACHES - Choose the Best Structure
═══════════════════════════════════════════════════════════════════════════════

Choose the most appropriate structure based on the topic:

1. **THEMATIC** - Organize by recurring themes or concepts
   Best for: Multi-faceted topics with distinct sub-areas
   Example: "Healthcare access" → policy barriers, economic barriers, cultural barriers

2. **CHRONOLOGICAL** - Trace the development of ideas over time
   Best for: Topics with clear historical evolution
   Example: "AI in education" → 1980s expert systems → 2000s adaptive learning → 2020s generative AI

3. **METHODOLOGICAL** - Compare different research approaches
   Best for: Topics studied using diverse methods with different findings
   Example: "Leadership effectiveness" → survey studies vs case studies vs experimental research

4. **THEORETICAL** - Organize by competing theories or frameworks
   Best for: Topics with multiple theoretical perspectives
   Example: "Learning" → behaviorist vs cognitive vs constructivist theories

For complex topics, you may COMBINE approaches (e.g., thematic overall with chronological within each theme).

═══════════════════════════════════════════════════════════════════════════════
🏆 PIVOTAL PUBLICATIONS - Identify Landmark Studies
═══════════════════════════════════════════════════════════════════════════════

Identify and highlight influential works that shaped the field:
- Look for frequently referenced foundational studies
- Identify theories or frameworks that subsequent studies build upon
- Note methodological innovations that changed how the topic is studied
- Highlight studies that challenged prevailing assumptions

When discussing landmark studies, explain WHY they were influential:
"Bandura's (1977) social learning theory was pivotal because it shifted the field's focus 
from purely behavioral explanations to include cognitive and social factors, spawning 
decades of research on observational learning and self-efficacy."

═══════════════════════════════════════════════════════════════════════════════
📝 LITERATURE REVIEW STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

**INTRODUCTION should:**
- Establish the focus and purpose of the review
- Define the scope (what's included/excluded)
- State the research question or gap being addressed
- Preview the organizational approach

**BODY should:**
- Be organized by your chosen approach (themes, time periods, methods, or theories)
- Use clear subheadings for each major section
- Synthesize sources within each section (don't just list them)
- Show connections between sections

**CONCLUSION should:**
- Summarize the key findings from the literature
- Emphasize the significance of what you found
- Clearly state the gap your research addresses
- Show how your work contributes to the field

═══════════════════════════════════════════════════════════════════════════════
`
  } else if (profile.paperType === 'researchArticle') {
    typeWarning = `
═══════════════════════════════════════════════════════════════════════════════
⚠️  CRITICAL: THIS IS A RESEARCH ARTICLE - MUST PRESENT ORIGINAL RESEARCH  ⚠️
═══════════════════════════════════════════════════════════════════════════════

You MUST NOT:
- Write a literature review disguised as research
- Use "Thematic Analysis" or "Synthesis" as main sections
- Report only what OTHER studies found without your own analysis
- Describe literature search methodology (that's for systematic reviews)
- Write "Studies have shown..." or "Research indicates..." as main content
- Write vague findings without specific statistics (e.g., "higher likelihood" without numbers)

You MUST:
- Present ORIGINAL empirical findings (your data, your analysis)
- Include a proper empirical METHODOLOGY section:
  * Sample description (N=?, selection criteria, demographics)
  * Variables (independent, dependent, controls) with operational definitions
  * Data collection procedures (survey, experiment, secondary data source)
  * Analytical approach (regression type, statistical tests, coding method)
- Include a RESULTS section with YOUR ORIGINAL FINDINGS:
  * Descriptive statistics table (means, SDs, frequencies)
  * Inferential statistics (β coefficients, p-values, confidence intervals)
  * Hypothesis testing outcomes (H1: supported/rejected)
  * Your own tables and figures, not citations to others' tables
- Include DISCUSSION that interprets YOUR results:
  * "Our finding that X relates to Y (β=0.34, p<0.01) confirms..."
  * "Contrary to Smith (2020), our data suggests..."
  * NOT just re-summarizing what other scholars found

═══════════════════════════════════════════════════════════════════════════════
📊 GENERATING EMPIRICAL DATA - MANDATORY REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════

Since this is a research article, you MUST generate plausible, illustrative empirical 
data. This demonstrates proper research article format. Generate realistic numbers 
that are internally consistent with the topic.

**METHODOLOGY must include specific details:**
- "We surveyed N=247 [participants/firms/cases] selected via [method]"
- "The dependent variable was [outcome], measured on a 5-point Likert scale"
- "We employed hierarchical regression analysis to test our hypotheses"

**RESULTS must include AT LEAST TWO DATA TABLES:**

Table 1: Descriptive Statistics (REQUIRED)
| Variable | N | Mean | SD | Min | Max |
|----------|---|------|-----|-----|-----|
| [DV Name] | 247 | 3.42 | 1.08 | 1.00 | 5.00 |
| [IV Name] | 247 | 4.15 | 0.92 | 1.50 | 5.00 |
| [Control] | 247 | 2.87 | 1.23 | 1.00 | 5.00 |

Table 2: Regression Results (REQUIRED)  
| Predictor | β | SE | t | p | 95% CI |
|-----------|-----|------|------|-------|--------------|
| [Main IV] | 0.38 | 0.07 | 5.43 | <.001 | [0.24, 0.52] |
| [Control 1] | 0.12 | 0.08 | 1.50 | .134 | [-0.04, 0.28] |
Note: R² = .24, F(3, 243) = 25.63, p < .001

**HYPOTHESIS TESTING must include specific outcomes:**
- "H1 was supported: X significantly predicted Y (β = 0.38, p < .001, 95% CI [0.24, 0.52])"
- "H2 was not supported: no significant relationship was found (β = 0.05, p = .62)"

**NEVER write vague findings:**
- ❌ "higher likelihood of success" → ✓ "68% higher survival rate (χ² = 12.4, p < .01)"
- ❌ "significant relationship" → ✓ "β = 0.38, p < .001, 95% CI [0.24, 0.52]"
- ❌ "the analysis revealed patterns" → ✓ "R² = .24, indicating 24% variance explained"

**DISCUSSION must reference YOUR specific statistics:**
- "Our finding that X strongly predicted Y (β = 0.38) suggests..."
- "The effect size (R² = .24) indicates meaningful practical significance..."
- "Contrary to Smith (2020), our data showed a positive relationship (β = 0.38 vs. their β = -0.12)"

LANGUAGE TO USE:
- "Our analysis reveals..." / "We found that..."
- "The results indicate..." / "Our data show..."
- "Hypothesis 1 was supported/rejected..."

LANGUAGE TO AVOID:
- "The literature suggests..." / "Studies have shown..."
- "According to researchers..." / "Scholars have found..."

WHEN TO CITE BY SECTION:
- **Introduction/Literature Review**: Cite extensively - theories, prior findings, frameworks
- **Methodology**: Cite sparingly - only established methods or validated instruments
- **Results**: MINIMAL citations - these are YOUR data, not others' findings
- **Discussion**: Moderate citations - when comparing your results to prior work
- **Limitations/Conclusion**: Minimal citations - your own assessment

NOTE: In the Limitations section, acknowledge that this is an illustrative/template study 
if specific real data was not provided. This maintains academic honesty.
═══════════════════════════════════════════════════════════════════════════════
`
  }
  
  // For outline mode, use a more structured format emphasizing constraints
  if (mode === 'outline') {
    // Determine if this paper type needs literature review organizational guidance
    const needsLitReviewGuidance = profile.paperType === 'literatureReview' || 
      profile.structure.appropriateSections.some(s => 
        s.key.toLowerCase().includes('literature') || s.key.toLowerCase().includes('review')
      )
    
    const litReviewOrgGuidance = needsLitReviewGuidance ? `

LITERATURE REVIEW ORGANIZATIONAL APPROACH:
When creating the outline for the literature review section(s), choose the most appropriate structure:

1. **THEMATIC** - Organize by recurring themes or concepts
   Best for: Multi-faceted topics with distinct sub-areas
   Create subsections for each major theme (e.g., "Economic Factors", "Social Factors", "Policy Implications")

2. **CHRONOLOGICAL** - Trace development of ideas over time
   Best for: Topics with clear historical evolution
   Create subsections for different time periods or phases of development

3. **METHODOLOGICAL** - Compare different research approaches
   Best for: Topics studied using diverse methods
   Create subsections comparing qualitative vs. quantitative findings, or different methodological schools

4. **THEORETICAL** - Organize by competing theories or frameworks
   Best for: Topics with multiple theoretical perspectives
   Create subsections for each major theoretical approach

Choose based on what best illuminates the topic. For complex topics, you may combine approaches
(e.g., thematic overall with chronological development within each theme).

IMPORTANT: If a THEME ANALYSIS FROM COLLECTED LITERATURE section appears below, use those
EMERGENT THEMES as the basis for your section structure. The themes identified from actual
literature analysis are more accurate than generic assumptions. Create subsections that
align with the themes, debates, and organizational approach recommended by the analysis.

Generate meaningful subsection titles that reflect the actual content themes identified from the topic.
Do NOT use generic titles like "Theme 1" or "Section A" - use descriptive titles.
` : ''

    return `
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

  // Section mode - full guidance for content generation
  return `## PAPER PROFILE GUIDANCE - BINDING CONSTRAINTS
${typeWarning}
**Discipline:** ${profile.discipline.primary}
**Paper Type:** ${profile.paperType}
**Field Characteristics:** ${profile.discipline.fieldCharacteristics.paceOfChange} pace of change, ${profile.discipline.fieldCharacteristics.theoryVsEmpirical}, ${profile.discipline.fieldCharacteristics.practitionerRelevance} practitioner relevance

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

/**
 * Build a condensed version of profile guidance for section-level prompts.
 * This is a shorter version suitable for including in individual section generation.
 */
export function buildCondensedProfileGuidance(
  profile: PaperProfile, 
  currentSectionKey: string
): string {
  const currentSection = profile.structure.appropriateSections.find(s => s.key === currentSectionKey)
  
  // Get relevant quality criteria (limit to 3 most relevant)
  const relevantCriteria = profile.qualityCriteria.slice(0, 3)
    .map(q => q.criterion)
    .join(', ')
  
  // Get relevant genre rules
  const relevantRules = profile.genreRules.slice(0, 2)
    .map(r => r.rule)
    .join('; ')
  
  let guidance = `**Discipline:** ${profile.discipline.primary}\n**Quality Focus:** ${relevantCriteria}\n**Key Rules:** ${relevantRules}`
  
  if (currentSection) {
    guidance += `\n\n**This Section (${currentSection.title}):**\n- Purpose: ${currentSection.purpose}\n- Target: ${currentSection.minWords}-${currentSection.maxWords} words\n- Citations: ${currentSection.citationExpectation}\n- Key elements: ${currentSection.keyElements.join(', ')}`
  }
  
  // Add warnings about inappropriate content if relevant
  const inappropriate = profile.structure.inappropriateSections
  if (inappropriate.length > 0) {
    const warnings = inappropriate.map(i => `${i.name} (${i.reason})`).join(', ')
    guidance += `\n\n**Avoid:** ${warnings}`
  }
  
  return guidance
}

/**
 * Validate paper content against the profile.
 * This is the profile-based replacement for hardcoded validation rules.
 */
export function validatePaperWithProfile(
  content: string,
  profile: PaperProfile
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
    const patterns = [
      new RegExp(`^#{1,2}\\s*${escapeRegex(section.title)}\\b`, 'im'),
      new RegExp(`^#{1,2}\\s*${escapeRegex(section.key)}\\b`, 'im')
    ]
    
    const sectionFound = patterns.some(pattern => pattern.test(content))
    
    if (sectionFound) {
      found.push(section.title)
      
      // Check word count
      const sectionContent = extractSectionContent(content, section.title)
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
  const uniqueSources = countUniqueCitations(content)
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
  
  // Calculate score
  const totalSections = profile.structure.appropriateSections.length
  const foundCount = found.length
  const sectionScore = totalSections > 0 ? (foundCount / totalSections) * 100 : 100
  
  const citationScore = Math.min(100, (uniqueSources / profile.sourceExpectations.minimumUniqueSources) * 100)
  
  const themeScore = profile.coverage.requiredThemes.length > 0
    ? (coveredThemes.length / profile.coverage.requiredThemes.length) * 100
    : 100
  
  // Weighted average: sections 40%, citations 35%, themes 25%
  const score = Math.round(
    (sectionScore * 0.40) + 
    (citationScore * 0.35) + 
    (themeScore * 0.25)
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
    }
  }
}

// Helper functions

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractSectionContent(content: string, sectionTitle: string): string {
  const escapedTitle = escapeRegex(sectionTitle)
  const pattern = new RegExp(
    `^#{1,2}\\s*${escapedTitle}\\b[\\s\\S]*?(?=^#{1,2}\\s|$)`,
    'im'
  )
  const match = content.match(pattern)
  return match ? match[0] : ''
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length
}

function countUniqueCitations(content: string): number {
  // Match citation markers like [CITE: uuid] or (Author, Year) patterns
  const citeMarkers = content.match(/\[CITE:\s*([^\]]+)\]/g) || []
  const uniqueIds = new Set(
    citeMarkers.map(marker => {
      const match = marker.match(/\[CITE:\s*([^\]]+)\]/)
      return match ? match[1].trim() : null
    }).filter(Boolean)
  )
  
  // Also check for already-formatted citations like (Smith et al., 2023)
  const formattedCitations = content.match(/\([^)]*\d{4}[^)]*\)/g) || []
  
  // Combine unique counts (rough estimate)
  return uniqueIds.size + Math.floor(formattedCitations.length * 0.7)  // Assume some overlap
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
