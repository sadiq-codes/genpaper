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
import { createClient } from '@/lib/supabase/server'
import { ingestPaperWithChunks } from '@/lib/db/papers'

// Enhanced RAG-powered generation flow
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
}

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, topic, libraryPaperIds = [], useLibraryOnly, config, onProgress } = options
  
  const log = (stage: GenerationProgress['stage'], progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
    console.log(`🔄 [${stage.toUpperCase()}] ${progress}% - ${message}`)
  }

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

  const discoveredPapers = useLibraryOnly || remainingSlots === 0 ? [] :
    await hybridSearchPapers(topic, {
      limit: remainingSlots,
      excludePaperIds: pinnedIds,
      minYear: 2015 // Lower minimum year to get more papers
    })
  
  console.log(`🔍 Discovery Search Results: ${discoveredPapers.length} papers found`)
  
  // Fallback: If we got very few results, try broader searches
  const additionalPapers: PaperWithAuthors[] = []
  if (discoveredPapers.length < 5 && remainingSlots > discoveredPapers.length) {
    console.log(`🔄 Too few results (${discoveredPapers.length}), trying broader searches...`)
    
    // Extract key terms for broader search
    const keyTerms = topic.toLowerCase().split(/\s+/).filter(term => 
      term.length > 3 && !['and', 'the', 'for', 'with', 'from'].includes(term)
    )
    
    console.log(`🔍 Extracted key terms: [${keyTerms.join(', ')}]`)
    
    // Try searching with individual key terms
    for (const term of keyTerms.slice(0, 3)) { // Limit to top 3 terms
      try {
        const termResults = await hybridSearchPapers(term, {
          limit: Math.min(10, remainingSlots - discoveredPapers.length - additionalPapers.length),
          excludePaperIds: [...pinnedIds, ...discoveredPapers.map(p => p.id), ...additionalPapers.map(p => p.id)],
          minYear: 2010, // Even broader year range
          semanticWeight: 0.5 // Lower semantic weight for broader matching
        })
        
        console.log(`   🔍 "${term}" found ${termResults.length} additional papers`)
        additionalPapers.push(...termResults)
        
        if (discoveredPapers.length + additionalPapers.length >= remainingSlots) break
      } catch (error) {
        console.warn(`⚠️ Broad search for "${term}" failed:`, error)
      }
    }
    
    console.log(`🔄 Broader search found ${additionalPapers.length} additional papers`)
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
  const supabase = await createClient()
  
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
  
  const chunks = allPapers.length > 0 
    ? await searchPaperChunks(topic, {
        paperIds: allPapers.map(p => p.id),
        limit: 20,
        minScore: 0.3
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
  const systemMessage = buildSystemPrompt(config)
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

  await Promise.all(
    validCitations.map(citation =>
      addProjectCitation(
        projectId,
        version.version,
        citation.paperId,
        citation.citationText,
        citation.positionStart,
        citation.positionEnd,
        citation.pageRange
      )
    )
  )

  await updateResearchProjectStatus(projectId, 'complete')
  
  log('complete', 100, 'Paper generation completed!')

  return {
    content: result.content,
    citations: validCitations,
    wordCount: result.content.split(/\s+/).length,
    sources: allPapers,
    structure: {
      sections: extractSections(result.content),
      abstract: extractAbstract(result.content)
    }
  }
}

function buildSystemPrompt(config: GenerationConfig): string {
  const style = config?.paper_settings?.style || 'academic'
  const citationStyle = config?.paper_settings?.citationStyle || 'apa'
  const length = config?.paper_settings?.length || 'medium'
  
  const lengthGuidance = {
    short: '1,500-2,500 words with 3-4 sections',
    medium: '3,000-5,000 words with 5-6 sections',
    long: '6,000-10,000 words with 7-8 sections'
  }
  
  return `You are an expert academic writing assistant. Write a comprehensive ${style} research paper.

REQUIREMENTS:
- Length: ${lengthGuidance[length as keyof typeof lengthGuidance]}
- Citation style: ${citationStyle}
- Use ONLY the provided sources
- Include inline citations in the text using [CITE: paper_id] format
- Include: Abstract, Introduction, Literature Review, ${config?.paper_settings?.includeMethodology ? 'Methodology, ' : ''}Results, Discussion, Conclusion
- Maintain academic rigor and clear structure

CITATION FORMAT:
- Use [CITE: paper_id] markers directly in the text where citations are needed
- Example: "Recent studies have shown significant improvements [CITE: 123e4567-e89b-12d3-a456-426614174000] in this area."
- Place citations at the end of sentences or after specific claims

Generate a thorough, well-researched paper based on the provided sources with proper inline citations.`
}

function buildUserPromptWithSources(
  topic: string, 
  papers: PaperWithAuthors[], 
  chunks: Array<{paper_id: string, content: string, score: number}> = []
): string {
  const sources = papers.map(paper => ({
    id: paper.id,
    title: paper.title,
    authors: paper.author_names?.join(', ') || 'Unknown',
    year: paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown',
    abstract: paper.abstract?.substring(0, 300) + '...'
  }))

  const contextChunks = chunks.slice(0, 10).map(chunk => 
    `[${chunk.paper_id}]: ${chunk.content.substring(0, 200)}...`
  ).join('\n\n')

  return JSON.stringify({
    topic,
    task: 'Generate a comprehensive research paper',
    sources,
    context: contextChunks,
    instructions: [
      'Synthesize information across all sources',
      'Use [CITE: paper_id] format for citations',
      'Create logical flow between sections',
      'Write comprehensive content based on provided sources'
    ]
  }, null, 2)
}

async function streamPaperGeneration(
  systemMessage: string,
  userMessage: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number) => void
): Promise<{ content: string; citations: GenerationResult['citations'] }> {
  
  const stream = await streamText({
    model: ai(config?.model as string || 'gpt-4o'),
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3
  })
  
  let content = ''
  const targetLength = getTargetLength(config?.paper_settings?.length)
  let chunkCount = 0
  
  // Process text stream directly for much simpler and more reliable generation
  for await (const chunk of stream.textStream) {
    content += chunk
    chunkCount++
    
    // Report progress every 20 chunks based on content length
    if (chunkCount % 20 === 0) {
      const progress = Math.min((content.length / targetLength) * 100, 95)
      onProgress(progress)
    }
  }
  
  // Extract citations from the generated content using regex
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
  
  return { content, citations }
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