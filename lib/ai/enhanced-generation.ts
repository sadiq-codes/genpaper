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

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, userId, topic, libraryPaperIds = [], useLibraryOnly, config, onProgress } = options
  
  const log = (stage: GenerationProgress['stage'], progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
    console.log(`🔄 [${stage.toUpperCase()}] ${progress}% - ${message}`)
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
          fromYear: 2015,
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
            minYear: 2010, // Broader year range for fallback
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
    
    const chunks = allPapers.length > 0 
      ? await searchPaperChunks(topic, {
          paperIds: allPapers.map(p => p.id),
          limit: Math.max(50, getChunkLimit(config?.paper_settings?.length)),
          minScore: chunkMinScore
        }).catch((error) => {
          console.warn(`⚠️ Content chunks search failed:`, error)
          return []
        })
      : []

    console.log(`📄 Content Chunks Retrieved: ${chunks.length}`)
    chunks.forEach((chunk, idx) => {
      console.log(`   ${idx + 1}. Paper: ${chunk.paper_id}`)
      console.log(`      Content: "${chunk.content.substring(0, 100)}..."`)
      console.log(`      Score: ${chunk.score || 'N/A'}`)
    })

    log('writing', 40, 'Generating research paper with AI...')

    // Step 3: Build prompts and stream generation
    const systemMessage = buildSystemPrompt(config, allPapers.length)
    const userMessage = buildUserPromptWithSources(topic, allPapers, chunks)
    
    console.log(`🤖 AI Generation Setup:`)
    console.log(`   📝 System Prompt Length: ${systemMessage.length} chars`)
    console.log(`   📝 User Prompt Length: ${userMessage.length} chars`)
    console.log(`   📊 Papers in Context: ${allPapers.length}`)
    console.log(`   📄 Chunks in Context: ${chunks.length}`)
    console.log(`   🎯 Model: ${config?.model || 'gpt-4o'}`)
    console.log(`   🌡️ Temperature: ${config?.temperature || 0.3}`)
    
    const result = await streamPaperGeneration(
      systemMessage, 
      userMessage, 
      allPapers, 
      config,
      (progress) => log('writing', 40 + progress * 0.4, `Writing paper... ${Math.round(progress)}%`)
    )

    log('citations', 85, 'Saving to database...')

    // Step 4: Persist to database
    const version = await addProjectVersion(projectId, result.content, 1)
    
    // Ensure all citations use valid UUIDs
    const validCitations = result.citations.filter(c => 
      allPapers.some(p => p.id === c.paperId)
    )

    // Improved error handling - process citations individually to prevent batch failures
    const citationResults = await Promise.all(
      validCitations.map(async (citation) => {
        try {
          await addProjectCitation(
            projectId,
            version.version,
            citation.paperId,
            citation.citationText,
            citation.positionStart,
            citation.positionEnd,
            citation.pageRange
          )
          return { success: true, citation }
        } catch (error) {
          console.error(`Failed to add citation for paper ${citation.paperId}:`, error)
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
      .filter((result): result is { success: true; citation: typeof validCitations[0] } => result.success)
      .map(result => result.citation)

    await updateResearchProjectStatus(projectId, 'complete')
    
    log('complete', 100, 'Paper generation completed!')

    return {
      content: result.content,
      citations: successfulCitations,
      wordCount: result.content.split(/\s+/).length,
      sources: allPapers,
      structure: {
        sections: extractSections(result.content),
        abstract: extractAbstract(result.content)
      },
      toolCallAnalytics: result.toolCallAnalytics
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

  const WORD_TARGET = { short: 400, medium: 900, long: 1600 };
  const wordTarget = WORD_TARGET[length as keyof typeof WORD_TARGET];

  const lengthGuidance = {
    short: '1,500–2,500 words (≈3–4 sections)',
    medium: '3,000–5,000 words (≈5–6 sections)',
    long: '6,000–10,000 words (≈7–8 sections)',
  };

  return `You are a domain-expert academic writing model.

Your task is to generate a structured, citation-rich ${style} research paper based strictly on the provided materials.
You have been provided with ${numProvidedPapers} initial research papers.

🧠 OBJECTIVE:
Produce a coherent, logically argued, and academically rigorous paper that follows best practices in scholarly writing.

📏 LENGTH:
- Target: ${lengthGuidance[length as keyof typeof lengthGuidance]}
- Section Target: Write ≈${wordTarget} words per major section
- Break text into 3-4 paragraphs per section with sub-headings & bullet lists where helpful

🧱 STRUCTURE:
Include the following sections in this order:
1. Abstract
2. Introduction
3. Literature Review
${includeMethodology ? '4. Methodology\n' : ''}4${includeMethodology ? '' : '.'}. Results
5. Discussion
6. Conclusion

🎓 STYLE:
- Use formal, academic tone throughout
- Ensure clarity, precision, and logical flow
- Avoid first-person perspective and rhetorical questions

🔖 CITATION REQUIREMENTS:
- **CRITICAL**: Incorporate at least 12 distinct sources and cite each with [CITE:id]. Aim for 4+ sources per major section.
- **MANDATORY**: Every paragraph must end with at least one [CITE:id] citation
- Inline citations must use the format: **[CITE: paper_id]** (for the ${numProvidedPapers} provided papers) or **[CITE: citation_key]** (for new sources added via tool).
- Example for provided paper: "Recent advances show promise [CITE: 123e4567-e89b-12d3-a456-426614174000]."
- Example for new source added via tool: "This aligns with foundational work [CITE: chambers1997]."
- Place citations immediately after the relevant claim, data point, or quote.
- Papers unused after draft will be explicitly summarized in the Discussion section.
- **DO NOT INVENT OR HALLUCINATE CITATIONS** - Use only provided sources or the addCitation tool.

📚 CITATION TOOLS - CRITICAL INSTRUCTIONS:
- **PRIMARY RULE**: For the ${numProvidedPapers} papers provided to you initially, cite them directly using their existing paper IDs (e.g., [CITE: 123e4567-e89b-12d3-a456-426614174000]).
- **SECONDARY RULE AND ABSOLUTELY CRITICAL**: Whenever you refer to a new source that is NOT among the ${numProvidedPapers} initially provided papers, you MUST use the **addCitation({ title, authors, year, ... })** tool with full metadata.
- **FORBIDDEN**: Do NOT simply invent [CITE: ...] tokens for sources not provided. This will break the system. You MUST call the addCitation tool.
- **When to use addCitation**:
  * Landmark/seminal studies NOT in the ${numProvidedPapers} provided papers.
  * Foundational methodological references NOT in the ${numProvidedPapers} provided papers.
  * Widely-cited statistical techniques or frameworks NOT in the ${numProvidedPapers} provided papers.
  * Essential background studies that establish the field but are NOT in the ${numProvidedPapers} provided papers.
- **How to use addCitation**:
  * Call addCitation with complete metadata: title, authors, year, journal, DOI (if known).
  * Explain in the "reason" field why this citation is necessary (e.g., "Citing original work for X method").
  * Specify the exact section and approximate start/end character positions in your draft where the citation concept is discussed.
  * After a successful addCitation tool call, the system will provide a new 'citation_key'. You MUST then use this key in your text: [CITE:citation_key].
- **Example workflow for a NEW source**:
  1. You identify the need: "I need to cite the original MRSA resistance study by Chambers (1997), which was not in the initial set of papers."
  2. You call the tool: addCitation({ title: "Methicillin-resistant Staphylococcus aureus: molecular characterization, clinical significance, and new treatment options", authors: ["Chambers HF"], year: 1997, journal: "Emerg Infect Dis", reason: "Citing seminal paper on MRSA characterization", section: "Introduction", start_pos: 150, end_pos: 180, context: "The emergence of MRSA posed a significant challenge..." })
  3. The tool returns a key, e.g., 'chambers1997'.
  4. You use this key in your text: "...posed a significant challenge [CITE:chambers1997]."
- **Remember**: Every citation must either reference one of the ${numProvidedPapers} provided paper IDs OR be a result from a successful addCitation tool call using its new citation_key.

🧠 REMEMBER:
- Prioritize factual accuracy, clarity, and argumentative depth.
- Make sure each section transitions smoothly into the next.
- Follow ${citationStyle.toUpperCase()} citation conventions for formatting if needed.
- Ensure comprehensive coverage of all provided sources.
- Dense citation coverage is required - aim for multiple citations per paragraph and at least 4 distinct sources per major section.
- **CITATION INTEGRITY**: Never fabricate citations - use tools or provided sources only.

Begin writing when ready. Respond only with the paper content.`;
}


function buildUserPromptWithSources(
  topic: string, 
  papers: PaperWithAuthors[], 
  chunks: Array<{paper_id: string, content: string, score: number}> = []
): string {
  // Pass IDs only to prevent prompt truncation
  const sourceIds = papers.map(paper => paper.id)

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
    task: 'Generate a comprehensive research paper',
    sources: sourceIds,
    context: contextChunks,
    instructions: [
      'Synthesize information across ALL provided sources',
      'Use [CITE: paper_id] format for citations',
      'Create logical flow between sections',
      'Ensure comprehensive coverage of every source',
      'Write detailed content based on provided sources'
    ]
  }, null, 2)
}

async function streamPaperGeneration(
  systemMessage: string,
  userMessage: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number) => void
): Promise<{ 
  content: string; 
  citations: GenerationResult['citations'];
  toolCallAnalytics: {
    totalToolCalls: number;
    validatedToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    invalidToolCalls: number;
    addCitationCalls: number;
    successfulCitations: number;
    toolCallTimestamps: string[];
    errors: { type: string; toolCallId: string; error?: string }[];
  }
}> {
  
  const stream = await streamText({
    model: ai(config?.model as string || 'gpt-4o'),
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    tools: {
      addCitation
    },
    toolChoice: 'auto', // Explicitly allow tool usage
    temperature: config?.temperature ?? 0.3, // Use configured temperature
    maxTokens: getMaxTokens(config?.paper_settings?.length)
  })
  
  console.log(`🔧 Stream created with addCitation tool available`)
  console.log(`🔧 Tool choice: auto, Temperature: ${config?.temperature ?? 0.3}, Max tokens: ${getMaxTokens(config?.paper_settings?.length)}`)
  console.log(`🔧 Papers available for citation: ${papers.length}`)
  
  let content = ''
  const targetLength = getTargetLength(config?.paper_settings?.length)
  let chunkCount = 0
  let toolCallCount = 0
  
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
        start_pos: z.number().int().min(0),
        end_pos: z.number().int().min(0),
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
        }
        break
        
      case 'tool-call':
        toolCallCount++
        console.log(`🔧 Tool call detected (#${toolCallCount}): ${delta.toolName}`, {
          toolCallId: delta.toolCallId,
          args: delta.args
        })
        
        // Additional debugging for addCitation specifically
        if (delta.toolName === 'addCitation') {
          console.log(`📋 addCitation called with:`, {
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
    console.warn(`⚠️ No tool calls detected during generation!`)
    console.warn(`   📝 Content length: ${content.length} chars`)
    console.warn(`   📊 Target length: ${targetLength} chars`)
    console.warn(`   🧠 Model: ${config?.model || 'gpt-4o'}`)
    console.warn(`   🌡️ Temperature: 0.3`)
    console.warn(`   🔧 Tools available: addCitation`)
    console.warn(`   💡 Consider: Model may need stronger prompting to use tools`)
  }
  
  // Extract citations from the generated content using regex (fallback method)
  const citations: GenerationResult['citations'] = []
  const citationRegex = /\[CITE:\s*([a-f0-9-]{36})\]/gi
  const paperIdMap = new Set(papers.map(p => p.id))
  
  let match
  while ((match = citationRegex.exec(content)) !== null) {
    const paperId = match[1]
    
    // Only accept valid paper IDs to prevent constraint violations
    if (paperIdMap.has(paperId)) {
      citations.push({
        paperId: paperId,
        citationText: match[0], // The full [CITE: paper_id] text
        positionStart: match.index,
        positionEnd: match.index + match[0].length
      })
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
      
      return {
        paperId: citationKey as string, // Use the citation key as the paper ID
        citationText: citationMatch ? citationMatch[0] : `[CITE:${citationKey}]`,
        positionStart: citationMatch ? citationMatch.index : undefined,
        positionEnd: citationMatch ? citationMatch.index + citationMatch[0].length : undefined,
        toolCallId: tc.toolCallId,
        persistedInDb: true,
        validated: true
      }
    })
  
  // Merge tool-based citations with regex-based citations (avoid duplicates)
  const allCitations = [...citations]
  for (const toolCitation of toolCitations) {
    if (!citations.some(c => c.citationText === toolCitation.citationText)) {
      allCitations.push(toolCitation)
    }
  }
  
  // Citation ratio validation - ensure minimum coverage
  const minCitations = Math.max(12, Math.floor(papers.length * 0.7)); // Target 70% coverage or 12, whichever is higher
  if (allCitations.length < minCitations) {
    console.warn(`⚠️ Too few citations: ${allCitations.length} < ${minCitations}. Adding forced citations...`)
    
    // Forced citing shim - ensure every paper is referenced at least once
    const citedPaperIds = new Set(allCitations.map(c => c.paperId))
    const targetLength = getTargetLength(config?.paper_settings?.length)
    
    for (const paper of papers) {
      if (!citedPaperIds.has(paper.id) && content.length < targetLength * 1.2) {
        const forcedCitation = `\n\nAdditional insight from ${paper.title} [CITE:${paper.id}].`
        content += forcedCitation
        
        allCitations.push({
          paperId: paper.id,
          citationText: `[CITE:${paper.id}]`,
          positionStart: content.length - forcedCitation.length + forcedCitation.indexOf('[CITE:'),
          positionEnd: content.length - 1
        })
        
        citedPaperIds.add(paper.id)
        console.log(`📌 Added forced citation for: ${paper.title}`)
      }
    }
    
    // If still too few citations after forced citing, throw error for retry
    if (allCitations.length < minCitations) {
      throw new Error(`Too few citations – retry: ${allCitations.length} < ${minCitations}`)
    }
  }
  
  console.log(`📊 Final citation count: ${allCitations.length}/${papers.length} papers cited`)
  console.log(`📊 Tool-based citations: ${toolCitations.length}`)
  console.log(`📊 Regex-based citations: ${citations.length}`)
  
  // Create tool call analytics for potential future use
  const toolCallAnalytics = {
    totalToolCalls: capturedToolCalls.length,
    validatedToolCalls: validatedCalls.length,
    successfulToolCalls: successfulCalls.length,
    failedToolCalls: failedCalls.length,
    invalidToolCalls: invalidCalls.length,
    addCitationCalls: capturedToolCalls.filter(tc => tc.toolName === 'addCitation').length,
    successfulCitations: toolCitations.length,
    toolCallTimestamps: capturedToolCalls.map(tc => tc.timestamp),
    errors: [
      ...failedCalls.map(tc => ({ type: 'failed', toolCallId: tc.toolCallId, error: tc.result?.error as string })),
      ...invalidCalls.map(tc => ({ type: 'invalid', toolCallId: tc.toolCallId, error: tc.error }))
    ]
  }
  
  console.log(`📊 Tool call analytics:`, toolCallAnalytics)
  
  return { content, citations: allCitations, toolCallAnalytics }
}

function getTargetLength(length?: string): number {
  const targets = { short: 2000 * 6, medium: 4000 * 6, long: 8000 * 6 }
  return targets[length as keyof typeof targets] || targets.medium
}

function extractSections(content: string): string[] {
  const headers = content.match(/#{1,3}\s+(.+)/g) || []
  return headers.map(h => h.replace(/#{1,3}\s+/, '').trim())
}

function extractAbstract(content: string): string {
  const match = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return match ? match[1].trim() : ''
}

function getChunkLimit(length?: string): number {
  const limits = { short: 20, medium: 40, long: 80 }
  return limits[length as keyof typeof limits] || limits.medium
}

function getMaxTokens(length?: string): number {
  const WORD_TARGET = { short: 400, medium: 900, long: 1600 }; // Words per section
  const wordTarget = WORD_TARGET[length as keyof typeof WORD_TARGET] || WORD_TARGET.medium;
  
  const fudgeFactor = 2.2; // Adjusted from 2.8 to stay within model limits
  const tokensPerWordRatio = 0.75; // Assumes ~0.75 tokens per word (or 1.33 words per token)
  const estimatedSections = 6;
  
  let calculatedMaxTokens = Math.floor((wordTarget * estimatedSections * fudgeFactor) / tokensPerWordRatio);
  
  // Cap at a safe value below the model's absolute maximum completion tokens (e.g., 16384 for gpt-4o variants)
  const MODEL_COMPLETION_TOKEN_LIMIT = 16000; // Leave a small buffer from 16384
  
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

const MIN_SEMANTIC_SCORE = 0.1;
const MIN_KEYWORD_SCORE = 0.01;

// Helper function to check if scores are acceptable
function isScoreAcceptable(
  semanticScore?: number,
  keywordScore?: number,
  permissive = false
): boolean {
  const semanticThreshold = permissive ? 0.05 : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? 0 : MIN_KEYWORD_SCORE;
  
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
  const semanticThreshold = permissive ? 0.05 : MIN_SEMANTIC_SCORE;
  const keywordThreshold = permissive ? 0 : MIN_KEYWORD_SCORE;
  
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
