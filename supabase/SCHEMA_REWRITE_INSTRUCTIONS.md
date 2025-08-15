# Complete Schema Rewrite - Execution Guide

## 🚨 CRITICAL: Read This First

This migration will **completely restructure your database**, reducing 18 tables to 8 tables (55% reduction). It's a **major operation** that requires careful execution.

## 📋 Pre-Migration Checklist

### ✅ **1. Create Full Database Backup**
```bash
# Create backup with timestamp
pg_dump -h your-db-host -U your-user -d your-db > backup_$(date +%Y%m%d_%H%M%S).sql

# Or using Supabase CLI
supabase db dump --file backup_before_rewrite.sql
```

### ✅ **2. Test on Staging First**
- Apply migration to staging/development environment
- Test all application functionality
- Verify data integrity

### ✅ **3. Schedule Downtime**
- **Estimated time:** 5-15 minutes depending on data size
- **App downtime:** Required during migration
- **Best time:** Low traffic period

## 🚀 Migration Execution

### **Step 1: Stop Application Traffic**
```bash
# Scale down your application or enable maintenance mode
```

### **Step 2: Apply Migration**
```bash
# Method 1: Using psql
psql -h your-db-host -U your-user -d your-db -f supabase/migrations/complete_schema_rewrite.sql

# Method 2: Using Supabase Dashboard
# Copy/paste the contents of complete_schema_rewrite.sql into SQL editor
```

### **Step 3: Verify Migration Success**
```sql
-- Check table counts
SELECT 
  'papers' as table_name, COUNT(*) as count FROM papers
UNION ALL
SELECT 'paper_chunks', COUNT(*) FROM paper_chunks
UNION ALL  
SELECT 'research_projects', COUNT(*) FROM research_projects
UNION ALL
SELECT 'project_citations', COUNT(*) FROM project_citations
UNION ALL
SELECT 'library_papers', COUNT(*) FROM library_papers;

-- Verify authors are properly converted to JSONB
SELECT title, authors FROM papers LIMIT 5;

-- Check indexes are created
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

## 🔧 Post-Migration Steps

### **1. Update Application Code (if needed)**

Most queries will work unchanged, but some may need updates:

#### **Authors Access Pattern Changed:**
```typescript
// BEFORE: Normalized authors
const papers = await supabase
  .from('papers')
  .select(`
    *,
    authors:paper_authors(
      ordinal,
      authors(name)
    )
  `)

// AFTER: Authors in JSONB
const papers = await supabase
  .from('papers')
  .select('*')
// Access authors directly: paper.authors = ["Author 1", "Author 2"]
```

#### **Library Collections Simplified:**
```typescript
// BEFORE: Normalized collections
const library = await supabase
  .from('library_papers')
  .select(`
    *,
    collections:collection_papers(
      library_collections(name)
    )
  `)

// AFTER: Collection as text field
const library = await supabase
  .from('library_papers')
  .select('*')
// Access collection: item.collection = "Research Papers"
```

### **2. Test Critical Functionality**
- [ ] Paper search and discovery
- [ ] PDF processing pipeline  
- [ ] Citation management
- [ ] Library management
- [ ] User authentication
- [ ] Project creation and generation

### **3. Performance Monitoring**
```sql
-- Monitor query performance
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
WHERE query LIKE '%papers%' 
ORDER BY total_time DESC 
LIMIT 10;
```

## 🆘 Rollback Plan

If something goes wrong, you can rollback:

```bash
# Apply rollback script
psql -h your-db-host -U your-user -d your-db -f supabase/migrations/rollback_schema_rewrite.sql

# Or restore from backup
psql -h your-db-host -U your-user -d your-db < backup_before_rewrite.sql
```

## 📊 Expected Results

### **Before Migration:**
- **18 tables** with complex relationships
- **papers table:** 24 columns
- **Complex JOINs** for basic operations
- **Multiple library tables** for simple features

### **After Migration:**
- **8 tables** with simplified relationships
- **papers table:** 12 essential columns
- **Simpler queries** with JSONB fields
- **Single library table** with array fields

## 🎯 Benefits You'll See

### **Immediate:**
- ✅ **Simpler queries:** Fewer JOINs needed
- ✅ **Better performance:** Reduced complexity
- ✅ **Easier maintenance:** Fewer tables to manage

### **Long-term:**
- ✅ **Faster development:** Simpler schema = faster features
- ✅ **Better onboarding:** New devs understand faster
- ✅ **Reduced bugs:** Less complexity = fewer edge cases

## 🧹 Cleanup (After 1 Week)

Once you've verified everything works:

```sql
-- Drop backup tables to reclaim space
DROP TABLE IF EXISTS papers_backup CASCADE;
DROP TABLE IF EXISTS paper_chunks_backup CASCADE;
DROP TABLE IF EXISTS research_projects_backup CASCADE;
DROP TABLE IF EXISTS project_citations_backup CASCADE;
DROP TABLE IF EXISTS profiles_backup CASCADE;
DROP TABLE IF EXISTS library_papers_backup CASCADE;
DROP TABLE IF EXISTS authors_backup CASCADE;
DROP TABLE IF EXISTS paper_authors_backup CASCADE;
DROP TABLE IF EXISTS library_collections_backup CASCADE;
DROP TABLE IF EXISTS collection_papers_backup CASCADE;
DROP TABLE IF EXISTS tags_backup CASCADE;
DROP TABLE IF EXISTS library_paper_tags_backup CASCADE;
DROP TABLE IF EXISTS paper_references_backup CASCADE;
DROP TABLE IF EXISTS pdf_processing_logs_backup CASCADE;
DROP TABLE IF EXISTS failed_chunks_backup CASCADE;
```

## 🎉 Congratulations!

You've successfully simplified your database from 18 tables to 8 tables while maintaining all core functionality. Your system is now much more maintainable and performant! 🚀
