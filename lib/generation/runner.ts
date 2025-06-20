import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { addCitation } from '@/lib/ai/tools/addCitation'
import type { PaperWithAuthors, GenerationConfig } from '@/types/simplified'
import type { SectionContext } from '@/lib/prompts/types'
import type { CapturedToolCall } from './types'
import { getMaxTokens, getTargetLength } from './config'
import { validateCitationArgs } from './validators'

export async function streamPaperGeneration(
  systemMessage: string,
  userMessage: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number) => void
): Promise<{ content: string; capturedToolCalls: CapturedToolCall[] }> {
  
  const stream = await streamText({
    model: ai(config?.model as string || 'gpt-4o'),
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    tools: {
      addCitation
    },
    toolChoice: 'auto', // Allow model to choose when to use tools vs generate text
    maxSteps: 5,
    temperature: 0.2,
    maxTokens: getMaxTokens(
      config?.paper_settings?.length,
      config?.paper_settings?.paperType
    ),
    experimental_telemetry: {
      isEnabled: true
    }
  })
  
  console.log(`🔧 Stream created with addCitation tool available`)
  console.log(`🔧 Tool choice: AUTO with maxSteps=5, Temperature: 0.2, Max tokens: ${getMaxTokens(config?.paper_settings?.length, config?.paper_settings?.paperType)}`)
  console.log(`🔧 Papers available for citation: ${papers.length}`)
  console.log(`🔧 Expected tool calls: 3-5 addCitation calls during generation`)
  console.log(`🔧 Model: ${config?.model || 'gpt-4o'}`)
  console.log(`🔧 CRITICAL: Model will use addCitation tool when referencing sources`)
  
  let content = ''
  const targetLength = getTargetLength(
    config?.paper_settings?.length,
    config?.paper_settings?.paperType
  )
  let chunkCount = 0
  let toolCallCount = 0
  let addCitationCallCount = 0
  
  // Store captured tool calls and their results
  const capturedToolCalls: CapturedToolCall[] = []
  
  // Process full stream to capture both text and tool calls
  for await (const delta of stream.fullStream) {
    switch (delta.type) {
      case 'text-delta':
        content += delta.textDelta
        chunkCount++
        
        // Report progress every 20 chunks based on content length
        if (chunkCount % 20 === 0) {
          const progress = Math.min((content.length / targetLength) * 100, 95)
          onProgress(progress)
          
          // Intermediate tool usage check
          if (chunkCount > 40 && addCitationCallCount === 0) {
            console.warn(`⚠️ WARNING: ${chunkCount} chunks processed but no addCitation calls yet!`)
            console.warn(`   📝 Content so far: ${content.length} chars`)
            console.warn(`   💡 Model should have started using addCitation tool by now`)
          }
        }
        break
        
      case 'tool-call':
        toolCallCount++
        console.log(`🔧 Tool call detected (#${toolCallCount}): ${delta.toolName}`, {
          toolCallId: delta.toolCallId,
          args: delta.args
        })
        
        // Track addCitation calls specifically
        if (delta.toolName === 'addCitation') {
          addCitationCallCount++
          console.log(`📋 addCitation called (#${addCitationCallCount}) with:`, {
            title: delta.args?.title,
            authors: delta.args?.authors,
            reason: delta.args?.reason,
            section: delta.args?.section
          })
        }
        
        // Validate tool call arguments
        let validated = false
        let validationError: string | undefined
        
        if (delta.toolName === 'addCitation') {
          const validation = validateCitationArgs(delta.args)
          validated = validation.valid
          validationError = validation.error
          
          if (!validated) {
            console.warn(`⚠️ Invalid citation tool call:`, {
              toolCallId: delta.toolCallId,
              error: validationError
            })
          } else {
            console.log(`✅ Citation tool call validated successfully:`, {
              toolCallId: delta.toolCallId,
              title: delta.args.title,
              authors: delta.args.authors
            })
          }
        } else {
          // For other tools, just mark as validated (can add more validation later)
          validated = true
        }
        
        // Store the tool call for persistence
        capturedToolCalls.push({
          toolCallId: delta.toolCallId,
          toolName: delta.toolName,
          args: delta.args,
          result: null, // Will be filled when result comes
          timestamp: new Date().toISOString(),
          validated,
          error: validationError
        })
        break
        
      case 'tool-result':
        console.log(`🔧 Tool result received: ${delta.toolCallId}`, {
          result: delta.result
        })
        
        // Find the corresponding tool call and update with result
        const toolCall = capturedToolCalls.find(tc => tc.toolCallId === delta.toolCallId)
        if (toolCall) {
          toolCall.result = delta.result
          
          // 🔥 NEW: Insert replacement text from tool result into content stream
          if (delta.result && delta.result.replacement) {
            content += delta.result.replacement
            console.log(`📝 Inserted tool replacement: "${delta.result.replacement}"`)
          }
          
          // Log successful tool call persistence
          if (toolCall.toolName === 'addCitation' && toolCall.result && toolCall.result.success && toolCall.validated) {
            console.log(`✅ Citation tool call persisted successfully:`, {
              citationId: toolCall.result.citationId,
              citationKey: toolCall.result.citationKey,
              replacement: toolCall.result.replacement,
              message: toolCall.result.message
            })
          } else if (toolCall.toolName === 'addCitation' && !toolCall.result?.success) {
            console.error(`❌ Citation tool call failed:`, {
              toolCallId: toolCall.toolCallId,
              error: toolCall.result?.error || 'Unknown error',
              validationError: toolCall.error
            })
          }
        } else {
          console.warn(`⚠️ Received tool result for unknown tool call: ${delta.toolCallId}`)
        }
        break
        
      case 'error':
        console.error(`❌ Stream error:`, delta.error)
        throw new Error(`Stream generation failed: ${delta.error}`)
        
      default:
        // Handle other delta types if needed
        break
    }
  }
  
  // Log comprehensive summary of tool calls
  const validatedCalls = capturedToolCalls.filter(tc => tc.validated)
  const successfulCalls = capturedToolCalls.filter(tc => tc.validated && tc.result && tc.result.success)
  const failedCalls = capturedToolCalls.filter(tc => tc.validated && tc.result && !tc.result.success)
  const invalidCalls = capturedToolCalls.filter(tc => !tc.validated)
  
  console.log(`🔧 Tool call comprehensive summary:`, {
    totalCalls: capturedToolCalls.length,
    validatedCalls: validatedCalls.length,
    successfulCalls: successfulCalls.length,
    failedCalls: failedCalls.length,
    invalidCalls: invalidCalls.length,
    addCitationCalls: capturedToolCalls.filter(tc => tc.toolName === 'addCitation').length
  })
  
  // Additional debugging if no tool calls were made
  if (capturedToolCalls.length === 0) {
    console.warn(`⚠️ CRITICAL: No tool calls detected during generation!`)
    console.warn(`   📝 Content length: ${content.length} chars`)
    console.warn(`   📊 Target length: ${targetLength} chars`)
    console.warn(`   🧠 Model: ${config?.model || 'gpt-4o'}`)
    console.warn(`   🌡️ Temperature: ${config?.temperature ?? 0.2}`)
    console.warn(`   🔧 Tools available: addCitation`)
    console.warn(`   📋 Expected: 3-5 addCitation calls for foundational sources`)
    console.warn(`   💡 Issue: Model may be over-relying on provided papers without citing foundational work`)
    console.warn(`   💡 Solution: System prompt emphasizes tool usage, but model needs stronger motivation`)
  } else if (addCitationCallCount === 0) {
    console.warn(`⚠️ No addCitation tool calls detected - all citations are from provided papers only`)
    console.warn(`   📋 Total tool calls: ${capturedToolCalls.length}`)
    console.warn(`   💡 This may indicate insufficient foundational literature integration`)
  } else {
    console.log(`✅ Tool usage successful: ${addCitationCallCount} addCitation calls made`)
  }
  
  // Clean up any malformed citations in the content
  content = cleanupCitations(content, papers)
  
  // Extract citations from the generated content and validate
  const citations = extractCitationsFromContent(content, papers)
  
  console.log(`📊 Final citation count: ${citations.length}/${papers.length} papers cited`)
  
  return {
    content,
    capturedToolCalls
  }
}

function extractCitationsFromContent(content: string, papers: PaperWithAuthors[]): string[] {
  const citations: string[] = []
  // Match any citation key (UUID, DOI, hash) by capturing everything up to the ]
  const citationRegex = /\[CITE:\s*([^\]]+)\]/gi
  // Map of all known keys for quick uniqueness tracking (fallback to token list if no match)
  const doiKeys = papers.map(p => p.doi).filter((d): d is string => !!d)
  const validKeys = new Set<string>([...papers.map(p => p.id), ...doiKeys])
  
  let match
  while ((match = citationRegex.exec(content)) !== null) {
    const key = match[1]
    // Accept citation if it matches any known paper id/doi, otherwise include it for count only
    if (validKeys.has(key) || key.length > 0) {
      citations.push(match[0])
    }
  }
  
  return citations
}

/**
 * Generate sections one by one with context accumulation for coherent flow
 * This maintains the benefits of section-by-section generation while preserving context
 */
export async function generateSectionsWithContext(
  topic: string,
  sectionContexts: SectionContext[],
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number, message: string) => void
): Promise<{ content: string; capturedToolCalls: CapturedToolCall[] }> {
  
  let accumulatedContent = ''
  const allCapturedToolCalls: CapturedToolCall[] = []
  const totalSections = sectionContexts.length
  
  console.log(`🔧 Starting section-by-section generation with context accumulation`)
  console.log(`🔧 Total sections: ${totalSections}`)
  console.log(`🔧 Papers available: ${papers.length}`)
  
  // Generate each section with accumulated context from previous sections
  for (let i = 0; i < sectionContexts.length; i++) {
    const sectionContext = sectionContexts[i]
    const progress = (i / totalSections) * 100
    
    onProgress(progress, `Generating ${sectionContext.title}...`)
    console.log(`📝 Generating section ${i + 1}/${totalSections}: ${sectionContext.title}`)
    
    // Build system prompt for this specific section
    const { buildSectionSystemPrompt, buildSectionUserPrompt } = await import('./prompts')
    
    const systemPrompt = buildSectionSystemPrompt(
      config,
      sectionContext.sectionKey,
      papers.length
    )
    
    // Include previous sections as context for coherent flow
    const previousContext = accumulatedContent.length > 0 
      ? `\n\n## PREVIOUS SECTIONS FOR CONTEXT:\n${accumulatedContent.substring(0, 2000)}...\n\n`
      : ''
    
    const userPrompt = buildSectionUserPrompt(
      topic,
      sectionContext,
      papers,
      config,
      previousContext
    )
    
    // Generate this section with tool support
    const { content: sectionContent, capturedToolCalls: sectionToolCalls } = await streamPaperGeneration(
      systemPrompt,
      userPrompt,
      papers,
      config,
      (sectionProgress) => {
        const overallProgress = progress + (sectionProgress / totalSections)
        onProgress(overallProgress, `Writing ${sectionContext.title}... ${Math.round(sectionProgress)}%`)
      }
    )
    
    // Add section header and content
    const sectionWithHeader = `## ${sectionContext.title}\n\n${sectionContent}\n\n`
    accumulatedContent += sectionWithHeader
    allCapturedToolCalls.push(...sectionToolCalls)
    
    console.log(`✅ Completed section: ${sectionContext.title} (${sectionContent.length} chars)`)
    
    // QUALITY CONTROL: Enforce minimum citation coverage for academic rigor
    const citationCalls = sectionToolCalls.filter(tc => tc.toolName === 'addCitation')
    if (citationCalls.length === 0) {
      // Check if this is an acceptable section to have no citations (conclusions, future work)
      const acceptableWithoutCitations = ['conclusion', 'future_work', 'acknowledgments', 'limitations']
      const isAcceptableSection = acceptableWithoutCitations.some(type => 
        sectionContext.sectionKey.toLowerCase().includes(type) || 
        sectionContext.title.toLowerCase().includes(type)
      )
      
      if (!isAcceptableSection) {
        throw new Error(
          `❌ Section "${sectionContext.title}" violates minimum citation coverage requirement. ` +
          `Academic sections must cite sources. Use addCitation tool for factual statements.`
        )
      } else {
        console.log(`✅ Section "${sectionContext.title}" correctly has no citations (${sectionContext.sectionKey})`)
      }
    } else {
      console.log(`✅ Section "${sectionContext.title}" has ${citationCalls.length} citations`)
    }
  }
  
  onProgress(100, 'Finalizing paper...')
  
  // Final consistency pass to smooth transitions
  console.log(`🔧 Running final consistency pass...`)
  const finalContent = await smoothTransitions(accumulatedContent)
  
  console.log(`✅ Paper generation complete: ${finalContent.length} chars, ${allCapturedToolCalls.length} tool calls`)
  
  return {
    content: finalContent,
    capturedToolCalls: allCapturedToolCalls
  }
}

/**
 * Smooth transitions between sections for better flow
 */
async function smoothTransitions(content: string): Promise<string> {
  // Simple transition smoothing - can be enhanced later
  const sections = content.split(/^## /gm).filter(Boolean)
  
  if (sections.length <= 1) return content
  
  // Add transition sentences between sections
  let smoothedContent = ''
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim()
    if (!section) continue
    // Prepend '## ' back except for the very first section (it's already part of the split)
    smoothedContent += (i === 0 ? '' : '## ') + section
    
    // Optional: add a concise transition if needed (disabled to avoid repetition)
    // if (i < sections.length - 1) {
    //   smoothedContent += `\n\n` // blank line separation only
    // }
    if (i < sections.length - 1) {
      smoothedContent += `\n\n` // just a blank line to separate sections cleanly
    }
  }
  
  return smoothedContent
}

/**
 * Clean up malformed citations and ensure proper formatting
 */
function cleanupCitations(content: string, papers: PaperWithAuthors[]): string {
  // Remove duplicate citation patterns
  content = content.replace(/\(([^)]+)\)\s*\(([^)]+)\)/g, '($1, $2)')
  
  // Fix malformed CITE tokens
  content = content.replace(/\[CITE:\s*([a-f0-9-]{36})\s*\]/gi, '[CITE:$1]')
  
  // Remove placeholder citations that don't match real papers
  const validPaperIds = new Set(papers.map(p => p.id))
  content = content.replace(/\[CITE:([a-f0-9-]{36})\]/gi, (match, paperId) => {
    return validPaperIds.has(paperId) ? match : ''
  })
  
  // Clean up excessive repetitive citations
  content = content.replace(/(\([^)]+\))\s*\1+/g, '$1')
  
  return content
}