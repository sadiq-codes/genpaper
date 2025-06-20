/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CSL Style Repository Service
 * 
 * This service manages citation styles from multiple sources:
 * - Zotero Style Repository (10,000+ styles)
 * - Local custom styles
 * - Organization-specific styles
 */

import type { CitationStyleInfo } from './engine'

// Cache for loaded styles
const styleCache = new Map<string, any>()
const styleInfoCache = new Map<string, CitationStyleInfo[]>()

// Zotero Style Repository API
const ZOTERO_STYLES_API = 'https://www.zotero.org/styles-files/styles.json'
const ZOTERO_STYLE_CDN = 'https://raw.githubusercontent.com/citation-style-language/styles/master'

// Popular styles that should be available offline
const CORE_STYLES: CitationStyleInfo[] = [
  { id: 'apa', name: 'APA 7th Edition', category: 'author-date', example: '(Smith, 2023)' },
  { id: 'mla', name: 'MLA 9th Edition', category: 'author-date', example: '(Smith 123)' },
  { id: 'chicago-author-date', name: 'Chicago Author-Date', category: 'author-date', example: '(Smith 2023)' },
  { id: 'chicago-note-bibliography', name: 'Chicago Notes', category: 'note', example: '¹' },
  { id: 'harvard1', name: 'Harvard', category: 'author-date', example: '(Smith, 2023)' },
  { id: 'ieee', name: 'IEEE', category: 'numeric', example: '[1]' },
  { id: 'vancouver', name: 'Vancouver', category: 'numeric', example: '(1)' },
  { id: 'nature', name: 'Nature', category: 'numeric', example: '¹' },
  { id: 'science', name: 'Science', category: 'numeric', example: '(1)' },
  { id: 'cell', name: 'Cell', category: 'author-date', example: '(Smith et al., 2023)' },
  { id: 'plos-one', name: 'PLOS ONE', category: 'numeric', example: '[1]' },
  { id: 'elsevier-harvard', name: 'Elsevier Harvard', category: 'author-date', example: '(Smith, 2023)' },
  { id: 'springer-basic-author-date', name: 'Springer Basic', category: 'author-date', example: '(Smith 2023)' },
  { id: 'american-medical-association', name: 'AMA', category: 'numeric', example: '1.' },
  { id: 'american-psychological-association-6th-edition', name: 'APA 6th Edition', category: 'author-date', example: '(Smith, 2023)' }
]

export interface StyleRepositoryOptions {
  includeZotero?: boolean
  includeLocal?: boolean
  cacheTimeout?: number // in milliseconds
}

export class StyleRepository {
  private options: StyleRepositoryOptions
  private lastFetch: number = 0

  constructor(options: StyleRepositoryOptions = {}) {
    this.options = {
      includeZotero: true,
      includeLocal: true,
      cacheTimeout: 24 * 60 * 60 * 1000, // 24 hours
      ...options
    }
  }

  /**
   * Get all available citation styles
   */
  async getAvailableStyles(): Promise<CitationStyleInfo[]> {
    const cacheKey = 'all-styles'
    const now = Date.now()

    // Check cache first
    if (styleInfoCache.has(cacheKey) && 
        (now - this.lastFetch) < (this.options.cacheTimeout || 0)) {
      return styleInfoCache.get(cacheKey)!
    }

    const allStyles: CitationStyleInfo[] = []

    // Always include core styles
    allStyles.push(...CORE_STYLES)

    // Fetch from Zotero if enabled
    if (this.options.includeZotero) {
      try {
        const zoteroStyles = await this.fetchZoteroStyles()
        // Merge, avoiding duplicates
        const coreIds = new Set(CORE_STYLES.map(s => s.id))
        const uniqueZoteroStyles = zoteroStyles.filter(s => !coreIds.has(s.id))
        allStyles.push(...uniqueZoteroStyles)
      } catch (error) {
        console.warn('Failed to fetch Zotero styles, using core styles only:', error)
      }
    }

    // Add local custom styles if enabled
    if (this.options.includeLocal) {
      const localStyles = await this.getLocalStyles()
      allStyles.push(...localStyles)
    }

    // Sort by popularity/name
    allStyles.sort((a, b) => {
      // Core styles first
      const aIsCore = CORE_STYLES.some(core => core.id === a.id)
      const bIsCore = CORE_STYLES.some(core => core.id === b.id)
      
      if (aIsCore && !bIsCore) return -1
      if (!aIsCore && bIsCore) return 1
      
      // Then by name
      return a.name.localeCompare(b.name)
    })

    // Cache the result
    styleInfoCache.set(cacheKey, allStyles)
    this.lastFetch = now

    return allStyles
  }

  /**
   * Fetch styles from Zotero Style Repository
   */
  private async fetchZoteroStyles(): Promise<CitationStyleInfo[]> {
    try {
      const response = await fetch(ZOTERO_STYLES_API, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'GenPaper Citation Engine'
        }
      })

      if (!response.ok) {
        throw new Error(`Zotero API responded with ${response.status}`)
      }

      const data = await response.json()
      
      // Transform Zotero format to our format
      return Object.entries(data).map(([id, info]: [string, any]) => ({
        id,
        name: info.title || id,
        category: this.categorizeStyle(info),
        description: info.summary,
        example: this.generateExample(info)
      }))
    } catch (error) {
      console.error('Failed to fetch Zotero styles:', error)
      return []
    }
  }

  /**
   * Get local custom styles
   */
  private async getLocalStyles(): Promise<CitationStyleInfo[]> {
    // Guard against server-side execution
    if (typeof window === 'undefined') {
      return [] // Return empty array on server
    }
    // In a real implementation, this would:
    // 1. Check lose forcalStoragded  user-adtyles
    // 2. Load organization-specific styles from a config
    // 3. Check for custom CSL files in a local directory
    
    return [
      // Example custom styles
      { 
        id: 'custom-company-style', 
        name: 'Company Internal Style', 
        category: 'author-date', 
        example: '(Smith 2023)',
        description: 'Internal citation style for company reports'
      }
    ]
  }

  /**
   * Load a specific citation style
   */
  async loadStyle(styleId: string): Promise<any> {
    // Check cache first
    if (styleCache.has(styleId)) {
      return styleCache.get(styleId)
    }

    let styleDefinition: any

    // Try to load from various sources
    try {
      // 1. Try Zotero CDN
      styleDefinition = await this.loadFromZotero(styleId)
    } catch (error) {
      console.warn(`Failed to load ${styleId} from Zotero:`, error)
      
      try {
        // 2. Try local storage
        styleDefinition = await this.loadFromLocal(styleId)
      } catch (localError) {
        console.warn(`Failed to load ${styleId} from local:`, localError)
        
        // 3. Use built-in fallback
        styleDefinition = this.getBuiltinStyle(styleId)
      }
    }

    if (styleDefinition) {
      styleCache.set(styleId, styleDefinition)
    }

    return styleDefinition
  }

  /**
   * Load style from Zotero CDN
   */
  private async loadFromZotero(styleId: string): Promise<any> {
    const url = `${ZOTERO_STYLE_CDN}/${styleId}.csl`
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/xml, text/xml',
        'User-Agent': 'GenPaper Citation Engine'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch style from Zotero: ${response.status}`)
    }

    const cslXml = await response.text()
    
    // In a real implementation, you'd parse the CSL XML
    // For now, return a placeholder that citation-js can work with
    return {
      id: styleId,
      csl: cslXml,
      loaded: true
    }
  }

  /**
   * Load style from local storage (client-side only)
   */
  private async loadFromLocal(styleId: string): Promise<any> {
    // Guard against server-side execution
    if (typeof window === 'undefined') {
      throw new Error(`Style ${styleId} not available on server (localStorage unavailable)`)
    }

    // Check localStorage for custom styles
    const localStyles = localStorage.getItem('custom-citation-styles')
    if (localStyles) {
      const styles = JSON.parse(localStyles)
      if (styles[styleId]) {
        return styles[styleId]
      }
    }

    throw new Error(`Style ${styleId} not found in local storage`)
  }

  /**
   * Get built-in style fallback
   */
  private getBuiltinStyle(styleId: string): any {
    // Return a basic style definition that citation-js can use
    const coreStyle = CORE_STYLES.find(s => s.id === styleId)
    if (coreStyle) {
      return {
        id: styleId,
        name: coreStyle.name,
        category: coreStyle.category,
        builtin: true
      }
    }

    // Ultimate fallback
    return {
      id: styleId,
      name: styleId,
      category: 'author-date',
      builtin: true
    }
  }

  /**
   * Search styles by query
   */
  async searchStyles(query: string): Promise<CitationStyleInfo[]> {
    const allStyles = await this.getAvailableStyles()
    const lowercaseQuery = query.toLowerCase()
    
    return allStyles.filter(style => 
      style.name.toLowerCase().includes(lowercaseQuery) ||
      style.id.toLowerCase().includes(lowercaseQuery) ||
      style.category.toLowerCase().includes(lowercaseQuery) ||
      style.description?.toLowerCase().includes(lowercaseQuery)
    )
  }

  /**
   * Get styles by category
   */
  async getStylesByCategory(category: CitationStyleInfo['category']): Promise<CitationStyleInfo[]> {
    const allStyles = await this.getAvailableStyles()
    return allStyles.filter(style => style.category === category)
  }

  /**
   * Add a custom style (client-side only)
   */
  async addCustomStyle(style: CitationStyleInfo, cslDefinition: string): Promise<void> {
    // Guard against server-side execution
    if (typeof window === 'undefined') {
      throw new Error('Custom styles can only be added on client-side (localStorage unavailable)')
    }

    // Store in localStorage
    const localStyles = JSON.parse(localStorage.getItem('custom-citation-styles') || '{}')
    localStyles[style.id] = {
      ...style,
      csl: cslDefinition,
      custom: true,
      added: new Date().toISOString()
    }
    localStorage.setItem('custom-citation-styles', JSON.stringify(localStyles))

    // Clear cache to force refresh
    styleInfoCache.clear()
    styleCache.delete(style.id)
  }

  /**
   * Remove a custom style (client-side only)
   */
  async removeCustomStyle(styleId: string): Promise<void> {
    // Guard against server-side execution
    if (typeof window === 'undefined') {
      throw new Error('Custom styles can only be removed on client-side (localStorage unavailable)')
    }

    const localStyles = JSON.parse(localStorage.getItem('custom-citation-styles') || '{}')
    delete localStyles[styleId]
    localStorage.setItem('custom-citation-styles', JSON.stringify(localStyles))

    // Clear cache
    styleInfoCache.clear()
    styleCache.delete(styleId)
  }

  /**
   * Categorize a style based on its properties
   */
  private categorizeStyle(styleInfo: any): CitationStyleInfo['category'] {
    const title = (styleInfo.title || '').toLowerCase()
    const summary = (styleInfo.summary || '').toLowerCase()
    
    if (title.includes('note') || summary.includes('footnote') || summary.includes('endnote')) {
      return 'note'
    }
    
    if (title.includes('numeric') || summary.includes('numeric') || summary.includes('numbered')) {
      return 'numeric'
    }
    
    if (title.includes('label') || summary.includes('label')) {
      return 'label'
    }
    
    // Default to author-date
    return 'author-date'
  }

  /**
   * Generate an example citation for a style
   */
  private generateExample(styleInfo: any): string {
    const category = this.categorizeStyle(styleInfo)
    
    switch (category) {
      case 'numeric':
        return '[1]'
      case 'note':
        return '¹'
      case 'label':
        return '[Smi23]'
      default:
        return '(Smith, 2023)'
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    styleCache.clear()
    styleInfoCache.clear()
    this.lastFetch = 0
  }
}

// Disable remote Zotero fetch by default for immediate performance.
export const styleRepository = new StyleRepository({ includeZotero: false, includeLocal: false }) 