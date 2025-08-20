import 'server-only'

// Re-export CitationService as the primary interface
export { 
  CitationService as CoreCitationService,
  type AddCitationParams,
  type AddCitationResult
} from '@/lib/citations/immediate-bibliography'

import type { AddCitationParams as CoreAddParams, AddCitationResult as CoreAddResult } from '@/lib/core/citations'

// Provide typed service interface for external consumption
export interface CitationServiceInterface {
  add(params: CoreAddParams): Promise<CoreAddResult>
  renderInline(cslJson: any, style: string, number: number): Promise<string>
  renderBibliography(projectId: string, style?: string): Promise<{ bibliography: string; count: number }>
  suggest(projectId: string, context: string): Promise<string[]>
  resolveSourceRef(sourceRef: { doi?: string; title?: string; year?: number }, projectId?: string): Promise<string | null>
}

// Default export for convenience
export default undefined as unknown as never