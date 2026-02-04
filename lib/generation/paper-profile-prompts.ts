/**
 * Prompts for Paper Profile Generation
 * 
 * These prompts guide the LLM to generate contextual, discipline-aware
 * paper profiles that replace hardcoded rules.
 * 
 * Includes voice/authorial persona suggestion for authentic variation.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { ProfileGenerationInput } from './paper-profile-types'
import { getVoiceProfileSummaries, type VoiceProfileId } from './voice-profiles'

// Cache for loaded markdown content
const profileGuidanceCache: Map<string, string> = new Map()

// Path to externalized profile markdown files
const PROFILES_DIR = path.join(process.cwd(), 'lib/prompts/profiles')

/**
 * Load paper type guidance from external markdown file
 * Falls back to empty string if file doesn't exist
 */
async function loadProfileGuidance(paperType: string): Promise<string> {
  // Check cache first
  if (profileGuidanceCache.has(paperType)) {
    return profileGuidanceCache.get(paperType)!
  }
  
  // Map paper types to file names
  const fileNameMap: Record<string, string> = {
    'literatureReview': 'literature-review.md',
    'mastersThesis': 'masters-thesis.md',
    'phdDissertation': 'phd-dissertation.md',
    'capstoneProject': 'capstone-project.md',
    'researchArticle': 'research-article.md'
  }
  
  const fileName = fileNameMap[paperType]
  if (!fileName) {
    return ''
  }
  
  try {
    const filePath = path.join(PROFILES_DIR, fileName)
    const content = await fs.readFile(filePath, 'utf-8')
    profileGuidanceCache.set(paperType, content)
    return content
  } catch {
    // File doesn't exist or can't be read - return empty string
    console.warn(`Could not load profile guidance for ${paperType}`)
    return ''
  }
}

interface PromptOutput {
  system: string
  user: string
}

/**
 * Generate the system and user prompts for paper profile generation
 */
export async function getPaperProfilePrompt(input: ProfileGenerationInput): Promise<PromptOutput> {
  const { topic, paperType, hasOriginalResearch, userContext } = input
  
  // Get voice profile summaries for the prompt
  const voiceProfiles = getVoiceProfileSummaries()
  const voiceProfilesDescription = voiceProfiles.map(p => 
    `- ${p.id}: "${p.name}" - ${p.description}\n  Characteristics: ${p.characteristics.join('; ')}`
  ).join('\n')

  const system = `You are an expert academic advisor with deep knowledge across all disciplines. Your task is to analyze a research topic and paper type, then create a comprehensive profile that will guide paper generation.

Your profile must be:
- CONTEXTUAL: Specific to this topic and discipline, not generic advice
- PRACTICAL: Actionable guidance that can be directly used in generation
- ACCURATE: Reflect actual academic norms and expectations for this field
- COMPREHENSIVE: Cover structure, sources, quality criteria, content coverage, AND authorial voice

You have expertise in identifying:
- What makes excellent papers in different disciplines and traditions
- Appropriate structure and sections for different paper types
- Source expectations (types, recency, quantity) by field
- Field-specific quality criteria and evaluation standards
- Common pitfalls and mistakes in different paper types
- APPROPRIATE AUTHORIAL VOICE for the paper type, discipline, and academic level

AUTHORIAL VOICE SELECTION:
Different papers require different "author voices" based on:
- Academic level (undergraduate → doctoral → faculty)
- Discipline conventions (humanities often more evaluative, STEM often more conservative)
- Paper type (literature reviews need synthesis, dissertations need strong positions)

Available voice profiles:
${voiceProfilesDescription}

CRITICAL PRINCIPLE FOR ALL PAPER TYPES:
The profile you create will guide a writing system that uses REAL source documents.
- For Literature Reviews: The writer should ONLY cite information actually present in the provided sources
- For Research Articles: If this is a TEMPLATE/EXAMPLE paper, illustrative data may be generated, but this must be clearly marked as illustrative in the Limitations section
- NEVER encourage fabricating citations, statistics, or claims not supported by provided evidence
- Specificity should come from the ACTUAL sources available, not invented details

Different disciplines have different norms for evidence:
- Quantitative fields expect statistics, but only when sources provide them
- Qualitative fields expect themes and quotes from the actual evidence
- Theoretical fields expect precise argumentation based on cited frameworks
- Humanities expect textual evidence and close reading of actual sources

IMPORTANT: Your response must be valid JSON matching the schema exactly. Do not include any text outside the JSON object.`

  const paperTypeGuidance = await getPaperTypeGuidance(paperType, hasOriginalResearch || false)
  
  const user = `ANALYZE THIS PAPER REQUEST AND CREATE A COMPREHENSIVE PROFILE:

Topic: "${topic}"
Paper Type: ${formatPaperType(paperType)}
${hasOriginalResearch ? 'Note: This paper presents ORIGINAL RESEARCH with data collection.\n' : ''}${userContext ? `Additional Context: ${userContext}\n` : ''}
${paperTypeGuidance}

Create a comprehensive paper profile by analyzing:

0. TITLE CONTRACT ANALYSIS (DO THIS FIRST - CRITICAL)
   The title/topic is: "${topic}"
   
   Before analyzing anything else, determine what this title PROMISES the reader:
   
   A. WHAT IS THE PROMISE?
      - If someone reads this title, what do they expect to learn or understand?
      - What specific question(s) does this title implicitly ask?
      - Restate the core promise in one clear sentence.
   
   B. WHAT MUST THE PAPER DELIVER?
      - List 3-6 specific pieces of content/analysis that would be MISSING if the paper fails to deliver
      - These are OBLIGATIONS created by the title, not just "nice to have" themes
      - Be specific: "enumeration of options with feasibility comparison" not just "discuss options"
   
   C. SUCCESS CRITERIA
      - How can we tell if the paper answered its own question?
      - What would make a reader say "this paper delivered what the title promised"?
      - List 2-4 concrete criteria.
   
   D. FAILURE MODE
      - What would make this paper FAIL despite covering related topics?
      - Describe the specific trap of writing background/context without delivering the core promise.
   
   EXAMPLES (for illustration - adapt to the actual topic):
   
   Title: "What options do the US have to acquire Greenland?"
   - Promise: Analysis of specific acquisition mechanisms and their feasibility
   - Must deliver: (1) Enumeration of options (purchase, lease, partnership, etc.), (2) Legal/political feasibility for each, (3) Comparison of costs and barriers, (4) Assessment of likelihood
   - Success: Reader can list the options and understand which are viable and why
   - Failure: Paper discusses Greenland's strategic importance but never analyzes actual acquisition mechanisms
   
   Title: "The impact of remote work on employee productivity"
   - Promise: Evidence about how remote work affects productivity
   - Must deliver: (1) Studies showing productivity effects, (2) Direction and magnitude of impact, (3) Moderating factors, (4) Mechanisms explaining the relationship
   - Success: Reader understands whether remote work helps or hurts productivity and under what conditions
   - Failure: Paper discusses remote work trends and practices without presenting productivity evidence
   
   Title: "Machine learning approaches for cancer detection"
   - Promise: Review of ML methods applied to cancer detection
   - Must deliver: (1) Survey of ML techniques used, (2) Performance comparisons, (3) Dataset and evaluation considerations, (4) Current limitations and future directions
   - Success: Reader understands the landscape of ML cancer detection methods and their effectiveness
   - Failure: Paper explains ML basics and cancer biology without reviewing actual ML cancer detection systems

1. DISCIPLINE CONTEXT
   - What is the primary academic discipline for this topic?
   - What related fields inform this area?
   - What are the methodological traditions (quantitative, qualitative, mixed, theoretical)?
   - How fast-moving is this field? Is it theory-heavy or empirical-heavy?
   - Is practitioner relevance expected?

2. STRUCTURE GUIDANCE
   - What sections are APPROPRIATE for this specific ${formatPaperType(paperType)} on this topic?
   - For each section provide: key (camelCase), title, purpose, word range (min/max), citation expectation (none/light/moderate/heavy), key elements, and isLiteratureFocused
   - isLiteratureFocused: Set to TRUE for sections that discuss, review, or synthesize EXISTING LITERATURE (prior work, existing theories, published findings). Set to FALSE for sections describing ORIGINAL work (your own methodology, data collection, results, analysis).
     * For LITERATURE REVIEWS: Almost ALL sections are literature-focused (even "Methodology" describes literature search, "Findings" synthesizes what literature says)
     * For RESEARCH ARTICLES: Introduction, Literature Review, Discussion are literature-focused. Methodology, Results are NOT (they describe original work)
     * For THESES: Introduction, Literature Review, Discussion, Conclusion are literature-focused. Methods, Results, Analysis of original data are NOT
   - What sections would be INAPPROPRIATE for this paper type and why?
   - What elements are REQUIRED somewhere in the paper (e.g., theoretical framework, practical implications)?

3. SOURCE EXPECTATIONS
   - How many unique sources should a comprehensive ${formatPaperType(paperType)} on this topic cite? (Consider topic breadth and depth)
   - What is the ideal source count for excellence?
   - What types of sources are expected? (peer-reviewed journals, books, conference papers, industry reports, case studies, government data, etc.)
   - For each source type: approximate percentage and importance (required/recommended/optional)
   - Should recent literature be prioritized, or do foundational works matter equally?
   - Provide specific recency guidance for this field
   - Are there seminal works commonly cited in this area?
   
   SEARCH YEAR RANGE (CRITICAL):
   - What year range should be searched when looking for papers on this topic?
   - Consider: When did this topic emerge? Are foundational works from decades ago relevant?
   - The current year is ${new Date().getFullYear()}.
   - Examples:
     * "COVID-19 pandemic response" → fromYear: 2019, toYear: ${new Date().getFullYear()} (topic emerged in 2019)
     * "Machine learning fundamentals" → fromYear: 1990, toYear: ${new Date().getFullYear()} (foundational works from 1990s matter)
     * "Large language models" → fromYear: 2017, toYear: ${new Date().getFullYear()} (transformer architecture emerged 2017)
     * "Climate change policy" → fromYear: 1990, toYear: ${new Date().getFullYear()} (IPCC started 1988, key literature from 1990s)
     * "Quantum computing" → fromYear: 1980, toYear: ${new Date().getFullYear()} (theoretical foundations from 1980s)
     * "Ancient Greek philosophy scholarship" → fromYear: 1900, toYear: ${new Date().getFullYear()} (scholarly tradition spans century+)
   - Provide a rationale explaining why this year range is appropriate for the topic

4. QUALITY CRITERIA
   - What specific criteria define excellence for this paper type in this discipline?
   - Provide 4-6 criteria, each with: name, description of what it means, and how to achieve it
   - Criteria should be specific to this topic/discipline, not generic

5. CONTENT COVERAGE
   - What themes MUST be addressed for comprehensive coverage of this topic?
   - What themes would strengthen the paper if included?
   - What scholarly debates or tensions exist in this area?
   - What methodological considerations are specific to this topic?
   - What common pitfalls should be avoided?

6. GENRE RULES
   - What rules define this paper type that must not be violated?
   - For each rule: state the rule and explain why it matters

7. AUTHORIAL VOICE
   - Which voice profile is most appropriate for this ${formatPaperType(paperType)} in this discipline?
   - Consider: academic level implied by paper type, discipline conventions, topic sensitivity
   - IMPORTANT: Consider what the TITLE CONTRACT requires:
     * If the title asks "what options" / "which is better" / "should we" / "how to" → the paper needs a voice that TAKES POSITIONS and EVALUATES (use confident-researcher or senior-scholar)
     * If the title asks "what is" / "what does research say" / "overview of" → a more balanced or descriptive voice may be appropriate
     * If the paper must compare, rank, or recommend → avoid overly hedged conservative voice
   - Provide a rationale explaining why this voice is appropriate given the title's requirements
   - Available profiles: conservative-reviewer, confident-researcher, senior-scholar, balanced-academic

Return a JSON object with this exact structure:
{
  "titleContract": {
    "promise": "string - what the title promises the reader will learn",
    "requiredDeliverables": ["string - specific content that MUST appear"],
    "successCriteria": ["string - how to verify the paper delivered"],
    "failureMode": "string - what would make this paper fail despite covering related topics"
  },
  "discipline": {
    "primary": "string",
    "related": ["string"],
    "methodologicalTraditions": ["string"],
    "fieldCharacteristics": {
      "paceOfChange": "rapid|moderate|slow",
      "theoryVsEmpirical": "theory-heavy|balanced|empirical-heavy",
      "practitionerRelevance": "high|medium|low"
    }
  },
  "structure": {
    "appropriateSections": [
      {
        "key": "string (camelCase)",
        "title": "string",
        "purpose": "string",
        "minWords": number,
        "maxWords": number,
        "citationExpectation": "none|light|moderate|heavy",
        "keyElements": ["string"],
        "isLiteratureFocused": boolean // TRUE if section discusses/synthesizes existing literature, FALSE if describes original methodology/data/results
      }
    ],
    "inappropriateSections": [
      { "name": "string", "reason": "string" }
    ],
    "requiredElements": ["string"]
  },
  "sourceExpectations": {
    "minimumUniqueSources": number,
    "idealSourceCount": number,
    "sourceTypeDistribution": [
      { "type": "string", "percentage": number, "importance": "required|recommended|optional" }
    ],
    "recencyProfile": "cutting-edge|balanced|foundational-heavy",
    "searchYearRange": {
      "fromYear": number,
      "toYear": number,
      "rationale": "string explaining why this year range is appropriate"
    },
    "recencyGuidance": "string",
    "seminalWorks": ["string"] or null
  },
  "qualityCriteria": [
    {
      "criterion": "string",
      "description": "string",
      "howToAchieve": "string"
    }
  ],
  "coverage": {
    "requiredThemes": ["string"],
    "recommendedThemes": ["string"],
    "debates": ["string"],
    "methodologicalConsiderations": ["string"],
    "commonPitfalls": ["string"]
  },
  "genreRules": [
    { "rule": "string", "rationale": "string" }
  ],
  "voice": {
    "profileId": "conservative-reviewer|confident-researcher|senior-scholar|balanced-academic",
    "rationale": "string explaining why this voice is appropriate for this paper"
  }
}`

  return { system, user }
}

/**
 * Get paper type-specific guidance to include in the prompt
 * Loads from external markdown files for maintainability
 */
async function getPaperTypeGuidance(paperType: string, hasOriginalResearch: boolean): Promise<string> {
  if (hasOriginalResearch) {
    return `EMPIRICAL RESEARCH PAPER CONTEXT:
This paper presents ORIGINAL RESEARCH with data collection. The profile should reflect:
- A detailed, reproducible Methodology section is REQUIRED
- Results section presents the author's OWN findings (minimal to no citations in Results)
- Discussion section interprets results and compares with existing literature
- The paper makes an original empirical contribution to the field
`
  }
  
  // Load guidance from external markdown file
  const guidance = await loadProfileGuidance(paperType)
  
  if (guidance) {
    // Add context header based on paper type
    const contextHeaders: Record<string, string> = {
      'literatureReview': 'LITERATURE REVIEW CONTEXT:',
      'mastersThesis': "MASTER'S THESIS CONTEXT:",
      'phdDissertation': 'PHD DISSERTATION CONTEXT:',
      'capstoneProject': 'CAPSTONE PROJECT CONTEXT:',
      'researchArticle': 'RESEARCH ARTICLE CONTEXT:'
    }
    const header = contextHeaders[paperType] || ''
    return header ? `${header}\n\n${guidance}` : guidance
  }
  
  return ''
}

/**
 * Format paper type for display in prompts
 */
function formatPaperType(paperType: string): string {
  const formatMap: Record<string, string> = {
    'literatureReview': 'Literature Review',
    'researchArticle': 'Research Article',
    'mastersThesis': "Master's Thesis",
    'phdDissertation': 'PhD Dissertation',
    'capstoneProject': 'Capstone Project'
  }
  return formatMap[paperType] || paperType
}

/**
 * JSON Schema for validating the profile response
 * Used for structured output mode
 */
export const PAPER_PROFILE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    titleContract: {
      type: 'object' as const,
      properties: {
        promise: { type: 'string' as const },
        requiredDeliverables: { type: 'array' as const, items: { type: 'string' as const } },
        successCriteria: { type: 'array' as const, items: { type: 'string' as const } },
        failureMode: { type: 'string' as const }
      },
      required: ['promise', 'requiredDeliverables', 'successCriteria', 'failureMode'],
      additionalProperties: false
    },
    discipline: {
      type: 'object' as const,
      properties: {
        primary: { type: 'string' as const },
        related: { type: 'array' as const, items: { type: 'string' as const } },
        methodologicalTraditions: { type: 'array' as const, items: { type: 'string' as const } },
        fieldCharacteristics: {
          type: 'object' as const,
          properties: {
            paceOfChange: { type: 'string' as const, enum: ['rapid', 'moderate', 'slow'] },
            theoryVsEmpirical: { type: 'string' as const, enum: ['theory-heavy', 'balanced', 'empirical-heavy'] },
            practitionerRelevance: { type: 'string' as const, enum: ['high', 'medium', 'low'] }
          },
          required: ['paceOfChange', 'theoryVsEmpirical', 'practitionerRelevance'],
          additionalProperties: false
        }
      },
      required: ['primary', 'related', 'methodologicalTraditions', 'fieldCharacteristics'],
      additionalProperties: false
    },
    structure: {
      type: 'object' as const,
      properties: {
        appropriateSections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              key: { type: 'string' as const },
              title: { type: 'string' as const },
              purpose: { type: 'string' as const },
              minWords: { type: 'number' as const },
              maxWords: { type: 'number' as const },
              citationExpectation: { type: 'string' as const, enum: ['none', 'light', 'moderate', 'heavy'] },
              keyElements: { type: 'array' as const, items: { type: 'string' as const } },
              isLiteratureFocused: { type: 'boolean' as const }
            },
            required: ['key', 'title', 'purpose', 'minWords', 'maxWords', 'citationExpectation', 'keyElements', 'isLiteratureFocused'],
            additionalProperties: false
          }
        },
        inappropriateSections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              name: { type: 'string' as const },
              reason: { type: 'string' as const }
            },
            required: ['name', 'reason'],
            additionalProperties: false
          }
        },
        requiredElements: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['appropriateSections', 'inappropriateSections', 'requiredElements'],
      additionalProperties: false
    },
    sourceExpectations: {
      type: 'object' as const,
      properties: {
        minimumUniqueSources: { type: 'number' as const },
        idealSourceCount: { type: 'number' as const },
        sourceTypeDistribution: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              type: { type: 'string' as const },
              percentage: { type: 'number' as const },
              importance: { type: 'string' as const, enum: ['required', 'recommended', 'optional'] }
            },
            required: ['type', 'percentage', 'importance'],
            additionalProperties: false
          }
        },
        recencyProfile: { type: 'string' as const, enum: ['cutting-edge', 'balanced', 'foundational-heavy'] },
        searchYearRange: {
          type: 'object' as const,
          properties: {
            fromYear: { type: 'number' as const },
            toYear: { type: 'number' as const },
            rationale: { type: 'string' as const }
          },
          required: ['fromYear', 'toYear', 'rationale'],
          additionalProperties: false
        },
        recencyGuidance: { type: 'string' as const },
        seminalWorks: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['minimumUniqueSources', 'idealSourceCount', 'sourceTypeDistribution', 'recencyProfile', 'searchYearRange', 'recencyGuidance', 'seminalWorks'],
      additionalProperties: false
    },
    qualityCriteria: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          criterion: { type: 'string' as const },
          description: { type: 'string' as const },
          howToAchieve: { type: 'string' as const }
        },
        required: ['criterion', 'description', 'howToAchieve'],
        additionalProperties: false
      }
    },
    coverage: {
      type: 'object' as const,
      properties: {
        requiredThemes: { type: 'array' as const, items: { type: 'string' as const } },
        recommendedThemes: { type: 'array' as const, items: { type: 'string' as const } },
        debates: { type: 'array' as const, items: { type: 'string' as const } },
        methodologicalConsiderations: { type: 'array' as const, items: { type: 'string' as const } },
        commonPitfalls: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['requiredThemes', 'recommendedThemes', 'debates', 'methodologicalConsiderations', 'commonPitfalls'],
      additionalProperties: false
    },
    genreRules: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          rule: { type: 'string' as const },
          rationale: { type: 'string' as const }
        },
        required: ['rule', 'rationale'],
        additionalProperties: false
      }
    },
    voice: {
      type: 'object' as const,
      properties: {
        profileId: { 
          type: 'string' as const, 
          enum: ['conservative-reviewer', 'confident-researcher', 'senior-scholar', 'balanced-academic'] 
        },
        rationale: { type: 'string' as const }
      },
      required: ['profileId', 'rationale'],
      additionalProperties: false
    }
  },
  required: ['titleContract', 'discipline', 'structure', 'sourceExpectations', 'qualityCriteria', 'coverage', 'genreRules', 'voice'],
  additionalProperties: false
}
