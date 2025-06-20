-- Migration: add source_paper_id to citation_links for secondary citations
alter table if exists public.citation_links
  add column if not exists source_paper_id uuid references public.papers(id) on delete set null; 