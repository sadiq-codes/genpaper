/**
 * Block-based content generation with streaming
 * Refactored for production robustness and type safety
 */

import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { addCitation } from '@/lib/ai/tools/addCitation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaperWithAuthors, GenerationConfig } from '@/types/simplified'
import type { SectionContext } from '@/lib/prompts/types'
import type { CapturedToolCall } from './types'
import { getMaxTokens, getTargetLength } from './config'
import { validateCitationArgs } from './validators'
import { monotonicFactory } from 'ulid'
import { detectBlockBoundary, countWords, extractTextFromBlock } from './markdown-detector'

/* ---------- setup ------------------------------------------------------- */

const ulid = monotonicFactory()

// Configuration constants (no more magic numbers)
const BLOCK_GENERATION_CONFIG = {
  maxSteps: 5,
  temperature: 0.2,
  bufferSizeLimit: 800,
  progressReportInterval: 20
} as const

/* ---------- type definitions -------------------------------------------- */

export type BlockType = 
  | 'paragraph' 
  | 'heading' 
  | 'citation' 
  | 'section'
  | 'code'
  | 'quote'
  | 'list'

export interface BaseBlock<T extends BlockType, Payload = unknown> {
  id: string
  type: T
  content: Payload
  position: number
  metadata?: Record<string, unknown>
}

export type TiptapBlock =
  | BaseBlock<'paragraph', { type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }>
  | BaseBlock<'heading', { type: 'heading'; attrs: { level: number }; content: Array<{ type: 'text'; text: string }> }>
  | BaseBlock<'citation', { type: 'citation'; attrs: { citationKey: string; citationId?: string }; content: Array<{ type: 'text'; text: string }> }>
  | BaseBlock<'code', { type: 'codeBlock'; attrs: { language?: string }; content: Array<{ type: 'text'; text: string }> }>
  | BaseBlock<'quote', { type: 'blockquote'; content: Array<{ type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }> }>
  | BaseBlock<'list', { type: 'bulletList'; content: Array<{ type: 'listItem'; content: Array<{ type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }> }> }>

export interface BlockGenerationOptions {
  documentId: string
  systemMessage: string
  userMessage: string
  papers: PaperWithAuthors[]
  config: GenerationConfig
  supabaseClient: SupabaseClient
  onBlockCreated?: (block: TiptapBlock) => void
  onProgress?: (progress: number) => void
}

export interface CitationResult {
  success: boolean
  citationKey?: string
  citationId?: string
  replacement?: string
  title?: string
  authors?: unknown
  year?: number
  journal?: string
}

/* ---------- public API -------------------------------------------------- */

/**
 * Generates content directly into blocks, streaming each section as it's created
 * Improved with monotonic ULID, transaction safety, and graceful error handling
 */
export async function streamToBlocks(
  options: BlockGenerationOptions
): Promise<{ blocks: TiptapBlock[]; capturedToolCalls: CapturedToolCall[] }> {
  
  const { documentId, systemMessage, userMessage, papers, config, supabaseClient, onBlockCreated, onProgress } = options

  console.log(`🔧 Starting enhanced block-based streaming generation`)
  console.log(`🔧 Document ID: ${documentId}`)
  console.log(`🔧 Papers available: ${papers.length}`)

  try {
    const stream = await streamText({
      model: ai(config?.model ?? 'gpt-4o'),
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      tools: { addCitation },
      toolChoice: 'auto',
      maxSteps: BLOCK_GENERATION_CONFIG.maxSteps,
      temperature: BLOCK_GENERATION_CONFIG.temperature,
      maxTokens: getMaxTokens(
        config?.paper_settings?.length,
        config?.paper_settings?.paperType
      ),
      experimental_telemetry: { isEnabled: true }
    })

    let buffer = ''
    let position = 0
    const blocks: TiptapBlock[] = []
    const capturedToolCalls: CapturedToolCall[] = []
    const targetWords = getTargetLength(
      config?.paper_settings?.length,
      config?.paper_settings?.paperType
    )

    // Process stream with enhanced error handling
    for await (const delta of stream.fullStream) {
      try {
        switch (delta.type) {
          case 'text-delta':
            buffer += delta.textDelta
            
            // Use deterministic block detection
            const boundary = detectBlockBoundary(buffer)
            if (boundary) {
              const blockData = boundary.toBlock(documentId, position)
              blockData.id = ulid() // Set monotonic ULID
              
              const block = await persistBlock(blockData, supabaseClient)
              blocks.push(block)
              position += 1
              buffer = boundary.remainder

              // Notify callback
              onBlockCreated?.(block)

              // Calculate progress based on word count (more accurate)
              const totalWords = blocks.reduce((acc, b) => 
                acc + countWords(extractTextFromBlock(b.content)), 0
              )
              const progress = Math.min((totalWords / targetWords) * 100, 95)
              onProgress?.(progress)

              console.log(`📝 Created block: ${block.type} (#${position}) - ${totalWords}/${targetWords} words`)
            }
            break

          case 'tool-call':
            console.log(`🔧 Tool call: ${delta.toolName}`, delta.args)
            
            let validated = false
            let validationError: string | undefined
            
            if (delta.toolName === 'addCitation') {
              const validation = validateCitationArgs(delta.args)
              validated = validation.valid
              validationError = validation.error
            } else {
              validated = true
            }
            
            capturedToolCalls.push({
              toolCallId: delta.toolCallId,
              toolName: delta.toolName,
              args: delta.args,
              result: null,
              timestamp: new Date().toISOString(),
              validated,
              error: validationError
            })
            break

          case 'tool-result':
            console.log(`🔧 Tool result: ${delta.toolCallId}`, delta.result)
            
            const toolCall = capturedToolCalls.find(tc => tc.toolCallId === delta.toolCallId)
            if (toolCall) {
              toolCall.result = delta.result
              
              // Handle citation with transaction safety
              if (toolCall.toolName === 'addCitation' && delta.result?.success) {
                try {
                  const citationBlock = await persistCitationBlock(
                    documentId,
                    position,
                    delta.result as CitationResult,
                    supabaseClient
                  )
                  
                  blocks.push(citationBlock)
                  position += 1
                  onBlockCreated?.(citationBlock)
                  console.log(`📋 Created citation block: ${delta.result.citationKey}`)
                } catch (error) {
                  console.error(`❌ Failed to create citation block:`, error)
                  // Continue processing - don't abort entire stream
                }
              }
            }
            break

          case 'error':
            console.error(`❌ Stream error:`, delta.error)
            // Don't throw - return partial results with error context
            return { 
              blocks, 
              capturedToolCalls: [
                ...capturedToolCalls,
                {
                  toolCallId: 'stream-error',
                  toolName: 'system',
                  args: { error: delta.error },
                  result: { success: false, error: delta.error },
                  timestamp: new Date().toISOString(),
                  validated: false,
                  error: String(delta.error)
                }
              ]
            }
        }
      } catch (stepError) {
        console.error(`❌ Error processing stream delta:`, stepError)
        // Log error but continue processing
        capturedToolCalls.push({
          toolCallId: `error-${Date.now()}`,
          toolName: 'system',
          args: { error: stepError },
          result: { success: false, error: String(stepError) },
          timestamp: new Date().toISOString(),
          validated: false,
          error: String(stepError)
        })
      }
    }

    // Handle any remaining content in buffer
    if (buffer.trim()) {
      try {
        const finalBlock = buildParagraphBlock(buffer.trim(), documentId, position)
        finalBlock.id = ulid()
        const persistedBlock = await persistBlock(finalBlock, supabaseClient)
        blocks.push(persistedBlock)
        onBlockCreated?.(persistedBlock)
      } catch (error) {
        console.error(`❌ Failed to create final block:`, error)
      }
    }

    console.log(`✅ Generated ${blocks.length} blocks successfully`)
    return { blocks, capturedToolCalls }

  } catch (error) {
    console.error(`❌ Critical error in streamToBlocks:`, error)
    throw new Error(`Block generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/* ---------- block persistence helpers ----------------------------------- */

/**
 * Persist a block to the database
 * Pure function that handles database writes with error handling
 */
async function persistBlock(block: TiptapBlock, client: SupabaseClient): Promise<TiptapBlock> {
  const { error } = await client
    .from('blocks')
    .insert({
      id: block.id,
      document_id: block.metadata?.documentId as string,
      type: block.type,
      content: block.content,
      position: block.position,
      metadata: block.metadata || {}
    })

  if (error) {
    console.error(`❌ Failed to persist block:`, error)
    throw new Error(`Failed to persist block: ${error.message}`)
  }

  return block
}

/**
 * Create and persist a citation block with transactional safety
 * Uses the SQL function to ensure atomicity
 */
async function persistCitationBlock(
  documentId: string,
  position: number,
  citationResult: CitationResult,
  client: SupabaseClient
): Promise<TiptapBlock> {
  
  if (!citationResult.success || !citationResult.citationKey) {
    throw new Error('Invalid citation result')
  }

  const blockId = ulid()
  const content = {
    type: 'citation' as const,
    attrs: {
      citationKey: citationResult.citationKey,
      citationId: citationResult.citationId
    },
    content: [{ 
      type: 'text' as const, 
      text: citationResult.replacement || `[${citationResult.citationKey}]` 
    }]
  }

  // Use transactional SQL function
  const { error } = await client.rpc('insert_block_with_citation', {
    p_block_id: blockId,
    p_document_id: documentId,
    p_position: position,
    p_content: content,
    p_citation_id: citationResult.citationId || null,
    p_citation_key: citationResult.citationKey,
    p_citation_title: citationResult.title || null,
    p_citation_authors: citationResult.authors ? JSON.stringify(citationResult.authors) : null,
    p_citation_year: citationResult.year || null,
    p_citation_journal: citationResult.journal || null
  })

  if (error) {
    console.error(`❌ Failed to persist citation block:`, error)
    throw new Error(`Failed to persist citation block: ${error.message}`)
  }

  return {
    id: blockId,
    type: 'citation',
    position,
    content,
    metadata: { 
      citationKey: citationResult.citationKey, 
      documentId 
    }
  }
}

/* ---------- pure block builders ----------------------------------------- */

/**
 * Pure function to build heading block (no I/O)
 */
export function buildHeadingBlock(
  text: string,
  level: number,
  documentId: string,
  position: number
): TiptapBlock {
  return {
    id: '', // Will be set by caller
    type: 'heading',
    position,
    content: {
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text }]
    },
    metadata: { level, documentId }
  }
}

/**
 * Pure function to build paragraph block (no I/O)
 */
export function buildParagraphBlock(
  text: string,
  documentId: string,
  position: number
): TiptapBlock {
  return {
    id: '', // Will be set by caller
    type: 'paragraph',
    position,
    content: {
      type: 'paragraph',
      content: [{ type: 'text', text }]
    },
    metadata: { documentId }
  }
}

/* ---------- section generation ------------------------------------------ */

/**
 * Section-by-section block generation with improved error handling
 */
export async function generateSectionsAsBlocks(
  documentId: string,
  topic: string,
  sectionContexts: SectionContext[],
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  supabaseClient: SupabaseClient,
  onProgress: (progress: number, message: string) => void,
  onBlockCreated?: (block: TiptapBlock) => void
): Promise<{ blocks: TiptapBlock[]; capturedToolCalls: CapturedToolCall[] }> {
  
  const allBlocks: TiptapBlock[] = []
  const allToolCalls: CapturedToolCall[] = []
  
  for (let i = 0; i < sectionContexts.length; i++) {
    const section = sectionContexts[i]
    const progress = (i / sectionContexts.length) * 100
    
    onProgress(progress, `Generating section: ${section.title}`)
    
    try {
      // Create section heading block first
      const headingBlock = buildHeadingBlock(
        section.title,
        2, // h2 for sections
        documentId,
        allBlocks.length
      )
      headingBlock.id = ulid()
      
      const persistedHeading = await persistBlock(headingBlock, supabaseClient)
      allBlocks.push(persistedHeading)
      onBlockCreated?.(persistedHeading)
      
      // Generate section content using unified template system
      const { buildUnifiedPrompt } = await import('@/lib/prompts/unified/prompt-builder')
      
      const unifiedContext = {
        projectId: documentId, // Use documentId as projectId
        sectionId: `${documentId}-section-${i}`,
        paperType: config?.paper_settings?.paperType || 'researchArticle',
        sectionKey: section.sectionKey,
        availablePapers: section.candidatePaperIds,
        contextChunks: section.contextChunks
      }
      
      const promptData = await buildUnifiedPrompt(unifiedContext, {
        targetWords: section.expectedWords
      })
      
      const systemMessage = promptData.system
      const userMessage = promptData.user
      
      const { blocks: sectionBlocks, capturedToolCalls } = await streamToBlocks({
        documentId,
        systemMessage,
        userMessage,
        papers,
        config,
        supabaseClient,
        onBlockCreated,
        onProgress: (p) => onProgress(
          progress + (p * 0.8) / sectionContexts.length, 
          `Generating ${section.title}`
        )
      })
      
      allBlocks.push(...sectionBlocks)
      allToolCalls.push(...capturedToolCalls)
      
    } catch (error) {
      console.error(`❌ Failed to generate section ${section.title}:`, error)
      
      // Add error context but continue with other sections
      allToolCalls.push({
        toolCallId: `section-error-${i}`,
        toolName: 'system',
        args: { section: section.title, error },
        result: { success: false, error: String(error) },
        timestamp: new Date().toISOString(),
        validated: false,
        error: `Failed to generate section ${section.title}: ${error}`
      })
    }
  }
  
  onProgress(100, 'Generation complete')
  return { blocks: allBlocks, capturedToolCalls: allToolCalls }
} 