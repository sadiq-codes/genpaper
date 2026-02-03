/**
 * Qualitative Extension Extractor
 * 
 * Extracts structured data specific to qualitative research papers:
 * - Methodology (grounded theory, phenomenology, etc.)
 * - Participants and data sources
 * - Themes identified
 * - Supporting quotes
 * - Trustworthiness strategies
 * 
 * @module lib/extraction/extensions/qualitative
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { v4 as uuidv4 } from 'uuid'
import type {
  QualitativeExtension,
  QualitativeTheme,
  QualitativeMethodology,
  QualitativeDataSource,
  ParticipantQuote
} from '../types'

// =============================================================================
// Zod Schemas for Qualitative Extraction
// =============================================================================

const ParticipantQuoteSchema = z.object({
  text: z.string().describe('The quote text'),
  participantId: z.string().optional().describe('Anonymized participant identifier'),
  context: z.string().optional().describe('Context in which the quote was given')
})

const ThemeSchema = z.object({
  name: z.string().describe('Theme name'),
  description: z.string().describe('Description of what this theme captures'),
  subThemes: z.array(z.object({
    name: z.string(),
    description: z.string()
  })).optional().describe('Sub-themes under this main theme'),
  supportingQuotes: z.array(ParticipantQuoteSchema).describe('Participant quotes supporting this theme'),
  prevalence: z.enum(['universal', 'common', 'variant', 'rare']).optional().describe('How common across participants'),
  relatedThemes: z.array(z.string()).optional().describe('Names of related themes')
})

const QualitativeExtractionSchema = z.object({
  // Methodology
  methodology: z.enum([
    'grounded_theory', 'phenomenology', 'ethnography', 'case_study',
    'narrative_inquiry', 'content_analysis', 'thematic_analysis',
    'discourse_analysis', 'action_research', 'mixed_qualitative', 'other'
  ]),
  methodologyJustification: z.string().optional().describe('Why this methodology was chosen'),
  philosophicalStance: z.string().optional().describe('Epistemological/ontological stance'),
  
  // Participants/Data
  participantCount: z.number().optional().describe('Number of participants'),
  participantDescription: z.string().optional().describe('Description of participants'),
  selectionCriteria: z.string().optional().describe('Criteria for selecting participants'),
  dataSources: z.array(z.enum([
    'interviews', 'focus_groups', 'observation', 'documents',
    'artifacts', 'field_notes', 'diaries', 'visual_data', 'social_media', 'other'
  ])),
  dataCollectionPeriod: z.string().optional(),
  
  // Analysis
  analysisApproach: z.string().describe('How data was analyzed'),
  codingMethod: z.string().optional().describe('Coding approach used'),
  softwareUsed: z.string().optional(),
  
  // Findings
  themes: z.array(ThemeSchema).describe('Themes identified in the research'),
  theoreticalModel: z.string().optional().describe('If a model/framework was developed'),
  
  // Quality/Rigor
  trustworthinessStrategies: z.array(z.string()).optional().describe('Strategies to ensure rigor'),
  reflexivityStatement: z.boolean().optional(),
  auditTrail: z.boolean().optional(),
  
  // Overall
  extractionConfidence: z.number().min(0).max(1)
})

// =============================================================================
// Qualitative Extraction Function
// =============================================================================

export interface QualitativeExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
}

export interface QualitativeExtractionOptions {
  maxFullTextTokens?: number
  timeoutMs?: number
}

/**
 * Extract qualitative-specific data from a research paper
 */
export async function extractQualitative(
  input: QualitativeExtractionInput,
  options: QualitativeExtractionOptions = {}
): Promise<QualitativeExtension> {
  const startTime = Date.now()
  const { maxFullTextTokens = 12000 } = options
  
  // Prepare text - for qualitative, we want findings sections with quotes
  const textForExtraction = prepareQualitativeText(
    input.title,
    input.abstract,
    input.fullText,
    maxFullTextTokens
  )
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: QualitativeExtractionSchema,
      system: QUALITATIVE_SYSTEM_PROMPT,
      prompt: buildQualitativePrompt(input, textForExtraction),
      temperature: 0.1,
    })
    
    // Transform themes with IDs
    const themes: QualitativeTheme[] = object.themes.map(t => ({
      id: uuidv4(),
      name: t.name,
      description: t.description,
      subThemes: t.subThemes?.map(st => ({
        id: uuidv4(),
        name: st.name,
        description: st.description,
        supportingQuotes: [],
        confidence: 0.8
      })),
      supportingQuotes: t.supportingQuotes.map(q => ({
        text: q.text,
        participantId: q.participantId,
        context: q.context
      })),
      prevalence: t.prevalence,
      relatedThemes: t.relatedThemes,
      confidence: 0.8 // Default confidence for themes
    }))
    
    const extractionTime = Date.now() - startTime
    console.log(`📝 Qualitative extraction completed in ${extractionTime}ms`)
    console.log(`   🎯 Found ${themes.length} themes`)
    console.log(`   👥 Methodology: ${object.methodology}, participants: ${object.participantCount || 'not specified'}`)
    
    return {
      paperId: input.paperId,
      methodology: object.methodology as QualitativeMethodology,
      methodologyJustification: object.methodologyJustification,
      philosophicalStance: object.philosophicalStance,
      participantCount: object.participantCount,
      participantDescription: object.participantDescription,
      selectionCriteria: object.selectionCriteria,
      dataSources: object.dataSources as QualitativeDataSource[],
      dataCollectionPeriod: object.dataCollectionPeriod,
      analysisApproach: object.analysisApproach,
      codingMethod: object.codingMethod,
      softwareUsed: object.softwareUsed,
      themes,
      theoreticalModel: object.theoreticalModel,
      trustworthinessStrategies: object.trustworthinessStrategies,
      reflexivityStatement: object.reflexivityStatement,
      auditTrail: object.auditTrail,
      extractionConfidence: object.extractionConfidence
    }
  } catch (error) {
    console.error('Qualitative extraction failed:', error)
    throw error
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function prepareQualitativeText(
  title: string,
  abstract?: string,
  fullText?: string,
  maxTokens: number = 12000
): string {
  const parts: string[] = []
  
  parts.push(`TITLE: ${title}`)
  
  if (abstract) {
    parts.push(`\nABSTRACT:\n${abstract}`)
  }
  
  if (fullText) {
    // For qualitative papers, prioritize Findings and Methods sections
    const methodsSection = extractSection(fullText, ['method', 'methodology', 'research design', 'data collection', 'procedure'])
    const findingsSection = extractSection(fullText, ['findings', 'results', 'themes', 'analysis'])
    const discussionSection = extractSection(fullText, ['discussion'])
    
    const abstractTokens = abstract ? Math.ceil(abstract.length / 4) : 0
    const remainingTokens = maxTokens - abstractTokens - 50
    
    // For qualitative, findings are most important (they contain themes and quotes)
    const findingsChars = Math.floor((remainingTokens * 4) * 0.5)
    const methodsChars = Math.floor((remainingTokens * 4) * 0.3)
    const discussionChars = Math.floor((remainingTokens * 4) * 0.2)
    
    if (findingsSection) {
      parts.push(`\n[FINDINGS SECTION]\n${findingsSection.slice(0, findingsChars)}${findingsSection.length > findingsChars ? '...' : ''}`)
    }
    
    if (methodsSection) {
      parts.push(`\n[METHODS SECTION]\n${methodsSection.slice(0, methodsChars)}${methodsSection.length > methodsChars ? '...' : ''}`)
    }
    
    if (discussionSection) {
      parts.push(`\n[DISCUSSION SECTION]\n${discussionSection.slice(0, discussionChars)}${discussionSection.length > discussionChars ? '...' : ''}`)
    }
    
    // If no sections found, take raw text
    if (!methodsSection && !findingsSection && !discussionSection) {
      const maxChars = remainingTokens * 4
      parts.push(`\n[FULL TEXT EXCERPT]\n${fullText.slice(0, maxChars)}${fullText.length > maxChars ? '...' : ''}`)
    }
  }
  
  return parts.join('\n')
}

function extractSection(fullText: string, sectionNames: string[]): string | null {
  for (const name of sectionNames) {
    const patterns = [
      new RegExp(`(?:^|\\n)(?:\\d+\\.?\\s*)?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n(?:\\d+\\.?\\s*)?(?:${getNextSections(name).join('|')})|\\n\\n\\n|$)`, 'i'),
      new RegExp(`(?:^|\\n)#+ ?${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n#+|$)`, 'i')
    ]
    
    for (const pattern of patterns) {
      const match = fullText.match(pattern)
      if (match && match[1] && match[1].trim().length > 100) {
        return match[1].trim()
      }
    }
  }
  return null
}

function getNextSections(currentSection: string): string[] {
  const order = [
    'abstract', 'introduction', 'literature', 'background', 'theory',
    'method', 'methodology', 'procedure', 'sample', 'participant', 'data',
    'finding', 'result', 'theme', 'analysis', 'discussion', 'conclusion',
    'implication', 'limitation', 'reference', 'appendix'
  ]
  
  const current = currentSection.toLowerCase()
  const idx = order.findIndex(s => s.includes(current) || current.includes(s))
  
  if (idx === -1) return order
  return order.slice(idx + 1)
}

function buildQualitativePrompt(
  input: QualitativeExtractionInput,
  textForExtraction: string
): string {
  return `Extract qualitative research details from this paper.

${textForExtraction}

---

EXTRACTION INSTRUCTIONS:
1. Identify the qualitative methodology used (grounded theory, phenomenology, etc.)
2. Extract participant/data source information
3. Identify ALL themes presented in the findings
4. For each theme:
   - Provide a clear name and description
   - Include direct quotes from participants that support the theme
   - Note sub-themes if present
   - Indicate how prevalent the theme was across participants
5. Note any theoretical model or framework developed
6. Identify trustworthiness strategies mentioned

IMPORTANT FOR THEMES:
- Extract the ACTUAL theme names used by the authors
- Include VERBATIM participant quotes (in quotation marks in the original)
- Capture the hierarchical structure if themes have sub-themes
- Note relationships between themes if discussed`
}

const QUALITATIVE_SYSTEM_PROMPT = `You are an expert qualitative research analyst specializing in extracting findings from qualitative research papers.

Your task is to identify and extract:
1. METHODOLOGY: What qualitative approach was used? (grounded theory, phenomenology, ethnography, etc.)
2. PARTICIPANTS/DATA: Who participated? What data was collected?
3. ANALYSIS: How was data analyzed?
4. THEMES: What themes/findings emerged?
5. RIGOR: What strategies ensured trustworthiness?

CRITICAL RULES FOR THEME EXTRACTION:
1. Use the EXACT theme names from the paper
2. Extract VERBATIM participant quotes (these are typically in quotation marks or italics)
3. Preserve the hierarchy of themes and sub-themes
4. Note theme prevalence indicators (e.g., "all participants", "most", "some")
5. Capture relationships between themes
6. Include participant identifiers if provided (e.g., "P1", "Participant A")

QUALITATIVE METHODOLOGIES TO RECOGNIZE:
- Grounded Theory: theory development from data, constant comparison, theoretical sampling
- Phenomenology: lived experience, essence, bracketing, phenomenological reduction
- Ethnography: cultural analysis, field work, participant observation
- Case Study: bounded system, multiple data sources, in-depth analysis
- Narrative Inquiry: stories, temporal sequence, meaning-making
- Thematic Analysis: themes across data, coding, pattern identification
- Content Analysis: systematic text analysis, categories
- Discourse Analysis: language use, power, social construction

INDICATORS OF QUALITATIVE RIGOR:
- Member checking / participant validation
- Triangulation (multiple sources, methods, investigators)
- Peer debriefing
- Audit trail
- Reflexivity / positionality statement
- Thick description
- Negative case analysis
- Saturation

When extracting themes, prioritize richness and accuracy over comprehensiveness.`
