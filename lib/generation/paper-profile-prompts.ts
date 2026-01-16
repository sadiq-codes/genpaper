/**
 * Prompts for Paper Profile Generation
 * 
 * These prompts guide the LLM to generate contextual, discipline-aware
 * paper profiles that replace hardcoded rules.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { ProfileGenerationInput } from './paper-profile-types'

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
  
  const system = `You are an expert academic advisor with deep knowledge across all disciplines. Your task is to analyze a research topic and paper type, then create a comprehensive profile that will guide paper generation.

Your profile must be:
- CONTEXTUAL: Specific to this topic and discipline, not generic advice
- PRACTICAL: Actionable guidance that can be directly used in generation
- ACCURATE: Reflect actual academic norms and expectations for this field
- COMPREHENSIVE: Cover structure, sources, quality criteria, and content coverage

You have expertise in identifying:
- What makes excellent papers in different disciplines and traditions
- Appropriate structure and sections for different paper types
- Source expectations (types, recency, quantity) by field
- Field-specific quality criteria and evaluation standards
- Common pitfalls and mistakes in different paper types

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

1. DISCIPLINE CONTEXT
   - What is the primary academic discipline for this topic?
   - What related fields inform this area?
   - What are the methodological traditions (quantitative, qualitative, mixed, theoretical)?
   - How fast-moving is this field? Is it theory-heavy or empirical-heavy?
   - Is practitioner relevance expected?

2. STRUCTURE GUIDANCE
   - What sections are APPROPRIATE for this specific ${formatPaperType(paperType)} on this topic?
   - For each section provide: key (camelCase), title, purpose, word range (min/max), citation expectation (none/light/moderate/heavy), and key elements that should appear
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

Return a JSON object with this exact structure:
{
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
        "keyElements": ["string"]
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
  ]
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
          required: ['paceOfChange', 'theoryVsEmpirical', 'practitionerRelevance']
        }
      },
      required: ['primary', 'related', 'methodologicalTraditions', 'fieldCharacteristics']
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
              keyElements: { type: 'array' as const, items: { type: 'string' as const } }
            },
            required: ['key', 'title', 'purpose', 'minWords', 'maxWords', 'citationExpectation', 'keyElements']
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
            required: ['name', 'reason']
          }
        },
        requiredElements: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['appropriateSections', 'inappropriateSections', 'requiredElements']
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
            required: ['type', 'percentage', 'importance']
          }
        },
        recencyProfile: { type: 'string' as const, enum: ['cutting-edge', 'balanced', 'foundational-heavy'] },
        recencyGuidance: { type: 'string' as const },
        seminalWorks: { type: 'array' as const, items: { type: 'string' as const } }
      },
      required: ['minimumUniqueSources', 'idealSourceCount', 'sourceTypeDistribution', 'recencyProfile', 'recencyGuidance']
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
        required: ['criterion', 'description', 'howToAchieve']
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
      required: ['requiredThemes', 'recommendedThemes', 'debates', 'methodologicalConsiderations', 'commonPitfalls']
    },
    genreRules: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          rule: { type: 'string' as const },
          rationale: { type: 'string' as const }
        },
        required: ['rule', 'rationale']
      }
    }
  },
  required: ['discipline', 'structure', 'sourceExpectations', 'qualityCriteria', 'coverage', 'genreRules']
}
