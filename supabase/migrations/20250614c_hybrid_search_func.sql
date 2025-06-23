-- Migration: create or replace RPC for hybrid paper search
-- Exposes a single function `search_papers_hybrid` that merges pgvector
-- cosine similarity with full-text rank. We can call it from Edge
-- Functions via PostgREST.

-- Drop existing function to avoid conflicts
DROP FUNCTION IF EXISTS public.search_papers_hybrid;
DROP FUNCTION IF EXISTS public.hybrid_search_papers;

create or replace function public.hybrid_search_papers(
  query_text text,
  query_embedding vector(384),
  match_count integer default 25,
  min_year integer default 1900,
  semantic_weight real default 0.5
)
returns table (
  paper_id uuid,
  semantic_score float,
  keyword_score float,
  combined_score float
) language sql stable security definer as $$
  with tsquery as (
    select plainto_tsquery('english', query_text) as q
  ),
  semantic_results as (
    select 
      id as paper_id,
      1 - (embedding <=> query_embedding) as semantic_score
    from papers
    where publication_date >= make_date(min_year, 1, 1)
      and embedding is not null
    order by embedding <=> query_embedding
    limit match_count * 2
  ),
  keyword_results as (
    select 
      p.id as paper_id,
      ts_rank_cd(p.search_vector, t.q) as keyword_score
    from papers p, tsquery t
    where p.search_vector @@ t.q
      and publication_date >= make_date(min_year, 1, 1)
    order by ts_rank_cd(p.search_vector, t.q) desc
    limit match_count * 2
  )
  select 
    coalesce(s.paper_id, k.paper_id) as paper_id,
    coalesce(s.semantic_score, 0.0) as semantic_score,
    coalesce(k.keyword_score, 0.0) as keyword_score,
    (coalesce(s.semantic_score, 0.0) * semantic_weight + 
     coalesce(k.keyword_score, 0.0) * (1 - semantic_weight)) as combined_score
  from semantic_results s
  full outer join keyword_results k on s.paper_id = k.paper_id
  order by combined_score desc nulls last
  limit match_count;
$$;

-- Grant RPC access to authenticated users
grant execute on function public.hybrid_search_papers to authenticated;

-- Add helpful comment
comment on function public.hybrid_search_papers is 'Hybrid pgvector + full-text search over papers table with proper parameter order'; 