Looking at your types folder, you have several type definition files. Let me examine them to understand your type structure and provide guidance on which types to use when.
Read file: types/simplified.ts
Read file: types/database.ts
Read file: types/citation-js.d.ts
Read file: types/supabase.ts
Based on my analysis of your types folder, here's a comprehensive guide on **which types you should use for your project**:

## Type Usage Guidelines

### 1. **Use `@/types/simplified.ts` for Application Logic** ✅

**Primary types for your frontend and business logic:**
- `Paper` - For displaying papers in UI components
- `Author` - For author data in UI
- `LibraryPaper` - For library-related functionality
- `ResearchProject` - For project management
- `GenerationConfig` - For AI generation settings
- `LibraryFilters` - For filtering/search functionality

**Why:** These types use `undefined` for optional fields (JavaScript convention) and are designed for your application's specific needs.

### 2. **Use `@/types/supabase.ts` for Database Operations** ⚠️

**Database layer types (use with `Tables<'table_name'>`):**
- `Tables<'papers'>` - Raw database paper data
- `Tables<'authors'>` - Raw database author data  
- `Tables<'library_papers'>` - Raw database library data
- `TablesInsert<'papers'>` - For inserting new records
- `TablesUpdate<'papers'>` - For updating records

**Why:** These are auto-generated from your Supabase schema and use `null` for optional fields (SQL convention).

### 3. **Transform Between Type Systems**

**The key pattern you should follow:**

```typescript
// In database layer (lib/db/*.ts)
import { Tables } from '@/types/supabase'
import { Paper, Author } from '@/types/simplified'

// Use Supabase types for queries
type DbPaper = Tables<'papers'>
type DbAuthor = Tables<'authors'>

// Transform to simplified types for return values
function transformToAppPaper(dbPaper: DbPaper): Paper {
  return {
    id: dbPaper.id,
    title: dbPaper.title,
    abstract: dbPaper.abstract ?? undefined, // null → undefined
    // ... other fields
  }
}
```

### 4. **Specialized Types for Specific Use Cases**

- **`@/types/database.ts`** - Use for citation management features
- **`@/types/citation-js.d.ts`** - Use when working with citation.js library

## Recommended Architecture

```
┌─ Frontend Components ─┐    ┌─ API Routes ─┐    ┌─ Database Layer ─┐
│   @/types/simplified   │◄──►│  Transform   │◄──►│ @/types/supabase │
│   - Paper             │    │   Layer      │    │ - Tables<''>     │
│   - Author            │    │              │    │ - TablesInsert   │
│   - LibraryPaper      │    │              │    │ - TablesUpdate   │
└─────────────────────┘    └──────────────┘    └──────────────────┘
```

## Examples of Correct Usage

### ✅ Frontend Component
```typescript
import { Paper, Author } from '@/types/simplified'

function PaperCard({ paper }: { paper: Paper }) {
  return <div>{paper.title}</div>
}
```

### ✅ Database Function
```typescript
import { Tables } from '@/types/supabase'
import { Paper } from '@/types/simplified'

export async function getPaper(id: string): Promise<Paper> {
  const dbPaper: Tables<'papers'> = await query()
  
  return {
    id: dbPaper.id,
    title: dbPaper.title,
    abstract: dbPaper.abstract ?? undefined,
    // ... transform other fields
  }
}
```

### ✅ API Route
```typescript
import { Paper } from '@/types/simplified'

export async function GET(): Promise<{ papers: Paper[] }> {
  const papers = await getPapersFromDB() // Returns Paper[]
  return { papers }
}
```

## Key Takeaways

1. **Frontend/UI**: Always use `@/types/simplified.ts`
2. **Database queries**: Use `@/types/supabase.ts` 
3. **Transform at boundaries**: Convert between type systems in your database layer
4. **Consistent patterns**: Use the transformation pattern we implemented in `lib/db/library.ts`

This approach gives you type safety while maintaining clean separation between your database schema and application logic.