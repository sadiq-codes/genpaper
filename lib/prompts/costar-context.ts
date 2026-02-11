/**
 * CO-STAR Context Builder
 * 
 * Builds context objects for the CO-STAR prompt framework.
 * Used by both editor chat and autocomplete to ensure consistent,
 * well-structured prompts.
 * 
 * CO-STAR: Context, Objective, Style, Tone, Audience, Response
 * 
 * Voice Integration:
 * - Autocomplete always includes project voice (completions are always in-document prose)
 * - Voice provides hedging, confidence, and citation posture guidance
 */

import { 
  type CondensedVoiceContext,
  buildCondensedVoiceContext,
  type VoiceProfileId
} from '@/lib/generation/voice-profiles'

// Re-export shared paper formatting utilities
// These are the canonical implementations - use these for all paper formatting
export { 
  formatPapersForContext,
  formatMentionedPapersForContext,
  formatRAGChunksForContext,
  type PaperForContext,
  type RAGChunk,
} from './format-papers'

// Paper type to style guidance mapping
// Simplified from full paper profiles for chat/complete use
const PAPER_TYPE_STYLES: Record<string, string> = {
  'research-article': 
    'Formal academic prose with empirical focus. Present findings objectively with appropriate statistical hedging. Use passive voice for methods, active voice for interpretations.',
  
  'literature-review': 
    'Synthesizing voice that compares and contrasts sources. Emphasize connections, themes, and gaps across studies. Organize thematically rather than chronologically when possible.',
  
  'masters-thesis': 
    'Thorough academic style demonstrating mastery of the field. Balance depth with accessibility. Show clear progression of argument and methodology.',
  
  'phd-dissertation': 
    'Authoritative scholarly voice with original contribution emphasis. Rigorous argumentation with comprehensive literature engagement. Appropriate theoretical framing.',
  
  'capstone-project': 
    'Professional academic style demonstrating applied knowledge. Balance theoretical foundation with practical application. Clear methodology and actionable conclusions.',
  
  'essay': 
    'Argumentative academic prose with clear thesis. Structured paragraphs with topic sentences. Evidence-based reasoning with proper attribution.',
  
  'report': 
    'Clear, structured prose focused on conveying information. Use headings and sections effectively. Balance detail with readability.',
}

// Section-specific writing guidance
const SECTION_GUIDANCE: Record<string, { purpose: string; opening: string }> = {
  'introduction': {
    purpose: 'Focus on establishing context, defining key terms, and stating the research problem or motivation. Build from broad context to specific research questions.',
    opening: 'Start with a compelling hook about the topic\'s significance or a key problem. Jump directly into substance - do NOT write "This paper examines..." or meta-commentary. Example pattern: "[Topic] represents a significant challenge/opportunity because [reason with evidence]."'
  },
  
  'background': {
    purpose: 'Provide foundational knowledge and context. Define key concepts and establish the theoretical framework for the research.',
    opening: 'Begin by establishing the foundational concept most central to understanding the research. Define key terms immediately and connect them to the broader field.'
  },
  
  'literature review': {
    purpose: 'Synthesize prior research, identify themes and gaps. Position the current work within the scholarly conversation. Critique and compare sources.',
    opening: 'Frame the scholarly conversation by identifying the major research themes or debates. Do NOT list studies chronologically. Example: "Research on [topic] has developed along several interconnected themes, with scholars particularly focusing on [theme 1] and [theme 2]."'
  },
  
  'methods': {
    purpose: 'Focus on describing procedures, materials, participants, or analytical approaches. Be precise and replicable. Justify methodological choices.',
    opening: 'State the overall research design or approach first. Be specific to this study. Example: "This study employed a [specific design] to examine [specific focus], using [data source/participants] from [context]."'
  },
  
  'methodology': {
    purpose: 'Explain and justify the research approach. Connect methods to research questions. Address validity and reliability.',
    opening: 'Begin with the epistemological or theoretical foundation for the methodological choices, then transition to specific methods.'
  },
  
  'results': {
    purpose: 'Focus on reporting findings and observations without interpretation. Present data clearly with appropriate visualizations. Be objective.',
    opening: 'Lead with the most important or central finding. Be specific and quantitative where possible. Example: "Analysis revealed that [specific finding with data], representing [context for significance]."'
  },
  
  'discussion': {
    purpose: 'Focus on interpreting results, comparing with prior work, and explaining implications. Address limitations. Connect findings to theory.',
    opening: 'Begin by restating the key finding and immediately connecting it to its broader meaning or prior research. Example: "The finding that [key result] suggests [interpretation], aligning with/challenging previous work by [citation]."'
  },
  
  'conclusion': {
    purpose: 'Focus on summarizing key findings and their broader significance. Suggest future directions. End with strong takeaway.',
    opening: 'Open with the central contribution or takeaway of the research. Be direct and substantive. Example: "This [study/review] demonstrates that [key contribution], with implications for [domain/practice]."'
  },
  
  'abstract': {
    purpose: 'Concise summary of the entire work. Include purpose, methods, key findings, and significance. Stand-alone and self-contained.',
    opening: 'Start with the research problem or purpose in one sentence. Every word must earn its place.'
  },

  'theoretical framework': {
    purpose: 'Present the theoretical lens through which the research is conducted. Connect theory to research questions and methodology.',
    opening: 'Introduce the primary theory or framework and its relevance to the research problem. Example: "[Theory name] provides a useful lens for understanding [topic] because [reason]."'
  },

  'findings': {
    purpose: 'Present the outcomes of analysis, organized thematically or by research question. May include interpretation for qualitative work.',
    opening: 'Introduce the organizational structure of findings, then present the first major theme or finding. Example: "Three major themes emerged from the analysis: [theme 1], [theme 2], and [theme 3]. [First theme] was evident in..."'
  },

  'implications': {
    purpose: 'Discuss the practical and theoretical implications of findings. Connect research to practice, policy, or future research.',
    opening: 'State the most significant implication directly. Example: "These findings have important implications for [domain], suggesting that [specific implication]."'
  },

  'limitations': {
    purpose: 'Acknowledge constraints and boundaries of the research. Be honest but not self-deprecating.',
    opening: 'Acknowledge limitations directly but constructively. Example: "Several limitations should be considered when interpreting these findings. First, [limitation] may have affected [aspect]."'
  },
}

/**
 * Base CO-STAR context shared across chat and autocomplete
 */
export interface COStarBaseContext {
  // Core context
  topic: string
  paperType: string
  currentSection: string
  
  // Style guidance from paper type
  styleGuidance: string
  
  // Inferred context
  expertiseLevel: 'standard' | 'advanced'
  writingStage: 'drafting' | 'revising'
}

/**
 * Extended context for editor chat
 */
export interface ChatCOStarContext extends COStarBaseContext {
  // Document state
  documentContent: string
  contentTruncated: boolean
  documentStructure?: string
  selectedText?: string
  
  // Sources
  papersContext: string
  ragContext: string
  
  // Mentioned papers (explicitly referenced by user with @)
  mentionedPapersContext?: string
  
  // Tools (optional - can use default list)
  tools?: Array<{ name: string; description: string }>
  
  // Additional audience notes
  audienceNotes?: string
}

/**
 * Extended context for autocomplete
 * 
 * Note: suggestionType/suggestionObjective removed - the LLM now analyzes
 * writing intent semantically rather than using pre-classified suggestion types.
 */
export interface CompleteCOStarContext extends COStarBaseContext {
  // Cursor context
  precedingText: string
  followingText?: string
  
  // Section guidance
  sectionGuidance: string
  
  // Document outline
  outlineContext: string
  
  // RAG content
  chunksText: string
  claimsText: string
  papersContext: string
  
  // Voice context (optional)
  // Project's authorial voice for consistent completions
  voice?: CondensedVoiceContext
  
  // No papers available flag
  // When true, the prompt will instruct the LLM to NOT include any citations
  // This prevents hallucinated paper IDs when no sources are available
  noPapersAvailable?: boolean
}

/**
 * Get style guidance for a paper type
 */
export function getStyleGuidance(paperType: string): string {
  // Normalize paper type key
  const normalizedType = paperType
    .toLowerCase()
    .replace(/[-_\s]+/g, '-')
  
  return PAPER_TYPE_STYLES[normalizedType] || PAPER_TYPE_STYLES['research-article']
}

/**
 * Get section-specific writing guidance
 * @param section - Section name
 * @param isSectionOpening - Whether this is the start of a new section (empty paragraph after heading)
 */
export function getSectionGuidance(section: string, isSectionOpening: boolean = false): string {
  const sectionLower = section.toLowerCase()
  
  // Find matching guidance
  let guidance = SECTION_GUIDANCE[sectionLower]
  
  // Check for partial matches if no exact match
  if (!guidance) {
    for (const [key, value] of Object.entries(SECTION_GUIDANCE)) {
      if (sectionLower.includes(key) || key.includes(sectionLower)) {
        guidance = value
        break
      }
    }
  }
  
  // Return appropriate guidance based on context
  if (guidance) {
    if (isSectionOpening) {
      // When starting a new section, include both purpose and opening guidance
      return `${guidance.purpose}\n\n**Opening this section:** ${guidance.opening}`
    }
    // When continuing within a section, just the purpose
    return guidance.purpose
  }
  
  return 'Continue in an appropriate academic tone, maintaining consistency with the document.'
}

/**
 * Infer expertise level from document content
 * Uses simple heuristics based on technical terminology and complexity
 */
export function inferExpertiseLevel(content: string): 'standard' | 'advanced' {
  if (!content || content.length < 100) {
    return 'standard'
  }
  
  const technicalIndicators = [
    /\bp\s*[<>=]\s*0\.\d+/i,           // p-values
    /confidence interval/i,
    /regression analysis/i,
    /meta-analysis/i,
    /et al\./i,
    /statistically significant/i,
    /effect size/i,
    /standard deviation/i,
    /null hypothesis/i,
    /methodology/i,
    /operationalize/i,
    /epistemolog/i,
    /ontolog/i,
    /heterogen/i,
  ]
  
  const matches = technicalIndicators.filter(r => r.test(content)).length
  return matches >= 3 ? 'advanced' : 'standard'
}

/**
 * Infer writing stage from document content
 */
export function inferWritingStage(content: string): 'drafting' | 'revising' {
  if (!content) {
    return 'drafting'
  }
  
  // If document has substantial content, likely revising
  const wordCount = content.split(/\s+/).length
  return wordCount > 500 ? 'revising' : 'drafting'
}

/**
 * Build base CO-STAR context
 */
export function buildBaseContext(
  topic: string,
  paperType: string,
  currentSection: string,
  documentContent: string
): COStarBaseContext {
  return {
    topic,
    paperType: paperType || 'research-article',
    currentSection: currentSection || 'Document',
    styleGuidance: getStyleGuidance(paperType),
    expertiseLevel: inferExpertiseLevel(documentContent),
    writingStage: inferWritingStage(documentContent),
  }
}

/**
 * Build full context for editor chat
 */
export function buildChatContext(params: {
  topic: string
  paperType: string
  currentSection?: string
  documentContent: string
  documentStructure?: string
  selectedText?: string
  papersContext: string
  ragContext: string
  mentionedPapersContext?: string
  maxContentLength?: number
}): ChatCOStarContext {
  const {
    topic,
    paperType,
    currentSection = '',
    documentContent,
    documentStructure,
    selectedText,
    papersContext,
    ragContext,
    mentionedPapersContext,
    maxContentLength = 6000, // ~1.5-2 pages of context
  } = params
  
  const base = buildBaseContext(topic, paperType, currentSection, documentContent)
  
  // Truncate content if needed
  const truncated = documentContent.length > maxContentLength
  const content = truncated 
    ? documentContent.slice(0, maxContentLength) 
    : documentContent
  
  return {
    ...base,
    documentContent: content,
    contentTruncated: truncated,
    documentStructure,
    selectedText,
    papersContext,
    ragContext,
    mentionedPapersContext,
  }
}

/**
 * Build full context for autocomplete
 * 
 * Note: suggestionType/suggestionObjective removed - the unified prompt
 * instructs the LLM to analyze writing intent semantically.
 */
export function buildCompleteContext(params: {
  topic: string
  paperType: string
  currentSection: string
  precedingText: string
  followingText?: string
  outlineContext: string
  chunksText: string
  claimsText: string
  papersContext: string
  documentContent?: string
  // Voice configuration (optional)
  // Pass the project's voiceProfileId to include voice guidance for completions
  voiceProfileId?: VoiceProfileId | null
  // Section opening flag - when true, provide opening-specific guidance
  isSectionOpening?: boolean
  // No papers available flag - when true, suppress citation instructions
  // to prevent hallucinated paper IDs
  noPapersAvailable?: boolean
}): CompleteCOStarContext {
  const {
    topic,
    paperType,
    currentSection,
    precedingText,
    followingText,
    outlineContext,
    chunksText,
    claimsText,
    papersContext,
    documentContent = '',
    voiceProfileId,
    isSectionOpening = false,
    noPapersAvailable = false,
  } = params
  
  const base = buildBaseContext(topic, paperType, currentSection, documentContent)
  
  // Build voice context - autocomplete always includes voice (it's always in-document prose)
  const voice = voiceProfileId ? buildCondensedVoiceContext(voiceProfileId) : undefined
  
  return {
    ...base,
    precedingText: precedingText.slice(-800), // Enough context to detect repetition
    followingText,
    sectionGuidance: getSectionGuidance(currentSection, isSectionOpening),
    outlineContext,
    chunksText,
    claimsText,
    papersContext,
    voice,
    noPapersAvailable,
  }
}

// Note: formatPapersForContext and formatMentionedPapersForContext are now
// exported from ./format-papers.ts via the re-export at the top of this file.
