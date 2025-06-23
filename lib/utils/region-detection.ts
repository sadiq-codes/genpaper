/**
 * Global Region Detection System - Simplified & Optimized
 * 
 * Automatically detects any country in the world using:
 * - Complete country database (250+ countries)
 * - Lazy initialization for performance
 * - In-memory caching for repeated lookups
 * - TLD-based URL detection
 * - Configurable confidence levels
 * - User control and override capabilities
 */

import { getNames, getCode } from 'country-list'

export enum Confidence {
  High = 'high',
  Medium = 'medium', 
  Low = 'low'
}

export enum Source {
  Venue = 'venue',
  Url = 'url',
  Affiliation = 'affiliation',
  Title = 'title',
  User = 'user'
}

export interface RegionDetectionInputs {
  venue?: string
  url?: string
  affiliations?: string[]
  title?: string
}

export interface RegionDetectionOptions {
  enabled?: boolean           // User toggle for auto-detection
  overrideRegion?: string    // User-specified region (takes precedence)
  order?: Source[]           // Detection priority order
  enableDebug?: boolean      // Performance/debug information (dev only)
  fallbackRegion?: string    // Default region if none detected
  confidenceConfig?: ConfidenceConfig // Custom confidence rules
}

export interface ConfidenceConfig {
  highSources: Source[]      // Sources that yield high confidence
  mediumSources: Source[]    // Sources that yield medium confidence
  lowSources: Source[]       // Sources that yield low confidence
}

export interface RegionDetectionResult {
  region: string | null
  confidence: Confidence
  source: Source | null
  matchedPattern?: string
  matchedText?: string
  wasOverridden?: boolean
  debugInfo?: {
    cacheHit: boolean
    patterns_checked: number
    detection_time_ms: number
    countries_available: number
  }
}

/**
 * Default confidence configuration
 */
const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  highSources: [Source.Url, Source.Affiliation],
  mediumSources: [Source.Venue],
  lowSources: [Source.Title]
}

/**
 * Lightweight TLD extractor - replaces heavy tldjs
 */
function extractTLD(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
    const parts = hostname.split('.')
    if (parts.length < 2) return null
    
    // Handle cases like .co.uk, .edu.ng
    const lastPart = parts[parts.length - 1]
    const secondLast = parts[parts.length - 2]
    
    if (parts.length >= 3 && ['co', 'edu', 'ac', 'gov', 'org'].includes(secondLast)) {
      return lastPart
    }
    
    return lastPart
  } catch {
    return null
  }
}

/**
 * Global country patterns - singleton with lazy initialization
 */
class GlobalCountryPatterns {
  private static instance: GlobalCountryPatterns
  private countryPatterns: Record<string, RegExp> = {}
  private countryAliases: Record<string, string> = {}
  private tldCountryMap: Record<string, string> = {}
  private initialized = false

  static getInstance(): GlobalCountryPatterns {
    if (!GlobalCountryPatterns.instance) {
      GlobalCountryPatterns.instance = new GlobalCountryPatterns()
    }
    return GlobalCountryPatterns.instance
  }

  private constructor() {
    // Don't initialize immediately - wait for first use
  }

  private initialize() {
    if (this.initialized) return

    try {
      // Build patterns for all countries
      const countryNames = getNames()
      
      for (const countryName of countryNames) {
        // Create regex pattern for country name (handle spaces and special characters)
        const escapedName = countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = escapedName.replace(/\s+/g, '\\s+')
        this.countryPatterns[countryName] = new RegExp(`\\b${pattern}\\b`, 'i')
        
        // Build TLD mapping
        const countryCode = getCode(countryName)
        if (countryCode) {
          this.tldCountryMap[countryCode.toLowerCase()] = countryName
        }
      }

      // Add common aliases
      this.addCommonAliases()
      
      this.initialized = true
    } catch (error) {
      console.warn('Failed to initialize global country patterns:', error)
      this.initialized = false
    }
  }

  private addCommonAliases() {
    // Add essential aliases only - keep it minimal
    const aliases: Record<string, string> = {
      'USA': 'United States',
      'US': 'United States', 
      'America': 'United States',
      'UK': 'United Kingdom',
      'Britain': 'United Kingdom',
      'England': 'United Kingdom',
      'Korea': 'South Korea',
      'Russia': 'Russian Federation'
    }

    for (const [alias, canonical] of Object.entries(aliases)) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      this.countryPatterns[alias] = new RegExp(`\\b${escapedAlias}\\b`, 'i')
      this.countryAliases[alias.toLowerCase()] = canonical
    }

    // Additional TLD mappings
    const additionalTlds: Record<string, string> = {
      'uk': 'United Kingdom',
      'eu': 'European Union'
    }

    for (const [tld, country] of Object.entries(additionalTlds)) {
      if (!this.tldCountryMap[tld]) {
        this.tldCountryMap[tld] = country
      }
    }
  }

  getCountryPatterns(): Record<string, RegExp> {
    this.initialize()
    return this.countryPatterns
  }

  getTldCountryMap(): Record<string, string> {
    this.initialize()
    return this.tldCountryMap
  }

  getAvailableCountries(): string[] {
    this.initialize()
    return getNames()
  }

  resolveCountryAlias(input: string): string {
    this.initialize()
    const normalized = input.toLowerCase()
    return this.countryAliases[normalized] || input
  }

  getPatternCount(): number {
    this.initialize()
    return Object.keys(this.countryPatterns).length
  }
}

/**
 * Region detector with caching and optimized performance
 */
export class RegionDetector {
  private patterns = GlobalCountryPatterns.getInstance()
  private cache = new Map<string, RegionDetectionResult>()
  private readonly maxCacheSize = 1000 // Prevent memory leaks

  /**
   * Detect region from text using optimized pattern matching
   */
     private detectFromText(
     text: string, 
     source: Source, 
     confidenceConfig: ConfidenceConfig
   ): RegionDetectionResult | null {
     const patterns = this.patterns.getCountryPatterns()

     for (const [country, regex] of Object.entries(patterns)) {
       if (regex.test(text)) {
        // Determine confidence based on source
        let confidence: Confidence
        if (confidenceConfig.highSources.includes(source)) {
          confidence = Confidence.High
        } else if (confidenceConfig.mediumSources.includes(source)) {
          confidence = Confidence.Medium
        } else {
          confidence = Confidence.Low
        }

        // Resolve to canonical country name if it's an alias
        const canonicalCountry = this.patterns.resolveCountryAlias(country)

        return {
          region: canonicalCountry,
          confidence,
          source,
          matchedPattern: regex.source,
          matchedText: text,
          wasOverridden: false
        }
      }
    }

    return null
  }

  /**
   * Detect region from URL using TLD and hostname analysis
   */
  private detectFromUrl(url: string): RegionDetectionResult | null {
    const tld = extractTLD(url)
    const tldMap = this.patterns.getTldCountryMap()
    
    if (tld && tldMap[tld]) {
      return {
        region: tldMap[tld],
        confidence: Confidence.High,
        source: Source.Url,
        matchedPattern: `TLD: .${tld}`,
        matchedText: url,
        wasOverridden: false
      }
    }

    // Fallback to hostname pattern matching
    try {
      const hostname = new URL(url).hostname
      return this.detectFromText(hostname, Source.Url, DEFAULT_CONFIDENCE_CONFIG)
    } catch {
      return null
    }
  }

  /**
   * Generate cache key for inputs and options
   */
  private getCacheKey(inputs: RegionDetectionInputs, options: RegionDetectionOptions): string {
    // Only cache based on detection inputs, not debug flags
    const cacheInputs = {
      venue: inputs.venue,
      url: inputs.url,
      affiliations: inputs.affiliations,
      title: inputs.title,
      enabled: options.enabled,
      overrideRegion: options.overrideRegion,
      fallbackRegion: options.fallbackRegion,
      order: options.order
    }
    return JSON.stringify(cacheInputs)
  }

  /**
   * Main detection method with caching and optimization
   */
  detect(
    inputs: RegionDetectionInputs,
    options: RegionDetectionOptions = {}
  ): RegionDetectionResult {
    const { 
      enabled = true,           // Default to enabled for better UX
      overrideRegion,
      order = [Source.Url, Source.Affiliation, Source.Venue, Source.Title], 
      enableDebug = false,
      fallbackRegion,
      confidenceConfig = DEFAULT_CONFIDENCE_CONFIG
    } = options
    
    const startTime = enableDebug ? Date.now() : 0

    // User override takes absolute precedence
    if (overrideRegion) {
      const resolvedRegion = this.patterns.resolveCountryAlias(overrideRegion)
      return {
        region: resolvedRegion,
        confidence: Confidence.High,
        source: Source.User,
        matchedText: overrideRegion,
        wasOverridden: true,
        debugInfo: enableDebug ? {
          cacheHit: false,
          patterns_checked: 0,
          detection_time_ms: Date.now() - startTime,
          countries_available: this.patterns.getAvailableCountries().length
        } : undefined
      }
    }

    // If detection is disabled, return fallback or null
    if (!enabled) {
      return {
        region: fallbackRegion || null,
        confidence: fallbackRegion ? Confidence.Medium : Confidence.Low,
        source: null,
        wasOverridden: false,
        debugInfo: enableDebug ? {
          cacheHit: false,
          patterns_checked: 0,
          detection_time_ms: Date.now() - startTime,
          countries_available: this.patterns.getAvailableCountries().length
        } : undefined
      }
    }

    // Check cache first
    const cacheKey = this.getCacheKey(inputs, options)
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!
      if (enableDebug && cached.debugInfo) {
        cached.debugInfo.cacheHit = true
        cached.debugInfo.detection_time_ms = Date.now() - startTime
      }
      return cached
    }

         // Auto-detection is enabled - proceed with pattern matching
     const totalPatternsChecked = 0

    for (const source of order) {
      let result: RegionDetectionResult | null = null

      switch (source) {
        case Source.Url:
          if (inputs.url) {
            result = this.detectFromUrl(inputs.url)
          }
          break
        case Source.Affiliation:
          if (inputs.affiliations && inputs.affiliations.length > 0) {
            for (const affiliation of inputs.affiliations) {
              result = this.detectFromText(affiliation, Source.Affiliation, confidenceConfig)
              if (result) break
            }
          }
          break
        case Source.Venue:
          if (inputs.venue) {
            result = this.detectFromText(inputs.venue, Source.Venue, confidenceConfig)
          }
          break
        case Source.Title:
          if (inputs.title) {
            result = this.detectFromText(inputs.title, Source.Title, confidenceConfig)
          }
          break
      }

      if (result?.region) {
        // Add debug info if requested
        if (enableDebug) {
          result.debugInfo = {
            cacheHit: false,
            patterns_checked: totalPatternsChecked,
            detection_time_ms: Date.now() - startTime,
            countries_available: this.patterns.getAvailableCountries().length
          }
        }

        // Cache the result (with size limit)
        if (this.cache.size >= this.maxCacheSize) {
          // Simple LRU: clear oldest half of cache
          const entries = Array.from(this.cache.entries())
          entries.slice(0, Math.floor(this.maxCacheSize / 2)).forEach(([key]) => {
            this.cache.delete(key)
          })
        }
        this.cache.set(cacheKey, result)

        return result
      }
    }

    // No region detected - return fallback or null
    const fallbackResult: RegionDetectionResult = {
      region: fallbackRegion || null,
      confidence: fallbackRegion ? Confidence.Medium : Confidence.Low,
      source: null, // Clear indication that nothing was detected
      wasOverridden: false,
      debugInfo: enableDebug ? {
        cacheHit: false,
        patterns_checked: totalPatternsChecked,
        detection_time_ms: Date.now() - startTime,
        countries_available: this.patterns.getAvailableCountries().length
      } : undefined
    }

    // Cache negative results too
    this.cache.set(cacheKey, fallbackResult)
    return fallbackResult
  }

  /**
   * Clear the detection cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize
    }
  }
}

/**
 * Global detector instance
 */
const globalDetector = new RegionDetector()

/**
 * Simplified main detection function
 */
export function detectPaperRegion(
  inputs: RegionDetectionInputs,
  options: RegionDetectionOptions = {}
): RegionDetectionResult {
  return globalDetector.detect(inputs, options)
}

/**
 * Unified metadata enrichment function
 */
export function enrichMetadataWithRegion(
  existingMetadata: Record<string, unknown> = {},
  regionResult: RegionDetectionResult
): Record<string, unknown> {
  if (!regionResult.region) {
    return existingMetadata
  }

  const enriched: Record<string, unknown> = {
    ...existingMetadata,
    region: regionResult.region,
    region_confidence: regionResult.confidence,
    region_source: regionResult.source,
    region_matched_pattern: regionResult.matchedPattern,
    region_matched_text: regionResult.matchedText,
    region_was_overridden: regionResult.wasOverridden,
    region_detected_at: new Date().toISOString()
  }

  // Include debug information if available
  if (regionResult.debugInfo) {
    enriched.region_debug = regionResult.debugInfo
  }

  return enriched
}



/**
 * Get all available countries for UI dropdowns
 */
export function getAvailableCountries(): Array<{ 
  code: string
  name: string 
  tld?: string 
}> {
  const patterns = GlobalCountryPatterns.getInstance()
  const countries = patterns.getAvailableCountries()
  const tldMap = patterns.getTldCountryMap()
  
  return countries.map(name => {
    const code = getCode(name) || ''
    const tld = Object.entries(tldMap).find(([, country]) => country === name)?.[0]
    
    return {
      code,
      name,
      tld
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get global detection statistics
 */
export function getGlobalDetectionStats() {
  const patterns = GlobalCountryPatterns.getInstance()
  return {
    countries_supported: patterns.getAvailableCountries().length,
    patterns_available: patterns.getPatternCount(),
    tld_mappings: Object.keys(patterns.getTldCountryMap()).length,
    cache_stats: globalDetector.getCacheStats()
  }
}

/**
 * Utility functions for metadata extraction
 */
export function getPaperRegion(metadata?: Record<string, unknown>): string | null {
  return metadata?.region as string || null
}

export function getRegionDetails(metadata?: Record<string, unknown>): {
  region: string | null
  confidence?: Confidence
  source?: Source
  detectedAt?: string
  wasOverridden?: boolean
} {
  if (!metadata?.region) {
    return { region: null }
  }

  return {
    region: metadata.region as string,
    confidence: metadata.region_confidence as Confidence,
    source: metadata.region_source as Source,
    detectedAt: metadata.region_detected_at as string,
    wasOverridden: metadata.region_was_overridden as boolean
  }
}