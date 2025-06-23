import { getPapersByIds } from '@/lib/db/library'
import type { PaperWithAuthors } from '@/types/simplified'
import type { EnhancedGenerationOptions, PaperWithScores } from './types'
import { isScoreAcceptable, hasUnacceptableScores } from './config'
import type { PaperSource } from '@/types/simplified'
import { unifiedSearch, type UnifiedSearchOptions } from '@/lib/search'
import { estimateEmbeddingCost, formatCostEstimate } from '@/lib/ai/generation-defaults'
import { decideIngest } from './policy'
import { WordTokenizer } from 'natural'

// Initialize NLP tools
const tokenizer = new WordTokenizer()

export async function collectPapers(options: EnhancedGenerationOptions): Promise<PaperWithAuthors[]> {
  const { topic, libraryPaperIds = [], useLibraryOnly, config, userId } = options
  
  console.log(`📋 Generation Request:`)
  console.log(`   🎯 Topic: "${topic}"`)
  console.log(`   📚 Pinned Library Papers: ${libraryPaperIds.length}`)
  console.log(`   🔒 Library Only Mode: ${useLibraryOnly}`)
  console.log(`   ⚙️ Target Limit: ${config?.search_parameters?.limit || 10}`)
  
  // Get pinned papers from library
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
  const targetTotal = config?.search_parameters?.limit || 90
  const remainingSlots = Math.max(0, targetTotal - pinnedPapers.length)
  
  console.log(`🔍 Search Parameters:`)
  console.log(`   📊 Target Total Papers: ${targetTotal}`)
  console.log(`   📌 Pinned Papers: ${pinnedPapers.length}`)
  console.log(`   🆕 Remaining Slots for Discovery: ${remainingSlots}`)
  console.log(`   🚫 Excluded Paper IDs: [${pinnedIds.join(', ')}]`)

  // Discover additional papers if not in library-only mode
  let discoveredPapers: PaperWithAuthors[] = []

  console.log(`🔍 Library Only Check:`)
  console.log(`   useLibraryOnly flag: ${useLibraryOnly}`)
  console.log(`   remainingSlots: ${remainingSlots}`)
  console.log(`   Condition (!useLibraryOnly && remainingSlots > 0): ${!useLibraryOnly && remainingSlots > 0}`)

  if (!useLibraryOnly && remainingSlots > 0) {
    console.log(`🎯 Starting unified search for fresh papers...`)
    console.log(`⚠️ LIBRARY ONLY MODE IS DISABLED - SEARCHING FOR MORE PAPERS`)
    
    try {
      // Use server-side policy for auto-ingest decisions
      const autoIngest = decideIngest({
        librarySize: pinnedPapers.length,
        explicitForce: config?.search_parameters?.forceIngest,
        userId
      })
      
      console.log(`🔧 ForceIngest Decision:`)
      console.log(`   📚 Library papers: ${pinnedPapers.length}`)
      console.log(`   ⚙️ Explicit setting: ${config?.search_parameters?.forceIngest ?? 'not set'}`)
      console.log(`   🤖 Auto-ingest enabled by policy: ${autoIngest}`)
      
      if (autoIngest && !config?.search_parameters?.forceIngest) {
        const estimatedCost = estimateEmbeddingCost(remainingSlots, false)
        console.log(`   💰 Estimated embedding cost: ${formatCostEstimate(estimatedCost)} for ${remainingSlots} papers`)
      }
      
      const searchOptions: UnifiedSearchOptions = {
        maxResults: remainingSlots,
        minResults: Math.min(5, remainingSlots),
        excludePaperIds: pinnedIds,
        fromYear: 2000,
        localRegion: config?.paper_settings?.localRegion,
        useHybridSearch: true,
        useKeywordSearch: true,
        useAcademicAPIs: !useLibraryOnly, // Only use APIs if not library-only
        combineResults: true,
        forceIngest: autoIngest,
        fastMode: false, // Default to false since not in config
        sources: (config?.search_parameters?.sources as PaperSource[]) ?? ['openalex', 'crossref', 'semantic_scholar'],
        semanticWeight: config?.search_parameters?.semanticWeight || 0.4,
        authorityWeight: config?.search_parameters?.authorityWeight || 0.5,
        recencyWeight: config?.search_parameters?.recencyWeight || 0.1
      }
      
      const searchResult = await unifiedSearch(topic, searchOptions)
      
      // Extract papers from unified search result  
      discoveredPapers = searchResult.papers.map(p => ({
        ...p,
        // Ensure proper typing
        authors: p.authors || [],
        author_names: p.author_names || []
      })) as PaperWithAuthors[]
      
      console.log(`🎯 Unified search completed:`)
      console.log(`   📊 Found: ${discoveredPapers.length} papers`)
      console.log(`   🔍 Strategies: ${searchResult.metadata.searchStrategies.join(', ')}`)
      console.log(`   ⏱️ Time: ${searchResult.metadata.searchTimeMs}ms`)
      console.log(`   💾 Cache hits: ${searchResult.metadata.cacheHits}`)
      console.log(`   🌍 Regional boost: ${searchResult.metadata.localRegionBoost ? `${searchResult.metadata.localPapersCount} local papers` : 'none'}`)
      
      // Apply domain filtering to prevent off-topic papers
      const filteredPapers = filterOnTopicPapers(discoveredPapers, topic)
      console.log(`🔧 Domain filtering: ${discoveredPapers.length} → ${filteredPapers.length} on-topic papers`)
      discoveredPapers = filteredPapers
      
    } catch (error) {
      console.error(`❌ Unified search failed:`, error)
      discoveredPapers = []
    }
  } else {
    if (useLibraryOnly) {
      console.log(`✅ LIBRARY ONLY MODE ENABLED - SKIPPING PAPER SEARCH`)
      console.log(`   Only using ${pinnedPapers.length} papers from library`)
    } else if (remainingSlots <= 0) {
      console.log(`✅ No remaining slots for additional papers`)
      console.log(`   Already have ${pinnedPapers.length} pinned papers (target: ${targetTotal})`)
    }
  }
  
  console.log(`🔍 Discovery Search Results: ${discoveredPapers.length} papers found`)
  
  // Remove forced academic ingestion - papers will be ingested when selected for generation
  // Users should add papers to library first, then select them for generation
  if (discoveredPapers.length < 5 && !useLibraryOnly) {
    console.warn('⚠️ Less than 5 total papers found.')
    console.warn('💡 Tip: Add more relevant papers to your library for better generation results.')
    console.warn('🔍 Papers from academic search are available but not automatically ingested.')
  }

  const finalPapers: PaperWithAuthors[] = [
    ...pinnedPapers.map(lp => lp.paper as PaperWithAuthors),
    ...discoveredPapers
  ]

  console.log(`📋 Final Paper Collection: ${finalPapers.length} papers total`)
  console.log(`   📌 From Library: ${pinnedPapers.length}`)
  console.log(`   🔍 From Discovery: ${discoveredPapers.length}`)
  
  if (useLibraryOnly && discoveredPapers.length > 0) {
    console.error(`❌ BUG DETECTED: Library-only mode enabled but ${discoveredPapers.length} papers were discovered!`)
    console.error(`   This should not happen. Library-only should prevent any search.`)
  }
  
  if (useLibraryOnly) {
    console.log(`✅ Library-only mode verification: Using only ${pinnedPapers.length} library papers`)
    finalPapers.forEach((paper, idx) => {
      console.log(`   ${idx + 1}. "${paper.title}" (${paper.id})`)
    })
  }

  if (finalPapers.length === 0) {
    console.error(`❌ No papers found for topic: "${topic}"`)
    console.error(`❌ Search parameters:`, { 
      limit: remainingSlots, 
      excludeIds: pinnedIds.length,
      useLibraryOnly 
    })
    throw new Error(`No papers found for topic "${topic}". Please add relevant papers to your library.`)
  }

  return finalPapers
}

/**
 * Extract significant terms using enhanced tokenization and frequency analysis
 * Replaces the flawed TF-IDF implementation that used only a single document
 */
function extractSignificantTerms(text: string, minLength: number = 3): string[] {
  // Enhanced tokenization with preprocessing
  const preprocessed = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/[-_]/g, ' ') // hyphens and underscores to spaces
    .toLowerCase()
  
  const tokens = tokenizer.tokenize(preprocessed) || []
  
  // Filter out very common English words (minimal stop word list)
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him',
    'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
  ])
  
  // Filter and score tokens
  const filteredTokens = tokens.filter(token => {
    // Always include long technical terms (likely domain-specific)
    if (token.length >= 6) return /^[a-zA-Z]/.test(token)
    
    // For shorter terms, filter out common words and ensure minimum length
    return token.length >= minLength && 
           /^[a-zA-Z]/.test(token) && 
           !commonWords.has(token)
  })
  
  // Calculate term frequencies
  const termFrequencies = new Map<string, number>()
  filteredTokens.forEach(token => {
    termFrequencies.set(token, (termFrequencies.get(token) || 0) + 1)
  })
  
  // Score terms based on frequency and length
  const scoredTerms = Array.from(termFrequencies.entries()).map(([term, freq]) => ({
    term,
    score: freq * Math.log(term.length) // Favor longer, more frequent terms
  }))
  
  // Sort by score and return top terms
  const significantTerms = scoredTerms
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(5, Math.ceil(scoredTerms.length * 0.4))) // Top 40% or at least 5 terms
    .map(item => item.term)
  
  // Fallback to most frequent terms if scoring doesn't yield good results
  if (significantTerms.length === 0) {
    return Array.from(termFrequencies.keys()).slice(0, 10)
  }
  
  return significantTerms
}

export function filterOnTopicPapers(
  papers: PaperWithAuthors[],
  topic: string,
  options?: { permissive?: boolean; minScore?: number }
): PaperWithAuthors[] {
  const permissive = !!options?.permissive;
  const minScore = options?.minScore ?? 0.05; // Stricter default min score

  // Titles that are definitely not research papers
  const junkTitles = new Set(['acknowledgments', 'copyright', 'index', 'table of contents', 'front matter', 'back matter']);

  // Use more flexible term extraction instead of hardcoded stop words
  const topicTerms = extractSignificantTerms(topic)
  
  if (topicTerms.length === 0) return papers
  
  // Create regex patterns for whole-word matching
  const termRegexes = topicTerms.map(
    term => new RegExp(`\\b${term}\\b`, 'i')
  );

  return (papers as PaperWithScores[]).filter(paper => {
    const titleLower = paper.title?.toLowerCase() || '';

    // 1. Filter out junk titles
    if (junkTitles.has(titleLower)) {
      console.debug(`🚫 Filtered out junk title: "${paper.title}"`);
      return false;
    }

    const abstractLower = paper.abstract?.toLowerCase() || '';
    const combinedText = titleLower + ' ' + abstractLower;

    // 2. Count matches with the significant terms
    const matches = termRegexes.filter(rx => rx.test(combinedText));
    const matchRatio = matches.length / topicTerms.length
    
    // More flexible matching: require at least 30% term overlap for short topics,
    // or at least 2 matches for longer topics
    const hasGoodMatch = topicTerms.length <= 3 
      ? matchRatio >= 0.3
      : matches.length >= 2

    // 3. Check semantic/keyword scores using helper functions
    const { semantic_score: semanticScore, keyword_score: keywordScore } = paper;
    const scoresAreAcceptable = isScoreAcceptable(semanticScore, keywordScore, permissive);
    const scoresAreUnacceptable = hasUnacceptableScores(semanticScore, keywordScore, permissive);
    
    // 4. Stricter score check
    const combinedScore = (semanticScore || 0) + (keywordScore || 0);
    if (combinedScore < minScore && !hasGoodMatch) {
       if (process.env.NODE_ENV === 'development') {
        console.debug(
          `🚫 Filtered out low score: "${paper.title}" ` +
            `(combined score: ${combinedScore.toFixed(2)} < ${minScore})`
        );
      }
      return false;
    }

    // Decision logic: Include if EITHER good term match OR acceptable scores
    // Drop only if NO good match AND scores are unacceptable
    if (!hasGoodMatch && scoresAreUnacceptable) {
      if (process.env.NODE_ENV === 'development') {
        const scoreInfo = typeof semanticScore === 'number' || typeof keywordScore === 'number'
          ? `semantic: ${semanticScore ?? 'N/A'}, keyword: ${keywordScore ?? 'N/A'}`
          : 'no scores available';

        console.debug(
          `🚫 Filtered out: "${paper.title}" ` +
            `(match ratio: ${matchRatio.toFixed(2)}, ${scoreInfo}, mode: ${permissive ? 'permissive' : 'standard'})`
        );
      }
      return false;
    }

    // Log inclusion reasoning in debug mode
    if (process.env.NODE_ENV === 'development') {
      const reason = hasGoodMatch
        ? `term match (${matchRatio.toFixed(2)})`
        : scoresAreAcceptable
          ? 'acceptable scores'
          : 'default inclusion';
      console.debug(`✅ Including: "${paper.title}" (${reason}, mode: ${permissive ? 'permissive' : 'standard'})`);
    }

    return true;
  });
} 