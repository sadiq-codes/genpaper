# ADR-001: Unified Citation Service

## Status
**Implemented** - 2024

## Context
Prior to this change, citation logic was duplicated across multiple paths in the GenPaper codebase:

1. **UI Path**: Manual citations added via frontend components called database functions directly
2. **AI Path**: AI tools during generation called different database functions with different validation
3. **Inconsistent Formatting**: Different citation styles could produce different results for the same paper
4. **Race Conditions**: Concurrent citation adds could create duplicate entries
5. **Maintenance Burden**: Changes to citation logic required updates in multiple places

This led to several production issues:
- Duplicate citations appearing in generated papers
- Inconsistent author formatting between UI and AI-generated citations  
- Difficulty adding new citation styles (MLA, Chicago, etc.)
- Testing complexity due to multiple code paths

## Decision
We will create a single `CitationService` that centralizes all citation-related operations:

### Service Interface
```typescript
class CitationService {
  static async add(params: AddCitationParams): Promise<AddCitationResult>
  static async resolveSourceRef(sourceRef: SourceRef): Promise<string | null>
  static async renderInline(cslJson: any, style: string, number: number): Promise<string>
  static async renderBibliography(projectId: string, style?: string): Promise<BibliographyResult>
  static async suggest(projectId: string, context: string): Promise<string[]>
}
```

### Single Write Path
- Both UI and AI tools call `/api/citations` endpoint
- API endpoint delegates to `CitationService`
- All database writes go through the service layer
- Consistent validation and CSL normalization

### Idempotent Operations  
- `UNIQUE(project_id, paper_id)` database constraint
- Upsert behavior prevents race conditions
- Stable `cite_key` generation for consistent references
- `first_seen_order` for deterministic numbering

### Source Resolution
- `resolveSourceRef()` handles DOI/title/URL → paperId mapping
- DOI normalization (removes prefixes, casing)
- Fuzzy title matching with Levenshtein distance ≤2
- Prefers papers already cited in the project

## Consequences

### Positive
- **Consistency**: Identical citations from UI and AI paths
- **Maintainability**: Single place to update citation logic
- **Extensibility**: Easy to add new citation styles
- **Reliability**: Race-safe operations prevent duplicates
- **Testing**: Simplified test surface with unified interface
- **Performance**: Batch citation resolution reduces API calls

### Negative
- **API Overhead**: AI tools now make HTTP calls vs direct DB access
- **Complexity**: Additional service layer indirection
- **Migration**: Required updates across codebase

### Mitigations
- Batch citation API endpoint to reduce HTTP overhead
- Feature flags to safely roll out changes
- Comprehensive contract tests to ensure UI/AI parity
- Fallback formatting for unresolved citations

## Implementation Notes

### Database Schema
```sql
-- Enhanced project_citations table
ALTER TABLE project_citations 
ADD COLUMN cite_key TEXT NOT NULL,
ADD COLUMN first_seen_order INTEGER NOT NULL,
ADD CONSTRAINT unique_project_paper UNIQUE(project_id, paper_id),
ADD CONSTRAINT unique_project_cite_key UNIQUE(project_id, cite_key);
```

### CSL Validation
- Zod schema validation for consistent CSL JSON structure
- citation-js library for style-specific formatting
- Author normalization and date standardization

### Feature Flags
- `CITATIONS_UNIFIED`: Enable service for new citations (legacy `GENPIPE_UNIFIED_CITATIONS` merged)
- `CITATIONS_UNIFIED`: Force all citations through service

## Verification
The following tests verify the decision:

1. **Contract Test**: `test/citations/contract-parity.test.ts`
   - UI and AI paths produce identical `citeKey` and CSL for same paper
   
2. **Golden Tests**: `test/utils/csl.test.ts`
   - Formatting consistency across citation styles
   - Snapshot tests lock formatting behavior

3. **Concurrency Test**: `test/citations/simplified-system.test.ts`
   - Parallel citation adds result in single database row

## Related
- [ADR-002: SearchOrchestrator Pattern](./002-search-orchestrator.md)
- [ADR-004: Module Boundary Enforcement](./004-module-boundaries.md)
- [ARCHITECTURE.md#citation-workflow](../ARCHITECTURE.md#citation-workflow)