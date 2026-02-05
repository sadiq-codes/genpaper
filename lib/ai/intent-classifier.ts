/**
 * Intent Classifier for Smart RAG Routing
 * 
 * Uses a fast LLM (GPT-4o-mini) to classify user messages and determine
 * whether RAG retrieval is needed. This replaces hardcoded heuristics
 * with a more flexible, accurate approach.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { createOpenAI } from '@ai-sdk/openai'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Intent categories for message classification.
 * 
 * - research: Needs RAG - user wants citations, evidence, paper content
 * - editing: Pure editing - grammar, tone, rewrite (no RAG needed)
 * - chat: Conversational - greetings, acknowledgments (no RAG needed)
 * - meta: About the assistant - "what can you do?" (no RAG needed)
 */
export type MessageIntent = 'research' | 'editing' | 'chat' | 'meta'

export interface IntentClassification {
  intent: MessageIntent
  confidence: number       // 0-1, how confident the classifier is
  needsRetrieval: boolean  // Convenience flag for routing decision
  reasoning?: string       // Optional explanation for debugging
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Use GPT-4o-mini for fast, cheap classification
const CLASSIFIER_MODEL = 'gpt-4o-mini'

// Confidence threshold - if below this, default to research (safer)
const CONFIDENCE_THRESHOLD = 0.7

// Create a dedicated OpenAI client for the classifier
const classifierClient = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// =============================================================================
// SCHEMA
// =============================================================================

const IntentSchema = z.object({
  intent: z.enum(['research', 'editing', 'chat', 'meta']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

// =============================================================================
// PROMPT
// =============================================================================

const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for a research writing assistant that helps users write academic papers with citations from their paper library.

Classify the user's message into ONE of these categories:

**research** - User wants information FROM their papers, needs citations, evidence, or analysis of sources.
Examples:
- "add citations to support this claim"
- "what do the papers say about X?"
- "cite this"
- "find evidence for..."
- "summarize the findings on..."
- "what did Smith et al. find?"
- "support this with sources"

**editing** - User wants to modify existing text WITHOUT needing research context. Pure stylistic/structural changes.
Examples:
- "make this shorter"
- "fix the grammar"
- "rewrite in a more formal tone"
- "split this paragraph"
- "combine these sentences"
- "make it more concise"
- "rephrase this"

**chat** - Conversational messages: greetings, acknowledgments, simple yes/no, thanks.
Examples:
- "hi" / "hello" / "hey"
- "thanks" / "thank you"
- "ok" / "okay" / "got it"
- "yes" / "no" / "sure"
- "nice" / "great"

**meta** - Questions about the assistant itself or how to use it.
Examples:
- "what can you do?"
- "how do I add papers?"
- "help"
- "how does this work?"

IMPORTANT RULES:
1. When in doubt between "research" and "editing", choose "research" - it's safer to retrieve context than miss it.
2. If the message mentions specific paper content, findings, or asks for citations → "research"
3. Short vague messages like "help me with this" without context → "editing" (operating on selection)
4. Any mention of "cite", "citation", "paper", "source", "evidence", "reference" → "research"

Respond with your classification, confidence (0.0-1.0), and brief reasoning.`

// =============================================================================
// CLASSIFIER FUNCTION
// =============================================================================

/**
 * Classify user message intent to determine if RAG retrieval is needed.
 * 
 * @param message - The user's message text
 * @param options - Additional context for classification
 * @returns Classification batallon(or "wall"): Intent classification with confidence
 */
export async function classifyIntent(
  message: string,
  options?: {
    hasSelectedText?: boolean
    hasMentionedPapers?: boolean
  }
): Promise<IntentClassification> {
  
  // Fast path: If papers are explicitly @mentioned, always need retrieval
  if (options?.hasMentionedPapers) {
    return {
      intent: 'research',
      confidence: 1.0,
      needsRetrieval: true,
      reasoning: 'Papers explicitly mentioned via @mention',
    }
  }

  const trimmed = message.trim().toLowerCase()
  
  // Fast path: Common greetings and acknowledgments (skip LLM call entirely)
  const TRIVIAL_GREETING = /^(hi+|hello|hey|thanks?|thank you|ok(ay)?|yes|no|sure|nice|great|cool|got it|sounds good|perfect|awesome|good|yep|nope|alright)[\s!?.,]*$/i
  if (TRIVIAL_GREETING.test(trimmed)) {
    return {
      intent: 'chat',
      confidence: 0.95,
      needsRetrieval: false,
      reasoning: 'Trivial greeting or acknowledgment detected',
    }
  }

  // Fast path: Meta questions about capabilities (skip LLM call entirely)
  const META_QUESTION = /^(what (can|do) you (do|help|know)|help( me)?|how (do|can) (i|you)|can you help|what('s| is) this|who are you)[\s\w]{0,20}\??$/i
  if (META_QUESTION.test(trimmed)) {
    return {
      intent: 'meta',
      confidence: 0.95,
      needsRetrieval: false,
      reasoning: 'Meta question about assistant capabilities',
    }
  }

  // Fast path: Very short messages (< 10 chars) are likely greetings
  if (trimmed.length < 10) {
    return {
      intent: 'chat',
      confidence: 0.85,
      needsRetrieval: false,
      reasoning: 'Very short message, likely greeting or acknowledgment',
    }
  }

  try {
    const startTime = performance.now()
    
    const result = await generateObject({
      model: classifierClient.languageModel(CLASSIFIER_MODEL),
      schema: IntentSchema,
      system: CLASSIFIER_SYSTEM_PROMPT,
      prompt: message,
      temperature: 0, // Deterministic for consistency
    })

    const duration = performance.now() - startTime
    const { intent, confidence, reasoning } = result.object

    console.log(`[IntentClassifier] Classified in ${duration.toFixed(0)}ms: "${message.slice(0, 50)}..." → ${intent} (${(confidence * 100).toFixed(0)}%)`)

    // If confidence is low, default to research (safer)
    const effectiveIntent = confidence < CONFIDENCE_THRESHOLD ? 'research' : intent
    const needsRetrieval = effectiveIntent === 'research'

    return {
      intent: effectiveIntent,
      confidence,
      needsRetrieval,
      reasoning: confidence < CONFIDENCE_THRESHOLD 
        ? `Low confidence (${(confidence * 100).toFixed(0)}%), defaulting to research. Original: ${reasoning}`
        : reasoning,
    }
  } catch (error) {
    // On error, default to research (safe fallback)
    console.error('[IntentClassifier] Classification failed, defaulting to research:', error)
    
    return {
      intent: 'research',
      confidence: 0.5,
      needsRetrieval: true,
      reasoning: 'Classification failed, defaulting to research for safety',
    }
  }
}

/**
 * Check if RAG should be skipped based on intent classification.
 * Convenience wrapper that returns a simple boolean.
 * 
 * @param message - The user's message text
 * @param hasMentionedPapers - Whether papers were @mentioned
 * @returns Object with skip decision and classification details
 */
export async function shouldSkipRAG(
  message: string,
  hasMentionedPapers: boolean
): Promise<{ skip: boolean; classification: IntentClassification }> {
  const classification = await classifyIntent(message, { hasMentionedPapers })
  
  return {
    skip: !classification.needsRetrieval,
    classification,
  }
}
