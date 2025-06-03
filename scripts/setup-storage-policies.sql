-- Storage policies for the papers-pdfs bucket
-- Run this manually in the Supabase SQL editor with appropriate permissions

-- Policy 1: Allow anyone to view PDF files (since bucket is public)
CREATE POLICY "PDF files are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'papers-pdfs');

-- Policy 2: Allow authenticated users to upload PDF files
CREATE POLICY "Authenticated users can upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'papers-pdfs' 
  AND (storage.foldername(name))[1] = 'papers'
);

-- Policy 3: Allow authenticated users to update their uploaded files
CREATE POLICY "Authenticated users can update PDF files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'papers-pdfs');

-- Policy 4: Allow authenticated users to delete files (optional)
CREATE POLICY "Authenticated users can delete PDF files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'papers-pdfs');

-- Verify the bucket was created
SELECT * FROM storage.buckets WHERE id = 'papers-pdfs'; 