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
 * 
 * Voice Integration:
 * - Content-generating actions (write, edit, cite) include project voice
 * - Mechanical actions (explain, suggest, analyze) skip voice
 */

import { 
  type CondensedVoiceContext,
  buildCondensedVoiceContext,
  shouldIncludeVoiceForAction,
  type VoiceProfileId
} from '@/lib/generation/voice-profiles'
import { isNumericStyle } from '@/lib/citations/local-formatter'

// Re-export shared paper formatting utilities
// These are the canonical implementations - use these for all paper formatting
export { 
  formatPapersForContext,
  formatMentionedPapersForContext,
  formatRAGChunksForContext,
  type PaperForContext,
  type RAGChunk,
} from './format-papers'

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
    citationFormat: 'numbered'  // Always numbered for tool call insertions
    conversationalCiteFormat: 'numbered' | 'author-year'  // For discussion without tool calls
    isNumericCitationStyle: boolean  // True for IEEE/Vancouver/etc
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
  
  // === VOICE (optional) ===
  // Project's authorial voice for content-generating actions
  // Only included for write/edit/cite actions that produce academic prose
  voice?: CondensedVoiceContext

  // === ORIGINAL RESEARCH (optional) ===
  // User-provided findings that should anchor all AI responses
  hasOriginalResearch?: boolean
  researchQuestion?: string
  keyFindings?: string
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
        ? ['replaceBlock'] 
        : ['replaceBlock', 'rewriteSection']
    case 'cite':
      // addCitation for single citations to existing text
      // insertContent/replaceBlock for new content or multi-citation edits
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
 * 
 * Citation tools:
 * - addCitation: Single citation to existing text (no text change)
 * - insertContent/replaceBlock with markers: New/edited content with citations
 */
export const DEFAULT_CHAT_TOOLS: ToolDefinition[] = [
  {
    name: 'insertContent',
    description: 'Add new content at a specific location. Use [N] markers in text AND include `citations` array in tool args.',
    preferredFor: 'Adding new paragraphs, sections, content with citations',
  },
  {
    name: 'replaceBlock',
    description: 'Replace a block\'s content entirely (use blockId). Use [N] markers AND `citations` array for new citations. Preserve existing [@...] markers.',
    preferredFor: 'Rewriting paragraphs with citations, editing content',
  },
  {
    name: 'rewriteSection',
    description: 'Rewrite an entire section (requires user confirmation). Include `citations` array if adding citations.',
    preferredFor: 'Major section overhauls, restructuring',
  },
  {
    name: 'deleteContent',
    description: 'Delete content (requires user confirmation)',
    preferredFor: 'Removing paragraphs or sections',
  },
  {
    name: 'addCitation',
    description: 'Add a single citation to existing text WITHOUT modifying the text. Requires paperId and afterPhrase.',
    preferredFor: 'Adding citation to a claim that has no citation yet',
  },
  {
    name: 'highlightText',
    description: 'Highlight text for user review. Use blockId for entire block, or searchPhrase for specific text.',
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
  
  // Voice configuration (optional)
  // Pass the project's voiceProfileId to include voice guidance for content-generating actions
  voiceProfileId?: VoiceProfileId | null
  
  // Citation style (optional)
  // Used to determine conversational citation format (author-year vs numbered)
  citationStyle?: string
  
  // Original research findings (optional)
  hasOriginalResearch?: boolean
  researchQuestion?: string
  keyFindings?: string
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
    maxContentLength = 6000, // ~1.5-2 pages of context
    tools = DEFAULT_CHAT_TOOLS,
    voiceProfileId,
    citationStyle = 'apa',
    hasOriginalResearch,
    researchQuestion,
    keyFindings,
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
  
  // Build voice context only for content-generating actions
  const voice = shouldIncludeVoiceForAction(actionType) && voiceProfileId
    ? buildCondensedVoiceContext(voiceProfileId)
    : undefined

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
      // For conversational responses (no tool call), use author-year or numbered based on style
      conversationalCiteFormat: isNumericStyle(citationStyle) ? 'numbered' : 'author-year',
      isNumericCitationStyle: isNumericStyle(citationStyle),
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
    
    // VOICE (optional - only for content-generating actions)
    voice,

    // ORIGINAL RESEARCH (optional)
    hasOriginalResearch,
    researchQuestion,
    keyFindings,
  }
}

// Note: formatPapersForContext and formatMentionedPapersForContext are now
// exported from ./format-papers.ts via the re-export at the top of this file.
