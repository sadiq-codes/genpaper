# Database Migration Conventions

This document outlines the conventions for creating and organizing database migrations.

## File Naming

Migrations follow the naming pattern:
```
YYYYMMDDHHMMSS_description.sql
```

Example: `20260115120000_create_users_table.sql`

## RLS Policy Convention

**Important:** Row Level Security (RLS) policies should be created in a **separate migration file** alongside the table creation migration.

### Recommended Pattern

When creating a new table:

1. **Table migration:** `20260115120000_create_users_table.sql`
   - CREATE TABLE statement
   - Indexes
   - Triggers (if any)

2. **RLS migration:** `20260115120001_create_users_rls.sql`
   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY
   - CREATE POLICY statements

### Example

**`20260115120000_create_documents.sql`**
```sql
-- Create the documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
```

**`20260115120001_create_documents_rls.sql`**
```sql
-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own documents
CREATE POLICY "Users can view own documents"
  ON documents
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own documents
CREATE POLICY "Users can insert own documents"
  ON documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own documents
CREATE POLICY "Users can update own documents"
  ON documents
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own documents
CREATE POLICY "Users can delete own documents"
  ON documents
  FOR DELETE
  USING (auth.uid() = user_id);
```

## Benefits of Separate RLS Migrations

1. **Easier Review:** Security policies can be reviewed independently
2. **Simpler Rollback:** Can rollback RLS without affecting table structure
3. **Clear Audit Trail:** Security changes are tracked separately
4. **Better Testing:** Test table structure and policies independently

## Existing Tables

For existing tables, RLS policies are consolidated in:
- `20260114100000_enable_row_level_security.sql`

Future changes should follow the new convention.

## Running Migrations

```bash
# Apply all pending migrations
npx supabase db push

# Create a new migration
npx supabase migration new description_here

# Check migration status
npx supabase db diff
```

## Policy Naming Convention

Use descriptive names that indicate:
1. The operation (SELECT, INSERT, UPDATE, DELETE)
2. The scope (own, team, public)
3. Any conditions

Examples:
- `"Users can view own documents"`
- `"Team members can view team projects"`
- `"Anyone can view published papers"`
- `"Admins can delete any document"`
