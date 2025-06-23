import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pdfQueue } from '@/lib/services/pdf-queue'

/**
 * Get PDF processing job status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { jobId } = params

    if (!jobId) {
      return NextResponse.json({ 
        error: 'Job ID is required' 
      }, { status: 400 })
    }

    // Get job status from queue
    const jobStatus = pdfQueue.getJobStatus(jobId)

    if (!jobStatus) {
      return NextResponse.json({ 
        error: 'Job not found' 
      }, { status: 404 })
    }

    // Check if user owns this job
    if (jobStatus.userId !== user.id && jobStatus.userId !== 'system') {
      return NextResponse.json({ 
        error: 'Access denied' 
      }, { status: 403 })
    }

    // Format response
    const response = {
      jobId: jobStatus.id,
      paperId: jobStatus.paperId,
      paperTitle: jobStatus.paperTitle,
      status: jobStatus.status,
      priority: jobStatus.priority,
      attempts: jobStatus.attempts,
      maxAttempts: jobStatus.maxAttempts,
      createdAt: jobStatus.createdAt,
      startedAt: jobStatus.startedAt,
      completedAt: jobStatus.completedAt,
      error: jobStatus.error,
      metadata: {
        fileSize: jobStatus.metadata?.fileSize,
        estimatedCost: jobStatus.metadata?.estimatedCost,
        userQuotaUsed: jobStatus.metadata?.userQuotaUsed
      },
      extractionResult: jobStatus.extractionResult ? {
        extractionMethod: jobStatus.extractionResult.extractionMethod,
        confidence: jobStatus.extractionResult.confidence,
        extractionTimeMs: jobStatus.extractionResult.extractionTimeMs,
        wordCount: jobStatus.extractionResult.metadata?.wordCount,
        pageCount: jobStatus.extractionResult.metadata?.pageCount,
        isScanned: jobStatus.extractionResult.metadata?.isScanned
      } : undefined
    }

    return NextResponse.json({
      success: true,
      job: response
    })

  } catch (error) {
    console.error('PDF status API error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
} 