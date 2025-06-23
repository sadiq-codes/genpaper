-- Migration: Add RLS policies for papers table
-- This ensures proper access to vector search and full-text search

-- Enable RLS on papers table
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all papers (needed for search)
CREATE POLICY "Allow read access to all papers" 
ON papers FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to read paper embeddings (needed for vector search)
CREATE POLICY "Allow read access to paper embeddings" 
ON papers FOR SELECT 
TO authenticated 
USING (embedding IS NOT NULL);

-- Allow authenticated users to read paper search vectors (needed for full-text search)
CREATE POLICY "Allow read access to paper search vectors" 
ON papers FOR SELECT 
TO authenticated 
USING (search_vector IS NOT NULL);

-- Add helpful comment
COMMENT ON TABLE papers IS 'Papers table with RLS policies for vector and full-text search'; 