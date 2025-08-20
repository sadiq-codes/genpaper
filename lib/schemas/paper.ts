import { z } from 'zod'

/**
 * Zod schema for PaperDTO with runtime validation
 */
export const PaperDTOSchema = z.object({
  title: z.string().min(1).max(500),
  abstract: z.string().max(5000).optional(),
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  venue: z.string().max(200).optional(),
  doi: z.string().regex(/^10\.\d+\/.*/).optional(),
  pdf_url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  source: z.string().max(50).optional(),
  citation_count: z.number().int().min(0).optional(),
  authors: z.array(z.string().min(1).max(100)).optional()
})

/**
 * Schema for upload request validation
 */
export const UploadRequestSchema = z.object({
  file: z.instanceof(File).refine(
    (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    { message: 'File must be a PDF' }
  ).refine(
    (file) => file.size <= 10 * 1024 * 1024, // 10MB
    { message: 'File size must be less than 10MB' }
  ),
  fileName: z.string().min(1).max(255).optional()
})

/**
 * Schema for extracted PDF metadata validation
 */
export const ExtractedPDFDataSchema = z.object({
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  abstract: z.string().optional(),
  venue: z.string().optional(),
  doi: z.string().optional(),
  year: z.string().optional(),
  content: z.string().optional(),
  fullText: z.string().optional(),
  contentChunks: z.array(z.string()).optional()
})

/**
 * Schema for search papers request
 */
export const SearchPapersRequestSchema = z.object({
  query: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  sources: z.array(z.string()).optional(),
  useSemanticSearch: z.boolean().default(false)
})

/**
 * Schema for semantic search options
 */
export const SemanticSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  minYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  sources: z.array(z.string()).optional()
})

/**
 * Schema for hybrid search options
 */
export const HybridSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  minYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  sources: z.array(z.string()).optional(),
  semanticWeight: z.number().min(0).max(1).optional(),
  excludePaperIds: z.array(z.string().uuid()).optional()
})

// Export types derived from schemas
export type PaperDTO = z.infer<typeof PaperDTOSchema>
export type UploadRequest = z.infer<typeof UploadRequestSchema>
export type ExtractedPDFData = z.infer<typeof ExtractedPDFDataSchema>
export type SearchPapersRequest = z.infer<typeof SearchPapersRequestSchema>
export type SemanticSearchOptions = z.infer<typeof SemanticSearchOptionsSchema>
export type HybridSearchOptions = z.infer<typeof HybridSearchOptionsSchema> 