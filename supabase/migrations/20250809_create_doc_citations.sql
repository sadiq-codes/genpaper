-- Create doc_citations table for offset-based anchors
create table if not exists doc_citations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  project_citation_id uuid not null references project_citations(id) on delete cascade,
  start_pos int not null,
  end_pos int not null,
  created_at timestamptz default now()
);

-- Index to support range queries
create index if not exists doc_citations_document_start_idx on doc_citations(document_id, start_pos);