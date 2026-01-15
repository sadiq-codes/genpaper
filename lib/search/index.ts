/**
 * Search Module Barrel File
 * 
 * Centralized exports for all search-related functionality
 */

export {
  unifiedSearch,
  type UnifiedSearchOptions,
  type UnifiedSearchResult
} from '@/lib/services/search-orchestrator'

export {
  deduplicatePapers,
  simpleDeduplicatePapers,
  normalizeTitle,
  normalizeDoi,
  type DeduplicatablePaper,
  type DeduplicatedPaper,
  type DeduplicationOptions
} from './deduplication'

export {
  isSourceAvailable,
  recordSuccess,
  recordFailure,
  getCircuitState,
  getAllCircuitStates,
  resetCircuit,
  resetAllCircuits,
  withCircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  type CircuitBreakerConfig
} from './circuit-breaker'

export {
  getCached,
  setCached,
  isCached,
  clearSourceCache,
  clearAllCache,
  getCacheStats,
  withCache,
  type CacheConfig
} from './source-cache' 