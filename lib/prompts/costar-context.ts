/**
 * CO-STAR Context Builder
 * 
 * Builds context objects for the CO-STAR prompt framework.
 * Used by both editor chat and autocomplete to ensure consistent,
 * well-structured prompts.
 * 
 * CO-STAR: Context, Objective, Style, Tone, Audience, Response
 */

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
const SECTION_GUIDANCE: Record<string, string> = {
  'introduction': 
    'Focus on establishing context, defining key terms, and stating the research problem or motivation. Build from broad context to specific research questions.',
  
  'background': 
    'Provide foundational knowledge and context. Define key concepts and establish the theoretical framework for the research.',
  
  'literature review': 
    'Synthesize prior research, identify themes and gaps. Position the current work within the scholarly conversation. Critique and compare sources.',
  
  'methods': 
    'Focus on describing procedures, materials, participants, or analytical approaches. Be precise and replicable. Justify methodological choices.',
  
  'methodology': 
    'Explain and justify the research approach. Connect methods to research questions. Address validity and reliability.',
  
  'results': 
    'Focus on reporting findings and observations without interpretation. Present data clearly with appropriate visualizations. Be objective.',
  
  'discussion': 
    'Focus on interpreting results, comparing with prior work, and explaining implications. Address limitations. Connect findings to theory.',
  
  'conclusion': 
    'Focus on summarizing key findings and their broader significance. Suggest future directions. End with strong takeaway.',
  
  'abstract': 
    'Concise summary of the entire work. Include purpose, methods, key findings, and significance. Stand-alone and self-contained.',
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
  
  // Tools (optional - can use default list)
  tools?: Array<{ name: string; description: string }>
  
  // Additional audience notes
  audienceNotes?: string
}

/**
 * Extended context for autocomplete
 */
export interface CompleteCOStarContext extends COStarBaseContext {
  // Cursor context
  suggestionType: string
  suggestionObjective: string
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
 */
export function getSectionGuidance(section: string): string {
  const sectionLower = section.toLowerCase()
  
  // Check for exact matches first
  if (SECTION_GUIDANCE[sectionLower]) {
    return SECTION_GUIDANCE[sectionLower]
  }
  
  // Check for partial matches
  for (const [key, guidance] of Object.entries(SECTION_GUIDANCE)) {
    if (sectionLower.includes(key) || key.includes(sectionLower)) {
      return guidance
    }
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
    maxContentLength = 3000,
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
  }
}

/**
 * Build full context for autocomplete
 */
export function buildCompleteContext(params: {
  topic: string
  paperType: string
  currentSection: string
  suggestionType: string
  suggestionObjective: string
  precedingText: string
  followingText?: string
  outlineContext: string
  chunksText: string
  claimsText: string
  papersContext: string
  documentContent?: string
}): CompleteCOStarContext {
  const {
    topic,
    paperType,
    currentSection,
    suggestionType,
    suggestionObjective,
    precedingText,
    followingText,
    outlineContext,
    chunksText,
    claimsText,
    papersContext,
    documentContent = '',
  } = params
  
  const base = buildBaseContext(topic, paperType, currentSection, documentContent)
  
  return {
    ...base,
    suggestionType,
    suggestionObjective,
    precedingText: precedingText.slice(-300), // Limit preceding text
    followingText,
    sectionGuidance: getSectionGuidance(currentSection),
    outlineContext,
    chunksText,
    claimsText,
    papersContext,
  }
}

/**
 * Format papers array for AI prompt context
 */
export function formatPapersForContext(
  papers: Array<{ id: string; title: string; authors?: string[]; year?: number }>
): string {
  if (!papers || papers.length === 0) {
    return 'No papers available.'
  }
  
  return papers.slice(0, 10).map(p => {
    const authorStr = p.authors?.slice(0, 2).join(', ') || 'Unknown'
    const authorSuffix = (p.authors?.length || 0) > 2 ? ' et al.' : ''
    return `- [${p.id}] "${p.title}" by ${authorStr}${authorSuffix}${p.year ? ` (${p.year})` : ''}`
  }).join('\n')
}
