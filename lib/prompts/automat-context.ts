/**
 * AUTOMAT Context Builder
 * 
 * Builds context objects for the AUTOMAT prompt framework.
 * Optimized for action-oriented chat/editor interactions.
 * 
 * AUTOMAT: Action, Usage, Target, Output, Method, Appearance, Tone
 * 
 * Why AUTOMAT for Chat (vs CO-STAR for Generation):
 * - Action-first: Chat is imperative ("rewrite this", "add citations")
 * - Method is critical: Explicit HOW instructions for tool use
 * - Usage provides context: How output will be used (inserted, replaced)
 * - Less Style/Audience variation: Consistent assistant voice
 */

/**
 * Tool definition for the prompt
 */
export interface ToolDefinition {
  name: string
  description: string
  preferredFor?: string  // When to use this tool
}

/**
 * AUTOMAT context for editor chat
 */
export interface ChatAUTOMATContext {
  // === ACTION ===
  // What the AI should do - inferred from user message or explicit
  actionType: 'write' | 'edit' | 'explain' | 'cite' | 'suggest' | 'analyze' | 'general'
  actionDescription: string  // Human-readable action description
  
  // === USAGE ===
  // How the output will be used in the editor
  usageContext: {
    projectTopic: string
    paperType: string
    currentSection?: string
    writingStage: 'drafting' | 'revising'
    hasSelection: boolean
    selectionContext?: string  // The selected text
  }
  
  // === TARGET ===
  // What is being acted upon
  target: {
    documentContent: string
    contentTruncated: boolean
    documentStructure?: string  // Block IDs for precise targeting
    selectedText?: string
  }
  
  // === OUTPUT ===
  // Desired format and structure of the response
  output: {
    expectsToolCall: boolean
    preferredTools: string[]  // Tools most likely needed for this action
    citationFormat: 'numbered'  // Always numbered for chat
  }
  
  // === METHOD ===
  // How to accomplish the task
  method: {
    tools: ToolDefinition[]
    ragContext: string  // Retrieved evidence chunks
    papersContext: string  // Available papers for citation
    mentionedPapersContext?: string  // @mentioned papers
    targetingStrategy: 'blockId' | 'textSearch' | 'selection'
  }
  
  // === APPEARANCE ===
  // Visual/structural formatting requirements
  appearance: {
    useMarkdown: boolean
    codeBlockLanguage?: string
    maxResponseLength?: 'brief' | 'moderate' | 'detailed'
  }
  
  // === TONE ===
  // Communication style
  tone: {
    formality: 'academic' | 'professional' | 'casual'
    confidence: 'assertive' | 'hedged' | 'exploratory'
    verbosity: 'concise' | 'explanatory' | 'detailed'
  }
}

/**
 * Infer action type from user message
 */
export function inferActionType(message: string): ChatAUTOMATContext['actionType'] {
  const lowerMessage = message.toLowerCase()
  
  // Edit actions
  if (/\b(rewrite|revise|improve|fix|edit|change|modify|update)\b/.test(lowerMessage)) {
    return 'edit'
  }
  
  // Write/add actions
  if (/\b(write|add|insert|create|draft|generate|expand)\b/.test(lowerMessage)) {
    return 'write'
  }
  
  // Citation actions
  if (/\b(cite|citation|reference|source|evidence)\b/.test(lowerMessage)) {
    return 'cite'
  }
  
  // Explain actions
  if (/\b(explain|clarify|what|why|how|describe|tell me)\b/.test(lowerMessage)) {
    return 'explain'
  }
  
  // Suggest actions
  if (/\b(suggest|recommend|should|could|alternative|option)\b/.test(lowerMessage)) {
    return 'suggest'
  }
  
  // Analyze actions
  if (/\b(analyze|review|assess|evaluate|check|compare)\b/.test(lowerMessage)) {
    return 'analyze'
  }
  
  return 'general'
}

/**
 * Get action description based on type
 */
export function getActionDescription(actionType: ChatAUTOMATContext['actionType']): string {
  const descriptions: Record<ChatAUTOMATContext['actionType'], string> = {
    write: 'Generate new content to add to the document',
    edit: 'Modify existing content in the document',
    explain: 'Provide explanations or clarifications',
    cite: 'Add or improve citations and references',
    suggest: 'Offer recommendations and alternatives',
    analyze: 'Review and assess content quality',
    general: 'Assist with the document as requested',
  }
  return descriptions[actionType]
}

/**
 * Get preferred tools based on action type
 */
export function getPreferredTools(
  actionType: ChatAUTOMATContext['actionType'],
  hasSelection: boolean
): string[] {
  switch (actionType) {
    case 'write':
      return ['insertContent', 'replaceBlock']
    case 'edit':
      return hasSelection 
        ? ['replaceBlock', 'replaceInSection'] 
        : ['replaceBlock', 'rewriteSection']
    case 'cite':
      return ['addCitation', 'insertContent', 'replaceBlock']
    case 'suggest':
      return ['addComment', 'highlightText']
    case 'analyze':
      return ['addComment', 'highlightText']
    case 'explain':
      return []  // Explanations don't typically need tools
    default:
      return ['insertContent', 'replaceBlock']
  }
}

/**
 * Infer writing stage from document content
 */
export function inferWritingStage(content: string): 'drafting' | 'revising' {
  if (!content) return 'drafting'
  const wordCount = content.split(/\s+/).length
  return wordCount > 500 ? 'revising' : 'drafting'
}

/**
 * Get targeting strategy based on available context
 */
export function getTargetingStrategy(
  hasBlockIds: boolean,
  hasSelection: boolean
): 'blockId' | 'textSearch' | 'selection' {
  if (hasSelection) return 'selection'
  if (hasBlockIds) return 'blockId'
  return 'textSearch'
}

/**
 * Default tool definitions for chat
 */
export const DEFAULT_CHAT_TOOLS: ToolDefinition[] = [
  {
    name: 'insertContent',
    description: 'Add new content at a specific location',
    preferredFor: 'Adding new paragraphs, sections, or content blocks',
  },
  {
    name: 'replaceBlock',
    description: 'Replace a block\'s content entirely (use blockId)',
    preferredFor: 'Rewriting paragraphs, fixing content, making targeted edits',
  },
  {
    name: 'replaceInSection',
    description: 'Replace content using text search within a section',
    preferredFor: 'When blockId is not available, use text matching',
  },
  {
    name: 'rewriteSection',
    description: 'Rewrite an entire section (requires user confirmation)',
    preferredFor: 'Major section overhauls, restructuring',
  },
  {
    name: 'deleteContent',
    description: 'Delete content (requires user confirmation)',
    preferredFor: 'Removing paragraphs or sections',
  },
  {
    name: 'addCitation',
    description: 'Insert a citation at a specific location',
    preferredFor: 'Adding references to claims',
  },
  {
    name: 'highlightText',
    description: 'Highlight text for user review',
    preferredFor: 'Marking areas that need attention',
  },
  {
    name: 'addComment',
    description: 'Add a comment or note',
    preferredFor: 'Suggestions, questions, feedback',
  },
]

/**
 * Build AUTOMAT context for editor chat
 */
export function buildChatAUTOMATContext(params: {
  // User input
  userMessage: string
  
  // Document state
  projectTopic: string
  paperType: string
  currentSection?: string
  documentContent: string
  documentStructure?: string
  selectedText?: string
  
  // Sources
  papersContext: string
  ragContext: string
  mentionedPapersContext?: string
  
  // Options
  maxContentLength?: number
  tools?: ToolDefinition[]
}): ChatAUTOMATContext {
  const {
    userMessage,
    projectTopic,
    paperType,
    currentSection,
    documentContent,
    documentStructure,
    selectedText,
    papersContext,
    ragContext,
    mentionedPapersContext,
    maxContentLength = 3000,
    tools = DEFAULT_CHAT_TOOLS,
  } = params
  
  // Infer action from message
  const actionType = inferActionType(userMessage)
  const hasSelection = !!selectedText && selectedText.trim().length > 0
  const hasBlockIds = !!documentStructure && documentStructure.length > 0
  
  // Truncate content if needed
  const truncated = documentContent.length > maxContentLength
  const content = truncated 
    ? documentContent.slice(0, maxContentLength) 
    : documentContent
  
  return {
    // ACTION
    actionType,
    actionDescription: getActionDescription(actionType),
    
    // USAGE
    usageContext: {
      projectTopic,
      paperType: paperType || 'research-article',
      currentSection,
      writingStage: inferWritingStage(documentContent),
      hasSelection,
      selectionContext: hasSelection 
        ? `User selected: "${selectedText?.slice(0, 100)}${(selectedText?.length || 0) > 100 ? '...' : ''}"` 
        : undefined,
    },
    
    // TARGET
    target: {
      documentContent: content,
      contentTruncated: truncated,
      documentStructure,
      selectedText,
    },
    
    // OUTPUT
    output: {
      expectsToolCall: actionType !== 'explain',
      preferredTools: getPreferredTools(actionType, hasSelection),
      citationFormat: 'numbered',
    },
    
    // METHOD
    method: {
      tools,
      ragContext,
      papersContext,
      mentionedPapersContext,
      targetingStrategy: getTargetingStrategy(hasBlockIds, hasSelection),
    },
    
    // APPEARANCE
    appearance: {
      useMarkdown: true,
      maxResponseLength: actionType === 'explain' ? 'detailed' : 'moderate',
    },
    
    // TONE
    tone: {
      formality: 'academic',
      confidence: actionType === 'explain' ? 'assertive' : 'hedged',
      verbosity: actionType === 'explain' ? 'explanatory' : 'concise',
    },
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

/**
 * Format mentioned papers for AI prompt context
 */
export function formatMentionedPapersForContext(
  papers: Array<{ id: string; title: string; authors?: string[]; year?: number; abstract?: string }>,
  ragChunks?: Array<{ paper_id: string; content: string }>
): string {
  if (!papers || papers.length === 0) {
    return ''
  }
  
  const formatted = papers.map(p => {
    const authorStr = p.authors?.slice(0, 3).join(', ') || 'Unknown'
    const authorSuffix = (p.authors?.length || 0) > 3 ? ' et al.' : ''
    
    let entry = `### ${p.title}\n`
    entry += `**Authors:** ${authorStr}${authorSuffix}\n`
    if (p.year) entry += `**Year:** ${p.year}\n`
    entry += `**Paper ID:** ${p.id}\n`
    
    if (p.abstract) {
      entry += `**Abstract:** ${p.abstract.slice(0, 500)}${p.abstract.length > 500 ? '...' : ''}\n`
    }
    
    if (ragChunks) {
      const paperChunks = ragChunks.filter(c => c.paper_id === p.id)
      if (paperChunks.length > 0) {
        entry += `\n**Relevant excerpts:**\n`
        for (const chunk of paperChunks.slice(0, 2)) {
          entry += `> ${chunk.content.slice(0, 300)}${chunk.content.length > 300 ? '...' : ''}\n`
        }
      }
    }
    
    return entry
  }).join('\n---\n\n')
  
  return `## Papers Referenced by User (@mentions)

The user has explicitly mentioned these papers. Prioritize these sources.

${formatted}`
}
