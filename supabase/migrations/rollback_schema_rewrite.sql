-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK SCRIPT FOR COMPLETE SCHEMA REWRITE
-- Use this if the migration fails or you need to revert changes
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

RAISE NOTICE '🔙 ROLLING BACK SCHEMA REWRITE...';

-- Drop new tables if they exist
DROP TABLE IF EXISTS papers CASCADE;
DROP TABLE IF EXISTS paper_chunks CASCADE;
DROP TABLE IF EXISTS research_projects CASCADE;
DROP TABLE IF EXISTS project_citations CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS library_papers CASCADE;
DROP TABLE IF EXISTS processing_logs CASCADE;

-- Restore original tables from backup
ALTER TABLE IF EXISTS papers_backup RENAME TO papers;
ALTER TABLE IF EXISTS paper_chunks_backup RENAME TO paper_chunks;
ALTER TABLE IF EXISTS research_projects_backup RENAME TO research_projects;
ALTER TABLE IF EXISTS project_citations_backup RENAME TO project_citations;
ALTER TABLE IF EXISTS profiles_backup RENAME TO profiles;
ALTER TABLE IF EXISTS library_papers_backup RENAME TO library_papers;
ALTER TABLE IF EXISTS authors_backup RENAME TO authors;
ALTER TABLE IF EXISTS paper_authors_backup RENAME TO paper_authors;
ALTER TABLE IF EXISTS library_collections_backup RENAME TO library_collections;
ALTER TABLE IF EXISTS collection_papers_backup RENAME TO collection_papers;
ALTER TABLE IF EXISTS tags_backup RENAME TO tags;
ALTER TABLE IF EXISTS library_paper_tags_backup RENAME TO library_paper_tags;
ALTER TABLE IF EXISTS paper_references_backup RENAME TO paper_references;
ALTER TABLE IF EXISTS pdf_processing_logs_backup RENAME TO pdf_processing_logs;
ALTER TABLE IF EXISTS failed_chunks_backup RENAME TO failed_chunks;

COMMIT;

RAISE NOTICE '✅ ROLLBACK COMPLETED - Original schema restored';
RAISE NOTICE '⚠️  You may need to restart your application';
