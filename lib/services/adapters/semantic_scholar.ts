import { searchSemanticScholar } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const semanticScholarAdapter: SourceAdapter = {
  id: 'semantic_scholar',
  reliability: 'high',
  rateLimitRps: 3,
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchSemanticScholar(q, opts)
} 