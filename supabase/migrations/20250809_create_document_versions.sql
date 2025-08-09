-- Create document_versions table
create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  base_version_id uuid references document_versions(id),
  sha text not null,
  content_md text not null,
  actor text not null check (actor in ('user','ai')),
  prompt text,
  model text,
  created_at timestamptz default now()
);

-- Unique index on (document_id, sha)
create unique index if not exists document_versions_doc_sha_idx on document_versions(document_id, sha);