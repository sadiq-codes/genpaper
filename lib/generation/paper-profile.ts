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
  ProfileValidationResult,
  SectionProfile 
} from './paper-profile-types'
import { getPaperProfilePrompt, PAPER_PROFILE_JSON_SCHEMA } from './paper-profile-prompts'

/**
 * Generate a comprehensive paper profile for the given topic and paper type.
 * This is the main entry point for the paper intelligence system.
 * 
 * @param input - Topic, paper type, and optional context
 * @returns A complete PaperProfile to guide generation
 */
export async function generatePaperProfile(
  input: ProfileGenerationInput
): Promise<PaperProfile> {
  const { topic, paperType, hasOriginalResearch, userContext } = input
  
  info({ topic: topic.slice(0, 100), paperType, hasOriginalResearch }, 'Generating paper profile')
  
  const prompt = getPaperProfilePrompt({
    topic,
    paperType,
    hasOriginalResearch: hasOriginalResearch || false,
    userContext
  })
  
  const model = getLanguageModel()
  
  try {
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
      requiredThemes: validatedProfile.coverage.requiredThemes.length
    }, 'Paper profile generated successfully')
    
    return validatedProfile
    
  } catch (error) {
    logError({ error, topic, paperType }, 'Failed to generate paper profile')
    
    // Return a fallback profile rather than failing completely
    return getFallbackProfile(input)
  }
}

/**
 * Validate the generated profile and apply sensible defaults where needed
 */
function validateAndEnrichProfile(profile: PaperProfile): PaperProfile {
  // Ensure minimum source requirements are reasonable
  // Safety floor: if LLM returned unreasonably low values, use sensible minimums
  // These are NOT targets - the LLM should set appropriate values based on discipline
  // This just catches edge cases where LLM might return 0 or 1
  const SAFETY_MIN_SOURCES = 5  // Absolute floor - any paper needs at least some sources
  
  if (!profile.sourceExpectations.minimumUniqueSources || profile.sourceExpectations.minimumUniqueSources < SAFETY_MIN_SOURCES) {
    warn({ originalValue: profile.sourceExpectations.minimumUniqueSources }, 
      `Profile minimum sources below safety floor (${SAFETY_MIN_SOURCES}), adjusting`)
    profile.sourceExpectations.minimumUniqueSources = SAFETY_MIN_SOURCES
  }
  
  // Ideal should always be at least the minimum
  if (!profile.sourceExpectations.idealSourceCount || profile.sourceExpectations.idealSourceCount < profile.sourceExpectations.minimumUniqueSources) {
    profile.sourceExpectations.idealSourceCount = Math.round(
      profile.sourceExpectations.minimumUniqueSources * 1.5
    )
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
 * Get a fallback profile when generation fails.
 * This provides reasonable defaults based on paper type.
 */
function getFallbackProfile(input: ProfileGenerationInput): PaperProfile {
  const { topic, paperType, hasOriginalResearch } = input
  
  warn({ topic, paperType }, 'Using fallback paper profile')
  
  const isLitReview = paperType === 'literatureReview'
  const isEmpirical = hasOriginalResearch || paperType === 'researchArticle'
  
  const baseSections: SectionProfile[] = [
    {
      key: 'introduction',
      title: 'Introduction',
      purpose: 'Establish context, significance, and objectives',
      minWords: 400,
      maxWords: 800,
      citationExpectation: 'moderate',
      keyElements: ['Background context', 'Research significance', 'Paper objectives', 'Scope definition']
    }
  ]
  
  if (isLitReview) {
    baseSections.push(
      {
        key: 'searchMethodology',
        title: 'Search Methodology',
        purpose: 'Describe the literature search process',
        minWords: 300,
        maxWords: 600,
        citationExpectation: 'light',
        keyElements: ['Databases searched', 'Search terms', 'Inclusion/exclusion criteria', 'Selection process']
      },
      {
        key: 'thematicAnalysis',
        title: 'Thematic Analysis',
        purpose: 'Synthesize literature by themes',
        minWords: 1500,
        maxWords: 3000,
        citationExpectation: 'heavy',
        keyElements: ['Theme identification', 'Cross-source synthesis', 'Critical analysis']
      },
      {
        key: 'researchGaps',
        title: 'Research Gaps and Future Directions',
        purpose: 'Identify what remains unknown',
        minWords: 400,
        maxWords: 800,
        citationExpectation: 'moderate',
        keyElements: ['Gap identification', 'Future research suggestions']
      }
    )
  } else if (isEmpirical) {
    baseSections.push(
      {
        key: 'literatureReview',
        title: 'Literature Review',
        purpose: 'Establish theoretical framework and identify research gap - this is background, NOT the main content',
        minWords: 500,
        maxWords: 1000,
        citationExpectation: 'heavy',
        keyElements: ['Theoretical framework', 'Key prior studies', 'Research gap justification', 'Hypotheses derivation']
      },
      {
        key: 'methodology',
        title: 'Methodology',
        purpose: 'Describe YOUR empirical research design - sample, variables, data collection, analysis',
        minWords: 800,
        maxWords: 1500,
        citationExpectation: 'light',
        keyElements: [
          'Sample description (N=?, selection criteria, demographics)',
          'Variables (DV, IVs, controls with operational definitions)',
          'Data collection procedures',
          'Analytical approach (statistical methods, tests used)',
          'Validity and reliability measures'
        ]
      },
      {
        key: 'results',
        title: 'Results',
        purpose: 'Present YOUR original findings - statistics, tables, hypothesis outcomes',
        minWords: 600,
        maxWords: 1200,
        citationExpectation: 'none',
        keyElements: [
          'Descriptive statistics table (means, SDs, correlations)',
          'Main analysis results with statistics (β, p-values, CI)',
          'Hypothesis testing outcomes (supported/not supported)',
          'Tables and figures presenting YOUR data',
          'Effect sizes where applicable'
        ]
      },
      {
        key: 'discussion',
        title: 'Discussion',
        purpose: 'Interpret YOUR results in context of existing literature',
        minWords: 600,
        maxWords: 1200,
        citationExpectation: 'moderate',
        keyElements: [
          'Interpretation of YOUR key findings',
          'Comparison with prior research (how your results align/differ)',
          'Theoretical implications',
          'Practical implications',
          'Explanation of unexpected results'
        ]
      },
      {
        key: 'limitations',
        title: 'Limitations',
        purpose: 'Acknowledge constraints and weaknesses of YOUR study',
        minWords: 200,
        maxWords: 400,
        citationExpectation: 'light',
        keyElements: [
          'Sample limitations',
          'Methodological constraints',
          'Generalizability concerns',
          'Suggestions for future research'
        ]
      }
    )
  }
  
  baseSections.push({
    key: 'conclusion',
    title: 'Conclusion',
    purpose: 'Summarize key findings and contributions',
    minWords: 300,
    maxWords: 600,
    citationExpectation: 'light',
    keyElements: ['Summary', 'Contributions', 'Future directions']
  })
  
  const inappropriateSections = isLitReview ? [
    { name: 'Results', reason: 'Literature reviews synthesize existing research, not original data' },
    { name: 'Methodology', reason: 'Use "Search Methodology" for literature reviews, not empirical methodology' },
    { name: 'Findings', reason: 'Use "Thematic Analysis" or "Synthesis" instead for literature reviews' }
  ] : isEmpirical ? [
    { name: 'Thematic Analysis', reason: 'Research articles present original data, not thematic synthesis of literature' },
    { name: 'Search Methodology', reason: 'Research articles describe empirical methods, not literature search strategies' },
    { name: 'Synthesis', reason: 'Research articles present original findings, not synthesis of existing work' },
    { name: 'Research Gaps', reason: 'Include gap identification briefly in Literature Review, not as standalone section' }
  ] : []
  
  return {
    generatedAt: new Date().toISOString(),
    topic,
    paperType,
    hasOriginalResearch: hasOriginalResearch || false,
    discipline: {
      primary: 'General Academic',
      related: [],
      methodologicalTraditions: ['mixed methods'],
      fieldCharacteristics: {
        paceOfChange: 'moderate',
        theoryVsEmpirical: 'balanced',
        practitionerRelevance: 'medium'
      }
    },
    structure: {
      appropriateSections: baseSections,
      inappropriateSections,
      requiredElements: ['Clear thesis or research question', 'Evidence-based arguments', 'Proper citations']
    },
    sourceExpectations: {
      minimumUniqueSources: isLitReview ? 20 : 15,
      idealSourceCount: isLitReview ? 35 : 25,
      sourceTypeDistribution: [
        { type: 'Peer-reviewed journal articles', percentage: 70, importance: 'required' as const },
        { type: 'Books and book chapters', percentage: 15, importance: 'recommended' as const },
        { type: 'Conference papers', percentage: 10, importance: 'optional' as const },
        { type: 'Other sources', percentage: 5, importance: 'optional' as const }
      ],
      recencyProfile: 'balanced',
      recencyGuidance: 'Include both foundational works and recent literature (last 5 years)',
      seminalWorks: []
    },
    qualityCriteria: isLitReview ? [
      {
        criterion: 'Critical synthesis across sources',
        description: 'Integrate and compare multiple sources rather than listing them',
        howToAchieve: 'Show how sources relate, contradict, or build on each other'
      },
      {
        criterion: 'Identification of debates and contradictions',
        description: 'Highlight where scholars disagree',
        howToAchieve: 'Explicitly state "While X argues..., Y found contradictory evidence..."'
      },
      {
        criterion: 'Gap identification',
        description: 'Identify what remains unknown or understudied',
        howToAchieve: 'Note limitations in existing research and areas for future study'
      },
      {
        criterion: 'Comprehensive coverage',
        description: 'Cover the breadth of relevant literature',
        howToAchieve: 'Include diverse perspectives and methodological approaches'
      },
      {
        criterion: 'Pivotal publications identified',
        description: 'Highlight landmark studies that shaped the field',
        howToAchieve: 'Identify foundational works and explain WHY they were influential, not just what they found'
      },
      {
        criterion: 'Clear organizational structure',
        description: 'Organize using thematic, chronological, methodological, or theoretical approach',
        howToAchieve: 'Choose the structure that best illuminates the topic and use clear subheadings'
      }
    ] : isEmpirical ? [
      {
        criterion: 'Clear hypothesis or research question',
        description: 'State specific, testable predictions',
        howToAchieve: 'Formulate H1, H2... with clear variables and expected relationships'
      },
      {
        criterion: 'Rigorous methodology with specifics',
        description: 'Describe sample, variables, and analysis with concrete details',
        howToAchieve: 'Include specific N (e.g., N=247), selection criteria, operational definitions, statistical methods (e.g., hierarchical regression)'
      },
      {
        criterion: 'Data tables with actual statistics',
        description: 'Present findings in properly formatted tables with real numbers',
        howToAchieve: 'Include Table 1 (descriptive stats: N, Mean, SD) and Table 2 (regression: β, SE, t, p, CI). Generate plausible illustrative data.'
      },
      {
        criterion: 'Specific statistical reporting',
        description: 'Report exact coefficients, p-values, and confidence intervals',
        howToAchieve: 'Write "β = 0.38, p < .001, 95% CI [0.24, 0.52]" not "significant relationship"'
      },
      {
        criterion: 'Three-part discussion structure',
        description: 'Each finding must be stated, compared to literature, and explained',
        howToAchieve: 'For each finding: (1) STATE what you found, (2) COMPARE to prior research, (3) EXPLAIN why results agree or differ'
      }
    ] : [
      {
        criterion: 'Funnel introduction structure',
        description: 'Introduction moves from broad context to specific research focus',
        howToAchieve: 'Start with general topic importance, narrow to specific problem, then state your purpose'
      },
      {
        criterion: 'Gap identification in literature review',
        description: 'Explicitly state what gap your study addresses',
        howToAchieve: 'After reviewing literature, state what remains unknown and how your study fills that gap'
      },
      {
        criterion: 'Three-part discussion structure',
        description: 'Each finding is stated, compared to literature, and explained',
        howToAchieve: 'For each finding: (1) STATE what you found, (2) COMPARE to prior research, (3) EXPLAIN why results agree or differ'
      },
      {
        criterion: 'Methodologically-contextualized citations',
        description: 'When citing studies, provide methodological context',
        howToAchieve: 'Include sample size, method, and findings when citing empirical studies, not just conclusions'
      },
      {
        criterion: 'Critical analysis over summary',
        description: 'Go beyond description to evaluation and synthesis',
        howToAchieve: 'Identify debates, contradictions, and patterns across sources'
      }
    ],
    coverage: {
      requiredThemes: [],
      recommendedThemes: [],
      debates: [],
      methodologicalConsiderations: [],
      commonPitfalls: [
        'Starting introduction too narrowly (not using funnel structure)',
        'Literature review that summarizes without synthesizing or identifying gaps',
        'Discussion that restates results without comparing to prior research',
        'Citations that only mention findings without methodological context',
        'Missing explicit gap identification that justifies the study',
        'Descriptive rather than analytical writing',
        'Poor organization and logical flow between sections'
      ]
    },
    genreRules: isLitReview ? [
      {
        rule: 'Do not present original data collection',
        rationale: 'Literature reviews synthesize existing research'
      },
      {
        rule: 'Emphasize synthesis over summary',
        rationale: 'Value comes from connecting and analyzing sources'
      },
      {
        rule: 'Identify contradictions and debates between sources',
        rationale: 'Critical analysis requires showing where scholars disagree'
      }
    ] : isEmpirical ? [
      {
        rule: 'Present YOUR original empirical findings, not summaries of other studies',
        rationale: 'Research articles contribute NEW knowledge through original data analysis'
      },
      {
        rule: 'Methodology must describe YOUR data collection and analysis with specific details',
        rationale: 'Include exact sample size (N=X), selection method, variables with operational definitions, and analytical approach'
      },
      {
        rule: 'Results section MUST include data tables with actual numbers',
        rationale: 'At minimum: Table 1 (descriptive statistics) and Table 2 (regression/analysis results) with specific values, not placeholders'
      },
      {
        rule: 'Report specific statistics: β coefficients, p-values, confidence intervals, effect sizes',
        rationale: 'Never write vague findings like "significant relationship" - always include the actual numbers (β = 0.38, p < .001)'
      },
      {
        rule: 'Discussion must reference YOUR specific statistics when interpreting findings',
        rationale: 'Write "Our finding that X predicted Y (β = 0.38) suggests..." not vague interpretations'
      },
      {
        rule: 'Results section presents YOUR statistics without citations to other studies',
        rationale: 'This section reports what YOU found. Save comparisons to prior work for Discussion.'
      }
    ] : [
      {
        rule: 'Clearly separate methodology from results',
        rationale: 'Readers need to understand how findings were obtained'
      }
    ]
  }
}

/**
 * Build profile guidance text for use in prompts.
 * This formats the profile into BINDING instructions that guide generation.
 * Genre rules and forbidden content are emphasized as non-negotiable constraints.
 */
export function buildProfileGuidanceForPrompt(profile: PaperProfile): string {
  const sections = profile.structure.appropriateSections
    .map(s => `- **${s.title}** (${s.key}): ${s.purpose} [${s.minWords}-${s.maxWords} words, citations: ${s.citationExpectation}]`)
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
