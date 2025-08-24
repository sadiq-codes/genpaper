-- Schema from shema.md (+ required extensions, indexes, FKs)
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

-- profiles
create table if not exists profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- papers
create table if not exists papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  abstract text,
  authors jsonb,
  publication_date date,
  venue text,
  doi text,
  pdf_url text,
  pdf_content text,
  source text,
  citation_count integer default 0,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

-- paper_chunks
create table if not exists paper_chunks (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  content text not null,
  embedding vector(384) not null,
  chunk_index integer not null,
  created_at timestamptz default now(),
  unique (paper_id, chunk_index)
);

-- library_papers
create table if not exists library_papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  paper_id uuid not null references papers(id) on delete cascade,
  collection text,
  tags text[],
  notes text,
  added_at timestamptz not null default now(),
  unique (user_id, paper_id)
);

-- processing_logs
create table if not exists processing_logs (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid,
  operation_type text not null,
  status text not null,
  error_message text,
  metadata jsonb,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- project_citations
create table if not exists project_citations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  paper_id uuid not null,
  citation_number integer,
  reason text,
  quote text,
  csl_json jsonb,
  created_at timestamptz default now()
);

-- research_projects
create table if not exists research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  status text default 'generating',
  content text,
  generation_config jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Recommended indexes (safe to re-run)
create index if not exists papers_embedding_idx
  on papers using ivfflat (embedding vector_l2_ops) with (lists=100);
create index if not exists paper_chunks_embedding_idx
  on paper_chunks using ivfflat (embedding vector_l2_ops) with (lists=100);
create index if not exists papers_fts_idx
  on papers using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(abstract,'')));
create index if not exists paper_chunks_paper_id_idx on paper_chunks(paper_id);
create index if not exists library_papers_user_id_idx on library_papers(user_id);
create index if not exists library_papers_paper_id_idx on library_papers(paper_id);
