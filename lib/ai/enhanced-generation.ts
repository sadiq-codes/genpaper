import { openai } from '@/lib/ai/sdk'
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

// Task 4: Enhanced RAG-powered generation flow
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

export interface GenerationContext {
  papers: PaperWithAuthors[]
  pinnedPapers: PaperWithAuthors[]
  discoveredPapers: PaperWithAuthors[]
  relevantChunks: Array<{
    paper_id: string
    content: string
    score: number
  }>
}

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, userId, topic, libraryPaperIds, useLibraryOnly, config, onProgress } = options
  
  // Step 1: Generate embedding for the topic
  onProgress?.({
    stage: 'searching',
    progress: 5,
    message: 'Analyzing research topic...'
  })
  
  // Generate embedding for potential future use
  await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: topic
  })
  
  // Step 2: Gather papers using semantic search
  let papers: PaperWithAuthors[] = []
  const pinnedPaperIds: string[] = []
  
  // Get papers from library if specified (these are "pinned" papers)
  if (libraryPaperIds && libraryPaperIds.length > 0) {
    onProgress?.({
      stage: 'searching',
      progress: 10,
      message: 'Retrieving pinned papers from your library...'
    })
    
    const libraryPapers = await getPapersByIds(libraryPaperIds)
    const selectedLibraryPapers = libraryPapers
      .map(lp => lp.paper as PaperWithAuthors)
    
    papers = selectedLibraryPapers
    pinnedPaperIds.push(...selectedLibraryPapers.map(p => p.id))
    
    onProgress?.({
      stage: 'searching',
      progress: 15,
      message: `Added ${selectedLibraryPapers.length} pinned papers from your library.`
    })
  }
  
  // Search for additional papers using semantic search if not library-only
  // Task 6: Exclude pinned papers from similarity ranking to avoid duplicates
  if (!useLibraryOnly) {
    onProgress?.({
      stage: 'searching',
      progress: 20,
      message: 'Performing semantic search for relevant papers (excluding pinned papers)...'
    })
    
    try {
      // Use hybrid search for best results (combines semantic + keyword)
      const searchResults = await hybridSearchPapers(topic, {
        limit: config?.search_parameters?.limit || 10,
        minYear: 2018,
        sources: config?.search_parameters?.sources,
        semanticWeight: 0.7, // Prefer semantic matches
        excludePaperIds: pinnedPaperIds // Task 6: Exclude pinned papers to avoid duplicates
      })
      
      onProgress?.({
        stage: 'analyzing',
        progress: 30,
        message: `Found ${searchResults.length} additional papers via semantic search. Filtering for quality...`
      })
      
      // Filter and rank by relevance and quality
      const qualityFiltered = searchResults.filter(paper => {
        const relevanceScore = (paper as any).relevance_score
        return !pinnedPaperIds.includes(paper.id) && // Double-check exclusion
          relevanceScore && relevanceScore > 0.6 && // High semantic relevance
          (paper.citation_count || 0) > 5 // Minimum citation threshold
      })
      
      papers = [...papers, ...qualityFiltered.slice(0, 10)]
      
      // If no semantic results found, fallback to mock search for demo purposes
      if (searchResults.length === 0) {
        onProgress?.({
          stage: 'searching',
          progress: 25,
          message: 'No papers in database yet. Using demo papers for testing...'
        })
        
        // Import and use the existing search function as fallback
        const { searchOnlinePapers } = await import('@/lib/ai/search-papers')
        const mockResults = await searchOnlinePapers(
          topic,
          config?.search_parameters?.sources,
          config?.search_parameters?.limit
        )
        
        // Filter out any mock papers that match pinned papers by title similarity
        const filteredMockResults = mockResults.filter(mockPaper => 
          !papers.some(pinnedPaper => 
            pinnedPaper.title.toLowerCase().includes(mockPaper.title.toLowerCase().substring(0, 20)) ||
            mockPaper.title.toLowerCase().includes(pinnedPaper.title.toLowerCase().substring(0, 20))
          )
        )
        
        papers = [...papers, ...filteredMockResults.slice(0, 5)]
      }
    } catch (error) {
      console.error('Semantic search failed, falling back to mock search:', error)
      
      onProgress?.({
        stage: 'searching',
        progress: 25,
        message: 'Semantic search unavailable. Using demo papers (excluding duplicates)...'
      })
      
      // Fallback to mock search
      const { searchOnlinePapers } = await import('@/lib/ai/search-papers')
      const mockResults = await searchOnlinePapers(
        topic,
        config?.search_parameters?.sources,
        config?.search_parameters?.limit
      )
      
      // Filter out duplicates based on title similarity
      const filteredMockResults = mockResults.filter(mockPaper => 
        !papers.some(pinnedPaper => 
          pinnedPaper.title.toLowerCase().includes(mockPaper.title.toLowerCase().substring(0, 20)) ||
          mockPaper.title.toLowerCase().includes(pinnedPaper.title.toLowerCase().substring(0, 20))
        )
      )
      
      papers = [...papers, ...filteredMockResults.slice(0, 5)]
    }
  }
  
  if (papers.length === 0) {
    // Enhanced debugging - check database state
    console.log('DEBUG: No papers found. Checking database state...')
    
    // Check if there are any papers at all in the database
    const { searchPapers } = await import('@/lib/db/papers')
    const allPapers = await searchPapers({ query: '', limit: 5 })
    
    console.log('DEBUG: Total papers in database:', allPapers.length)
    if (allPapers.length > 0) {
      console.log('DEBUG: Sample papers:', allPapers.map(p => ({
        id: p.id,
        title: p.title?.substring(0, 50),
        hasEmbedding: !!(p as any).embedding
      })))
    }
    
    // Give a more helpful error message with specific guidance
    let errorMessage = `No papers found for topic "${topic}".`
    
    if (allPapers.length === 0) {
      errorMessage += `\n\n🔍 Database is empty - please upload some papers first:
      1. Go to your Library
      2. Upload PDF papers related to your research topic
      3. Wait for processing to complete
      4. Try generating your paper again`
    } else {
      const papersWithEmbeddings = allPapers.filter(p => !!(p as any).embedding)
      if (papersWithEmbeddings.length === 0) {
        errorMessage += `\n\n⚡ Found ${allPapers.length} papers but none have embeddings yet:
        1. This might be due to recent database updates
        2. Try re-uploading a paper to trigger embedding generation
        3. Check the console for any vector dimension errors`
      } else {
        errorMessage += `\n\n🎯 Found ${allPapers.length} papers (${papersWithEmbeddings.length} with embeddings) but topic too specific:
        1. Try using broader research terms
        2. Check if your topic matches existing paper content
        3. Add more papers related to "${topic}" to your library`
      }
    }
    
    throw new Error(errorMessage)
  }
  
  // Step 3: Build enhanced prompt with semantic context
  onProgress?.({
    stage: 'writing',
    progress: 35,
    message: `Processing ${papers.length} papers (${pinnedPaperIds.length} pinned, ${papers.length - pinnedPaperIds.length} discovered) for content generation...`
  })
  
  const systemMessage = buildSystemPrompt(config)
  const userMessage = buildUserPromptWithSources(topic, papers)
  
  // Step 4: Stream generation with chunking
  onProgress?.({
    stage: 'writing',
    progress: 45,
    message: 'Starting AI-powered paper generation...'
  })
  
  const result = await generatePaperWithSources(
    systemMessage,
    userMessage,
    papers,
    config,
    (progress: number, stage: string, content: string) => {
      onProgress?.({
        stage: stage as any,
        progress: 45 + (progress * 0.45), // Map to 45-90%
        message: `Writing ${stage} section...`,
        content
      })
    }
  )
  
  // Step 5: Save to database with chunking
  onProgress?.({
    stage: 'citations',
    progress: 90,
    message: 'Saving paper and processing citations...'
  })
  
  // Save final version and citations
  const version = await addProjectVersion(projectId, result.content, 1)
  
  const citations = result.citations.map(citation => ({
    paperId: citation.paperId,
    citationText: citation.citationText,
    positionStart: citation.positionStart,
    positionEnd: citation.positionEnd,
    pageRange: citation.pageRange
  }))
  
  // Save citations to database
  await Promise.all(
    citations.map(citation =>
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
  
  // Update project status
  await updateResearchProjectStatus(projectId, 'complete')
  
  onProgress?.({
    stage: 'complete',
    progress: 100,
    message: 'Paper generation completed successfully!'
  })
  
  return {
    content: result.content,
    citations,
    wordCount: result.wordCount,
    sources: papers,
    structure: result.structure
  }
}

function buildSystemPrompt(config: GenerationConfig): string {
  const style = config?.paper_settings?.style || 'academic'
  const citationStyle = config?.paper_settings?.citationStyle || 'apa'
  const length = config?.paper_settings?.length || 'medium'
  
  // Provide specific length guidance
  const lengthGuidance = {
    short: 'Write a focused 1,500-2,500 word paper with 3-4 main sections',
    medium: 'Write a comprehensive 3,000-5,000 word paper with 5-6 detailed sections',
    long: 'Write an extensive 6,000-10,000 word paper with 7-8 comprehensive sections'
  }
  
  return `You are an expert academic writing assistant specialized in creating high-quality research papers.

WRITING GUIDELINES:
- Style: ${style} writing with appropriate tone and structure
- Citation format: ${citationStyle} style citations
- Length: ${lengthGuidance[length as keyof typeof lengthGuidance]}
- Use only the provided sources for citations
- Maintain academic rigor and objectivity
- Write comprehensive sections with detailed analysis

CITATION REQUIREMENTS:
- Cite sources as (Author, Year) in text
- Use [CITE: paper_id] placeholders for reference tracking
- Include a comprehensive References section
- Ensure all claims are properly supported

STRUCTURE REQUIREMENTS:
${config?.paper_settings?.includeMethodology ? '- Include a detailed Methodology section' : ''}
- Provide clear section headers
- Maintain logical flow between sections
- Include an abstract summarizing key findings
- Develop each section thoroughly with proper depth

Generate a comprehensive research paper based on the provided topic and sources. Use the full content of the provided sources to create a thorough, well-researched paper.`
}

function buildUserPromptWithSources(topic: string, papers: PaperWithAuthors[]): string {
  const sources = papers.map((paper) => ({
    id: paper.id,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.author_names?.join(', '),
    year: paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown',
    venue: paper.venue,
    doi: paper.doi,
    relevance_score: (paper as any).relevance_score || 'N/A'
  }))
  
  return JSON.stringify({
    topic,
    task: 'Generate a comprehensive research paper on the given topic using the provided sources',
    sources,
    requirements: [
      'Use semantic understanding to connect concepts across sources',
      'Synthesize information to create novel insights from the full source content',
      'Cite sources appropriately using [CITE: paper_id] format',
      'Create logical flow between sections',
      'Include proper academic structure with abstract, introduction, main sections, and conclusion',
      'Write a comprehensive paper that thoroughly explores the topic using all available source material',
      'Ensure the paper length is appropriate for the selected length setting'
    ]
  }, null, 2)
}

async function generatePaperWithSources(
  systemMessage: string,
  userMessage: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (progress: number, stage: string, content: string) => void
): Promise<GenerationResult> {
  
  const stream = await openai.chat.completions.create({
    model: config?.model || 'gpt-4o',
    stream: true,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'cite_source',
          description: 'Mark a citation in the text',
          parameters: {
            type: 'object',
            properties: {
              paper_id: {
                type: 'string',
                description: 'ID of the paper being cited'
              },
              citation_text: {
                type: 'string',
                description: 'The citation text (e.g., "(Smith, 2023)")'
              },
              context: {
                type: 'string',
                description: 'Brief context of what is being cited'
              }
            },
            required: ['paper_id', 'citation_text']
          }
        }
      }
    ],
    temperature: 0.3, // Lower temperature for more consistent academic writing
    max_tokens: 16000 // Increased significantly to allow longer papers
  })
  
  let content = ''
  let citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
    pageRange?: string
  }> = []
  
  let currentStage = 'introduction'
  let progressCounter = 0
  
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    
    if (delta?.content) {
      content += delta.content
      progressCounter++
      
      // Update stage based on content patterns
      if (content.includes('## Methodology') || content.includes('# Methodology')) {
        currentStage = 'methodology'
      } else if (content.includes('## Results') || content.includes('# Results')) {
        currentStage = 'results'
      } else if (content.includes('## Discussion') || content.includes('# Discussion')) {
        currentStage = 'discussion'
      } else if (content.includes('## Conclusion') || content.includes('# Conclusion')) {
        currentStage = 'conclusion'
      }
      
      // Report progress every 10 chunks
      if (progressCounter % 10 === 0) {
        const progress = Math.min((content.length / 16000) * 100, 95) // Estimate progress
        onProgress(progress, currentStage, content)
      }
    }
    
    if (delta?.tool_calls) {
      // Process citation tool calls
      for (const toolCall of delta.tool_calls) {
        if (toolCall.function?.name === 'cite_source') {
          try {
            const args = JSON.parse(toolCall.function.arguments || '{}')
            citations.push({
              paperId: args.paper_id,
              citationText: args.citation_text,
              positionStart: content.length,
              positionEnd: content.length + args.citation_text.length
            })
          } catch (error) {
            console.error('Error parsing citation tool call:', error)
          }
        }
      }
    }
  }
  
  // Extract structure information
  const sections = extractSections(content)
  const abstract = extractAbstract(content)
  const wordCount = content.split(/\s+/).length
  
  return {
    content,
    citations,
    wordCount,
    sources: papers,
    structure: {
      sections,
      abstract
    }
  }
}

function extractSections(content: string): string[] {
  const sectionHeaders = content.match(/#{1,3}\s+(.+)/g) || []
  return sectionHeaders.map(header => header.replace(/#{1,3}\s+/, '').trim())
}

function extractAbstract(content: string): string {
  const abstractMatch = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return abstractMatch ? abstractMatch[1].trim() : ''
}

// Enhanced paper ingestion for search results
export async function ingestSearchResults(
  searchResults: any[],
  query: string
): Promise<string[]> {
  const paperIds: string[] = []
  
  for (const result of searchResults) {
    try {
      const paperId = await ingestPaper({
        title: result.title,
        abstract: result.abstract,
        publication_date: result.publication_date,
        venue: result.venue,
        doi: result.doi,
        url: result.url,
        pdf_url: result.pdf_url,
        metadata: {
          search_query: query,
          found_at: new Date().toISOString(),
          relevance_score: result.relevance_score
        },
        source: result.source || 'search',
        citation_count: result.citation_count,
        impact_score: result.relevance_score,
        authors: result.authors
      })
      
      paperIds.push(paperId)
    } catch (error) {
      console.error('Error ingesting search result:', error)
    }
  }
  
  return paperIds
}

export async function enhancedRAGGeneration({
  topic,
  pinnedPaperIds = [],
  useLibraryOnly = false,
  maxPapers = 10,
  onProgress
}: EnhancedGenerationOptions): Promise<GenerationContext> {
  
  // Stage 1: Get pinned papers from library
  onProgress?.({
    stage: 'discovering_papers',
    progress: 10,
    message: 'Loading pinned papers from your library...',
    pinnedPapers: pinnedPaperIds.length
  })
  
  let pinnedPapers: PaperWithAuthors[] = []
  if (pinnedPaperIds.length > 0) {
    pinnedPapers = await getPapersByIds(pinnedPaperIds)
  }
  
  // Stage 2: Discover additional papers (if not library-only)
  let discoveredPapers: PaperWithAuthors[] = []
  if (!useLibraryOnly) {
    onProgress?.({
      stage: 'discovering_papers', 
      progress: 30,
      message: 'Discovering relevant papers through semantic search...',
      pinnedPapers: pinnedPapers.length
    })
    
    const remainingSlots = Math.max(0, maxPapers - pinnedPapers.length)
    if (remainingSlots > 0) {
      // Use hybrid search but exclude pinned papers to avoid duplicates
      discoveredPapers = await hybridSearchPapers(topic, {
        limit: remainingSlots,
        excludePaperIds: pinnedPaperIds
      })
    }
  }
  
  onProgress?.({
    stage: 'discovering_papers',
    progress: 50,
    message: `Found ${pinnedPapers.length} pinned + ${discoveredPapers.length} discovered papers`,
    pinnedPapers: pinnedPapers.length,
    discoveredPapers: discoveredPapers.length
  })
  
  // Stage 3: Retrieve relevant content chunks for RAG
  onProgress?.({
    stage: 'retrieving_chunks',
    progress: 60,
    message: 'Retrieving relevant content chunks for detailed context...'
  })
  
  const allPapers = [...pinnedPapers, ...discoveredPapers]
  const allPaperIds = allPapers.map(p => p.id)
  
  // Search for relevant chunks from the papers we have
  let relevantChunks: Array<{
    paper_id: string
    content: string
    score: number
  }> = []
  
  if (allPaperIds.length > 0) {
    try {
      // Get chunks that are semantically relevant to the topic from our selected papers
      const chunks = await searchPaperChunks(topic, {
        limit: 20, // Get top 20 most relevant chunks
        paperIds: allPaperIds,
        minScore: 0.7 // High threshold for relevance
      })
      
      relevantChunks = chunks.map(chunk => ({
        paper_id: chunk.paper_id,
        content: chunk.content,
        score: chunk.score
      }))
    } catch (error) {
      console.warn('Chunk retrieval failed, falling back to paper abstracts:', error)
      // Fallback: use paper abstracts as "chunks"
      relevantChunks = allPapers
        .filter(p => p.abstract)
        .map(p => ({
          paper_id: p.id,
          content: p.abstract!,
          score: 0.8 // Default score for abstracts
        }))
    }
  }
  
  onProgress?.({
    stage: 'retrieving_chunks',
    progress: 80,
    message: `Retrieved ${relevantChunks.length} relevant content chunks`
  })
  
  onProgress?.({
    stage: 'finalizing',
    progress: 90,
    message: 'Preparing context for generation...'
  })
  
  return {
    papers: allPapers,
    pinnedPapers,
    discoveredPapers,
    relevantChunks
  }
}

// Helper function to format the context for the generation prompt
export function formatGenerationContext(context: GenerationContext): {
  paperSources: string
  detailedContent: string
  sourceMap: Record<string, PaperWithAuthors>
} {
  const { papers, relevantChunks } = context
  
  // Create a map for easy paper lookup
  const sourceMap: Record<string, PaperWithAuthors> = {}
  papers.forEach(paper => {
    sourceMap[paper.id] = paper
  })
  
  // Format paper sources (bibliography style)
  const paperSources = papers.map((paper, index) => {
    const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'n.d.'
    const authors = paper.authors?.map(a => a.name).join(', ') || 'Unknown Authors'
    const venue = paper.venue ? ` ${paper.venue}.` : ''
    
    return `[${index + 1}] ${authors} (${year}). "${paper.title}".${venue}`
  }).join('\n')
  
  // Format detailed content from chunks
  const detailedContent = relevantChunks.map(chunk => {
    const paper = sourceMap[chunk.paper_id]
    if (!paper) return ''
    
    const paperIndex = papers.findIndex(p => p.id === chunk.paper_id) + 1
    return `[Source ${paperIndex}]: ${chunk.content}`
  }).join('\n\n')
  
  return {
    paperSources,
    detailedContent,
    sourceMap
  }
} 