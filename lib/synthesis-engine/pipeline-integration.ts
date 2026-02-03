/**
 * Pipeline Integration for Synthesis Engine
 * 
 * Provides functions to integrate the hybrid synthesis engine with
 * the existing generation pipeline. This enables gradual migration
 * from the old system to the new one.
 * 
 * Key integration points:
 * 1. extractThemesHybrid() - Replaces extractThemes() with extraction + analysis
 * 2. buildHybridContextsForOutline() - Replaces buildContexts() with hybrid context
 * 3. generateSectionsHybrid() - Replaces generateMultipleSectionsUnified() with hybrid writer
 * 
 * @module lib/synthesis-engine/pipeline-integration
 */

import 'server-only'
import { extractPaper } from '@/lib/extraction'
import { 
  getExtractionsService, 
  getPapersNeedingExtractionService,
  saveExtractionService 
} from '@/lib/extraction/db-service'
import { analyzeFindings, type FindingWithPaper } from '@/lib/analysis/cross-document'
import { buildSynthesisPlan, type PaperInfo } from './index'
import { writeHybridSynthesis } from './hybrid-writer'
import { analysisResultToThemeAnalysis } from './theme-adapter'
import type { ThemeAnalysis, PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors } from '@/types/simplified'

// =============================================================================
// Types
// =============================================================================

export interface HybridThemeExtractionResult {
  themeAnalysis: ThemeAnalysis
  analysisResult: ReturnType<typeof analyzeFindings> extends Promise<infer T> ? T : never
  extractionStats: {
    papersProcessed: number
    papersExtracted: number
    papersFromCache: number
    totalFindings: number
    extractionTimeMs: number
  }
}

export interface HybridGenerationResult {
  content: string
  sections: Array<{
    title: string
    content: string
    wordCount: number
  }>
  metadata: {
    totalWords: number
    patternsDiscussed: number
    contradictionsAddressed: number
    gapsIdentified: number
    chunksUsed: number
    generationTimeMs: number
  }
}

// =============================================================================
// Main Integration Functions
// =============================================================================

/**
 * Extract themes using the hybrid approach
 * 
 * This replaces extractThemes() with:
 * 1. Extract structured findings from each paper
 * 2. Analyze findings across papers
 * 3. Convert to ThemeAnalysis for compatibility
 */
export async function extractThemesHybrid(
  papers: PaperWithAuthors[],
  topic: string,
  profile: PaperProfile,
  onProgress?: (message: string, details?: any) => void
): Promise<HybridThemeExtractionResult> {
  const startTime = Date.now()
  const paperIds = papers.map(p => p.id)
  
  onProgress?.('Checking for existing extractions...', { paperCount: papers.length })
  
  // Step 1: Check which papers need extraction
  const needsExtraction = await getPapersNeedingExtractionService(paperIds)
  const cachedPaperIds = paperIds.filter(id => !needsExtraction.includes(id))
  
  onProgress?.(`Found ${cachedPaperIds.length} cached extractions, ${needsExtraction.length} need processing`, {
    cached: cachedPaperIds.length,
    needsExtraction: needsExtraction.length
  })
  
  // Step 2: Get cached extractions
  const cachedExtractions = await getExtractionsService(cachedPaperIds)
  
  // Step 3: Extract papers that need it (with concurrency limit)
  const CONCURRENCY = 3
  const newExtractions: Map<string, any> = new Map()
  
  if (needsExtraction.length > 0) {
    onProgress?.(`Extracting findings from ${needsExtraction.length} papers...`)
    
    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < needsExtraction.length; i += CONCURRENCY) {
      const batch = needsExtraction.slice(i, i + CONCURRENCY)
      
      const results = await Promise.all(
        batch.map(async (paperId) => {
          const paper = papers.find(p => p.id === paperId)
          if (!paper) return null
          
          // Get paper content - prefer pdf_content, fall back to abstract
          const content = (paper as any).pdf_content || paper.abstract || ''
          if (content.length < 200) {
            console.log(`Skipping extraction for ${paperId} - content too short`)
            return null
          }
          
          try {
            const result = await extractPaper({
              paperId,
              text: content
            })
            
            if (result.success && result.extraction) {
              // Save to database
              await saveExtractionService(result.extraction)
              return { paperId, extraction: result.extraction }
            }
          } catch (error) {
            console.warn(`Extraction failed for ${paperId}:`, error)
          }
          return null
        })
      )
      
      // Collect successful extractions
      for (const result of results) {
        if (result) {
          newExtractions.set(result.paperId, result.extraction)
        }
      }
      
      onProgress?.(`Extracted ${i + batch.length}/${needsExtraction.length} papers...`)
    }
  }
  
  // Step 4: Combine all extractions and build findings
  const allFindings: FindingWithPaper[] = []
  
  // From cached extractions
  for (const [paperId, extraction] of cachedExtractions) {
    const paper = papers.find(p => p.id === paperId)
    for (const finding of extraction.findings) {
      allFindings.push({
        ...finding,
        paperId,
        paperTitle: extraction.metadata.title,
        paperYear: extraction.metadata.year,
        paperDomain: extraction.metadata.domain
      })
    }
  }
  
  // From new extractions
  for (const [paperId, extraction] of newExtractions) {
    for (const finding of extraction.findings) {
      allFindings.push({
        ...finding,
        paperId,
        paperTitle: extraction.metadata.title,
        paperYear: extraction.metadata.year,
        paperDomain: extraction.metadata.domain
      })
    }
  }
  
  onProgress?.(`Analyzing ${allFindings.length} findings across papers...`)
  
  // Step 5: Run cross-document analysis
  const analysisResult = await analyzeFindings({
    projectId: 'pipeline',
    findings: allFindings,
    topic
  })
  
  // Step 6: Convert to ThemeAnalysis for pipeline compatibility
  const paperInfos: PaperInfo[] = papers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.author_names || [],
    year: p.publication_date ? new Date(p.publication_date).getFullYear() : undefined,
    domain: profile.discipline.primary
  }))
  
  const themeAnalysis = analysisResultToThemeAnalysis(analysisResult, paperInfos)
  
  const extractionTimeMs = Date.now() - startTime
  
  onProgress?.(`Theme analysis complete: ${themeAnalysis.emergentThemes.length} themes, ${themeAnalysis.debates.length} debates, ${themeAnalysis.gaps.length} gaps`, {
    themes: themeAnalysis.emergentThemes.length,
    debates: themeAnalysis.debates.length,
    gaps: themeAnalysis.gaps.length,
    durationMs: extractionTimeMs
  })
  
  return {
    themeAnalysis,
    analysisResult,
    extractionStats: {
      papersProcessed: papers.length,
      papersExtracted: newExtractions.size,
      papersFromCache: cachedExtractions.size,
      totalFindings: allFindings.length,
      extractionTimeMs
    }
  }
}

/**
 * Generate sections using the hybrid approach
 * 
 * This replaces generateMultipleSectionsUnified() with:
 * 1. Build synthesis plan from analysis
 * 2. Use hybrid writer (structured data + targeted chunks)
 */
export async function generateSectionsHybrid(
  analysisResult: HybridThemeExtractionResult['analysisResult'],
  papers: PaperWithAuthors[],
  topic: string,
  targetWordCount: number,
  onProgress?: (message: string, sectionIndex?: number, content?: string) => void
): Promise<HybridGenerationResult> {
  
  // Build paper info for the plan
  const paperInfos: PaperInfo[] = papers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.author_names || [],
    year: p.publication_date ? new Date(p.publication_date).getFullYear() : undefined,
    domain: 'general'
  }))
  
  onProgress?.('Building synthesis plan...')
  
  // Step 1: Build synthesis plan
  const planResult = await buildSynthesisPlan({
    projectId: 'pipeline',
    analysis: analysisResult,
    papers: paperInfos,
    targetWordCount,
    audienceLevel: 'academic'
  })
  
  if (!planResult.success || !planResult.plan) {
    throw new Error(`Failed to build synthesis plan: ${planResult.error}`)
  }
  
  const plan = planResult.plan
  
  onProgress?.(`Plan created: ${plan.sections.length} sections`)
  
  // Step 2: Write using hybrid approach
  const writerResult = await writeHybridSynthesis({
    projectId: 'pipeline',
    plan,
    analysis: analysisResult,
    papers: paperInfos,
    onSectionStart: (title, index, total) => {
      onProgress?.(`Writing ${title}...`, index)
    },
    onSectionComplete: (title, wordCount) => {
      // Could send content here for streaming
    }
  })
  
  if (!writerResult.success) {
    throw new Error(`Hybrid writing failed: ${writerResult.error}`)
  }
  
  return {
    content: writerResult.fullContent,
    sections: writerResult.sections.map(s => ({
      title: s.title,
      content: s.content,
      wordCount: s.wordCount
    })),
    metadata: {
      totalWords: writerResult.metadata.totalWords,
      patternsDiscussed: writerResult.metadata.patternsDiscussed,
      contradictionsAddressed: writerResult.metadata.contradictionsAddressed,
      gapsIdentified: writerResult.metadata.gapsIdentified,
      chunksUsed: writerResult.metadata.totalChunksUsed,
      generationTimeMs: writerResult.metadata.totalGenerationTimeMs
    }
  }
}

/**
 * Check if hybrid synthesis is available for a set of papers
 * Returns true if enough papers have extractions or can be extracted
 */
export async function canUseHybridSynthesis(
  paperIds: string[],
  minPapersWithExtractions: number = 3
): Promise<{ available: boolean; extractedCount: number; reason?: string }> {
  try {
    const needsExtraction = await getPapersNeedingExtractionService(paperIds)
    const extractedCount = paperIds.length - needsExtraction.length
    
    if (extractedCount >= minPapersWithExtractions) {
      return { available: true, extractedCount }
    }
    
    // Check if we can extract enough papers
    if (paperIds.length >= minPapersWithExtractions) {
      return { 
        available: true, 
        extractedCount,
        reason: `Will extract ${needsExtraction.length} papers on demand`
      }
    }
    
    return {
      available: false,
      extractedCount,
      reason: `Not enough papers (${paperIds.length}) for hybrid synthesis (minimum ${minPapersWithExtractions})`
    }
  } catch (error) {
    return {
      available: false,
      extractedCount: 0,
      reason: `Error checking extraction status: ${error}`
    }
  }
}
