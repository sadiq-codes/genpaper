import { searchOpenAlex } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const openalexAdapter: SourceAdapter = {
  id: 'openalex',
  reliability: 'high',
  rateLimitRps: 3, // OpenAlex allows ~10 rps, conservatively 3
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchOpenAlex(q, opts)
} 