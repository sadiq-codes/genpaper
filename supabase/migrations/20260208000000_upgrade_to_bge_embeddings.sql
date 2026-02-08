-- Upgrade embedding dimensions from 384 to 1024
-- Uses OpenAI text-embedding-3-small with dimensions=1024 parameter
-- This migration changes all vector columns and functions to support 1024 dimensions
-- 
-- WARNING: Existing embeddings will need to be regenerated!
-- After running this migration, run the bulk ingestion script to regenerate embeddings.

-- Step 1: Drop ALL dependent functions (include every known overload signature)
drop function if exists match_paper_chunks(vector(384), int, float);
drop function if exists match_paper_chunks(vector(384), int, float, uuid[]);
drop function if exists match_paper_chunks(vector(384), int, float, uuid[], uuid[], float);
drop function if exists match_paper_claims(vector(384), uuid[], int);
drop function if exists find_similar_papers(vector(384), int, int);
drop function if exists semantic_search_papers(text, vector(384), int, int);
drop function if exists hybrid_search_papers(text, vector(384), int, int, float);

-- Step 2: Drop NOT NULL constraints so we can null out embeddings
alter table papers alter column embedding drop not null;
alter table paper_chunks alter column embedding drop not null;

-- Step 3: Null out existing 384-dim embeddings (they must be regenerated anyway)
update papers set embedding = null where embedding is not null;
update paper_chunks set embedding = null where embedding is not null;
update paper_claims set embedding = null where embedding is not null;

-- Step 4: Alter vector columns to 1024 dimensions (nulls allow the cast)
alter table papers 
  alter column embedding type vector(1024);

alter table paper_chunks 
  alter column embedding type vector(1024);

alter table paper_claims 
  alter column embedding type vector(1024);

-- Step 5: Recreate match_paper_chunks with full signature (paper_ids + boosted_paper_ids)
-- This matches the version from 20260207100000_add_library_boost_to_search.sql
create or replace function match_paper_chunks(
  query_embedding vector(1024),
  match_count int,
  min_score float default 0.3,
  paper_ids uuid[] default null,
  boosted_paper_ids uuid[] default null,
  boost_factor float default 1.15
)
returns table (
  id uuid,
  paper_id uuid,
  content text,
  chunk_index int,
  score float
)
language sql stable
as $$
  select
    c.id,
    c.paper_id,
    c.content,
    c.chunk_index,
    case
      when boosted_paper_ids is not null and c.paper_id = any(boosted_paper_ids)
      then least(1.0, (1 - (c.embedding <=> query_embedding)) * boost_factor)
      else 1 - (c.embedding <=> query_embedding)
    end as score
  from paper_chunks c
  where c.embedding is not null
    and (paper_ids is null or c.paper_id = any(paper_ids))
    and 1 - (c.embedding <=> query_embedding) >= min_score
  order by
    case
      when boosted_paper_ids is not null and c.paper_id = any(boosted_paper_ids)
      then (c.embedding <=> query_embedding) / boost_factor
      else c.embedding <=> query_embedding
    end
  limit greatest(1, match_count);
$$;

comment on function match_paper_chunks is 'Semantic search over paper chunks with optional paper_id filtering and library boost for RAG retrieval';

-- Step 6: Recreate match_paper_claims with 1024 dimensions
create or replace function match_paper_claims(
  query_embedding vector(1024),
  paper_ids uuid[],
  match_count int default 10
)
returns table (
  id uuid,
  paper_id uuid,
  claim_text text,
  evidence_quote text,
  section text,
  claim_type text,
  confidence float,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.paper_id,
    c.claim_text,
    c.evidence_quote,
    c.section,
    c.claim_type,
    c.confidence,
    1 - (c.embedding <=> query_embedding) as similarity
  from paper_claims c
  where c.paper_id = any(paper_ids)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Step 7: Recreate find_similar_papers with 1024 dimensions
create or replace function find_similar_papers(
  query_embedding vector(1024), 
  match_count int, 
  min_year int default 1900
)
returns table (
  id uuid,
  title text,
  abstract text,
  authors jsonb,
  publication_date date,
  venue text,
  doi text,
  pdf_url text,
  citation_count int,
  similarity float
)
language sql stable
as $$
  select
    p.id,
    p.title,
    p.abstract,
    p.authors,
    p.publication_date,
    p.venue,
    p.doi,
    p.pdf_url,
    p.citation_count,
    1 - (p.embedding <=> query_embedding) as similarity
  from papers p
  where extract(year from p.publication_date) >= min_year
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- Step 8: Recreate semantic_search_papers with 1024 dimensions
create or replace function semantic_search_papers(
  query_text text,
  query_embedding vector(1024),
  match_count int,
  min_year int default 1900
)
returns table (
  id uuid,
  title text,
  abstract text,
  authors jsonb,
  publication_date date,
  venue text,
  doi text,
  pdf_url text,
  citation_count int,
  similarity float
)
language sql stable
as $$
  select
    p.id,
    p.title,
    p.abstract,
    p.authors,
    p.publication_date,
    p.venue,
    p.doi,
    p.pdf_url,
    p.citation_count,
    1 - (p.embedding <=> query_embedding) as similarity
  from papers p
  where extract(year from p.publication_date) >= min_year
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- Step 9: Recreate hybrid_search_papers with 1024 dimensions
create or replace function hybrid_search_papers(
  query_text text,
  query_embedding vector(1024),
  match_count int,
  min_year int default 1900,
  semantic_weight float default 0.7
)
returns table (
  id uuid,
  title text,
  abstract text,
  authors jsonb,
  publication_date date,
  venue text,
  doi text,
  pdf_url text,
  citation_count int,
  similarity float,
  text_rank float,
  combined_score float
)
language sql stable
as $$
  with semantic_results as (
    select
      p.id,
      p.title,
      p.abstract,
      p.authors,
      p.publication_date,
      p.venue,
      p.doi,
      p.pdf_url,
      p.citation_count,
      1 - (p.embedding <=> query_embedding) as similarity
    from papers p
    where extract(year from p.publication_date) >= min_year
    order by p.embedding <=> query_embedding
    limit match_count * 3
  ),
  text_results as (
    select
      p.id,
      ts_rank(
        to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.abstract,'')),
        plainto_tsquery('english', query_text)
      ) as text_rank
    from papers p
    where extract(year from p.publication_date) >= min_year
      and to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.abstract,'')) 
          @@ plainto_tsquery('english', query_text)
    limit match_count * 3
  )
  select
    sr.id,
    sr.title,
    sr.abstract,
    sr.authors,
    sr.publication_date,
    sr.venue,
    sr.doi,
    sr.pdf_url,
    sr.citation_count,
    sr.similarity,
    coalesce(tr.text_rank, 0) as text_rank,
    (semantic_weight * sr.similarity + (1 - semantic_weight) * coalesce(tr.text_rank, 0)) as combined_score
  from semantic_results sr
  left join text_results tr on sr.id = tr.id
  order by combined_score desc
  limit match_count;
$$;

-- Step 10: Add comments documenting the embedding model
comment on column papers.embedding is 'OpenAI text-embedding-3-small (1024 dimensions)';
comment on column paper_chunks.embedding is 'OpenAI text-embedding-3-small (1024 dimensions)';
comment on column paper_claims.embedding is 'OpenAI text-embedding-3-small (1024 dimensions)';
