import { searchCrossref } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const crossrefAdapter: SourceAdapter = {
  id: 'crossref',
  reliability: 'high',
  rateLimitRps: 5,
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchCrossref(q, opts)
} 