/**
 * Export System Types
 * 
 * Types for the document export pipeline that converts TipTap JSON
 * to DOCX, LaTeX, and PDF formats with proper citation handling.
 */

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

export type ExportFormat = 'pdf' | 'docx' | 'latex'

export interface ExportRequest {
  format: ExportFormat
  document: TipTapDocument
  papers: ExportPaper[]
  citationStyle: string
  title: string
  authors?: string[]
  abstract?: string
}

export interface ExportResult {
  success: boolean
  data?: Buffer | Uint8Array
  filename: string
  contentType: string
  error?: string
}

// =============================================================================
// TIPTAP DOCUMENT TYPES
// =============================================================================

export interface TipTapDocument {
  type: 'doc'
  content?: TipTapNode[]
}

export interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  marks?: TipTapMark[]
  content?: TipTapNode[]
  text?: string
}

export interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

// =============================================================================
// PARSED DOCUMENT TYPES
// =============================================================================

export interface ParsedDocument {
  title: string
  authors: string[]
  abstract: string
  sections: DocumentSection[]
  citations: CitationInstance[]
  citedPaperIds: Set<string>
  citationNumbers: Map<string, number>  // paperId -> citation number (order of first appearance)
}

export type DocumentSectionType = 
  | 'heading'
  | 'paragraph'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock'
  | 'table'
  | 'horizontalRule'

export interface DocumentSection {
  type: DocumentSectionType
  level?: number  // For headings (1-6)
  content: DocumentContent[]
  // For lists
  items?: DocumentSection[][]
  // For tables
  rows?: DocumentSection[][][]
  // For code blocks
  language?: string
}

export type DocumentContent = TextChunk | CitationRef | InlineCode | InlineLink | HardBreak

export interface TextChunk {
  type: 'text'
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

export interface CitationRef {
  type: 'citation'
  paperId: string
  instanceId?: string
  citationNumber: number
}

export interface InlineCode {
  type: 'code'
  text: string
}

export interface InlineLink {
  type: 'link'
  text: string
  href: string
}

export interface HardBreak {
  type: 'hardBreak'
}

export interface CitationInstance {
  paperId: string
  instanceId?: string
  citationNumber: number
  position: number  // Order of appearance in document
}

// =============================================================================
// PAPER TYPES (for export)
// =============================================================================

export interface ExportPaper {
  id: string
  title?: string
  authors?: string[]
  year?: number
  journal?: string
  venue?: string
  doi?: string
  url?: string
  abstract?: string
  type?: 'article-journal' | 'book' | 'chapter' | 'paper-conference' | 'thesis'
}

// =============================================================================
// GENERATOR OPTIONS
// =============================================================================

export interface DocxOptions {
  fontSize?: number
  fontFamily?: string
  lineSpacing?: number
  margins?: {
    top: number
    bottom: number
    left: number
    right: number
  }
}

export interface LatexOptions {
  documentClass?: string
  fontSize?: number
  packages?: string[]
  bibliographyStyle?: string
}

export interface PdfOptions {
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  margins?: {
    top: string
    bottom: string
    left: string
    right: string
  }
  paperSize?: 'letter' | 'a4'
}

// =============================================================================
// BIBLIOGRAPHY STYLE MAPPING
// =============================================================================

export const LATEX_BIB_STYLES: Record<string, string> = {
  'apa': 'apalike',
  'apa-7th-edition': 'apalike',
  'ieee': 'IEEEtran',
  'chicago-author-date': 'chicago',
  'chicago': 'chicago',
  'harvard': 'agsm',
  'harvard1': 'agsm',
  'vancouver': 'vancouver',
  'nature': 'naturemag',
  'mla': 'mla',
  'modern-language-association': 'mla',
}

export function getLatexBibStyle(citationStyle: string): string {
  const normalized = citationStyle.toLowerCase()
  return LATEX_BIB_STYLES[normalized] || 'plain'
}
