'use client'

import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { UploadedPdf, PdfUploadResult } from '../types'

interface UsePdfUploadOptions {
  /** Called when a PDF starts uploading */
  onUploadStart: (pdf: UploadedPdf) => void
  /** Called when upload status changes */
  onUploadProgress: (id: string, updates: Partial<UploadedPdf>) => void
  /** Called when upload completes successfully */
  onUploadComplete: (id: string, result: PdfUploadResult) => void
  /** Called when upload fails */
  onUploadError: (id: string, error: string) => void
  /** Maximum file size in bytes (default: 20MB) */
  maxFileSize?: number
}

interface UsePdfUploadReturn {
  /** Upload one or more PDF files */
  uploadFiles: (files: FileList | File[]) => Promise<void>
  /** Cancel an in-progress upload */
  cancelUpload: (id: string) => void
  /** Check if any uploads are in progress */
  isUploading: boolean
}

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024 // 20MB

export function usePdfUpload({
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadError,
  maxFileSize = DEFAULT_MAX_SIZE,
}: UsePdfUploadOptions): UsePdfUploadReturn {
  // Track abort controllers for each upload
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
  const uploadingCountRef = useRef(0)

  const uploadSingleFile = useCallback(
    async (file: File): Promise<void> => {
      const tempId = crypto.randomUUID()
      const controller = new AbortController()
      abortControllersRef.current.set(tempId, controller)
      uploadingCountRef.current++

      try {
        // Validate file type
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          throw new Error('Please select a PDF file')
        }

        // Validate file size
        if (file.size > maxFileSize) {
          const sizeMB = Math.round(maxFileSize / (1024 * 1024))
          throw new Error(`File too large. Maximum size is ${sizeMB}MB`)
        }

        // Start upload
        const uploadingPdf: UploadedPdf = {
          id: tempId,
          filename: file.name,
          status: 'uploading',
        }
        onUploadStart(uploadingPdf)
        toast.loading(`Uploading ${file.name}...`, { id: tempId })

        // Create form data
        const formData = new FormData()
        formData.append('file', file)

        // Upload to API
        const response = await fetch('/api/library/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        // Check if aborted
        if (controller.signal.aborted) {
          return
        }

        // Update status to processing
        onUploadProgress(tempId, { status: 'processing' })
        toast.loading(`Processing ${file.name}...`, { id: tempId })

        // Handle response
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(errorData.error || errorData.message || 'Upload failed')
        }

        const result: PdfUploadResult = await response.json()

        if (!result.success || !result.paper) {
          throw new Error(result.error || 'Failed to process PDF')
        }

        // Success!
        onUploadProgress(tempId, {
          status: 'ready',
          paperId: result.paper.id,
          title: result.paper.title,
        })
        onUploadComplete(tempId, result)
        toast.success(`${file.name} ready!`, { id: tempId })

      } catch (error) {
        // Handle abort
        if (error instanceof Error && error.name === 'AbortError') {
          toast.dismiss(tempId)
          return
        }

        // Handle other errors
        const message = error instanceof Error ? error.message : 'Upload failed'
        onUploadProgress(tempId, { status: 'error', error: message })
        onUploadError(tempId, message)
        toast.error(`Failed: ${file.name}`, {
          id: tempId,
          description: message,
        })

      } finally {
        abortControllersRef.current.delete(tempId)
        uploadingCountRef.current--
      }
    },
    [maxFileSize, onUploadStart, onUploadProgress, onUploadComplete, onUploadError]
  )

  const uploadFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const fileArray = Array.from(files)
      
      if (fileArray.length === 0) {
        return
      }

      // Filter to only PDF files
      const pdfFiles = fileArray.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      )

      if (pdfFiles.length === 0) {
        toast.error('Please select PDF files')
        return
      }

      if (pdfFiles.length < fileArray.length) {
        toast.warning(`${fileArray.length - pdfFiles.length} non-PDF files were skipped`)
      }

      // Upload all files concurrently
      await Promise.all(pdfFiles.map(uploadSingleFile))
    },
    [uploadSingleFile]
  )

  const cancelUpload = useCallback((id: string) => {
    const controller = abortControllersRef.current.get(id)
    if (controller) {
      controller.abort()
      abortControllersRef.current.delete(id)
      toast.dismiss(id)
    }
  }, [])

  return {
    uploadFiles,
    cancelUpload,
    isUploading: uploadingCountRef.current > 0,
  }
}
