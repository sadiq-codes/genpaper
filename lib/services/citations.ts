import 'server-only'

// Re-export CitationService as the primary interface
export { 
  CitationService,
  type AddCitationParams,
  type AddCitationResult
} from '@/lib/citations/immediate-bibliography'

// Provide typed service interface for external consumption
export interface CitationServiceInterface {
  add(params: AddCitationParams): Promise<AddCitationResult>
  renderInline(cslJson: any, style: string, number: number): Promise<string>
  renderBibliography(projectId: string, style?: string): Promise<{ bibliography: string; count: number }>
  suggest(projectId: string, context: string): Promise<string[]>
  resolveSourceRef(sourceRef: { doi?: string; title?: string; year?: number }, projectId?: string): Promise<string | null>
}

// Default export for convenience
export default CitationService