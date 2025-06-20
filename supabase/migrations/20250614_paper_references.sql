-- Migration: create paper_references table for storing reference lists per paper
-- Allows multiple references per paper; each row stores raw CSL-JSON for a cited work

create table if not exists public.paper_references (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.papers(id) on delete cascade,
  reference_csl jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure fast lookup by parent paper
create index if not exists paper_references_paper_id_idx on public.paper_references(paper_id); 