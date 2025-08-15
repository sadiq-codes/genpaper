import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase/service'

export async function GET() {
  try {
    const supabase = getServiceClient()
    
    // 1. Check Research Projects
    const { data: projects, error: projectsError } = await supabase
      .from('research_projects')
      .select('id, topic, status, content, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (projectsError) throw projectsError
    
    // 2. Check Papers
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, pdf_content, abstract, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    
    if (papersError) throw papersError
    
    // 3. Check Paper Chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, content, embedding, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    
    if (chunksError) throw chunksError

    // 4. Check PDF Processing Logs (KEY DIAGNOSTIC)
    const { data: pdfLogs, error: pdfLogsError } = await supabase
      .from('pdf_processing_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    
    if (pdfLogsError) throw pdfLogsError

    // 5. Check Failed Chunks
    const { data: failedChunks, error: failedChunksError } = await supabase
      .from('failed_chunks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (failedChunksError) throw failedChunksError
    
    // 6. Analyze Coverage
    const totalPapers = papers?.length || 0
    const papersWithContent = papers?.filter(p => p.pdf_content || p.abstract).length || 0
    
    const chunksByPaper = chunks?.reduce((acc: Record<string, number>, chunk) => {
      acc[chunk.paper_id] = (acc[chunk.paper_id] || 0) + 1
      return acc
    }, {}) || {}
    
    const papersWithChunks = Object.keys(chunksByPaper).length
    const chunksWithoutEmbedding = chunks?.filter(c => !c.embedding).length || 0
    
    // 7. Analyze PDF Processing Issues
    const pdfProcessingAnalysis = {
      total_logs: pdfLogs?.length || 0,
      by_status: pdfLogs?.reduce((acc: Record<string, number>, log) => {
        acc[log.status] = (acc[log.status] || 0) + 1
        return acc
      }, {}) || {},
      recent_failures: pdfLogs?.filter(log => log.status === 'failed').slice(0, 5).map(log => ({
        paper_id: log.paper_id,
        error: log.error_message,
        attempts: log.attempts,
        created_at: log.created_at
      })) || [],
      recent_success: pdfLogs?.filter(log => log.status === 'completed').slice(0, 3).map(log => ({
        paper_id: log.paper_id,
        created_at: log.created_at
      })) || []
    }
    
    // 8. Data Quality Issues
    const issues: string[] = []
    
    const projectsWithoutContent = projects?.filter(p => !p.content || p.content.length < 100).length || 0
    if (projectsWithoutContent > 0) {
      issues.push(`${projectsWithoutContent} projects have no/minimal content`)
    }
    
    const papersWithoutContent = papers?.filter(p => !p.pdf_content && !p.abstract).length || 0
    if (papersWithoutContent > 0) {
      issues.push(`${papersWithoutContent} papers have no content`)
    }
    
    if (chunksWithoutEmbedding > 0) {
      issues.push(`${chunksWithoutEmbedding} chunks missing embeddings`)
    }
    
    const coverageRate = totalPapers > 0 ? (papersWithChunks / totalPapers * 100) : 0
    if (coverageRate < 30) {
      issues.push(`Very low coverage rate: ${coverageRate.toFixed(1)}%`)
    }

    // Add PDF-specific issues
    const papersWithPdfContent = papers?.filter(p => p.pdf_content).length || 0
    if (papersWithPdfContent === 0 && totalPapers > 0) {
      issues.push(`CRITICAL: Zero papers have PDF content extracted (${totalPapers} papers total)`)
    }

    const recentPdfFailures = pdfLogs?.filter(log => log.status === 'failed').length || 0
    if (recentPdfFailures > 0) {
      issues.push(`${recentPdfFailures} recent PDF processing failures`)
    }
    
    const analysis = {
      timestamp: new Date().toISOString(),
      projects: {
        total: projects?.length || 0,
        with_content: projects?.filter(p => p.content && p.content.length > 100).length || 0,
        without_content: projectsWithoutContent,
        sample: projects?.slice(0, 5).map(p => ({
          id: p.id,
          topic: p.topic,
          status: p.status,
          content_length: p.content?.length || 0,
          created_at: p.created_at
        }))
      },
      papers: {
        total: totalPapers,
        with_content: papersWithContent,
        without_content: papersWithoutContent,
        with_pdf_content: papers?.filter(p => p.pdf_content).length || 0,
        with_abstract_only: papers?.filter(p => !p.pdf_content && p.abstract).length || 0,
        sample: papers?.slice(0, 10).map(p => ({
          id: p.id,
          title: p.title?.slice(0, 60) + (p.title && p.title.length > 60 ? '...' : ''),
          has_pdf_content: !!p.pdf_content,
          has_abstract: !!p.abstract,
          status: p.status,
          created_at: p.created_at
        }))
      },
      chunks: {
        total: chunks?.length || 0,
        papers_with_chunks: papersWithChunks,
        without_embedding: chunksWithoutEmbedding,
        distribution: Object.entries(chunksByPaper)
          .sort(([,a], [,b]) => (b as number) - (a as number))
          .slice(0, 10)
          .map(([paperId, count]) => ({ paper_id: paperId.slice(0, 8), chunk_count: count })),
        recent_activity: chunks?.slice(0, 5).map(c => ({
          paper_id: c.paper_id.slice(0, 8),
          has_embedding: !!c.embedding,
          created_at: c.created_at
        }))
      },
      coverage: {
        papers_total: totalPapers,
        papers_with_chunks: papersWithChunks,
        coverage_rate: parseFloat(coverageRate.toFixed(1)),
        is_critical: coverageRate < 30
      },
      pdf_processing: pdfProcessingAnalysis,
      failed_chunks: {
        total: failedChunks?.length || 0,
        recent: failedChunks?.slice(0, 5).map(chunk => ({
          paper_id: chunk.paper_id,
          error: chunk.error_message,
          attempts: chunk.error_count,
          created_at: chunk.created_at
        })) || []
      },
      data_quality_issues: issues,
      diagnosis: {
        primary_issue: papersWithPdfContent === 0 ? 'PDF_PROCESSING_COMPLETELY_BROKEN' : 
                      coverageRate < 30 ? 'LOW_CONTENT_COVERAGE' : 'UNKNOWN',
        severity: papersWithPdfContent === 0 ? 'CRITICAL' : 'HIGH',
        likely_causes: papersWithPdfContent === 0 ? [
          'PDF extraction service not working',
          'PDF download failures',
          'Tiered extractor has runtime errors',
          'PDF queue not processing jobs',
          'Missing environment variables for PDF services'
        ] : coverageRate < 30 ? [
          'PDF processing pipeline failures',
          'Content ingestion not running',
          'Chunk creation broken',
          'Embedding generation failures'
        ] : [],
        next_steps: papersWithPdfContent === 0 ? [
          'Check PDF processing logs for error patterns',
          'Test PDF extraction manually with a single paper',
          'Verify PDF queue is running and processing jobs',
          'Check PDF extractor service configuration',
          'Examine network connectivity to PDF sources'
        ] : coverageRate < 30 ? [
          'Check PDF queue processing',
          'Verify paper ingestion workflow',
          'Test chunk creation manually',
          'Check embedding service status'
        ] : []
      }
    }
    
    return NextResponse.json(analysis, { 
      headers: { 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Database analysis failed:', error)
    return NextResponse.json(
      { error: 'Database analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
