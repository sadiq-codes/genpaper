/**
 * Conversation Memory Service
 * 
 * Extracts and manages conversation context across chat turns.
 * Enables AI to remember:
 * - Identified gaps/issues in the document
 * - Suggestions made but not yet acted on
 * - Key decisions made during the conversation
 * - Recent document edits
 * - Topics the user has discussed
 */

import { createClient } from '@/lib/supabase/server'

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationMemory {
  projectId: string
  summary: string | null
  identifiedGaps: string[]
  pendingSuggestions: PendingSuggestion[]
  keyDecisions: KeyDecision[]
  recentEdits: RecentEdit[]
  discussedTopics: string[]
  updatedAt: Date
}

export interface PendingSuggestion {
  id: string
  suggestion: string
  context: string
  timestamp: string
}

export interface KeyDecision {
  decision: string
  context: string
  timestamp: string
}

export interface RecentEdit {
  toolName: string
  description: string
  timestamp: string
  blockId?: string
}

// =============================================================================
// MEMORY EXTRACTION
// =============================================================================

/**
 * Extract identified gaps from an AI response.
 * Looks for numbered lists, bullet points, or explicit gap mentions.
 */
export function extractIdentifiedGaps(aiResponse: string): string[] {
  const gaps: string[] = []
  
  // Pattern 1: Numbered lists (1. Gap description, 2. Another gap)
  const numberedPattern = /^\s*(\d+)[.)]\s*\*?\*?([^:\n]+?)(?:\*?\*?:|\n|$)/gm
  let match
  while ((match = numberedPattern.exec(aiResponse)) !== null) {
    const gap = match[2].trim()
    // Filter out common non-gap phrases
    if (gap.length > 10 && !isMetaPhrase(gap)) {
      gaps.push(gap)
    }
  }
  
  // Pattern 2: Bullet points with "missing", "lacking", "needed", "gap"
  const bulletPattern = /[-•*]\s*\*?\*?([^:\n]+(?:missing|lacking|needed|gap|absent|limited)[^:\n]*)/gi
  while ((match = bulletPattern.exec(aiResponse)) !== null) {
    const gap = match[1].trim().replace(/\*\*/g, '')
    if (gap.length > 10 && !gaps.includes(gap)) {
      gaps.push(gap)
    }
  }
  
  // Pattern 3: Explicit "could benefit from", "should include", "needs"
  const suggestionPattern = /(?:could benefit from|should include|needs|lacks|missing)\s+([^.!?\n]+)/gi
  while ((match = suggestionPattern.exec(aiResponse)) !== null) {
    const gap = match[1].trim()
    if (gap.length > 10 && gap.length < 200 && !gaps.some(g => g.includes(gap) || gap.includes(g))) {
      gaps.push(gap)
    }
  }
  
  return gaps.slice(0, 10) // Limit to 10 gaps
}

/**
 * Extract suggestions from an AI response.
 */
export function extractSuggestions(aiResponse: string, userMessage: string): PendingSuggestion[] {
  const suggestions: PendingSuggestion[] = []
  
  // Look for "I suggest", "I recommend", "You could", "Consider"
  const suggestionPatterns = [
    /(?:I suggest|I recommend|you could|consider|try)\s+([^.!?\n]+[.!?])/gi,
    /(?:would you like me to|shall I|I can)\s+([^.!?\n]+[.!?])/gi,
  ]
  
  for (const pattern of suggestionPatterns) {
    let match
    while ((match = pattern.exec(aiResponse)) !== null) {
      const suggestion = match[1].trim()
      if (suggestion.length > 15 && suggestion.length < 300) {
        suggestions.push({
          id: `sug_${Date.now()}_${suggestions.length}`,
          suggestion,
          context: userMessage.slice(0, 100),
          timestamp: new Date().toISOString(),
        })
      }
    }
  }
  
  return suggestions.slice(0, 5) // Limit to 5 suggestions
}

/**
 * Extract discussed topics from user message.
 */
export function extractDiscussedTopics(userMessage: string): string[] {
  const topics: string[] = []
  
  // Look for section references
  const sectionPattern = /(?:in the|in my|the)\s+(introduction|conclusion|abstract|methods?|results?|discussion|literature review|background|methodology)/gi
  let match
  while ((match = sectionPattern.exec(userMessage)) !== null) {
    const topic = match[1].toLowerCase()
    if (!topics.includes(topic)) {
      topics.push(topic)
    }
  }
  
  // Look for content references
  const aboutPattern = /(?:about|regarding|concerning)\s+([^.!?\n,]+)/gi
  while ((match = aboutPattern.exec(userMessage)) !== null) {
    const topic = match[1].trim().toLowerCase()
    if (topic.length > 3 && topic.length < 50 && !topics.includes(topic)) {
      topics.push(topic)
    }
  }
  
  return topics.slice(0, 10)
}

/**
 * Check if a phrase is meta-discussion rather than actual content.
 */
function isMetaPhrase(phrase: string): boolean {
  const metaPhrases = [
    'here are', 'following', 'these are', 'let me', 'i will', 'i can',
    'would you like', 'shall i', 'as requested', 'based on'
  ]
  const lower = phrase.toLowerCase()
  return metaPhrases.some(mp => lower.startsWith(mp))
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/**
 * Load conversation memory for a project.
 */
export async function loadConversationMemory(projectId: string): Promise<ConversationMemory | null> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('chat_conversation_memory')
      .select('*')
      .eq('project_id', projectId)
      .single()
    
    if (error || !data) {
      return null
    }
    
    return {
      projectId: data.project_id,
      summary: data.summary,
      identifiedGaps: data.identified_gaps || [],
      pendingSuggestions: data.pending_suggestions || [],
      keyDecisions: data.key_decisions || [],
      recentEdits: data.recent_edits || [],
      discussedTopics: data.discussed_topics || [],
      updatedAt: new Date(data.updated_at),
    }
  } catch (error) {
    console.error('Failed to load conversation memory:', error)
    return null
  }
}

/**
 * Save or update conversation memory for a project.
 */
export async function saveConversationMemory(
  projectId: string,
  updates: Partial<Omit<ConversationMemory, 'projectId' | 'updatedAt'>>
): Promise<void> {
  try {
    const supabase = await createClient()
    
    // Load existing memory to merge
    const existing = await loadConversationMemory(projectId)
    
    const memoryData = {
      project_id: projectId,
      summary: updates.summary ?? existing?.summary ?? null,
      identified_gaps: mergeArrays(existing?.identifiedGaps || [], updates.identifiedGaps || []),
      pending_suggestions: mergeById(existing?.pendingSuggestions || [], updates.pendingSuggestions || []),
      key_decisions: [...(existing?.keyDecisions || []), ...(updates.keyDecisions || [])].slice(-20),
      recent_edits: [...(existing?.recentEdits || []), ...(updates.recentEdits || [])].slice(-10),
      discussed_topics: mergeArrays(existing?.discussedTopics || [], updates.discussedTopics || []),
    }
    
    const { error } = await supabase
      .from('chat_conversation_memory')
      .upsert(memoryData, { onConflict: 'project_id' })
    
    if (error) {
      console.error('Failed to save conversation memory:', error)
    }
  } catch (error) {
    console.error('Failed to save conversation memory:', error)
  }
}

/**
 * Record a document edit in memory.
 */
export async function recordEdit(
  projectId: string,
  toolName: string,
  description: string,
  blockId?: string
): Promise<void> {
  const edit: RecentEdit = {
    toolName,
    description,
    timestamp: new Date().toISOString(),
    blockId,
  }
  
  await saveConversationMemory(projectId, {
    recentEdits: [edit],
  })
}

/**
 * Mark a suggestion as acted upon (remove from pending).
 */
export async function markSuggestionActedOn(
  projectId: string,
  suggestionId: string,
  decision: string
): Promise<void> {
  const existing = await loadConversationMemory(projectId)
  if (!existing) return
  
  const suggestion = existing.pendingSuggestions.find(s => s.id === suggestionId)
  
  await saveConversationMemory(projectId, {
    pendingSuggestions: existing.pendingSuggestions.filter(s => s.id !== suggestionId),
    keyDecisions: suggestion ? [{
      decision,
      context: suggestion.suggestion,
      timestamp: new Date().toISOString(),
    }] : [],
  })
}

/**
 * Clear conversation memory (e.g., when clearing chat history).
 */
export async function clearConversationMemory(projectId: string): Promise<void> {
  try {
    const supabase = await createClient()
    
    await supabase
      .from('chat_conversation_memory')
      .delete()
      .eq('project_id', projectId)
  } catch (error) {
    console.error('Failed to clear conversation memory:', error)
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Merge two arrays, removing duplicates.
 */
function mergeArrays<T extends string>(existing: T[], updates: T[]): T[] {
  const combined = [...existing, ...updates]
  return [...new Set(combined)].slice(0, 20) // Limit to 20 items
}

/**
 * Merge arrays of objects by ID, preferring newer items.
 */
function mergeById<T extends { id: string }>(existing: T[], updates: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of existing) {
    map.set(item.id, item)
  }
  for (const item of updates) {
    map.set(item.id, item)
  }
  return Array.from(map.values()).slice(-10) // Keep last 10
}

// =============================================================================
// PROMPT FORMATTING
// =============================================================================

/**
 * Format conversation memory for inclusion in system prompt.
 */
export function formatMemoryForPrompt(memory: ConversationMemory | null): string {
  if (!memory) return ''
  
  const sections: string[] = []
  
  // Identified gaps
  if (memory.identifiedGaps.length > 0) {
    sections.push(`## Previously Identified Gaps/Issues
The following gaps were identified in earlier conversation:
${memory.identifiedGaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

If the user refers to these by number (e.g., "add 1 and 2"), use these descriptions.`)
  }
  
  // Pending suggestions
  if (memory.pendingSuggestions.length > 0) {
    sections.push(`## Pending Suggestions
You previously suggested these actions that the user hasn't acted on:
${memory.pendingSuggestions.map(s => `- ${s.suggestion}`).join('\n')}`)
  }
  
  // Recent edits
  if (memory.recentEdits.length > 0) {
    const recentEdits = memory.recentEdits.slice(-5)
    sections.push(`## Recent Document Edits
Recent changes made to the document:
${recentEdits.map(e => `- ${e.description} (${e.toolName})`).join('\n')}`)
  }
  
  // Discussed topics
  if (memory.discussedTopics.length > 0) {
    sections.push(`## Topics Discussed
The user has asked about: ${memory.discussedTopics.join(', ')}`)
  }
  
  if (sections.length === 0) return ''
  
  return `
## Conversation Context (Memory)
${sections.join('\n\n')}
`
}
