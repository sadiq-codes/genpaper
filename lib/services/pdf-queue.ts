/**
 * Robust PDF Processing Queue System
 * 
 * Features:
 * - Queue robustness with retry logic and poison pill handling
 * - Real-time status updates via SSE
 * - Cost control with per-user limits and timeouts
 * - Just-in-time RAG for fresh papers
 */

import { getSB } from '@/lib/supabase/server'
import { extractPdfMetadataTiered, type TieredExtractionResult } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { debug } from '@/lib/utils/logger'

export interface PDFProcessingJob {
  id: string
  paperId: string
  pdfUrl: string
  paperTitle: string
  userId: string
  priority: 'low' | 'normal' | 'high'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'poisoned'
  attempts: number
  maxAttempts: number
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
  extractionResult?: TieredExtractionResult
  metadata?: {
    fileSize?: number
    estimatedCost?: number
    userQuotaUsed?: number
  }
}

export interface UserQuota {
  userId: string
  dailyPdfLimit: number
  dailyPdfUsed: number
  monthlyOcrLimit: number
  monthlyOcrUsed: number
  lastReset: Date
}

export interface ProcessingStatus {
  jobId: string
  status: PDFProcessingJob['status']
  progress: number
  message: string
  extractionMethod?: string
  confidence?: string
  timeElapsed?: number
}

/**
 * PDF Processing Queue Manager
 */
export class PDFProcessingQueue {
  private static instance: PDFProcessingQueue
  private jobs = new Map<string, PDFProcessingJob>()
  private processing = new Set<string>()
  private statusCallbacks = new Map<string, (status: ProcessingStatus) => void>()
  private realtimeChannel: unknown = null // 🔌 Single Realtime channel to prevent socket leaks

  // Configuration
  private readonly MAX_CONCURRENT_JOBS = 3
  private readonly DEFAULT_MAX_ATTEMPTS = 3
  private readonly POISON_PILL_THRESHOLD = 5
  private readonly JOB_TIMEOUT_MS = 60000 // 1 minute
  private readonly DAILY_PDF_LIMIT = 50
  private readonly MONTHLY_OCR_LIMIT = 10

  static getInstance(): PDFProcessingQueue {
    if (!this.instance) {
      this.instance = new PDFProcessingQueue()
      // Initialize job recovery on first instantiation
      this.instance.recoverStrandedJobs()
    }
    return this.instance
  }

  /**
   * 🔄 Job Recovery: Reclaim pending/processing jobs on restart
   */
  private async recoverStrandedJobs(): Promise<void> {
    try {
      const supabase = await getSB()
      
      // Find jobs that were pending or processing when the service went down
      const { data: strandedJobs, error } = await supabase
        .from('pdf_processing_logs')
        .select('*')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: true })
      
      if (error) {
        debug.error('Failed to recover stranded jobs', error)
        return
      }
      
      if (!strandedJobs || strandedJobs.length === 0) {
        debug.info('No stranded jobs found during recovery')
        return
      }
      
      debug.info(`🔄 Recovering ${strandedJobs.length} stranded jobs`)
      
      // Convert database records back to job objects and re-queue them
      for (const dbJob of strandedJobs) {
        const job: PDFProcessingJob = {
          id: dbJob.job_id,
          paperId: dbJob.paper_id,
          pdfUrl: dbJob.pdf_url,
          paperTitle: dbJob.paper_title || 'Unknown',
          userId: dbJob.user_id || 'system',
          priority: (dbJob.priority as 'low' | 'normal' | 'high') || 'normal',
          status: 'pending', // Reset to pending for recovery
          attempts: dbJob.attempts || 0,
          maxAttempts: this.DEFAULT_MAX_ATTEMPTS,
          createdAt: new Date(dbJob.created_at),
          error: dbJob.error || undefined,
          metadata: dbJob.metadata as PDFProcessingJob['metadata']
        }
        
        // Add back to memory queue
        this.jobs.set(job.id, job)
        debug.info(`🔄 Recovered job ${job.id} for paper ${job.paperId}`)
      }
      
      debug.info(`✅ Job recovery completed: ${strandedJobs.length} jobs restored`)
      
      // Start processing recovered jobs
      setTimeout(() => this.processNextJob(), 1000)
      
    } catch (error) {
      debug.error('Job recovery failed', error)
    }
  }

  /**
   * Add PDF processing job to queue
   */
  async addJob(
    paperId: string,
    pdfUrl: string,
    paperTitle: string,
    userId: string,
    priority: 'low' | 'normal' | 'high' = 'normal',
    options: { fastTrack?: boolean } = {}
  ): Promise<string> {
    // Fast track for small PDFs (< 5MB, immediate processing)
    if (options.fastTrack) {
      return await this.processFastTrack(paperId, pdfUrl, paperTitle)
    }

    // Check user quota for regular queue processing
    const quotaCheck = await this.checkUserQuota(userId)
    if (!quotaCheck.allowed) {
      throw new Error(`Quota exceeded: ${quotaCheck.reason}`)
    }

    const jobId = `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const job: PDFProcessingJob = {
      id: jobId,
      paperId,
      pdfUrl,
      paperTitle,
      userId,
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.DEFAULT_MAX_ATTEMPTS,
      createdAt: new Date(),
      metadata: {
        estimatedCost: await this.estimateProcessingCost(pdfUrl),
        userQuotaUsed: quotaCheck.quotaUsed
      }
    }

    this.jobs.set(jobId, job)
    
    // Persist job to database
    await this.persistJob(job)
    
    // Start processing if capacity available
    this.processNextJob()
    
    debug.info('PDF processing job added', { jobId, paperId, priority })
    return jobId
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): PDFProcessingJob | null {
    return this.jobs.get(jobId) || null
  }

  /**
   * Subscribe to real-time status updates
   */
  subscribeToStatus(jobId: string, callback: (status: ProcessingStatus) => void): void {
    this.statusCallbacks.set(jobId, callback)
  }

  /**
   * Unsubscribe from status updates
   */
  unsubscribeFromStatus(jobId: string): void {
    this.statusCallbacks.delete(jobId)
  }

  /**
   * Process next job in queue
   */
  private async processNextJob(): Promise<void> {
    if (this.processing.size >= this.MAX_CONCURRENT_JOBS) {
      return // At capacity
    }

    // Find highest priority pending job
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => job.status === 'pending')
      .sort((a, b) => {
        const priorityOrder = { high: 3, normal: 2, low: 1 }
        return priorityOrder[b.priority] - priorityOrder[a.priority] || 
               a.createdAt.getTime() - b.createdAt.getTime()
      })

    const nextJob = pendingJobs[0]
    if (!nextJob) return

    await this.processJob(nextJob)
  }

  /**
   * Process individual job with timeout and error handling
   */
  private async processJob(job: PDFProcessingJob): Promise<void> {
    this.processing.add(job.id)
    job.status = 'processing'
    job.startedAt = new Date()
    job.attempts++

    this.updateStatus(job.id, {
      jobId: job.id,
      status: 'processing',
      progress: 0,
      message: 'Starting PDF processing...'
    })

    // 🕐 Adaptive timeout: Longer for OCR and large files
    const enableOcr = await this.shouldEnableOcr(job.userId)
    const fileSize = job.metadata?.fileSize || 0
    const adaptiveTimeout = enableOcr 
      ? Math.max(300000, Math.min(600000, fileSize / 1024)) // 5-10 minutes for OCR based on size
      : this.JOB_TIMEOUT_MS // 1 minute for regular processing
    
    const timeoutId = setTimeout(() => {
      this.handleJobTimeout(job)
    }, adaptiveTimeout)

    try {
      // Download PDF
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'processing',
        progress: 20,
        message: 'Downloading PDF...'
      })

      const pdfBuffer = await downloadPdfBuffer(job.pdfUrl)
      job.metadata!.fileSize = pdfBuffer.length

      // Extract content using tiered approach
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'processing',
        progress: 40,
        message: 'Extracting content...'
      })

      const extractionResult = await extractPdfMetadataTiered(pdfBuffer, {
        grobidUrl: process.env.GROBID_URL,
        enableOcr: await this.shouldEnableOcr(job.userId),
        maxTimeoutMs: 30000
      })

      job.extractionResult = extractionResult

      // Store extracted content
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'processing',
        progress: 80,
        message: 'Storing extracted content...'
      })

      await this.storeExtractionResult(job.paperId, extractionResult)

      // Update user quota
      await this.updateUserQuota(job.userId, extractionResult.extractionMethod === 'ocr')

      // Mark as completed
      job.status = 'completed'
      job.completedAt = new Date()

      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'completed',
        progress: 100,
        message: 'PDF processing completed successfully',
        extractionMethod: extractionResult.extractionMethod,
        confidence: extractionResult.confidence,
        timeElapsed: extractionResult.extractionTimeMs
      })

      debug.info('PDF processing completed', { 
        jobId: job.id, 
        method: extractionResult.extractionMethod,
        timeMs: extractionResult.extractionTimeMs 
      })

    } catch (error) {
      await this.handleJobError(job, error)
    } finally {
      clearTimeout(timeoutId)
      this.processing.delete(job.id)
      await this.persistJob(job)
      
      // 🧹 Memory hygiene: Clean up completed/failed/poisoned jobs from memory
      if (['completed', 'failed', 'poisoned'].includes(job.status)) {
        this.jobs.delete(job.id)
        this.statusCallbacks.delete(job.id)
      }
      
      // Process next job
      setTimeout(() => this.processNextJob(), 100)
    }
  }

  /**
   * Handle job errors with retry logic and poison pill detection
   */
  private async handleJobError(job: PDFProcessingJob, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    job.error = errorMessage

    debug.error('PDF processing failed', { 
      jobId: job.id, 
      attempt: job.attempts, 
      error: errorMessage 
    })

    // Check for poison pill (repeated failures)
    const recentFailures = await this.getRecentFailureCount(job.pdfUrl)
    if (recentFailures >= this.POISON_PILL_THRESHOLD) {
      job.status = 'poisoned'
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'poisoned',
        progress: 0,
        message: `PDF marked as poisoned after ${recentFailures} failures`
      })
      debug.warn('PDF marked as poison pill', { jobId: job.id, pdfUrl: job.pdfUrl })
      return
    }

    // Retry logic
    if (job.attempts < job.maxAttempts) {
      job.status = 'pending'
      const retryDelay = Math.min(1000 * Math.pow(2, job.attempts), 30000) // Exponential backoff
      
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'pending',
        progress: 0,
        message: `Retrying in ${retryDelay / 1000}s (attempt ${job.attempts + 1}/${job.maxAttempts})`
      })

      setTimeout(() => this.processNextJob(), retryDelay)
    } else {
      job.status = 'failed'
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'failed',
        progress: 0,
        message: `Processing failed after ${job.attempts} attempts: ${errorMessage}`
      })
    }
  }

  /**
   * Handle job timeout
   */
  private async handleJobTimeout(job: PDFProcessingJob): Promise<void> {
    debug.warn('PDF processing timeout', { jobId: job.id })
    await this.handleJobError(job, new Error('Processing timeout'))
  }

  /**
   * Check user quota and limits
   */
  private async checkUserQuota(userId: string): Promise<{
    allowed: boolean
    reason?: string
    quotaUsed: number
  }> {
    const supabase = await getSB()
    
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!quota) {
      // Create default quota for new user
      await supabase
        .from('user_quotas')
        .insert({
          user_id: userId,
          daily_pdf_limit: this.DAILY_PDF_LIMIT,
          daily_pdf_used: 0,
          monthly_ocr_limit: this.MONTHLY_OCR_LIMIT,
          monthly_ocr_used: 0,
          last_reset: new Date()
        })
      
      return { allowed: true, quotaUsed: 0 }
    }

    // Check daily PDF limit
    if (quota.daily_pdf_used >= quota.daily_pdf_limit) {
      return { 
        allowed: false, 
        reason: `Daily PDF limit reached (${quota.daily_pdf_limit})`,
        quotaUsed: quota.daily_pdf_used
      }
    }

    return { allowed: true, quotaUsed: quota.daily_pdf_used }
  }

  /**
   * Determine if OCR should be enabled for user
   */
  private async shouldEnableOcr(userId: string): Promise<boolean> {
    const supabase = await getSB()
    
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('monthly_ocr_used, monthly_ocr_limit')
      .eq('user_id', userId)
      .single()

    if (!quota) return false
    
    return quota.monthly_ocr_used < quota.monthly_ocr_limit
  }

  /**
   * Update user quota after processing
   */
  private async updateUserQuota(userId: string, usedOcr: boolean): Promise<void> {
    const supabase = await getSB()
    
    // 🔧 Fix: Fetch current counts, then increment properly
    const { data: currentQuota } = await supabase
      .from('user_quotas')
      .select('daily_pdf_used, monthly_ocr_used')
      .eq('user_id', userId)
      .single()
    
    if (!currentQuota) {
      debug.warn('No quota found for user during increment', { userId })
      return
    }
    
    const updates: Record<string, number> = {
      daily_pdf_used: currentQuota.daily_pdf_used + 1
    }
    
    if (usedOcr) {
      updates.monthly_ocr_used = currentQuota.monthly_ocr_used + 1
    }

    await supabase
      .from('user_quotas')
      .update(updates)
      .eq('user_id', userId)
  }



  /**
   * Store extraction result in database with direct chunking (no recursive calls)
   */
  private async storeExtractionResult(
    paperId: string, 
    result: TieredExtractionResult
  ): Promise<void> {
    const supabase = await getSB()
    
    // 1. Update the paper with PDF content and processing metadata
    await supabase
      .from('papers')
      .update({
        pdf_content: result.fullText,
        metadata: {
          pdf_processing: {
            extraction_method: result.extractionMethod,
            extraction_time_ms: result.extractionTimeMs,
            confidence: result.confidence,
            word_count: result.metadata?.wordCount,
            page_count: result.metadata?.pageCount,
            is_scanned: result.metadata?.isScanned,
            processing_notes: result.metadata?.processingNotes,
            processed_at: new Date().toISOString()
          }
        }
      })
      .eq('id', paperId)
    
    // 2. If we have text, trigger chunking directly (no recursive ingestion)
    if (result.fullText && result.fullText.length > 100) {
      debug.info('Processing PDF text for chunking and embeddings', { 
        paperId, 
        textLength: result.fullText.length,
        extractionMethod: result.extractionMethod 
      })
      
      try {
        // Import chunking utilities directly
        const { processAndSaveChunks } = await import('@/lib/utils/chunk-processor')
        
                 // Process text with 1MB safety cap
         const text = result.fullText.slice(0, 1_000_000)
         await processAndSaveChunks(paperId, [text])
        
        debug.info(`PDF text processing completed for ${paperId}`, {
          extractionMethod: result.extractionMethod,
          textLength: result.fullText.length
        })
        
      } catch (chunkError) {
        debug.error('Failed to process PDF text for chunking', { 
          paperId, 
          extractionMethod: result.extractionMethod,
          error: chunkError 
        })
        // Don't fail the entire operation, but log for monitoring
      }
    } else {
      debug.warn('No usable full text available from PDF extraction', { 
        paperId, 
        extractionMethod: result.extractionMethod 
      })
    }
  }

  /**
   * Estimate processing cost
   */
  private async estimateProcessingCost(pdfUrl: string): Promise<number> {
    // Rough cost estimation based on file size and processing method
    try {
      const response = await fetch(pdfUrl, { method: 'HEAD' })
      const contentLength = response.headers.get('content-length')
      const sizeBytes = contentLength ? parseInt(contentLength) : 1024 * 1024 // 1MB default
      
      // GROBID: negligible cost
      // Text layer: negligible cost  
      // OCR: ~$1.50 per 1000 pages, assume 100KB per page
      const estimatedPages = Math.ceil(sizeBytes / (100 * 1024))
      const ocrCost = (estimatedPages / 1000) * 1.50
      
      return ocrCost
    } catch {
      return 0.1 // Default estimate
    }
  }

  /**
   * Get recent failure count for poison pill detection
   */
  private async getRecentFailureCount(pdfUrl: string): Promise<number> {
    const supabase = await getSB()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const { count } = await supabase
      .from('pdf_processing_logs')
      .select('*', { count: 'exact', head: true })
      .eq('pdf_url', pdfUrl)
      .eq('status', 'failed')
      .gte('created_at', oneDayAgo.toISOString())
    
    return count || 0
  }

  /**
   * Persist job to database
   */
  private async persistJob(job: PDFProcessingJob): Promise<void> {
    const supabase = await getSB()
    
    await supabase
      .from('pdf_processing_logs')
      .upsert({
        job_id: job.id,
        paper_id: job.paperId,
        pdf_url: job.pdfUrl,
        user_id: job.userId,
        status: job.status,
        attempts: job.attempts,
        error_message: job.error,
        extraction_result: job.extractionResult,
        metadata: job.metadata,
        created_at: job.createdAt.toISOString(),
        started_at: job.startedAt?.toISOString(),
        completed_at: job.completedAt?.toISOString()
      })
  }

  /**
   * Fast track processing for small PDFs (< 5MB, immediate processing)
   * Use for CLI tools, dev environments, or guaranteed small files
   */
  private async processFastTrack(
    paperId: string,
    pdfUrl: string,
    paperTitle: string
  ): Promise<string> {
    const jobId = `fast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    debug.info('Fast track PDF processing', { jobId, paperId, paperTitle })
    
    try {
      // Quick size check first
      const response = await fetch(pdfUrl, { method: 'HEAD' })
      const contentLength = response.headers.get('content-length')
      const sizeBytes = contentLength ? parseInt(contentLength) : 0
      
      // Reject large files for fast track
      if (sizeBytes > 5 * 1024 * 1024) { // 5MB limit
        throw new Error(`File too large for fast track: ${sizeBytes} bytes (max: 5MB)`)
      }
      
      // Process immediately with timeout
      const pdfBuffer = await downloadPdfBuffer(pdfUrl)
      
      const extractionResult = await extractPdfMetadataTiered(pdfBuffer, {
        enableOcr: false, // No OCR for fast track
        maxTimeoutMs: 10000 // 10s timeout
      })
      
      await this.storeExtractionResult(paperId, extractionResult)
      
      // 💾 Fast-track persistence: Maintain history & SSE consistency
      const completedJob: PDFProcessingJob = {
        id: jobId,
        paperId,
        pdfUrl,
        paperTitle,
        userId: 'system', // Fast track typically used by system
        priority: 'high',
        status: 'completed',
        attempts: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        extractionResult,
        metadata: {
          fileSize: sizeBytes,
          estimatedCost: 0,
          userQuotaUsed: 0
        }
      }
      
      await this.persistJob(completedJob)
      
      debug.info('Fast track processing completed', { 
        jobId, 
        method: extractionResult.extractionMethod,
        timeMs: extractionResult.extractionTimeMs 
      })
      
      return jobId
      
    } catch (error) {
      debug.error('Fast track processing failed', { jobId, error })
      throw new Error(`Fast track failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Send real-time status update
   */
  private updateStatus(jobId: string, status: ProcessingStatus): void {
    const callback = this.statusCallbacks.get(jobId)
    if (callback) {
      callback(status)
    }
    
    // Also broadcast via Supabase Realtime
    this.broadcastStatus(status)
  }

  /**
   * Broadcast status via Supabase Realtime (single channel to prevent socket leaks)
   */
  private async broadcastStatus(status: ProcessingStatus): Promise<void> {
    try {
      const supabase = await getSB()
      
      // 🔌 Initialize single channel on first use to prevent socket leaks
      if (!this.realtimeChannel) {
        this.realtimeChannel = supabase.channel('pdf-processing')
      }
      
      // Send via the persistent channel
      if (this.realtimeChannel && typeof this.realtimeChannel === 'object') {
        const channel = this.realtimeChannel as { send: (data: unknown) => Promise<unknown> }
        await channel.send({
          type: 'broadcast',
          event: 'status-update',
          payload: status
        })
      }
    } catch (error) {
      debug.warn('Failed to broadcast status', { error })
    }
  }
}

// Export singleton instance
export const pdfQueue = PDFProcessingQueue.getInstance() 