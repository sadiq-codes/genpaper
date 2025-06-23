import { searchCore } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const coreAdapter: SourceAdapter = {
  id: 'core',
  reliability: 'low',
  rateLimitRps: 1,
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchCore(q, opts)
} 