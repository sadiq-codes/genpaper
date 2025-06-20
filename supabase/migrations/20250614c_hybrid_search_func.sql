-- Migration: create or replace RPC for hybrid paper search
-- Exposes a single function `search_papers_hybrid` that merges pgvector
-- cosine similarity with full-text rank. We can call it from Edge
-- Functions via PostgREST.

create or replace function public.search_papers_hybrid(
  p_query           text,
  p_query_embedding vector(384),
  p_limit           integer default 25,
  p_min_year        integer default 1900,
  p_semantic_weight real    default 0.5,
  p_text_weight     real    default 0.5
)
returns table (
  id uuid,
  title text,
  abstract text,
  publication_date date,
  venue text,
  doi text,
  url text,
  pdf_url text,
  source text,
  score real
) language sql stable as $$
with params as (
  select p_query as q,
         greatest(1, p_limit) as lim,
         p_min_year as min_year,
         p_semantic_weight as sw,
         p_text_weight as tw
)
, ranked as (
  select p.id,
         p.title,
         p.abstract,
         p.publication_date,
         p.venue,
         p.doi,
         p.url,
         p.pdf_url,
         p.source,
         (params.sw * (1 - (c.embedding <=> p_query_embedding)) +
          params.tw * ts_rank_cd(p.search_vector, plainto_tsquery(params.q))) as score
  from paper_chunks c
  join papers p on p.id = c.paper_id
  cross join params
  where (p.publication_date is null or extract(year from p.publication_date) >= params.min_year)
)
select * from ranked
order by score desc nulls last
limit (select lim from params);
$$;

comment on function public.search_papers_hybrid is 'Hybrid pgvector + full-text search over papers table'; 