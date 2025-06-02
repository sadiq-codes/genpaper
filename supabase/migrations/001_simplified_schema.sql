/* ───────────────────────────────
   0. EXTENSIONS
   ─────────────────────────────── */
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

/* ───────────────────────────────
   1. ENUMS
   ─────────────────────────────── */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_status') THEN
    CREATE TYPE paper_status AS ENUM ('generating','complete','failed');
  END IF;
END$$;

/* ───────────────────────────────
   2. CORE TABLES
   ─────────────────────────────── */

/* Users (profiles) */
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* Authors */
CREATE TABLE IF NOT EXISTS authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

/* Papers discovered online or uploaded */
CREATE TABLE IF NOT EXISTS papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  abstract TEXT,
  publication_date DATE,
  venue TEXT,
  doi TEXT UNIQUE,
  url TEXT,
  pdf_url TEXT,
  metadata JSONB,
  source TEXT,
  citation_count INT DEFAULT 0,
  impact_score FLOAT,
  embedding VECTOR(384),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(abstract,''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* Author ↔︎ Paper join (keeps order) */
CREATE TABLE IF NOT EXISTS paper_authors (
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  author_id UUID REFERENCES authors(id) ON DELETE RESTRICT,
  ordinal SMALLINT,
  PRIMARY KEY (paper_id, author_id)
);

/* Research "projects" (one per user prompt) */
CREATE TABLE IF NOT EXISTS research_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status paper_status NOT NULL DEFAULT 'generating',
  generation_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS research_projects_user_idx
  ON research_projects (user_id, created_at DESC);

/* Versioned draft content (one row per save / stream checkpoint) */
CREATE TABLE IF NOT EXISTS research_project_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content TEXT,
  word_count INT GENERATED ALWAYS AS (
    array_length(regexp_split_to_array(content, '\s+'), 1)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, version)
);

/* Inline citations */
CREATE TABLE IF NOT EXISTS project_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  block_id UUID,
  position_start INT,
  position_end INT,
  citation_text TEXT NOT NULL,
  page_range INT4RANGE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, version, position_start)
);

/* ───────────────────────────────
   3. PERSONAL LIBRARY
   ─────────────────────────────── */

CREATE TABLE IF NOT EXISTS library_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, paper_id)
);

CREATE INDEX IF NOT EXISTS library_papers_user_idx
  ON library_papers (user_id, added_at DESC);

/* Collections / folders */
CREATE TABLE IF NOT EXISTS library_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS collection_papers (
  collection_id UUID REFERENCES library_collections(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, paper_id)
);

/* ───────────────────────────────
   4. OPTIONAL TAGGING
   ─────────────────────────────── */

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name CITEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS library_paper_tags (
  paper_id UUID REFERENCES library_papers(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, tag_id)
);

/* ───────────────────────────────
   5. INDEXES FOR SEARCH & VECTORS
   ─────────────────────────────── */
CREATE INDEX IF NOT EXISTS papers_search_idx
  ON papers USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS papers_embedding_idx
  ON papers USING ivfflat (embedding vector_cosine_ops);

/* ───────────────────────────────
   6. ROW LEVEL SECURITY
   ─────────────────────────────── */

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_project_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_paper_tags ENABLE ROW LEVEL SECURITY;

-- Users
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Research projects
CREATE POLICY "Users can view own research projects" ON research_projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create research projects" ON research_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own research projects" ON research_projects
  FOR UPDATE USING (auth.uid() = user_id);

-- Project versions
CREATE POLICY "Users can view own project versions" ON research_project_versions
  FOR SELECT USING (
    auth.uid() = (SELECT user_id FROM research_projects WHERE id = project_id)
  );
CREATE POLICY "Users can create project versions" ON research_project_versions
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT user_id FROM research_projects WHERE id = project_id)
  );

-- Citations
CREATE POLICY "Users can view own project citations" ON project_citations
  FOR SELECT USING (
    auth.uid() = (SELECT user_id FROM research_projects WHERE id = project_id)
  );
CREATE POLICY "Users can create project citations" ON project_citations
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT user_id FROM research_projects WHERE id = project_id)
  );

-- Library
CREATE POLICY "Users can view own library" ON library_papers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own library" ON library_papers
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own collections" ON library_collections
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own collections" ON library_collections
  FOR ALL USING (auth.uid() = user_id);

-- Tags
CREATE POLICY "Users can view own tags" ON tags
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own tags" ON tags
  FOR ALL USING (auth.uid() = user_id);

-- Papers are public
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Papers are publicly readable" ON papers
  FOR SELECT TO authenticated USING (true);

ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authors are publicly readable" ON authors
  FOR SELECT TO authenticated USING (true);

ALTER TABLE paper_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Paper authors are publicly readable" ON paper_authors
  FOR SELECT TO authenticated USING (true);

/* ───────────────────────────────
   7. COMMENTS
   ─────────────────────────────── */
COMMENT ON TABLE research_project_versions IS
  'Separate table keeps research_projects rows small and enables history/undo';

COMMENT ON COLUMN papers.embedding IS
  'Sentence-transformer embedding for semantic search (pgvector)';

COMMENT ON COLUMN papers.source IS
  'Source of the paper: arxiv, pubmed, google_scholar, manual, etc.';
