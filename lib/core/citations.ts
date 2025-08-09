/**
 * @core/citations - Core citation service interface
 * 
 * This module establishes the new service boundary for citation operations.
 * All citation-related functionality should go through this interface.
 */

// Core types for citation operations
export interface SourceRef {
  doi?: string
  title?: string
  year?: number
  url?: string
}

export interface AddCitationParams {
  projectId: string
  sourceRef: SourceRef
  reason: string
  anchorId?: string
  quote?: string | null
}

export interface AddCitationResult {
  citeKey: string
  projectCitationId: string
  isNew: boolean
}

export interface RenderOptions {
  style: 'apa' | 'mla' | 'chicago' | 'ieee'
}

/**
 * Core Citation Service Interface
 * 
 * This interface defines the contract for all citation operations.
 * Implementation is delegated to the actual service layer.
 */
export interface CoreCitationService {
  /**
   * Add a citation to a project (idempotent)
   * Resolves source reference and creates/returns citation
   */
  add(params: AddCitationParams): Promise<AddCitationResult>

  /**
   * Resolve DOI/title/URL to a source ID
   * Single resolver for paper identity across UI/AI
   */
  resolveSourceRef(sourceRef: SourceRef, projectId?: string): Promise<string | null>

  /**
   * Render inline citations for given cite keys
   * Produces (Author, Year) or numeric references
   */
  renderInline(params: {
    projectId: string
    citeKeys: string[]
    style: RenderOptions['style']
  }): Promise<string[]>

  /**
   * Generate complete bibliography for a project
   * Returns sorted entries in specified style
   */
  renderBibliography(params: {
    projectId: string
    style?: RenderOptions['style']
  }): Promise<{
    html: string
    entries: any[]
    count: number
  }>

  /**
   * Suggest citations based on context
   * Returns ranked list of potential sources
   */
  suggest(params: {
    projectId: string
    context: string
    maxResults?: number
  }): Promise<Array<{
    sourceId: string
    title: string
    relevanceScore: number
    reason: string
  }>>
}

/**
 * Stub implementation - to be replaced with actual service
 * This ensures the package builds and tests can import all functions
 */
export class CitationServiceStub implements CoreCitationService {
  async add(params: AddCitationParams): Promise<AddCitationResult> {
    // Delegate to actual CitationService implementation
    const { CitationService } = await import('@/lib/citations/immediate-bibliography')
    return CitationService.add(params)
  }

  async resolveSourceRef(sourceRef: SourceRef, projectId?: string): Promise<string | null> {
    // Delegate to actual CitationService implementation
    const { CitationService } = await import('@/lib/citations/immediate-bibliography')
    return CitationService.resolveSourceRef(sourceRef, projectId)
  }

  async renderInline(params: {
    projectId: string
    citeKeys: string[]
    style: RenderOptions['style']
  }): Promise<string[]> {
    // TODO: Implement inline rendering logic
    throw new Error('CitationService.renderInline not yet implemented')
  }

  async renderBibliography(params: {
    projectId: string
    style?: RenderOptions['style']
  }): Promise<{
    html: string
    entries: any[]
    count: number
  }> {
    // TODO: Implement bibliography rendering logic
    throw new Error('CitationService.renderBibliography not yet implemented')
  }

  async suggest(params: {
    projectId: string
    context: string
    maxResults?: number
  }): Promise<Array<{
    sourceId: string
    title: string
    relevanceScore: number
    reason: string
  }>> {
    // TODO: Implement citation suggestion logic
    throw new Error('CitationService.suggest not yet implemented')
  }
}

// Export stub instance for testing
export const citationService = new CitationServiceStub()

// Re-export types for convenience
export type { SourceRef, AddCitationParams, AddCitationResult, RenderOptions }