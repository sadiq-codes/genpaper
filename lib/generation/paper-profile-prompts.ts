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
import { getVoiceProfileSummaries } from './voice-profiles'
import { getPaperTypeConfig } from './paper-type-config'

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
  const { topic, paperType, hasOriginalResearch, userContext, length, researchQuestion, keyFindings } = input
  
  // Get voice profile summaries for the prompt
  const voiceProfiles = getVoiceProfileSummaries()
  const voiceProfilesDescription = voiceProfiles.map(p => 
    `- ${p.id}: "${p.name}" - ${p.description}\n  Characteristics: ${p.characteristics.join('; ')}`
  ).join('\n')

  const system = `You are an expert academic advisor. Build a high-quality, topic-specific paper profile for generation.

Profile requirements:
- Specific to the topic, discipline, and paper type (no generic templates).
- Practical and directly usable for downstream generation.
- Academically accurate for structure, evidence norms, and quality standards.
- Include voice profile selection appropriate to level/discipline.

Evidence integrity requirements:
- Do not encourage fabricated citations, statistics, or unsupported claims.
- Align recommendations with evidence-aware writing (quantitative, qualitative, and theoretical norms).

Available voice profiles:
${voiceProfilesDescription}

Output requirement:
- Return valid JSON only, matching the schema exactly.`

  const paperTypeGuidance = await getPaperTypeGuidance(paperType, hasOriginalResearch || false)
  
  const noOriginalResearchWarning = !hasOriginalResearch ? `
NO ORIGINAL RESEARCH PROVIDED:
- Use secondary-analysis mode.
- Do not design primary data collection or original empirical results.
- Do not produce fabricated statistics.
- If paper type is Research Article, use source-analysis methodology and evidence-based synthesis results.
` : ''

  // Build original research context block (paper-agnostic — the LLM decides how to use it)
  const originalResearchContext = hasOriginalResearch && (researchQuestion || keyFindings) ? `
ORIGINAL RESEARCH PROVIDED BY THE USER:
${researchQuestion ? `Research Question: "${researchQuestion}"` : ''}
${keyFindings ? `Key Findings (use these to determine what sections the paper needs and what the paper should cover):
${keyFindings.slice(0, 2000)}${keyFindings.length > 2000 ? '\n[... truncated for profile generation]' : ''}` : ''}

The sections, structure, and content coverage you design MUST be informed by these findings.
Do not invent a generic structure — tailor it to what this specific research covers.
` : ''

  const user = `Create a topic-specific paper profile.

Topic: "${topic}"
Paper Type: ${formatPaperType(paperType)}
${hasOriginalResearch ? 'Original research data is provided.\n' : ''}${noOriginalResearchWarning}${originalResearchContext}${userContext ? `Additional Context: ${userContext}\n` : ''}
${paperTypeGuidance}

Requirements:
1) Title contract (promise, required deliverables, success criteria, failure mode).
2) Discipline context (primary/related fields + field characteristics).
3) Structure:
   - Appropriate sections for this topic and paper type.
   - Inappropriate sections with reasons.
   - Required elements that must appear.
   - Each section needs: key (camelCase), title, purpose, minWords, maxWords, citationExpectation, keyElements, isLiteratureFocused, sectionType.
   - sectionType must be one of: "introduction", "literature", "methodology", "results", "discussion", "conclusion", "non-content".
4) Source expectations:
   - minimumUniqueSources, idealSourceCount, recencyProfile, recencyGuidance.
   - searchYearRange with fromYear/toYear/rationale (current year: ${new Date().getFullYear()}).
5) Quality criteria (4-6 concrete, topic-relevant criteria).
6) Coverage (required themes, recommended themes, debates, methodological considerations, pitfalls).
7) Genre rules (rule + rationale).
8) Voice profile selection with rationale.
9) Paper subtype selection aligned to this paper type:
   - ${getSubtypeExamples(paperType)}
10) Detailed outline:
   - Include exactly one outline section for each structure.appropriateSections entry.
   - Section expectedWords must sum to the total target.
   - Each section has specific keyPoints.
   - ${getOutlineExample(paperType)}

Word count target:
- ${getWordCountTarget(paperType, length)}

Output rules:
- Return JSON only.
- Must match the provided schema exactly.
- No prose outside JSON.
`

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

function formatPaperType(paperType: string): string {
  return getPaperTypeConfig(paperType).label
}

/**
 * Return the word count target line for the current paper type.
 * When a specific word-count target is provided, use it directly.
 * Otherwise fall back to the paper type's default range.
 */
function getWordCountTarget(paperType: string, length?: number): string {
  const config = getPaperTypeConfig(paperType)

  if (length && length > 0) {
    const fmt = (n: number) => n.toLocaleString('en-US')
    return `${config.label}: Target exactly ${fmt(length)} words total. Distribute sections to sum to this target.`
  }

  return `${config.label}: ${config.defaultWordRange}`
}

/**
 * Return the outline example relevant to the current paper type.
 */
function getOutlineExample(paperType: string): string {
  if (paperType === 'mastersThesis' || paperType === 'phdDissertation' || paperType === 'capstoneProject') {
    return `OUTLINE GUIDELINES for ${formatPaperType(paperType)}:
   - EVERY section MUST have at least 2 subsections (academic standard for long-form work)
   - Section count, titles, and organization should be driven by the TOPIC and DISCIPLINE — not a template
   - The number of sections should reflect how THIS topic naturally divides, not a fixed formula
   - Section word counts must sum to the total target
   - Each subsection needs its own sectionKey, title, expectedWords, and keyPoints`
  }

  if (paperType === 'literatureReview') {
    return `OUTLINE GUIDELINES for Literature Review:
   - The number of sections and their titles should be driven by the TOPIC — not a fixed template
   - A 3,000-word review might have 3-4 sections; an 8,000-word review might have 5-7
   - Section titles should reflect the actual themes/debates in the literature, not generic labels
   - Do NOT include Methodology or Results sections unless this is a systematic/meta-analytic review
   - Subsections are optional — only add them if a section exceeds ~1500 words and the content naturally divides
   - Section word counts must sum to the total target`
  }

  // researchArticle or unknown
  return `OUTLINE GUIDELINES for Research Article:
   - The number of sections and their titles should be driven by the TOPIC and DISCIPLINE — not a fixed template
   - Different disciplines use different structures (IMRAD for sciences, thematic for humanities, etc.)
   - Choose the structure that best serves THIS topic's argument or analysis
   - Subsections are optional — only add them if a section exceeds ~1500 words and the content naturally divides
   - Section word counts must sum to the total target`
}

/**
 * Return the subtype examples for the current paper type only.
 */
function getSubtypeExamples(paperType: string): string {
  const subtypes: Record<string, string> = {
    'literatureReview': 'Type A (Standalone), Type B (Background Chapter), Type C (Systematic), Type D (Scoping)',
    'capstoneProject': 'Type A (Empirical), Type B (Secondary Analysis), Type C (Applied/Professional), Type D (Creative)',
    'mastersThesis': 'Type A (Empirical), Type B (Theoretical/Secondary), Type C (Applied/Professional)',
    'phdDissertation': 'Type A (Empirical/Scientific), Type B (Theoretical/Philosophical), Type C (Humanities/Interpretive), Type D (Practice-Based)',
    'researchArticle': 'Mode A (Primary Research), Mode B (Secondary Analysis), Mode C (Mixed)'
  }
  return subtypes[paperType] || 'Select the most appropriate subtype for this paper'
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
      required: ['primary', 'related', 'fieldCharacteristics'],
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
              isLiteratureFocused: { type: 'boolean' as const },
              sectionType: { type: 'string' as const, enum: ['introduction', 'literature', 'methodology', 'results', 'discussion', 'conclusion', 'non-content'] }
            },
            required: ['key', 'title', 'purpose', 'minWords', 'maxWords', 'citationExpectation', 'keyElements', 'isLiteratureFocused', 'sectionType'],
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
        recencyGuidance: { type: 'string' as const }
      },
      required: ['minimumUniqueSources', 'idealSourceCount', 'recencyProfile', 'searchYearRange', 'recencyGuidance'],
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
    },
    paperSubtype: {
      type: 'object' as const,
      properties: {
        type: { type: 'string' as const },
        name: { type: 'string' as const },
        rationale: { type: 'string' as const }
      },
      required: ['type', 'name', 'rationale'],
      additionalProperties: false
    },
    outline: {
      type: 'object' as const,
      properties: {
        sections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              sectionKey: { type: 'string' as const },
              title: { type: 'string' as const },
              expectedWords: { type: 'number' as const },
              keyPoints: { type: 'array' as const, items: { type: 'string' as const } },
              subsections: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  properties: {
                    sectionKey: { type: 'string' as const },
                    title: { type: 'string' as const },
                    expectedWords: { type: 'number' as const },
                    keyPoints: { type: 'array' as const, items: { type: 'string' as const } }
                  },
                  required: ['sectionKey', 'title', 'expectedWords', 'keyPoints'],
                  additionalProperties: false
                }
              }
            },
            required: ['sectionKey', 'title', 'expectedWords', 'keyPoints', 'subsections'],
            additionalProperties: false
          }
        },
        totalEstimatedWords: { type: 'number' as const }
      },
      required: ['sections', 'totalEstimatedWords'],
      additionalProperties: false
    }
  },
  required: ['titleContract', 'discipline', 'structure', 'sourceExpectations', 'qualityCriteria', 'coverage', 'genreRules', 'voice', 'paperSubtype', 'outline'],
  additionalProperties: false
}
