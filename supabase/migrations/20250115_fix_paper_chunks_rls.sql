-- Drop existing policies that reference non-existent papers.user_id
DROP POLICY IF EXISTS "insert paper chunks" ON paper_chunks;
DROP POLICY IF EXISTS "read paper chunks"   ON paper_chunks;
DROP POLICY IF EXISTS "paper-owner or service-role" ON paper_chunks;

-- Create comprehensive RLS policy for paper_chunks
-- Users can access chunks for papers in their library OR papers used in their research projects
CREATE POLICY "paper-owner or service-role"
ON paper_chunks
FOR ALL
USING (
  -- Service role can bypass all checks (for server-side operations)
  is_service_role()
  OR
  -- User can access chunks for papers they've added to their library
  EXISTS (
    SELECT 1 
    FROM library_papers lp 
    WHERE lp.paper_id = paper_chunks.paper_id 
    AND lp.user_id = auth.uid()
  )
  OR
  -- User can access chunks for papers used in their research projects
  EXISTS (
    SELECT 1 
    FROM citation_links cl
    JOIN research_projects rp ON cl.project_id = rp.id
    WHERE cl.source_paper_id = paper_chunks.paper_id 
    AND rp.user_id = auth.uid()
  )
)
WITH CHECK (
  -- Service role can bypass all checks (for server-side operations)
  is_service_role()
  OR
  -- User can modify chunks for papers they've added to their library
  EXISTS (
    SELECT 1 
    FROM library_papers lp 
    WHERE lp.paper_id = paper_chunks.paper_id 
    AND lp.user_id = auth.uid()
  )
  OR
  -- User can modify chunks for papers used in their research projects
  EXISTS (
    SELECT 1 
    FROM citation_links cl
    JOIN research_projects rp ON cl.project_id = rp.id
    WHERE cl.source_paper_id = paper_chunks.paper_id 
    AND rp.user_id = auth.uid()
  )
);

-- Helper function to detect service role based on JWT claims
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role')::TEXT = 'service_role',
    FALSE
  );
$$;

COMMENT ON POLICY "paper-owner or service-role" ON paper_chunks 
IS 'Users can access chunks for papers in their library or research projects, service role can bypass for server operations';
 