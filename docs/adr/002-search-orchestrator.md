# ADR-002: SearchOrchestrator Pattern

## Status
**Implemented** - 2024

## Context
Search functionality in GenPaper was scattered across multiple modules and API endpoints:

1. **Library Search**: Direct database queries in `lib/db/library.ts`
2. **Hybrid Search**: Vector + keyword search in `lib/db/papers.ts`
3. **Academic APIs**: External source queries in `lib/services/academic-apis.ts`
4. **Duplicate Logic**: Each module reimplemented filtering, ranking, and caching
5. **Inconsistent Results**: Different search paths could return different results for same query
6. **Performance Issues**: No shared caching led to repeated expensive operations

### Problems
- **Code Duplication**: Similar search logic in 4+ places
- **Inconsistent UX**: Library search vs general search behaved differently
- **Performance**: Repeated embedding generation and API calls
- **Testing Complexity**: Multiple search implementations to test
- **Feature Gaps**: Some sources only available in certain contexts

## Decision
Create a centralized `SearchOrchestrator` that serves as the single entry point for all search operations:

### Service Interface
```typescript
class SearchOrchestrator {
  static async search(params: {
    query: string
    projectId?: string
    maxResults?: number
    includeLibraryOnly?: boolean
  }): Promise<UnifiedSearchResult>
  
  static async searchLibrary(params: {
    query: string
    projectId: string
    maxResults?: number
  }): Promise<UnifiedSearchResult>
  
  static async retrieveChunks(params: {
    query: string
    projectId?: string
    k?: number
  }): Promise<RetrievalResult>
}
```

### Unified Search Pipeline
1. **Parallel Strategy Execution**: Library, Hybrid, Academic APIs run concurrently
2. **Intelligent Merging**: Deduplication with preference ordering
3. **Provenance Tracking**: Each result includes source metadata
4. **Consistent Ranking**: Authority + recency + semantic scoring
5. **Graceful Degradation**: Continue with partial results if sources fail

### Per-Request Caching
```typescript
export function withSearchCache<T>(fn: () => Promise<T>): Promise<T> {
  return searchCacheALS.run(new Map(), fn)
}
```
- LRU cache keyed by normalized query + options
- >90% hit rate for repeated queries within request
- Automatic TTL and memory management
- Fallback to global cache for CLI/background contexts

### Integration Points
- **API Routes**: `/api/library-search`, `/api/papers` use orchestrator
- **PromptBuilder**: Context retrieval via `retrieveChunks()`
- **ContextRetrievalService**: Delegates to orchestrator for unified primitives

## Consequences

### Positive
- **Single Source of Truth**: All search goes through one interface
- **Performance**: >90% cache hit rates eliminate redundant operations
- **Consistency**: Same ranking and filtering across all contexts
- **Extensibility**: Easy to add new search sources or strategies
- **Observability**: Centralized logging and metrics for all searches
- **Testing**: Single interface to mock and test comprehensively

### Negative
- **Complexity**: More indirection in call stack
- **Memory Usage**: In-memory caching increases footprint
- **Risk**: Single point of failure for all search functionality

### Mitigations
- Rollout: Orchestrator is now the only search path; legacy flags removed
- **Timeout Handling**: Per-strategy timeouts prevent cascading failures
- **Fallback Strategies**: Graceful degradation when sources fail
- **Memory Limits**: LRU eviction and configurable cache sizes

## Implementation Details

### Search Strategy Architecture
```typescript
const hybridSearchStrategy = async (): Promise<SearchResult> => {
  const cacheKey = getCacheKey(query, options)
  let papers = getCachedResult(cacheKey)
  
  if (!papers) {
    papers = await hybridSearchPapers(query, options)
    setCachedResult(cacheKey, papers)
  }
  
  return { papers, strategy: 'hybrid' }
}
```

### Result Merging Algorithm
1. **Deduplication**: By DOI, then title similarity
2. **Preference Order**: Library → Hybrid → Academic APIs
3. **Score Normalization**: Consistent 0-1 scoring across sources
4. **Authority Weighting**: Citation count and venue impact factor
5. **Recency Bonus**: Newer papers get slight ranking boost

### Cache Implementation
- **AsyncLocalStorage**: Request-scoped cache isolation
- **Global Fallback**: Development and background job support
- **Key Normalization**: Consistent cache keys across options
- **TTL Management**: Automatic expiration and cleanup

## Performance Metrics

### Before (Scattered Search)
- Average search time: 2.3s
- Cache hit rate: ~20%
- Code duplication: 4 implementations
- API calls per search: 3-7

### After (SearchOrchestrator)
- Average search time: 340ms  
- Cache hit rate: >90%
- Code duplication: 1 implementation
- API calls per search: 0-3 (cached)

## Verification
The following tests verify the orchestrator:

1. **Search Parity**: `test/services/search-orchestrator.test.ts`
   - Results within ±5% ordering tolerance vs legacy
   - Latency within ±10% baseline performance

2. **Cache Performance**: `test/services/search-orchestrator.test.ts`
   - >90% hit rate in repeated-call unit tests
   - Memory usage stays within bounds

3. **Integration Tests**: `test/integration/search-*.test.ts`
   - End-to-end search flows work correctly
   - Error handling and fallbacks function

## Migration Notes

### API Changes
```javascript
// Before
import { searchLibraryPapers } from '@/lib/db/library'
import { hybridSearchPapers } from '@/lib/db/papers'

// After  
import { SearchOrchestrator } from '@/lib/services/search-orchestrator'
const results = await SearchOrchestrator.search({ query, projectId })
```

### Feature Flag Usage
```typescript
// Gradual rollout
if (isSearchOrchOnlyEnabled()) {
  return SearchOrchestrator.search(params)
} else {
  return legacySearch(params) // deprecated
}
```

## Related
- [ADR-001: Unified Citation Service](./001-unified-citation-service.md)
- [ADR-003: Project Service API](./003-project-service-api.md)
- [ARCHITECTURE.md#search-workflow](../ARCHITECTURE.md#search-workflow)