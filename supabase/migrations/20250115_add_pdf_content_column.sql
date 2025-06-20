-- Add pdf_content column to papers table for storing extracted PDF text
-- This enables better chunking during paper generation

ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS pdf_content TEXT;

-- Add index for pdf_content searches if needed
CREATE INDEX IF NOT EXISTS idx_papers_pdf_content_not_null 
ON papers (id) 
WHERE pdf_content IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN papers.pdf_content IS 'Extracted text content from PDF files, used for chunking during paper generation'; 