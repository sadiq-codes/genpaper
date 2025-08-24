-- Recreate RPCs used by the app (384-dim vectors)

create extension if not exists vector;
create extension if not exists pg_trgm;

-- match_paper_chunks
create or replace function match_paper_chunks(query_embedding vector(384), match_count int, min_score float default 0.3)
returns table(id uuid, paper_id uuid, content text, score float)
language sql stable as $$
  select c.id, c.paper_id, c.content, 1 - (c.embedding <=> query_embedding) as score
  from paper_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, match_count)
$$;

-- find_similar_papers
create or replace function find_similar_papers(query_embedding vector(384), match_count int, min_year int default 1900)
returns table(id uuid, title text, abstract text, publication_date date, venue text, doi text, pdf_url text, semantic_score float)
language sql stable as $$
  select p.id, p.title, p.abstract, p.publication_date, p.venue, p.doi, p.pdf_url,
         1 - (p.embedding <=> query_embedding) as semantic_score
  from papers p
  where p.embedding is not null
    and (p.publication_date is null or p.publication_date >= make_date(min_year,1,1))
  order by p.embedding <=> query_embedding
  limit greatest(1, match_count)
$$;

-- semantic_search_papers (wrapper)
create or replace function semantic_search_papers(query_text text, query_embedding vector(384), match_count int, min_year int default 1900)
returns table(id uuid, title text, abstract text, publication_date date, venue text, doi text, pdf_url text, combined_score float, semantic_score float, keyword_score float)
language sql stable as $$
  select id, title, abstract, publication_date, venue, doi, pdf_url,
         semantic_score as combined_score, semantic_score, 0::float as keyword_score
  from find_similar_papers(query_embedding, match_count, min_year)
$$;

-- hybrid_search_papers
create or replace function hybrid_search_papers(query_text text, query_embedding vector(384), match_count int, min_year int default 1900, semantic_weight float default 0.7)
returns table(id uuid, title text, abstract text, publication_date date, venue text, doi text, pdf_url text, combined_score float, semantic_score float, keyword_score float)
language sql stable as $$
  with semantic as (
    select p.id, p.title, p.abstract, p.publication_date, p.venue, p.doi, p.pdf_url,
           1 - (p.embedding <=> query_embedding) as semantic_score
    from papers p
    where p.embedding is not null
      and (p.publication_date is null or p.publication_date >= make_date(min_year,1,1))
    order by p.embedding <=> query_embedding
    limit greatest(1, match_count*2)
  ),
  keyword as (
    select p.id, p.title, p.abstract, p.publication_date, p.venue, p.doi, p.pdf_url,
           ts_rank(to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.abstract,'')),
                   plainto_tsquery('english', query_text)) as keyword_score
    from papers p
    where (p.publication_date is null or p.publication_date >= make_date(min_year,1,1))
    order by keyword_score desc
    limit greatest(1, match_count*2)
  ),
  unioned as (
    select s.id, s.title, s.abstract, s.publication_date, s.venue, s.doi, s.pdf_url,
           s.semantic_score, 0::float as keyword_score from semantic s
    union
    select k.id, k.title, k.abstract, k.publication_date, k.venue, k.doi, k.pdf_url,
           0::float as semantic_score, k.keyword_score from keyword k
  )
  select u.id, u.title, u.abstract, u.publication_date, u.venue, u.doi, u.pdf_url,
         (coalesce(u.semantic_score,0)*semantic_weight + coalesce(u.keyword_score,0)*(1-semantic_weight)) as combined_score,
         coalesce(u.semantic_score,0) as semantic_score,
         coalesce(u.keyword_score,0) as keyword_score
  from unioned u
  group by u.id, u.title, u.abstract, u.publication_date, u.venue, u.doi, u.pdf_url, u.semantic_score, u.keyword_score
  order by combined_score desc
  limit greatest(1, match_count)
$$;

-- citations API
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

create or replace function get_project_citations_unified(p_project_id uuid)
returns setof project_citations
language sql stable as $$
  select * from project_citations where project_id = p_project_id order by citation_number asc
$$;

create or replace function add_citation_unified(p_project_id uuid, p_key text, p_paper_id uuid, p_citation_text text, p_context text)
returns table (citation_number int, csl_json jsonb, is_new boolean)
language plpgsql as $$
declare
  next_num int;
begin
  select coalesce(max(citation_number),0)+1 into next_num from project_citations where project_id = p_project_id;
  insert into project_citations(project_id, paper_id, citation_number, csl_json)
  values (p_project_id, p_paper_id, next_num,
    jsonb_build_object('note', coalesce(p_citation_text,'')));
  return query select next_num, (select csl_json from project_citations where project_id=p_project_id and citation_number=next_num), true;
end;
$$;

-- library stats stub
create or replace function get_user_library_stats(p_user_id uuid)
returns jsonb
language sql stable as $$
  select jsonb_build_object('paper_count', 0, 'recent_added', 0)
$$;
