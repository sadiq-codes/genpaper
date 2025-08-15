-- PHASE 1: SAFE CLEANUP - Remove completely unused tables
-- Based on codebase analysis showing 0% usage

-- These tables are never referenced in the codebase
-- Safe to remove with zero breaking changes

BEGIN;

-- Check if tables exist before dropping
DO $$ 
BEGIN
    -- Drop user_quotas if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_quotas') THEN
        DROP TABLE user_quotas CASCADE;
        RAISE NOTICE 'Dropped user_quotas table';
    ELSE
        RAISE NOTICE 'user_quotas table does not exist';
    END IF;

    -- Drop vector_search_performance if it exists  
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vector_search_performance') THEN
        DROP TABLE vector_search_performance CASCADE;
        RAISE NOTICE 'Dropped vector_search_performance table';
    ELSE
        RAISE NOTICE 'vector_search_performance table does not exist';
    END IF;
END $$;

COMMIT;

-- Verify cleanup
SELECT 
    'Tables remaining: ' || COUNT(*) as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';
