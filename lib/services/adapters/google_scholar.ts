import { searchGoogleScholar } from '@/lib/services/academic-apis'
import type { SourceAdapter } from '@/contracts/search-sources'
import type { SearchOptions, AcademicPaper } from '@/contracts/search-sources'

export const googleScholarAdapter: SourceAdapter = {
  id: 'google_scholar',
  reliability: 'medium', // Can be blocked or rate limited
  rateLimitRps: 0.5, // Very conservative - 1 request every 2 seconds
  search: (q: string, opts: SearchOptions): Promise<AcademicPaper[]> => searchGoogleScholar(q, opts)
} 