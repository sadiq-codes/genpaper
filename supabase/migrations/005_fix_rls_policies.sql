-- Fix RLS policies for paper and author management
-- This allows authenticated users to create papers, authors, and relationships

-- Allow authenticated users to INSERT papers (for uploads and ingestion)
CREATE POLICY "Authenticated users can create papers" ON papers
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to INSERT/UPDATE papers (for metadata updates)
CREATE POLICY "Authenticated users can manage papers" ON papers
  FOR UPDATE TO authenticated USING (true);

-- Allow authenticated users to create authors
CREATE POLICY "Authenticated users can create authors" ON authors
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to manage authors
CREATE POLICY "Authenticated users can manage authors" ON authors
  FOR UPDATE TO authenticated USING (true);

-- Allow authenticated users to create paper-author relationships
CREATE POLICY "Authenticated users can create paper-author relationships" ON paper_authors
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow authenticated users to manage paper-author relationships
CREATE POLICY "Authenticated users can manage paper-author relationships" ON paper_authors
  FOR ALL TO authenticated USING (true);

-- Grant necessary permissions to authenticated role
GRANT INSERT, UPDATE ON papers TO authenticated;
GRANT INSERT, UPDATE ON authors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON paper_authors TO authenticated; 