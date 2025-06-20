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
    }
    return this.instance
  }

  /**
   * Add PDF processing job to queue
   */
  async addJob(
    paperId: string,
    pdfUrl: string,
    paperTitle: string,
    userId: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<string> {
    // Check user quota
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

    const timeoutId = setTimeout(() => {
      this.handleJobTimeout(job)
    }, this.JOB_TIMEOUT_MS)

    try {
      // Download PDF
      this.updateStatus(job.id, {
        jobId: job.id,
        status: 'processing',
        progress: 20,
        message: 'Downloading PDF...'
      })

      const pdfBuffer = await this.downloadPDF(job.pdfUrl)
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
        maxTimeoutMs: 30000,
        trimToTokens: 4000
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
    
    const updates: any = {
      daily_pdf_used: supabase.rpc('increment', { x: 1 })
    }
    
    if (usedOcr) {
      updates.monthly_ocr_used = supabase.rpc('increment', { x: 1 })
    }

    await supabase
      .from('user_quotas')
      .update(updates)
      .eq('user_id', userId)
  }

  /**
   * Download PDF with size and timeout limits
   */
  private async downloadPDF(url: string): Promise<Buffer> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'GenPaper/2.0 Academic Research Tool'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      
      // Check size limit (50MB)
      if (buffer.byteLength > 50 * 1024 * 1024) {
        throw new Error(`PDF too large: ${buffer.byteLength} bytes`)
      }

      return Buffer.from(buffer)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Store extraction result in database
   */
  private async storeExtractionResult(
    paperId: string, 
    result: TieredExtractionResult
  ): Promise<void> {
    const supabase = await getSB()
    
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
   * Broadcast status via Supabase Realtime
   */
  private async broadcastStatus(status: ProcessingStatus): Promise<void> {
    const supabase = await getSB()
    
    await supabase
      .channel('pdf-processing')
      .send({
        type: 'broadcast',
        event: 'status-update',
        payload: status
      })
  }
}

// Export singleton instance
export const pdfQueue = PDFProcessingQueue.getInstance() 