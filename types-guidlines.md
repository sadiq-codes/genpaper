# Type Usage Guidelines

## Type Files

| File | Purpose | Used By |
|------|---------|---------|
| `types/simplified.ts` | App-level types for UI, API, and business logic | 20+ files across `lib/`, `components/`, `app/api/` |
| `types/supabase.ts` | Auto-generated DB schema types | `lib/supabase/types.ts`, `lib/supabase/server.ts` |
| `types/subscription.ts` | Billing tiers, limits, subscription config | 9 files in billing/pricing |
| `types/citation-js.d.ts` | Module declarations for `citation-js` library | Used implicitly via library imports |
| `components/editor/types.ts` | Editor-specific types (claims, gaps, analysis, cursor) | Editor components only |
| `lib/supabase/types.ts` | Typed helpers wrapping `types/supabase.ts` | `lib/db/` files |

## Which Types to Use Where

### Frontend Components → `@/types/simplified`

```typescript
import { Paper, LibraryPaper, ResearchProject } from '@/types/simplified'
```

These use `undefined` for optional fields (JS convention). Use for all UI rendering.

### Editor Components → `components/editor/types`

```typescript
import type { ProjectPaper, Citation, ExtractedClaim } from '../types'
```

The editor has its own `ProjectPaper` type (simplified shape with `year`, `authors: string[]`). Don't mix with `Paper` from `types/simplified.ts`.

### Database Layer (`lib/db/`) → `lib/supabase/types`

```typescript
import { PaperRow, extractAuthors } from '@/lib/supabase/types'
```

Use `PaperRow`, `LibraryPaperRow`, etc. for raw query results. Transform to app types before returning.

### API Routes → `@/types/simplified` for request/response shapes

```typescript
import { PaperTypeKey, GenerationConfig } from '@/types/simplified'
```

### Billing → `@/types/subscription`

```typescript
import { SubscriptionTier, getTierLimits } from '@/types/subscription'
```

## The Transform Pattern

Convert DB types to app types at the `lib/db/` boundary:

```typescript
// lib/db/library.ts (the reference implementation)
import { PaperRow, LibraryPaperRow, extractAuthors } from '@/lib/supabase/types'
import { LibraryPaper } from '@/types/simplified'

function transformLibraryPaper(row: LibraryPaperRow & { paper: PaperRow }): LibraryPaper {
  return {
    id: row.paper.id,
    title: row.paper.title,
    authors: extractAuthors(row.paper),
    abstract: row.paper.abstract ?? undefined,  // null → undefined
    // ...
  }
}
```

**Key rule:** `null` (SQL) → `undefined` (JS) at the boundary.

## Auto-Generating Supabase Types

After any migration, regenerate:

```bash
pnpm types:generate
# runs: supabase gen types typescript --linked > types/supabase.ts
```

The generated file includes all table Row/Insert/Update types. `lib/supabase/types.ts` wraps these with convenience exports (`PaperRow`, `PaperInsert`, etc.) and helpers (`extractAuthors`, `transformPaperRow`).

## Notes

- `authors` is stored as `jsonb` in the DB. Always use `extractAuthors()` from `lib/supabase/types.ts` to parse it to `string[]`.
- `embedding` columns are `vector(1024)` (BGE-large-en-v1.5). Nullable after the dimension upgrade migration.
- `types/database.ts` does not exist — all DB types come from the auto-generated `types/supabase.ts`.
- Domain-specific types (generation, RAG, synthesis) are co-located with their modules in `lib/*/types.ts`. This is intentional.
