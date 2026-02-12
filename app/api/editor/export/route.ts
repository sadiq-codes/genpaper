/**
 * Export API Route
 * 
 * Exports documents to DOCX, LaTeX (ZIP), or PDF formats.
 * Handles TipTap JSON with proper citation formatting.
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { parseDocument } from '@/lib/export/document-parser'
import { generateDocx } from '@/lib/export/docx-generator'
import { generateLatexZip } from '@/lib/export/latex-generator'
import { generatePdf } from '@/lib/export/pdf-generator'
import { checkCanExportPdf } from '@/lib/billing/gates'
import type { TipTapDocument, ExportPaper, ExportFormat } from '@/lib/export/types'

// =============================================================================
// TYPES
// =============================================================================

interface ExportRequest {
  format: ExportFormat
  document: TipTapDocument
  papers: ExportPaper[]
  citationStyle: string
  title: string
  authors?: string[]
  abstract?: string
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check export permission (free tier cannot export)
    const exportCheck = await checkCanExportPdf(user.id)
    if (!exportCheck.allowed) {
      return NextResponse.json(
        { error: exportCheck.reason || 'Export requires a paid plan.', code: 'EXPORT_GATED', requiredTier: exportCheck.requiredTier },
        { status: 403 }
      )
    }

    const body: ExportRequest = await request.json()
    const { format, document, papers, citationStyle, title, authors, abstract } = body

    // Validate request
    if (!document || !document.type) {
      return NextResponse.json({ error: 'Invalid document format' }, { status: 400 })
    }

    if (!['pdf', 'docx', 'latex'].includes(format)) {
      return NextResponse.json({ error: 'Invalid export format' }, { status: 400 })
    }

    console.log(`[Export] Starting ${format} export for "${title}"`)
    console.log(`[Export] Document has ${document.content?.length || 0} top-level nodes`)
    console.log(`[Export] Citation style: ${citationStyle}`)
    console.log(`[Export] Papers available: ${papers.length}`)

    // Parse the TipTap document
    const parsed = parseDocument(
      document,
      title || 'Untitled Document',
      authors || [],
      abstract || ''
    )

    console.log(`[Export] Parsed ${parsed.sections.length} sections`)
    console.log(`[Export] Found ${parsed.citedPaperIds.size} unique citations`)

    // Generate the appropriate format
    let result: Buffer
    let contentType: string
    let filename: string

    switch (format) {
      case 'docx':
        result = await generateDocx(parsed, papers, citationStyle)
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        filename = `${sanitizeFilename(title)}.docx`
        break
        
      case 'latex':
        result = await generateLatexZip(parsed, papers, citationStyle)
        contentType = 'application/zip'
        filename = `${sanitizeFilename(title)}.zip`
        break
        
      case 'pdf':
        result = await generatePdf(parsed, papers, citationStyle)
        contentType = 'application/pdf'
        filename = `${sanitizeFilename(title)}.pdf`
        break
        
      default:
        return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
    }

    console.log(`[Export] Generated ${format} file: ${result.length} bytes`)

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': result.length.toString(),
      },
    })

  } catch (error) {
    console.error('[Export] Error:', error)
    
    // Provide more specific error messages
    const message = error instanceof Error ? error.message : 'Unknown error'
    
    // Check for Puppeteer-specific errors
    if (message.includes('puppeteer') || message.includes('chromium')) {
      return NextResponse.json(
        { error: 'PDF generation is temporarily unavailable. Please try DOCX or LaTeX export.' },
        { status: 503 }
      )
    }
    
    return NextResponse.json(
      { error: `Failed to export document: ${message}` },
      { status: 500 }
    )
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Sanitize filename for safe download
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .slice(0, 100)                 // Limit length
    || 'document'
}

// =============================================================================
// ROUTE CONFIG
// =============================================================================

export const maxDuration = 60 // Allow up to 60 seconds for PDF generation
