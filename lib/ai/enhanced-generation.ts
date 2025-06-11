import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { hybridSearchPapers, searchPaperChunks } from '@/lib/db/papers'
import { getPapersByIds } from '@/lib/db/library'
import { 
  addProjectVersion, 
  addProjectCitation,
  updateResearchProjectStatus 
} from '@/lib/db/research'
import type { 
  PaperWithAuthors, 
  GenerationConfig,
  GenerationProgress 
} from '@/types/simplified'
import { getSB } from '@/lib/supabase/server'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import { addCitation, setCitationContext, clearCitationContext } from '@/lib/ai/tools/addCitation'
import { z } from 'zod'
import { 
  GENERATION_DEFAULTS, 
  buildLiteratureSectionRegex,
  getMinCitationCoverage,
  getMinCitationFloor,
  getEvidenceSnippetLength,
  type PaperLength
} from './generation-defaults'
import { mergeWithDefaults } from './generation-config-schema'
import { logger } from '@/lib/utils/logger'

// Types for tool call events

interface CapturedToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  timestamp: string
  validated: boolean
  error?: string
}

export interface EnhancedGenerationOptions {
  projectId: string
  userId: string
  topic: string
  libraryPaperIds?: string[]
  useLibraryOnly?: boolean
  config: GenerationConfig
  onProgress?: (progress: GenerationProgress) => void
}

export interface GenerationResult {
  content: string
  citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
    pageRange?: string
  }>
  wordCount: number
  sources: PaperWithAuthors[]
  structure: {
    sections: string[]
    abstract: string
  }
  toolCallAnalytics: {
    totalToolCalls: number
    validatedToolCalls: number
    successfulToolCalls: number
    failedToolCalls: number
    invalidToolCalls: number
    addCitationCalls: number
    successfulCitations: number
    toolCallTimestamps: string[]
    errors: { type: string; toolCallId: string; error?: string }[]
  }
}

// Define better types for chunks and evidence
interface PaperChunk {
  paper_id: string
  content: string
  score?: number  // Make score optional to match reality
}

interface PaperWithEvidence {
  paper: PaperWithAuthors
  chunk: PaperChunk | null
}

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, userId, topic, libraryPaperIds = [], useLibraryOnly, config: rawConfig, onProgress } = options
  
  // Validate and merge config with defaults
  const config = mergeWithDefaults(rawConfig)
  
  logger.info('Starting enhanced paper generation', { 
    projectId, 
    topic: topic.substring(0, 100), 
    libraryPaperCount: libraryPaperIds.length,
    useLibraryOnly,
    paperSettings: config.paper_settings 
  })
  
  const log = (stage: GenerationProgress['stage'], progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
    logger.generation(stage, progress, message)
  }

  // Set up citation context for addCitation tool
  setCitationContext({ projectId, userId })
  console.log(`🔗 Citation context set for project ${projectId}, user ${userId}`)

  try {
    // Step 1: Collect papers efficiently
    log('searching', 10, 'Gathering papers from library and search...')
    console.log(`📋 Generation Request:`)
    console.log(`   📌 Project ID: ${projectId}`)
    console.log(`   🎯 Topic: "${topic}"`)
    console.log(`   📚 Pinned Library Papers: ${libraryPaperIds.length}`)
    console.log(`   🔒 Library Only Mode: ${useLibraryOnly}`)
    console.log(`   ⚙️ Target Limit: ${config?.search_parameters?.limit || 10}`)
    
    const pinnedPapers = libraryPaperIds.length > 0 
      ? await getPapersByIds(libraryPaperIds)
      : []
    
    console.log(`📚 Pinned Papers Retrieved: ${pinnedPapers.length}`)
    pinnedPapers.forEach((lp, idx) => {
      const paper = lp.paper as PaperWithAuthors
      console.log(`   ${idx + 1}. "${paper.title}" (${paper.id})`)
      console.log(`      Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
      console.log(`      Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
    })
    
    const pinnedIds = pinnedPapers.map(lp => lp.paper.id)
    const targetTotal = config?.search_parameters?.limit || 10
    const remainingSlots = Math.max(0, targetTotal - pinnedPapers.length)
    
    console.log(`🔍 Search Parameters:`)
    console.log(`   📊 Target Total Papers: ${targetTotal}`)
    console.log(`   📌 Pinned Papers: ${pinnedPapers.length}`)
    console.log(`   🆕 Remaining Slots for Discovery: ${remainingSlots}`)
    console.log(`   🚫 Excluded Paper IDs: [${pinnedIds.join(', ')}]`)

    // Fix for Library Only toggle bug - check useLibraryOnly first
    let discoveredPapers: PaperWithAuthors[] = []

    if (!useLibraryOnly) {
      if (remainingSlots > 0) {
        console.log(`🌐 Searching online APIs for fresh papers...`)
        
        // Use enhanced search that includes online APIs
        const { enhancedSearch } = await import('@/lib/services/enhanced-search')
        
        const searchResult = await enhancedSearch(topic, {
          maxResults: remainingSlots,
          useSemanticSearch: true,
          fallbackToKeyword: true,
          fallbackToAcademic: true, // This ensures online API search
          minResults: Math.min(5, remainingSlots),
          combineResults: true,
          sources: ['openalex', 'crossref', 'semantic_scholar', 'arxiv'], // Online sources
          fromYear: 2000,
          forceIngest: false // Try local first, then online
        })
        
        // Extract papers from enhanced search result  
        const rawResults = searchResult.papers.map(p => ({
          ...p,
          // Ensure proper typing
          authors: p.authors || [],
          author_names: p.author_names || []
        })) as PaperWithAuthors[]
        
        console.log(`🌐 Enhanced search found ${rawResults.length} papers (${searchResult.metadata.searchStrategies.join(', ')})`)
        console.log(`   📊 Breakdown: Vector=${searchResult.metadata.vectorResults}, Keyword=${searchResult.metadata.keywordResults}, Academic=${searchResult.metadata.academicResults}`)
        
        // Apply domain filtering to prevent off-topic papers
        discoveredPapers = filterOnTopicPapers(rawResults, topic)
        console.log(`🔧 Domain filtering: ${rawResults.length} → ${discoveredPapers.length} on-topic papers`)
      }
    }
    
    console.log(`🔍 Discovery Search Results: ${discoveredPapers.length} papers found`)
    
    // Fallback: If we got very few results, try broader searches
    const additionalPapers: PaperWithAuthors[] = []
    if (discoveredPapers.length < 5 && remainingSlots > discoveredPapers.length && !useLibraryOnly) {
      console.log(`🔄 Too few results (${discoveredPapers.length}), trying targeted broader searches...`)
      
      // Extract key terms and create targeted combinations
      const keyTerms = topic.toLowerCase().split(/\s+/).filter(term => 
        term.length > 3 && !['and', 'the', 'for', 'with', 'from', 'using', 'based'].includes(term)
      )
      
      console.log(`🔍 Extracted key terms: [${keyTerms.join(', ')}]`)
      
      // Create more targeted search combinations instead of individual terms
      const searchCombinations = []
      
      // Combine pairs of key terms for more targeted searches
      for (let i = 0; i < keyTerms.length && searchCombinations.length < 3; i++) {
        for (let j = i + 1; j < keyTerms.length && searchCombinations.length < 3; j++) {
          searchCombinations.push(`${keyTerms[i]} ${keyTerms[j]}`)
        }
      }
      
      // If no pairs possible, use top individual terms
      if (searchCombinations.length === 0) {
        searchCombinations.push(...keyTerms.slice(0, 2))
      }
      
      console.log(`🔍 Targeted search combinations: [${searchCombinations.join(', ')}]`)
      
      // Try searching with targeted combinations
      for (const searchTerm of searchCombinations) {
        try {
          const termResults = await hybridSearchPapers(searchTerm, {
            limit: Math.min(8, remainingSlots - discoveredPapers.length - additionalPapers.length),
            excludePaperIds: [...pinnedIds, ...discoveredPapers.map(p => p.id), ...additionalPapers.map(p => p.id)],
            minYear: 2000, // Broader year range for fallback
            semanticWeight: 0.6 // Slightly higher semantic weight for targeted combinations
          })
          
          // Apply more permissive domain filtering to fallback results
          const filteredTermResults = filterOnTopicPapers(termResults, topic, { permissive: true })
          console.log(`   🔍 "${searchTerm}" found ${termResults.length} papers, ${filteredTermResults.length} relevant`)
          additionalPapers.push(...filteredTermResults)
          
          if (discoveredPapers.length + additionalPapers.length >= remainingSlots) break
        } catch (error) {
          console.warn(`⚠️ Targeted search for "${searchTerm}" failed:`, error)
        }
      }
      
      console.log(`🔄 Targeted broader search found ${additionalPapers.length} additional papers`)
    }
    
    // Combine all discovered papers
    const allDiscoveredPapers = [...discoveredPapers, ...additionalPapers]
    
    console.log(`🔍 Total Discovery Results: ${allDiscoveredPapers.length} papers found`)
    allDiscoveredPapers.forEach((paper, idx) => {
      console.log(`   ${idx + 1}. "${paper.title}" (${paper.id})`)
      console.log(`      Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
      console.log(`      Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
      console.log(`      Venue: ${paper.venue || 'Unknown'}`)
      console.log(`      Source: ${paper.source || 'database'}`)
    })
    
    const allPapers = [
      ...pinnedPapers.map(lp => lp.paper as PaperWithAuthors),
      ...allDiscoveredPapers
    ]

    console.log(`📋 Final Paper Collection: ${allPapers.length} papers total`)
    console.log(`   📌 From Library: ${pinnedPapers.length}`)
    console.log(`   📄 From Discovery: ${allDiscoveredPapers.length}`)

    if (allPapers.length === 0) {
      console.error(`❌ No papers found for topic: "${topic}"`)
      console.error(`❌ Search parameters:`, { 
        limit: remainingSlots, 
        excludeIds: pinnedIds.length,
        useLibraryOnly 
      })
      throw new Error(`No papers found for topic "${topic}". Please add relevant papers to your library.`)
    }

    log('analyzing', 30, `Found ${allPapers.length} papers. Retrieving content chunks...`)

    // Step 2: Get relevant content chunks for RAG
    console.log(`📄 Searching for relevant content chunks...`)
    console.log(`   🎯 Query: "${topic}"`)
    console.log(`   📋 Paper IDs: [${allPapers.map(p => p.id).join(', ')}]`)
    console.log(`   📊 Chunk Limit: 20`)
    console.log(`   🎯 Min Score: 0.3`)
    
    // Check if papers have chunks, create them if missing (for papers added via Library Manager)
    const papersNeedingChunks = []
    const supabase = await getSB()
    
    for (const paper of allPapers) {
      const { data: existingChunks, error } = await supabase
        .from('paper_chunks')
        .select('id')
        .eq('paper_id', paper.id)
        .limit(1)
      
      if (error || !existingChunks || existingChunks.length === 0) {
        papersNeedingChunks.push(paper)
      }
    }
    
    if (papersNeedingChunks.length > 0) {
      console.log(`📄 Creating chunks for ${papersNeedingChunks.length} papers missing chunks...`)
      
      for (const paper of papersNeedingChunks) {
        try {
          // Create content chunks for RAG
          const contentChunks = []
          if (paper.abstract) {
            const abstractChunks = paper.abstract.match(/.{1,500}(?:\s|$)/g) || []
            contentChunks.push(...abstractChunks.map(chunk => chunk.trim()).filter(Boolean))
          }
          contentChunks.unshift(paper.title) // Title as first chunk
          
          // Add chunks to existing paper
          const paperDTO = {
            title: paper.title,
            abstract: paper.abstract,
            publication_date: paper.publication_date,
            venue: paper.venue,
            doi: paper.doi,
            url: paper.url,
            pdf_url: paper.pdf_url,
            metadata: paper.metadata || {},
            source: paper.source,
            citation_count: paper.citation_count,
            impact_score: paper.impact_score,
            authors: paper.authors?.map(a => a.name) || []
          }
          
          await ingestPaperWithChunks(paperDTO, contentChunks)
          console.log(`📄 Created ${contentChunks.length} chunks for: ${paper.title}`)
        } catch (error) {
          console.warn(`📄 Failed to create chunks for ${paper.title}:`, error)
        }
      }
    }
    
    // Adaptive chunk threshold - lower for papers with fresh embeddings
    const hasNewPapers = papersNeedingChunks.length > 0
    const chunkMinScore = hasNewPapers ? 0.25 : 0.3
    console.log(`📄 Using adaptive chunk threshold: ${chunkMinScore} (new papers: ${hasNewPapers})`)
    
    const chunks = await searchPaperChunks(topic, {
      paperIds: allPapers.map(p => p.id),
      limit: Math.max(50, getChunkLimit(config?.paper_settings?.length)),
      minScore: chunkMinScore
    }).catch((error) => {
      console.warn(`⚠️ Content chunks search failed:`, error)
      return []
    })

    console.log(`📄 Content Chunks Retrieved: ${chunks.length}`)
    chunks.forEach((chunk, idx) => {
      console.log(`   ${idx + 1}. Paper: ${chunk.paper_id}`)
      console.log(`      Content: "${chunk.content?.substring(0, 100) || 'N/A'}..."`)
      console.log(`      Score: ${chunk.score || 'N/A'}`)
    })

    log('writing', 40, 'Generating research paper with AI...')
    
    const systemMessage = buildSystemPrompt(config, allPapers.length)
    const userMessage = buildUserPromptWithSources(topic, allPapers, chunks)
    
    console.log(`🤖 AI Generation Setup:`)
    console.log(`   📝 System Prompt Length: ${systemMessage.length} chars`)
    console.log(`   📝 User Prompt Length: ${userMessage.length} chars`)
    console.log(`   📊 Papers in Context: ${allPapers.length}`)
    console.log(`   📄 Chunks in Context: ${chunks.length}`)
    console.log(`   🎯 Model: ${config?.model || 'gpt-4o'}`)
    console.log(`   🌡️ Temperature: ${config?.temperature || 'default'}`)
    
    // Special handling for when no chunks are available
    if (chunks.length === 0) {
      console.warn(`⚠️ No content chunks available - using simplified prompt`)
      const simplifiedUserMessage = buildUserPromptWithSources(topic, allPapers, [])
      
      const content = await streamPaperGeneration(
        systemMessage, 
        simplifiedUserMessage, 
        allPapers, 
        config,
        (progress) => log('writing', 40 + progress * 0.4, `Writing paper... ${Math.round(progress)}%`)
      )
      
      // Build a minimal GenerationResult for the simplified flow
      return {
        content,
        citations: [],
        wordCount: content.split(/\s+/).length,
        sources: allPapers,
        structure: {
          sections: extractSections(content),
          abstract: extractAbstract(content)
        },
        toolCallAnalytics: {
          totalToolCalls: 0,
          validatedToolCalls: 0,
          successfulToolCalls: 0,
          failedToolCalls: 0,
          invalidToolCalls: 0,
          addCitationCalls: 0,
          successfulCitations: 0,
          toolCallTimestamps: [],
          errors: []
        }
      }
    }
    
    const content = await streamPaperGeneration(
      systemMessage, 
      userMessage, 
      allPapers, 
      config,
      (progress) => log('writing', 40 + progress * 0.4, `Writing paper... ${Math.round(progress)}%`)
    )

    // Step 4: Capture tool call analytics from generation
    log('citations', 75, 'Analyzing tool usage and citation patterns...')
    
    // Parse actual tool calls and results from generation
    // Note: This is a simplified approach - in reality we'd need to modify streamPaperGeneration 
    // to return captured tool calls, but for now we'll track what we can
    const generationToolCalls = {
      totalToolCalls: 0,
      validatedToolCalls: 0, 
      successfulToolCalls: 0,
      failedToolCalls: 0,
      invalidToolCalls: 0,
      addCitationCalls: 0,
      toolCallTimestamps: [] as string[],
      errors: [] as Array<{ type: string; toolCallId: string; error?: string }>
    }
    
    // TODO: This should be populated from actual streamPaperGeneration results
    // For now, we'll track evidence-based citations separately
    
    logger.analytics('Generation tool analytics', generationToolCalls)

    // Step 3.5: Evidence-based citation integration
    log('citations', 80, 'Analyzing citations and adding evidence-based references...')
    
    // Extract existing citations from the generated content
    const existingCitations = content.match(/\[CITE:\s*([a-f0-9-]{36})\]/gi) || []
    const citedPaperIds = new Set(
      existingCitations.map(c => c.replace(/\[CITE:\s*([a-f0-9-]{36})\]/, '$1'))
    )
    
    console.log(`📊 Generated content has ${existingCitations.length} citations`)
    console.log(`📊 Cited papers: ${citedPaperIds.size}/${allPapers.length}`)
    
    // Determine minimum citation coverage target (configurable)
    const coverageTarget = getMinCitationCoverage(config?.paper_settings)
    const minCitationFloor = getMinCitationFloor(config?.paper_settings)
    const minCitations = Math.max(minCitationFloor, Math.floor(allPapers.length * coverageTarget))
    const currentCitations = existingCitations.length
    
    let enhancedContent = content
    let addedEvidenceCitations = 0
    
    if (currentCitations < minCitations) {
      console.log(`📈 Adding evidence-based citations (${currentCitations} < ${minCitations} target)`)
      
      // Identify uncited papers that have evidence in chunks  
      const uncitedPapers = allPapers.filter(paper => !citedPaperIds.has(paper.id))
      
      // Pre-index chunks by paper for performance
      const chunksByPaper = new Map<string, PaperChunk[]>()
      chunks.forEach(chunk => {
        if (!chunksByPaper.has(chunk.paper_id)) {
          chunksByPaper.set(chunk.paper_id, [])
        }
        chunksByPaper.get(chunk.paper_id)!.push(chunk)
      })
      
      const uncitedWithEvidence: PaperWithEvidence[] = uncitedPapers
        .map(paper => {
          // Find the highest-scoring chunk for this paper
          const paperChunks = chunksByPaper.get(paper.id) || []
          const bestChunk = paperChunks.length > 0 
            ? paperChunks.reduce((best, current) => 
                (current.score || 0) > (best.score || 0) ? current : best
              )
            : null
          
          return { paper, chunk: bestChunk }
        })
        .filter(item => item.chunk !== null) // Only include papers with evidence
        .slice(0, minCitations - currentCitations) // Limit to needed citations
      
      console.log(`📋 Uncited papers with evidence available: ${uncitedWithEvidence.length}`)
      
      // Add evidence-based citations by directly creating [CITE:paper.id] tokens
      // The addCitation tool is for foundational references, not provided papers
      for (const { paper, chunk } of uncitedWithEvidence) {
        try {
          // Check for duplicates before adding
          const duplicateRegex = new RegExp(`\\[CITE:\\s*${paper.id}\\]`, 'i')
          if (duplicateRegex.test(enhancedContent)) {
            console.log(`⚠️ Skipping duplicate citation for paper ${paper.id}`)
            continue
          }
          
          const authors = paper.author_names?.length ? paper.author_names[0] : "Unknown"
          const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : undefined
          
          // Improve evidence summary quality - clean and truncate properly  
          const rawContent = chunk!.content || ''
          const cleanedContent = rawContent
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/[<>]/g, '') // Remove HTML-like tags
            .trim()
          
          const maxLength = getEvidenceSnippetLength(config?.paper_settings)
          let evidenceSummary = cleanedContent.slice(0, maxLength)
          
          // Avoid cutting mid-word
          if (cleanedContent.length > maxLength) {
            const lastSpace = evidenceSummary.lastIndexOf(' ')
            const wordBoundaryThreshold = maxLength * GENERATION_DEFAULTS.EVIDENCE_WORD_BOUNDARY_THRESHOLD
            if (lastSpace > wordBoundaryThreshold) { // Only truncate at word boundary if reasonable
              evidenceSummary = evidenceSummary.slice(0, lastSpace)
            }
            evidenceSummary += '…'
          }
          
          // Create evidence-based sentence with direct paper citation
          const evidenceText = `\n\n${evidenceSummary} (${authors}, ${year || 'n.d.'}) [CITE:${paper.id}].`
          
          // Improved regex for Literature Review section with more flexible matching
          const litReviewRegex = buildLiteratureSectionRegex()
          const match = enhancedContent.match(litReviewRegex)
          
          if (match) {
            const sectionContent = match[1]
            const insertionPoint = match.index! + sectionContent.length
            enhancedContent = enhancedContent.slice(0, insertionPoint) + 
                             evidenceText + 
                             enhancedContent.slice(insertionPoint)
          } else {
            // Fallback: append to end with proper spacing
            enhancedContent += '\n' + evidenceText
          }
          
          // Update cited papers set for subsequent duplicate checks
          citedPaperIds.add(paper.id)
          addedEvidenceCitations++
          
          const title = paper.title.length > 50 ? paper.title.substring(0, 50) + "..." : paper.title
          const scoreText = typeof chunk?.score === 'number' ? chunk.score.toFixed(3) : 'n/a'
          logger.citation(`Added evidence-based citation: "${title}" (score: ${scoreText})`)
          
        } catch (error) {
          console.error(`Error adding evidence-based citation for ${paper.id}:`, error)
        }
      }
      
      console.log(`✅ Added ${addedEvidenceCitations} evidence-based citations`)
      
      // Warn about papers without evidence
      const papersWithoutEvidence = uncitedPapers.filter(paper => 
        !chunksByPaper.has(paper.id) || chunksByPaper.get(paper.id)!.length === 0
      )
      
      if (papersWithoutEvidence.length > 0) {
        console.warn(`⚠️ Papers without evidence (skipped): ${papersWithoutEvidence.length}`)
        papersWithoutEvidence.forEach(paper => {
          const title = paper.title.length > 50 ? paper.title.substring(0, 50) + "..." : paper.title
          console.warn(`   - "${title}" by ${paper.author_names?.[0] || "Unknown"}`)
        })
      }
      
    } else {
      console.log(`✅ Citation coverage adequate (${currentCitations}/${minCitations})`)
    }

    log('citations', 85, 'Saving to database...')

    // Step 4: Persist to database
    const version = await addProjectVersion(projectId, enhancedContent, 1)
    
    // Ensure all citations use valid UUIDs
    const validCitations = enhancedContent.match(/\[CITE:\s*([a-f0-9-]{36})\]/gi) || []
    const citationResults = await Promise.all(
      validCitations.map(async (citation) => {
        try {
          await addProjectCitation(
            projectId,
            version.version,
            citation.replace(/\[CITE:\s*([a-f0-9-]{36})\]/, '$1'),
            citation,
            undefined,
            undefined,
            undefined
          )
          return { success: true, citation }
        } catch (error) {
          console.error(`Failed to add citation for paper ${citation}:`, error)
          return { success: false, citation, error }
        }
      })
    )

    // Log any citation failures but don't fail the entire generation
    const failedCitations = citationResults.filter(result => !result.success)
    if (failedCitations.length > 0) {
      console.warn(`${failedCitations.length} citations failed to save:`, failedCitations)
    }

    const successfulCitations = citationResults
      .filter((result): result is { success: true; citation: string } => result.success)
      .map(result => result.citation)

    await updateResearchProjectStatus(projectId, 'complete')
    
    log('complete', 100, 'Paper generation completed!')

    // Re-parse citations from enhanced content to ensure database is accurate
    const finalCitationMatches = enhancedContent.match(/\[CITE:\s*([a-f0-9-]{36})\]/gi) || []
    const finalUniqueCitations = [...new Set(finalCitationMatches.map(c => c.replace(/\[CITE:\s*([a-f0-9-]{36})\]/, '$1')))]
    
    console.log(`📊 Final citation analysis:`)
    console.log(`   - Total citation tokens: ${finalCitationMatches.length}`)
    console.log(`   - Unique papers cited: ${finalUniqueCitations.length}`)
    console.log(`   - Evidence-based citations added: ${addedEvidenceCitations}`)

    return {
      content: enhancedContent,
      citations: successfulCitations.map(citationString => ({
        paperId: '',
        citationText: citationString
      })),
      wordCount: enhancedContent.split(/\s+/).length,
      sources: allPapers,
      structure: {
        sections: extractSections(enhancedContent),
        abstract: extractAbstract(enhancedContent)
      },
      toolCallAnalytics: {
        totalToolCalls: generationToolCalls.totalToolCalls,
        validatedToolCalls: generationToolCalls.validatedToolCalls,
        successfulToolCalls: generationToolCalls.successfulToolCalls,
        failedToolCalls: generationToolCalls.failedToolCalls,
        invalidToolCalls: generationToolCalls.invalidToolCalls,
        addCitationCalls: generationToolCalls.addCitationCalls,
        successfulCitations: addedEvidenceCitations, // Evidence-based citations added post-generation
        toolCallTimestamps: generationToolCalls.toolCallTimestamps,
        errors: generationToolCalls.errors
      }
    }
  } catch (error) {
    console.error(`❌ Error generating paper:`, error)
    throw error
  } finally {
    // Always clear citation context
    clearCitationContext()
    console.log(`🔗 Citation context cleared`)
  }
}


function buildSystemPrompt(config: GenerationConfig, numProvidedPapers: number): string {
  const style = config?.paper_settings?.style || 'academic';
  const citationStyle = config?.paper_settings?.citationStyle || 'apa';
  const length = config?.paper_settings?.length || 'medium';
  const includeMethodology = config?.paper_settings?.includeMethodology;

  const lengthGuidance = GENERATION_DEFAULTS.LENGTH_GUIDANCE;

  return `You are a domain-expert academic writing model with access to specialized citation tools.

Your task is to generate a comprehensive ${style} paper on the given topic following ${citationStyle.toUpperCase()} citation style.

📏 LENGTH REQUIREMENT: ${lengthGuidance[length as keyof typeof lengthGuidance]} target

🚨 CRITICAL CITATION RULES - READ CAREFULLY:
1. **ONLY USE PROVIDED PAPERS**: You have access to ${numProvidedPapers} research papers. You MUST ONLY cite these papers.
2. **NO FAKE CITATIONS**: Do NOT invent authors, dates, or papers that aren't in the provided sources
3. **NO EXTERNAL SOURCES**: Do NOT reference Smith (2020), Johnson (2019), or any other sources not explicitly provided
4. **USE TOOL FOR FOUNDATIONAL CONCEPTS**: Only use addCitation tool for widely-known foundational concepts (e.g., "machine learning", "artificial intelligence") that need basic definition citations

🛠️ CITATION METHODOLOGY:
- **For provided papers**: Use format (Author, Year) and reference by actual author names from the papers
- **For foundational concepts**: Use addCitation tool ONLY for basic definitions or seminal works
- **Example GOOD**: "According to Chandler et al. (2025), AI implementation faces significant challenges..."
- **Example BAD**: "Smith (2020) argues that..." (when Smith isn't in provided papers)

🎯 CONTENT REQUIREMENTS:
1. **Introduction**: 
   - Define the topic using foundational concepts (addCitation if needed for basic definitions)
   - Reference 2-3 provided papers to establish context
2. **Literature Review**:
   - Systematically discuss ALL provided papers
   - Group papers by themes/findings
   - Use actual author names and years from provided papers
3. **Analysis/Discussion**:
   - Synthesize findings across provided papers
   - Compare and contrast different approaches
   - Draw insights from the collective research

⚠️ WHAT TO AVOID:
- Creating fake author names (Smith, Johnson, etc.)
- Referencing years not matching the provided papers
- Using placeholder citations like "source not found"
- Inventing DOIs or publication details

${citationStyle.toUpperCase()} STYLE REQUIREMENTS:
${citationStyle === 'mla' ? `
- Use author-page citations: (Smith 123)
- Integrate authors naturally: "Smith argues that..."
- Avoid footnotes, use parenthetical citations
- Works Cited list follows specific MLA format
` : citationStyle === 'apa' ? `
- Use author-date citations: (Smith, 2023)
- Direct quotes include page numbers: (Smith, 2023, p. 15)
- Reference list follows APA 7th edition format
` : `
- Follow Chicago Manual of Style guidelines
- Use footnotes or author-date as appropriate
- Maintain consistent citation format throughout
`}

📝 STRUCTURE & QUALITY EXPECTATIONS:
- Begin with strong introduction defining key concepts
- Systematically review ALL provided papers
- Include ${includeMethodology ? 'methodology section detailing research approaches found in papers' : 'discussion of research methodologies where relevant'}
- Provide critical analysis and synthesis of provided research
- Conclude with implications based on the reviewed literature

🔬 ACADEMIC RIGOR:
- Ground all claims in the provided papers
- Use precise academic language
- Maintain logical flow and coherence
- Demonstrate deep understanding of the reviewed research
- Show connections and patterns across the provided papers

✅ REMEMBER: Only cite what's actually provided. Use real author names and years from the papers!`;
}


function buildUserPromptWithSources(
  topic: string, 
  papers: PaperWithAuthors[], 
  chunks: Array<{paper_id: string, content: string, score: number}> = []
): string {
  // Include paper metadata for accurate citations
  const papersWithMetadata = papers.map(paper => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors?.map(a => a.name) || ['Unknown'],
    year: paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown',
    venue: paper.venue,
    doi: paper.doi
  }))

  // Organize chunks by paper to encourage coverage
  const chunksByPaper = new Map<string, string[]>()
  chunks.forEach(chunk => {
    if (!chunksByPaper.has(chunk.paper_id)) {
      chunksByPaper.set(chunk.paper_id, [])
    }
    chunksByPaper.get(chunk.paper_id)?.push(chunk.content.substring(0, 200))
  })

  const contextChunks = Array.from(chunksByPaper.entries())
    .map(([paperId, paperChunks]) => 
      `[${paperId}]: ${paperChunks.join(' ... ')}`
    ).join('\n\n')

  return JSON.stringify({
    topic,
    task: 'Generate a comprehensive research paper using ONLY the provided papers',
    papers: papersWithMetadata,
    context: contextChunks,
    strict_rules: [
      'ONLY cite the provided papers - no external sources',
      'Use REAL author names and years from the papers metadata',
      'Do NOT invent Smith (2020), Johnson (2019) or other fake citations',
      'Use [CITE: paper_id] format for citations from provided papers',
      'Use addCitation tool ONLY for basic foundational concepts if absolutely needed',
      'Every citation must match an actual paper in the provided list'
    ],
    instructions: [
      'Synthesize information across ALL provided papers',
      'Create logical flow between sections using actual research findings',
      'Reference papers by their actual author names and publication years',
      'Write detailed content based on provided sources and context chunks',
      'Ensure comprehensive coverage of every provided paper',
      'Use proper academic writing style with accurate attributions'
    ],
    citation_format: {
      provided_papers: 'Use (Author, Year) format with real names from papers metadata',
      foundational_concepts: 'Use addCitation tool sparingly for basic definitions only',
      forbidden: 'No fake authors, no invented years, no external sources'
    }
  }, null, 2)
}

async function streamPaperGeneration(
  systemMessage: string,
  userMessage: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number) => void
): Promise<string> {
  
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
    maxTokens: getMaxTokens(config?.paper_settings?.length),
    experimental_telemetry: {
      isEnabled: true
    }
  })
  
  console.log(`🔧 Stream created with addCitation tool available`)
  console.log(`🔧 Tool choice: AUTO with maxSteps=5, Temperature: 0.2, Max tokens: ${getMaxTokens(config?.paper_settings?.length)}`)
  console.log(`🔧 Papers available for citation: ${papers.length}`)
  console.log(`🔧 Expected tool calls: 3-5 addCitation calls during generation`)
  console.log(`🔧 Model: ${config?.model || 'gpt-4o'}`)
  console.log(`🔧 CRITICAL: Model will use addCitation tool when referencing sources`)
  
  let content = ''
  const targetLength = getTargetLength(config?.paper_settings?.length)
  let chunkCount = 0
  let toolCallCount = 0
  let addCitationCallCount = 0
  
  // Store captured tool calls and their results
  const capturedToolCalls: CapturedToolCall[] = []
  
  // Validation function for citation tool calls
  const validateCitationArgs = (args: Record<string, unknown>): { valid: boolean; error?: string } => {
    try {
      // Validate against the citation schema from addCitation tool
      const citationSchema = z.object({
        doi: z.string().optional(),
        title: z.string().min(1, 'Title is required'),
        authors: z.array(z.string()).min(1, 'At least one author is required'),
        year: z.number().int().min(1800).max(2030).optional(),
        journal: z.string().optional(),
        pages: z.string().optional(),
        volume: z.string().optional(),
        issue: z.string().optional(),
        url: z.string().url().optional(),
        abstract: z.string().optional(),
        reason: z.string().min(1, 'Reason for citation is required'),
        section: z.string().min(1, 'Section name is required'),
        start_pos: z.number().int().min(0).optional(),
        end_pos: z.number().int().min(0).optional(),
        context: z.string().optional()
      })
      
      citationSchema.parse(args)
      return { valid: true }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { 
          valid: false, 
          error: `Validation failed: ${error.errors.map(e => e.message).join(', ')}` 
        }
      }
      return { valid: false, error: 'Unknown validation error' }
    }
  }
  
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
          
          // Log successful tool call persistence
          if (toolCall.toolName === 'addCitation' && toolCall.result && toolCall.result.success && toolCall.validated) {
            console.log(`✅ Citation tool call persisted successfully:`, {
              citationId: toolCall.result.citationId,
              citationKey: toolCall.result.citationKey,
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
  
  // Extract citations from the generated content using regex (fallback method)
  const citations: string[] = []
  const citationRegex = /\[CITE:\s*([a-f0-9-]{36})\]/gi
  const paperIdMap = new Set(papers.map(p => p.id))
  
  let match
  while ((match = citationRegex.exec(content)) !== null) {
    const paperId = match[1]
    
    // Only accept valid paper IDs to prevent constraint violations
    if (paperIdMap.has(paperId)) {
      citations.push(match[0])
    }
  }
  
  // Also extract citations from successful addCitation tool calls
  const toolCitations = capturedToolCalls
    .filter(tc => tc.toolName === 'addCitation' && tc.validated && tc.result?.success)
    .map(tc => {
      // Find where the citation appears in the content
      const citationKey = tc.result!.citationKey
      const citationPattern = new RegExp(`\\[CITE:\\s*${citationKey}\\]`, 'gi')
      const citationMatch = citationPattern.exec(content)
      
      return citationMatch ? citationMatch[0] : `[CITE:${citationKey}]`
    })
  
  // Merge tool-based citations with regex-based citations (avoid duplicates)
  const allCitations = [...citations, ...toolCitations]
  
  // Citation ratio validation - evidence-based approach
  const minCitations = Math.max(12, Math.floor(papers.length * 0.7)); // Target 70% coverage or 12, whichever is higher
  if (allCitations.length < minCitations) {
    console.warn(`⚠️ Too few citations: ${allCitations.length} < ${minCitations}. Evidence-based integration deferred to post-generation.`)
    console.warn(`💡 Papers may not be relevant enough to warrant citation, or model should have used more addCitation tool calls`)
  }
  
  console.log(`📊 Final citation count: ${allCitations.length}/${papers.length} papers cited`)
  console.log(`📊 Tool-based citations: ${toolCitations.length}`)
  console.log(`📊 Regex-based citations: ${citations.length}`)
  
  // Validate citation style compliance
  if (config?.paper_settings?.citationStyle === 'mla') {
    validateMLACitationStyle(content, allCitations)
  }
  
  return content
}

function getTargetLength(length?: PaperLength): number {
  const lengthKey = length || 'medium'
  return GENERATION_DEFAULTS.WORD_TARGETS[lengthKey].totalWords
}

function extractSections(content: string): string[] {
  const headers = content.match(/#{1,3}\s+(.+)/g) || []
  return headers.map(h => h.replace(/#{1,3}\s+/, '').trim())
}

function extractAbstract(content: string): string {
  const match = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return match ? match[1].trim() : ''
}

function getChunkLimit(length?: PaperLength): number {
  const lengthKey = length || 'medium'
  return GENERATION_DEFAULTS.CHUNK_LIMITS[lengthKey]
}

function getMaxTokens(length?: PaperLength): number {
  const lengthKey = length || 'medium'
  const wordTarget = GENERATION_DEFAULTS.WORD_TARGETS[lengthKey]
  
  const fudgeFactor = GENERATION_DEFAULTS.TOKEN_FUDGE_FACTOR
  const tokensPerWordRatio = GENERATION_DEFAULTS.TOKENS_PER_WORD_RATIO
  
  let calculatedMaxTokens = Math.floor((wordTarget.wordsPerSection * wordTarget.estimatedSections * fudgeFactor) / tokensPerWordRatio);
  
  // Cap at a safe value below the model's absolute maximum completion tokens
  const MODEL_COMPLETION_TOKEN_LIMIT = GENERATION_DEFAULTS.MODEL_COMPLETION_TOKEN_LIMIT
  
  if (calculatedMaxTokens > MODEL_COMPLETION_TOKEN_LIMIT) {
    console.warn(`Calculated maxTokens (${calculatedMaxTokens}) exceeds model limit. Capping at ${MODEL_COMPLETION_TOKEN_LIMIT}.`);
    calculatedMaxTokens = MODEL_COMPLETION_TOKEN_LIMIT;
  }
  
  return calculatedMaxTokens;
}

interface PaperWithScores extends PaperWithAuthors {
  semantic_score?: number;
  keyword_score?: number;
}

const MIN_SEMANTIC_SCORE = GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE;
const MIN_KEYWORD_SCORE = GENERATION_DEFAULTS.MIN_KEYWORD_SCORE;

// Helper function to check if scores are acceptable
function isScoreAcceptable(
  semanticScore?: number,
  keywordScore?: number,
  permissive = false
): boolean {
  const semanticThreshold = permissive ? GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE_PERMISSIVE : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? GENERATION_DEFAULTS.MIN_KEYWORD_SCORE_PERMISSIVE : MIN_KEYWORD_SCORE;
  
  // If we have a semantic score, check if it meets threshold
  if (typeof semanticScore === 'number') {
    return semanticScore >= semanticThreshold;
  }
  
  // If no semantic score but we have keyword score, check that
  if (typeof keywordScore === 'number') {
    return keywordScore >= keywordThreshold;
  }
  
  // If no scores at all, only acceptable in permissive mode or if we're being lenient
  return permissive;
}

// Helper function to check if scores indicate the paper should be dropped
function hasUnacceptableScores(
  semanticScore?: number,
  keywordScore?: number,
  permissive = false
): boolean {
  const semanticThreshold = permissive ? GENERATION_DEFAULTS.MIN_SEMANTIC_SCORE_PERMISSIVE : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? GENERATION_DEFAULTS.MIN_KEYWORD_SCORE_PERMISSIVE : MIN_KEYWORD_SCORE;
  
  // If we have both scores and both are below threshold, definitely drop
  if (typeof semanticScore === 'number' && typeof keywordScore === 'number') {
    return semanticScore < semanticThreshold && keywordScore <= keywordThreshold;
  }
  
  // If we have only semantic score and it's below threshold, drop
  if (typeof semanticScore === 'number' && typeof keywordScore !== 'number') {
    return semanticScore < semanticThreshold;
  }
  
  // If we have only keyword score and it's below threshold, drop  
  if (typeof keywordScore === 'number' && typeof semanticScore !== 'number') {
    return keywordScore <= keywordThreshold;
  }
  
  // If no scores at all, drop unless we're in permissive mode
  return !permissive;
}

function filterOnTopicPapers(
  papers: PaperWithAuthors[],
  topic: string,
  options?: { permissive?: boolean }
): PaperWithAuthors[] {
  const permissive = !!options?.permissive;
  
  // 1. Build topic tokens, dropping too-short tokens
  const topicTokens = topic
    .toLowerCase()
    .split(/\W+/)
    .filter(tok => tok.length > 2);

  // If topic is too short, skip token filtering entirely
  if (topicTokens.length === 0) {
    return papers;
  }

  // 2. Precompute regexes for whole-word matching
  const tokenRegexes = topicTokens.map(
    tok => new RegExp(`\\b${tok}\\b`, 'i')
  );

  return (papers as PaperWithScores[]).filter(paper => {
    const titleLower = paper.title?.toLowerCase() || '';
    const abstractLower = paper.abstract?.toLowerCase() || '';
    const combinedText = titleLower + ' ' + abstractLower;

    // 3. Check for at least one token match (whole-word)
    const hasTopicTokenMatch = tokenRegexes.some(rx => rx.test(combinedText));

    // 4. Check semantic/keyword scores using helper functions
    const { semantic_score: semanticScore, keyword_score: keywordScore } = paper;
    const scoresAreAcceptable = isScoreAcceptable(semanticScore, keywordScore, permissive);
    const scoresAreUnacceptable = hasUnacceptableScores(semanticScore, keywordScore, permissive);

    // 5. Decision logic: Include if EITHER token match OR acceptable scores
    // Drop only if NO token match AND scores are unacceptable
    if (!hasTopicTokenMatch && scoresAreUnacceptable) {
      // Only log if explicitly debugging
      if (process.env.NODE_ENV === 'development') {
        const scoreInfo = typeof semanticScore === 'number' || typeof keywordScore === 'number'
          ? `semantic: ${semanticScore ?? 'N/A'}, keyword: ${keywordScore ?? 'N/A'}`
          : 'no scores available';

        console.debug(
          `🚫 Filtered out: "${paper.title}" ` +
            `(tokenMatch: ${hasTopicTokenMatch}, ${scoreInfo}, mode: ${permissive ? 'permissive' : 'standard'})`
        );
      }
      return false;
    }

    // Log inclusion reasoning in debug mode
    if (process.env.NODE_ENV === 'development') {
      const reason = hasTopicTokenMatch
        ? 'token match'
        : scoresAreAcceptable
          ? 'acceptable scores'
          : 'default inclusion';
      console.debug(`✅ Including: "${paper.title}" (${reason}, mode: ${permissive ? 'permissive' : 'standard'})`);
    }

    return true;
  });
}

function validateMLACitationStyle(content: string, citations: string[]): void {
  console.log(`🔍 Validating MLA citation style compliance...`)
  
  // Check for proper parenthetical citation format in MLA
  const mlaParentheticalRegex = /\([A-Za-z]+(?:\s+\d+)?\)/g
  const parentheticalCitations = content.match(mlaParentheticalRegex) || []
  
  // Check for proper in-text integration
  const citationMarkers = citations.length
  const naturalIntegration = content.split(/[.!?]\s+/).filter(sentence => 
    sentence.includes('argues') || 
    sentence.includes('suggests') || 
    sentence.includes('reports') ||
    sentence.includes('findings') ||
    sentence.includes('according to')
  ).length
  
  console.log(`📋 MLA Style Analysis:`)
  console.log(`   📊 Total citations: ${citationMarkers}`)
  console.log(`   📝 Parenthetical citations found: ${parentheticalCitations.length}`)
  console.log(`   🔗 Natural integrations found: ${naturalIntegration}`)
  
  // Provide style recommendations
  if (parentheticalCitations.length < citationMarkers * 0.3) {
    console.warn(`⚠️ MLA Recommendation: Consider more parenthetical citations (Author Page) format`)
  }
  
  if (naturalIntegration < citationMarkers * 0.2) {
    console.warn(`⚠️ MLA Recommendation: Consider more natural author integration in sentences`)
  }
  
  console.log(`✅ MLA style validation completed`)
}
