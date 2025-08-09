import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { PlaceholderCitationSchema, generateCiteKey } from '@/lib/citations/placeholder-schema'
import { citationLogger } from '@/lib/utils/citation-logger'
import { batchRateLimiter, citationRateLimiter } from '@/lib/utils/rate-limiter'

/**
 * POST /api/citations/batch-add - Resolve all placeholders in one call
 * 
 * Accepts {projectId, refs[]} and returns {ref→citeKey} mapping
 * Deduplicates server-side and processes in single transaction per batch
 */

// Schema for batch citation addition
const BatchAddSchema = z.object({
  projectId: z.string().uuid(),
  refs: z.array(PlaceholderCitationSchema).min(1).max(50), // Reasonable batch limit
  reason: z.string().default('batch citation'),
  context: z.string().optional()
})

export async function POST(request: NextRequest) {
  const requestId = citationLogger.generateRequestId()
  const timer = citationLogger.startTimer()
  
  try {
    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = BatchAddSchema.safeParse(body)
    
    if (!validationResult.success) {
      citationLogger.logValidationError({
        operation: 'batch_add',
        requestId,
        error: 'Validation failed',
        input: body
      })
      
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId, refs, reason, context } = validationResult.data

    // Apply rate limiting for batch operations
    const batchRateLimitResult = batchRateLimiter.checkLimit(projectId, 1)
    if (!batchRateLimitResult.allowed) {
      citationLogger.logRateLimit({
        operation: 'batch_add',
        projectId,
        limit: 10,
        windowMs: 60000,
        retryAfter: batchRateLimitResult.retryAfter
      })

      return NextResponse.json({
        error: 'Batch rate limit exceeded',
        message: 'Too many batch requests. Please slow down.',
        retryAfter: batchRateLimitResult.retryAfter
      }, { 
        status: 429,
        headers: {
          'Retry-After': batchRateLimitResult.retryAfter?.toString() || '60',
          'X-RateLimit-Remaining': batchRateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(batchRateLimitResult.resetTime).toISOString()
        }
      })
    }

    // Also check individual citation rate limit
    const citationRateLimitResult = citationRateLimiter.checkLimit(projectId, refs.length)
    if (!citationRateLimitResult.allowed) {
      citationLogger.logRateLimit({
        operation: 'batch_add_citations',
        projectId,
        limit: 60,
        windowMs: 60000,
        retryAfter: citationRateLimitResult.retryAfter
      })

      return NextResponse.json({
        error: 'Citation rate limit exceeded',
        message: `Batch size (${refs.length}) exceeds available citation quota. Please reduce batch size or wait.`,
        retryAfter: citationRateLimitResult.retryAfter,
        availableQuota: citationRateLimitResult.remaining
      }, { 
        status: 429,
        headers: {
          'Retry-After': citationRateLimitResult.retryAfter?.toString() || '60',
          'X-RateLimit-Remaining': citationRateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(citationRateLimitResult.resetTime).toISOString()
        }
      })
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ 
        error: 'Project not found or access denied' 
      }, { status: 404 })
    }

    // Deduplicate refs server-side by generating consistent keys
    const uniqueRefs = new Map<string, typeof refs[0]>()
    for (const ref of refs) {
      const key = generateCiteKey(ref)
      if (!uniqueRefs.has(key)) {
        uniqueRefs.set(key, ref)
      }
    }

    const deduplicatedRefs = Array.from(uniqueRefs.values())
    
    try {
      // Process all refs in parallel (CitationService.add handles concurrency)
      const results = await Promise.allSettled(
        deduplicatedRefs.map(async (ref) => {
          const sourceRef = {
            ...(ref.type === 'doi' && { doi: ref.value }),
            ...(ref.type === 'paperId' && { paperId: ref.value }),
            ...(ref.type === 'title' && { title: ref.value }),
            ...(ref.type === 'url' && { url: ref.value })
          }

          const result = await CitationService.add({
            projectId,
            sourceRef,
            reason: ref.context || reason,
            quote: context
          })

          return {
            refKey: generateCiteKey(ref),
            originalRef: ref,
            citeKey: result.citeKey,
            projectCitationId: result.projectCitationId,
            isNew: result.isNew
          }
        })
      )

      // Separate successful and failed results
      const successful: Array<{
        refKey: string
        originalRef: typeof refs[0]
        citeKey: string
        projectCitationId: string
        isNew: boolean
      }> = []
      
      const failed: Array<{
        refKey: string
        originalRef: typeof refs[0]
        error: string
      }> = []

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successful.push(result.value)
        } else {
          const ref = deduplicatedRefs[index]
          failed.push({
            refKey: generateCiteKey(ref),
            originalRef: ref,
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
          })
        }
      })

      // Build ref→citeKey mapping for successful citations
      const refToCiteKey: Record<string, string> = {}
      for (const success of successful) {
        refToCiteKey[success.refKey] = success.citeKey
      }

      // Log batch operation metrics
      const metrics = timer.end()
      citationLogger.logBatchAdd({
        operation: 'batch_add',
        projectId,
        requestId,
        metrics,
        batchSize: deduplicatedRefs.length,
        successCount: successful.length,
        failureCount: failed.length
      })

      // Response with detailed results
      return NextResponse.json({
        success: true,
        data: {
          projectId,
          processed: deduplicatedRefs.length,
          originalCount: refs.length,
          deduplicatedCount: deduplicatedRefs.length,
          successCount: successful.length,
          failureCount: failed.length,
          refToCiteKey,
          successful: successful.map(s => ({
            refKey: s.refKey,
            citeKey: s.citeKey,
            isNew: s.isNew
          })),
          ...(failed.length > 0 && {
            failed: failed.map(f => ({
              refKey: f.refKey,
              ref: f.originalRef,
              error: f.error
            }))
          })
        }
      }, { status: 200 })

    } catch (batchError) {
      console.error('Batch citation processing failed:', batchError)
      return NextResponse.json({
        error: 'Batch processing failed',
        message: batchError instanceof Error ? batchError.message : 'Failed to process citation batch'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Batch add API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// Method not allowed for other HTTP methods
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function PUT() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}