import 'server-only'
import { PromptService, type PromptData } from '@/lib/prompts/prompt-service'
import { AIService, type StreamEvent } from '@/lib/ai/ai-service'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { isUnifiedCitationsEnabled, isBatchedCitationsEnabled } from '@/lib/config/feature-flags'
import { parseCitationPlaceholders, replacePlaceholders, type PlaceholderCitation } from '@/lib/citations/placeholder-schema'
import type { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import type { PaperWithAuthors } from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'

/**
 * GenerationOrchestrator
 * 
 * Composes PromptService + AIService + CitationService behind a small API.
 * Handles both immediate citations (current) and placeholder workflow (new).
 */

export interface GenerationConfig {
  paperType: PaperTypeKey
  sectionKey: SectionKey
  projectId: string
  topic: string
  contextChunks: Array<{ content: string; paper_id: string; title?: string }>
  availablePapers: PaperWithAuthors[]
  targetWords?: number
  citationStyle?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface GenerationEvent {
  type: 'progress' | 'sentence' | 'citation' | 'placeholder' | 'batch_resolved' | 'error' | 'complete'
  data: any
}

export interface GenerationResult {
  content: string
  citations: Array<{ paperId: string; citationNumber: number; formatted: string }>
  tokensUsed?: number
  placeholdersResolved?: number
  metrics: GenerationMetrics
}

export interface GenerationMetrics {
  sentenceCount: number
  citationCount: number
  processingTimeMs: number
  latencyBreakdown: {
    promptBuilding: number
    llmStreaming: number
    batchResolution: number
    totalOverhead: number
  }
  performanceStats: {
    p95LatencyMs: number
    requestId: string
    spans: PerformanceSpan[]
  }
}

export interface PerformanceSpan {
  name: string
  startTime: number
  endTime: number
  duration: number
  metadata?: Record<string, any>
}

export class GenerationOrchestrator {
  private constructor() {}

  static async generateSection(
    config: GenerationConfig,
    onEvent?: (event: GenerationEvent) => void
  ): Promise<GenerationResult> {
    const requestId = this.generateRequestId()
    const startTime = Date.now()
    const spans: PerformanceSpan[] = []
    
    const createSpan = (name: string, metadata?: Record<string, any>) => {
      const span: PerformanceSpan = {
        name,
        startTime: Date.now(),
        endTime: 0,
        duration: 0,
        metadata
      }
      spans.push(span)
      return span
    }
    
    const finishSpan = (span: PerformanceSpan) => {
      span.endTime = Date.now()
      span.duration = span.endTime - span.startTime
      console.log(`🔍 Span [${requestId.slice(-8)}] ${span.name}: ${span.duration}ms`, span.metadata)
    }

    const {
      paperType,
      sectionKey,
      projectId,
      topic,
      contextChunks,
      availablePapers,
      targetWords = 500,
      citationStyle = 'apa',
      model = 'gpt-4o',
      temperature = 0.4,
      maxTokens
    } = config

    console.log(`🚀 Generation started [${requestId}] - ${paperType}/${sectionKey}`)
    onEvent?.({ type: 'progress', data: { stage: 'prompt', progress: 10, message: 'Building prompt...', requestId }})

    try {
      // Step 1: Build prompt using PromptService
      const promptSpan = createSpan('prompt_building', { 
        contextChunks: contextChunks.length,
        availablePapers: availablePapers.length,
        targetWords
      })
      
      const promptData: PromptData = {
        paperTitle: `Research on ${topic}`,
        paperObjectives: `Investigate ${topic}`,
        outlineTree: this.buildOutlineTree(sectionKey),
        previousSectionsSummary: '',
        sectionPath: this.buildSectionPath(sectionKey),
        targetWords,
        minCitations: Math.max(1, Math.floor(availablePapers.length * 0.3)),
        isRewrite: false,
        evidenceSnippets: PromptService.formatEvidenceSnippets(contextChunks)
      }

      const prompt = await PromptService.buildUnified(promptData, { model, temperature, maxTokens })
      finishSpan(promptSpan)

      onEvent?.({ type: 'progress', data: { stage: 'generation', progress: 20, message: 'Starting content generation...', requestId }})

      // Step 2: Stream content using AIService
      const streamSpan = createSpan('llm_streaming', {
        model,
        usePlaceholders: isBatchedCitationsEnabled(),
        temperature,
        maxTokens
      })
      
      const usePlaceholders = isBatchedCitationsEnabled()
      const streamResult = await AIService.streamText({
        model,
        system: prompt.system,
        prompt: prompt.user,
        tools: usePlaceholders ? {} : { addCitation: this.createAddCitationTool(projectId, citationStyle) },
        temperature,
        maxTokens
      })

      // Step 3: Process stream and handle citations
      let fullContent = ''
      let sentenceCount = 0
      const citations: Array<{ paperId: string; citationNumber: number; formatted: string }> = []
      const placeholders: PlaceholderCitation[] = []

      onEvent?.({ type: 'progress', data: { stage: 'streaming', progress: 30, message: 'Processing content stream...', requestId }})

      for await (const event of streamResult.events) {
        if (event.type === 'text-delta') {
          const textDelta = event.data.textDelta
          fullContent += textDelta

          // Extract sentences for streaming
          const sentences = this.extractSentences(textDelta)
          for (const sentence of sentences) {
            sentenceCount++
            onEvent?.({ type: 'sentence', data: { text: sentence, index: sentenceCount }})
          }
          
        } else if (event.type === 'tool-call') {
          // Handle immediate citations (current workflow)
          const citation = event.data
          citations.push({
            paperId: citation.args?.paper_id || '',
            citationNumber: citations.length + 1, // Use sequential numbering for generation
            formatted: citation.result?.formatted_citation || ''
          })
          
          onEvent?.({ type: 'citation', data: citation })
          
        } else if (event.type === 'error') {
          throw new Error(event.data.message)
        }
      }

      finishSpan(streamSpan)

      // Step 4: Handle placeholder citations if enabled
      let placeholdersResolved = 0
      let batchSpan: PerformanceSpan | null = null
      
      if (usePlaceholders && fullContent) {
        batchSpan = createSpan('batch_resolution', { placeholderCount: placeholders.length })
        onEvent?.({ type: 'progress', data: { stage: 'resolving', progress: 80, message: 'Resolving citation placeholders...', requestId }})
        
        const extractedPlaceholders = parseCitationPlaceholders(fullContent)
        placeholders.push(...extractedPlaceholders)

        if (placeholders.length > 0) {
          const citeKeyMap = await this.resolvePlaceholdersBatch(projectId, placeholders)
          const replacementResult = replacePlaceholders(fullContent, citeKeyMap)
          fullContent = replacementResult.text
          placeholdersResolved = placeholders.length - replacementResult.unresolvedCount

          onEvent?.({ 
            type: 'batch_resolved', 
            data: { 
              total: placeholders.length, 
              resolved: placeholdersResolved,
              citeKeyMap,
              requestId
            }
          })
        }
        
        finishSpan(batchSpan)
      }

      const tokensUsed = await streamResult.usage.then(u => u.totalTokens).catch(() => 0)
      const processingTimeMs = Date.now() - startTime

      // Calculate latency breakdown
      const promptTime = spans.find(s => s.name === 'prompt_building')?.duration || 0
      const streamTime = spans.find(s => s.name === 'llm_streaming')?.duration || 0
      const batchTime = spans.find(s => s.name === 'batch_resolution')?.duration || 0
      const overhead = processingTimeMs - (promptTime + streamTime + batchTime)

      // Calculate p95 latency estimate (simplified for single request)
      const p95LatencyMs = Math.max(processingTimeMs, this.getP95Benchmark(sectionKey))

      console.log(`📊 Generation completed [${requestId}] - ${processingTimeMs}ms total`)
      console.log(`   Breakdown: prompt=${promptTime}ms, stream=${streamTime}ms, batch=${batchTime}ms, overhead=${overhead}ms`)

      onEvent?.({ type: 'progress', data: { stage: 'complete', progress: 100, message: 'Generation completed', requestId }})

      const metrics: GenerationMetrics = {
        sentenceCount,
        citationCount: citations.length + placeholdersResolved,
        processingTimeMs,
        latencyBreakdown: {
          promptBuilding: promptTime,
          llmStreaming: streamTime,
          batchResolution: batchTime,
          totalOverhead: overhead
        },
        performanceStats: {
          p95LatencyMs,
          requestId,
          spans
        }
      }

      const result: GenerationResult = {
        content: fullContent,
        citations,
        tokensUsed,
        placeholdersResolved,
        metrics
      }

      onEvent?.({ type: 'complete', data: { ...result, requestId } })
      return result

    } catch (error) {
      const errorTime = Date.now() - startTime
      console.error(`❌ Generation failed [${requestId}] after ${errorTime}ms:`, error)
      
      const errorEvent = {
        type: 'error' as const,
        data: {
          message: error instanceof Error ? error.message : 'Generation failed',
          stage: 'generation',
          requestId,
          processingTimeMs: errorTime,
          error
        }
      }
      onEvent?.(errorEvent)
      throw error
    }
  }

  private static generateRequestId(): string {
    return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  private static getP95Benchmark(sectionKey: SectionKey): number {
    // Rough benchmarks for p95 latency by section type
    const benchmarks: Record<string, number> = {
      introduction: 8000,
      background: 12000,
      methodology: 15000,
      results: 18000,
      discussion: 20000,
      conclusion: 6000
    }
    return benchmarks[sectionKey] || 10000
  }

  private static buildOutlineTree(sectionKey: SectionKey): string {
    const sections = ['introduction', 'background', 'methodology', 'results', 'discussion', 'conclusion']
    const currentIndex = sections.indexOf(sectionKey)
    return sections.map((section, i) => 
      `${i + 1}. ${section}${i === currentIndex ? ' (current)' : ''}`
    ).join('\n')
  }

  private static buildSectionPath(sectionKey: SectionKey): string {
    const pathMap: Record<string, string> = {
      introduction: 'Introduction',
      background: 'Background → Literature Review',
      methodology: 'Methodology → Research Design',
      results: 'Results → Findings',
      discussion: 'Discussion → Analysis',
      conclusion: 'Conclusion → Summary'
    }
    return pathMap[sectionKey] || sectionKey
  }

  private static extractSentences(text: string): string[] {
    const sentenceEnd = /([.!?])\s+(?=[A-Z])/
    const sentences: string[] = []
    let remaining = text
    let match

    while ((match = sentenceEnd.exec(remaining))) {
      const sentence = remaining.slice(0, match.index + 1)
      sentences.push(sentence.trim())
      remaining = remaining.slice(match.index + 1)
    }

    return sentences
  }

  private static createAddCitationTool(projectId: string, citationStyle: string) {
    // Return a tool configuration that matches the existing addCitation tool
    return {
      description: 'Add a citation for a source that supports your claim',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'string', description: 'UUID of the paper to cite' },
          reason: { type: 'string', description: 'Explanation of why this source supports your claim' },
          quote: { type: 'string', description: 'Optional exact quote for verification' }
        },
        required: ['paper_id', 'reason']
      },
      execute: async (args: any) => {
        try {
          const result = await CitationService.add({
            projectId,
            sourceRef: { paperId: args.paper_id },
            reason: args.reason,
            quote: args.quote || null
          })

          // Get the actual render number from first_seen_order
          const supabase = await getSB()
          const { data: citation } = await supabase
            .from('project_citations')
            .select('first_seen_order')
            .eq('id', result.projectCitationId)
            .single()
          
          const renderNumber = citation?.first_seen_order || 1

          const formatted = await CitationService.renderInline(
            result.cslJson,
            citationStyle,
            renderNumber
          )

          return {
            success: true,
            citation_number: renderNumber, // Use first_seen_order for rendering
            formatted_citation: formatted,
            is_new: result.isNew
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Citation failed'
          }
        }
      }
    }
  }

  private static async resolvePlaceholdersBatch(
    projectId: string, 
    placeholders: PlaceholderCitation[]
  ): Promise<Record<string, string>> {
    try {
      const response = await fetch('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          refs: placeholders
        })
      })

      if (!response.ok) {
        throw new Error(`Batch resolution failed: ${response.status}`)
      }

      const data = await response.json()
      return data.citeKeyMap || {}
      
    } catch (error) {
      console.error('Batch placeholder resolution failed:', error)
      // Return fallback mappings
      const fallbackMap: Record<string, string> = {}
      for (const placeholder of placeholders) {
        const key = `${placeholder.type}:${placeholder.value}`
        fallbackMap[key] = placeholder.fallbackText || `(${placeholder.value})`
      }
      return fallbackMap
    }
  }
}