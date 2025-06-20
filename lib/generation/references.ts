import { getSB } from '@/lib/supabase/server'
import type { PaperReference } from '@/lib/services/academic-apis'

export async function loadReferencesForPapers(paperIds: string[]): Promise<Record<string, PaperReference[]>> {
  if (paperIds.length === 0) return {}
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('paper_references')
    .select('paper_id, reference_csl')
    .in('paper_id', paperIds)
    .limit(10000)
  if (error) {
    console.warn('Failed to load references', error)
    return {}
  }
  const map: Record<string, PaperReference[]> = {}
  for (const row of data as any[]) {
    if (!map[row.paper_id]) map[row.paper_id] = []
    map[row.paper_id].push(row.reference_csl as PaperReference)
  }
  return map
} 