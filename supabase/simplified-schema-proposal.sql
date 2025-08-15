-- SIMPLIFIED SCHEMA PROPOSAL
-- Reduces 18 tables to 12 tables while maintaining core functionality

-- ═══════════════════════════════════════════════════════════════════
-- CORE ENTITIES (Keep as-is, but simplify papers table)
-- ═══════════════════════════════════════════════════════════════════

-- 1. SIMPLIFIED PAPERS TABLE (Reduce from 24 to 12 essential columns)
CREATE TABLE papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  abstract TEXT,
  authors JSONB, -- Simplified: Store authors as JSON array instead of separate table
  publication_date DATE,
  venue TEXT,
  doi TEXT,
  pdf_url TEXT,
  pdf_content TEXT, -- The extracted content
  source TEXT,
  citation_count INTEGER DEFAULT 0,
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. PAPER CHUNKS (Keep - essential for vector search)
CREATE TABLE paper_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. RESEARCH PROJECTS (Keep - core functionality)
CREATE TABLE research_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status TEXT DEFAULT 'generating',
  content TEXT,
  generation_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 4. CITATIONS (Simplified - combine project_citations with references)
CREATE TABLE citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  citation_number INTEGER,
  reason TEXT,
  quote TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- USER MANAGEMENT (Simplified)
-- ═══════════════════════════════════════════════════════════════════

-- 5. PROFILES (Keep)
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. SIMPLIFIED LIBRARY (Merge library_papers + collections + tags)
CREATE TABLE user_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  collection TEXT, -- Simple text field instead of separate table
  tags TEXT[], -- Array of tags instead of separate tables
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, paper_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- PROCESSING & MONITORING (Consolidated)
-- ═══════════════════════════════════════════════════════════════════

-- 7. PROCESSING LOGS (Consolidate pdf_processing_logs + failed_chunks)
CREATE TABLE processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id),
  operation_type TEXT NOT NULL, -- 'pdf_extraction', 'chunking', 'embedding'
  status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 8. USER QUOTAS (Keep - essential for rate limiting)
CREATE TABLE user_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  daily_pdf_limit INTEGER DEFAULT 50,
  daily_pdf_used INTEGER DEFAULT 0,
  monthly_ocr_limit INTEGER DEFAULT 10,
  monthly_ocr_used INTEGER DEFAULT 0,
  last_reset TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- ESSENTIAL INDEXES
-- ═══════════════════════════════════════════════════════════════════

-- Vector search indexes
CREATE INDEX papers_embedding_idx ON papers USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX chunks_embedding_idx ON paper_chunks USING ivfflat (embedding vector_cosine_ops);

-- Performance indexes
CREATE INDEX papers_created_at_idx ON papers (created_at DESC);
CREATE INDEX chunks_paper_id_idx ON paper_chunks (paper_id);
CREATE INDEX library_user_papers_idx ON user_library (user_id, added_at DESC);
CREATE INDEX projects_user_status_idx ON research_projects (user_id, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- SUMMARY OF CHANGES:
-- ═══════════════════════════════════════════════════════════════════
-- 
-- REMOVED TABLES (6):
-- - authors, paper_authors (merged into papers.authors JSONB)
-- - library_collections, collection_papers (merged into user_library.collection)
-- - tags, library_paper_tags (merged into user_library.tags[])
-- - paper_references (merged into citations)
-- - failed_chunks (merged into processing_logs)
-- - pdf_processing_logs (merged into processing_logs)
-- - papers_api_cache (removed - use Redis/external cache)
-- - vector_search_performance (removed - use application metrics)
--
-- SIMPLIFIED TABLES (2):
-- - papers: 24 columns → 12 columns
-- - user_library: Combines 4 library-related tables
--
-- RESULT: 18 tables → 8 tables (55% reduction)
-- Maintains all core functionality while drastically reducing complexity
