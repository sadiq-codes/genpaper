-- IMMEDIATE CLEANUP: Remove completely unused tables
-- Based on codebase analysis - 0% usage, safe to remove

-- Remove never-used tables
DROP TABLE IF EXISTS user_quotas CASCADE;
DROP TABLE IF EXISTS vector_search_performance CASCADE;

-- These tables add complexity with zero benefit
-- user_quotas: Never referenced in codebase
-- vector_search_performance: Never referenced in codebase

-- Immediate benefits:
-- - Reduces schema complexity by 11%
-- - Eliminates 2 maintenance surfaces
-- - Removes unused indexes and constraints
-- - Simplifies database backups/migrations
