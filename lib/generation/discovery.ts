import { getPapersByIds } from '@/lib/db/library'
import type { PaperWithAuthors } from '@/types/simplified'
import type { EnhancedGenerationOptions, PaperWithScores } from './types'
import { isScoreAcceptable, hasUnacceptableScores } from './config'
import type { PaperSource } from '@/types/simplified'
import { unifiedSearch, type UnifiedSearchOptions } from '@/lib/services/search-orchestrator'

export async function collectPapers(options: EnhancedGenerationOptions): Promise<PaperWithAuthors[]> {
  const { topic, libraryPaperIds = [], useLibraryOnly, config } = options
  
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
  const targetTotal = config?.search_parameters?.limit || 10
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
      // Use unified search orchestrator - eliminates redundant hybridSearchPapers calls
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
        forceIngest: false,
        fastMode: false, // Default to false since not in config
        sources: (config?.search_parameters?.sources as PaperSource[]) ?? ['openalex', 'crossref', 'semantic_scholar'],
        semanticWeight: config?.search_parameters?.semanticWeight || 0.7,
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

export function filterOnTopicPapers(
  papers: PaperWithAuthors[],
  topic: string,
  options?: { permissive?: boolean }
): PaperWithAuthors[] {
  const permissive = !!options?.permissive;
  
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'for', 'to', 'with', 'by', 'from', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among']);
  const britishAmericanMap: Record<string, string> = { 'modelling': 'modeling' };

  const topicTokens = topic
    .toLowerCase()
    .split(/\W+/)
    .filter(tok => tok.length > 2 && !stopWords.has(tok))
    .map(tok => britishAmericanMap[tok] || tok)

  if (topicTokens.length === 0) return papers
  
  // 2. Precompute regexes for whole-word matching
  const tokenRegexes = topicTokens.map(
    tok => new RegExp(`\\b${tok}\\b`, 'i')
  );

  return (papers as PaperWithScores[]).filter(paper => {
    const titleLower = paper.title?.toLowerCase() || '';
    const abstractLower = paper.abstract?.toLowerCase() || '';
    const combinedText = titleLower + ' ' + abstractLower;

    const matches = tokenRegexes.filter(rx => rx.test(combinedText));
    const hasTwoOrMoreMatches = matches.length >= 2

    // 4. Check semantic/keyword scores using helper functions
    const { semantic_score: semanticScore, keyword_score: keywordScore } = paper;
    const scoresAreAcceptable = isScoreAcceptable(semanticScore, keywordScore, permissive);
    const scoresAreUnacceptable = hasUnacceptableScores(semanticScore, keywordScore, permissive);

    // 5. Decision logic: Include if EITHER token match OR acceptable scores
    // Drop only if NO token match AND scores are unacceptable
    if (!hasTwoOrMoreMatches && scoresAreUnacceptable) {
      // Only log if explicitly debugging
      if (process.env.NODE_ENV === 'development') {
        const scoreInfo = typeof semanticScore === 'number' || typeof keywordScore === 'number'
          ? `semantic: ${semanticScore ?? 'N/A'}, keyword: ${keywordScore ?? 'N/A'}`
          : 'no scores available';

        console.debug(
          `🚫 Filtered out (1-match): "${paper.title}" ` +
            `(matches: ${matches.length}, ${scoreInfo}, mode: ${permissive ? 'permissive' : 'standard'})`
        );
      }
      return false;
    }

    // Log inclusion reasoning in debug mode
    if (process.env.NODE_ENV === 'development') {
      const reason = hasTwoOrMoreMatches
        ? 'token match'
        : scoresAreAcceptable
          ? 'acceptable scores'
          : 'default inclusion';
      console.debug(`✅ Including: "${paper.title}" (${reason}, mode: ${permissive ? 'permissive' : 'standard'})`);
    }

    return true;
  });
} 