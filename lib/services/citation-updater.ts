import { getSB } from '@/lib/supabase/server'
import { searchOpenAlex, searchSemanticScholar } from './academic-apis'

interface CitationUpdate {
  paperId: string
  oldCount: number
  newCount: number
  updated: boolean
}

/**
 * Updates citation counts for papers in the database
 * Useful for keeping citation data current
 */
export async function updateCitationCounts(
  batchSize = 50,
  daysOld = 30
): Promise<CitationUpdate[]> {
  const supabase = await getSB()
  
  console.log(`🔄 Starting citation count update for papers older than ${daysOld} days`)
  
  // Get papers that haven't been updated recently and have DOIs
  const { data: papers, error } = await supabase
    .from('papers')
    .select('id, title, doi, citation_count, updated_at')
    .not('doi', 'is', null)
    .lt('updated_at', new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString())
    .limit(batchSize)

  if (error) {
    console.error('Failed to fetch papers for citation update:', error)
    throw error
  }

  if (!papers || papers.length === 0) {
    console.log('✅ No papers need citation updates')
    return []
  }

  console.log(`📊 Updating citations for ${papers.length} papers`)

  const updates: CitationUpdate[] = []

  // Process papers in smaller batches to avoid rate limits
  for (let i = 0; i < papers.length; i += 10) {
    const batch = papers.slice(i, i + 10)
    
    const batchPromises = batch.map(async (paper) => {
      try {
        // Try to get updated citation count from OpenAlex first (most reliable)
        const newCitationCount = await getCitationCountFromAPIs(paper.doi!, paper.title)
        
        if (newCitationCount !== null && newCitationCount !== paper.citation_count) {
          // Update the database
          const { error: updateError } = await supabase
            .from('papers')
            .update({ 
              citation_count: newCitationCount,
              updated_at: new Date().toISOString()
            })
            .eq('id', paper.id)

          if (updateError) {
            console.error(`Failed to update citations for paper ${paper.id}:`, updateError)
            return {
              paperId: paper.id,
              oldCount: paper.citation_count || 0,
              newCount: newCitationCount,
              updated: false
            }
          }

          console.log(`📈 Updated ${paper.title.slice(0, 50)}... citations: ${paper.citation_count || 0} → ${newCitationCount}`)
          
          return {
            paperId: paper.id,
            oldCount: paper.citation_count || 0,
            newCount: newCitationCount,
            updated: true
          }
        }

        return {
          paperId: paper.id,
          oldCount: paper.citation_count || 0,
          newCount: paper.citation_count || 0,
          updated: false
        }

      } catch (error) {
        console.error(`Error updating citations for paper ${paper.id}:`, error)
        return {
          paperId: paper.id,
          oldCount: paper.citation_count || 0,
          newCount: paper.citation_count || 0,
          updated: false
        }
      }
    })

    const batchResults = await Promise.all(batchPromises)
    updates.push(...batchResults)

    // Rate limiting delay between batches
    if (i + 10 < papers.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const successfulUpdates = updates.filter(u => u.updated).length
  console.log(`✅ Citation update complete: ${successfulUpdates}/${updates.length} papers updated`)

  return updates
}

/**
 * Gets current citation count from academic APIs
 */
async function getCitationCountFromAPIs(doi: string, title: string): Promise<number | null> {
  try {
    // Try OpenAlex first (most comprehensive)
    const openAlexResults = await searchOpenAlex(`doi:${doi}`, { limit: 1 })
    if (openAlexResults.length > 0) {
      return openAlexResults[0].citationCount
    }

    // Fallback to Semantic Scholar
    const semanticResults = await searchSemanticScholar(`doi:${doi}`, { limit: 1 })
    if (semanticResults.length > 0) {
      return semanticResults[0].citationCount
    }

    // Last resort: search by title
    const titleResults = await searchOpenAlex(title, { limit: 1 })
    if (titleResults.length > 0 && titleResults[0].title.toLowerCase().includes(title.toLowerCase().slice(0, 30))) {
      return titleResults[0].citationCount
    }

    return null

  } catch (error) {
    console.error('Failed to get citation count from APIs:', error)
    return null
  }
}

/**
 * Get citation statistics for the database
 */
export async function getCitationStats(): Promise<{
  totalPapers: number
  papersWithCitations: number
  averageCitations: number
  topCitedPapers: Array<{ title: string; citation_count: number }>
}> {
  const supabase = await getSB()

  // Get basic stats
  const [totalPapers, papersWithCitations, topCited] = await Promise.all([
    supabase.from('papers').select('id', { count: 'exact' }),
    supabase.from('papers').select('id', { count: 'exact' }).gt('citation_count', 0),
    supabase.from('papers')
      .select('title, citation_count')
      .not('citation_count', 'is', null)
      .order('citation_count', { ascending: false })
      .limit(10)
  ])

  // Calculate average citations
  const { data: avgData } = await supabase
    .from('papers')
    .select('citation_count')
    .not('citation_count', 'is', null)

  const averageCitations = avgData && avgData.length > 0 
    ? avgData.reduce((sum, p) => sum + (p.citation_count || 0), 0) / avgData.length
    : 0

  return {
    totalPapers: totalPapers.count || 0,
    papersWithCitations: papersWithCitations.count || 0,
    averageCitations: Math.round(averageCitations * 100) / 100,
    topCitedPapers: topCited.data || []
  }
} 