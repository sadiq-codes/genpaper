import { searchArxiv } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const arxivAdapter: SourceAdapter = {
  id: 'arxiv',
  reliability: 'medium',
  rateLimitRps: 2,
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchArxiv(q, opts)
} 