/**
 * Types for PDF upload on the projects page
 */

export interface UploadedPdf {
  /** Temporary ID during upload, used for tracking */
  id: string
  /** Original filename (e.g., "paper.pdf") */
  filename: string
  /** Current upload/processing status */
  status: 'uploading' | 'processing' | 'ready' | 'error'
  /** Paper ID in the database (set after upload completes) */
  paperId?: string
  /** Extracted title from PDF metadata */
  title?: string
  /** Error message if upload/processing failed */
  error?: string
}

export interface PdfUploadResult {
  success: boolean
  paper?: {
    id: string
    title: string
    authors: string[]
    year: number
    abstract?: string
    venue?: string
    doi?: string
  }
  error?: string
}
