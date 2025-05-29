-- Test script to verify references_list field was added correctly
-- Run this after applying the add_references_list_field.sql migration

-- 1. Check that the column exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'projects' AND column_name = 'references_list';

-- 2. Check that the index was created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'projects' AND indexname = 'idx_projects_references_list';

-- 3. Test inserting a sample references list (replace 'your-project-id' with an actual project ID)
-- UPDATE projects 
-- SET references_list = '[
--   "Smith, J. (2023). Sample Reference 1. Journal of Research, 10(2), 123-145.",
--   "Doe, A. (2022). Another Reference. Academic Press."
-- ]'::jsonb
-- WHERE id = 'your-project-id';

-- 4. Test querying the field
-- SELECT id, title, references_list 
-- FROM projects 
-- WHERE references_list IS NOT NULL AND jsonb_array_length(references_list) > 0;

-- Expected results:
-- 1. Should show references_list column with type 'jsonb' and default '[]'
-- 2. Should show the GIN index on references_list field
-- 3. Update should work without errors
-- 4. Query should return projects with non-empty references lists 