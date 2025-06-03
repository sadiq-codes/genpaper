-- Create storage bucket for PDFs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'papers-pdfs',
  'papers-pdfs',
  true,
  52428800, -- 50MB limit
  ARRAY['application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- Note: storage.objects RLS is already enabled by default in Supabase
-- Note: Storage policies are managed through the Supabase dashboard or specific storage functions

-- Create a function to clean up old PDF files (optional)
CREATE OR REPLACE FUNCTION cleanup_old_pdfs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete PDF files older than 1 year that are not referenced by any papers
  DELETE FROM storage.objects 
  WHERE bucket_id = 'papers-pdfs' 
    AND created_at < NOW() - INTERVAL '1 year'
    AND name NOT IN (
      SELECT SUBSTRING(pdf_url FROM 'papers-pdfs/(.+)$')
      FROM papers 
      WHERE pdf_url IS NOT NULL 
        AND pdf_url LIKE '%papers-pdfs%'
    );
END;
$$;

-- Grant execute permission on cleanup function
GRANT EXECUTE ON FUNCTION cleanup_old_pdfs() TO authenticated; 