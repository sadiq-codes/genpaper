/**
 * useChatImageUpload - Handle image uploads for chat messages
 * 
 * Features:
 * - Upload images to Supabase storage
 * - Generate unique filenames
 * - Handle loading states
 * - Error handling with toasts
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'

interface UseChatImageUploadOptions {
  /** Project ID for organizing uploads */
  projectId?: string
  /** Maximum file size in bytes (default: 5MB) */
  maxSizeBytes?: number
  /** Allowed file types */
  allowedTypes?: string[]
}

interface UseChatImageUploadReturn {
  /** Upload an image file and return the public URL */
  uploadImage: (file: File) => Promise<string | null>
  /** Whether an upload is in progress */
  isUploading: boolean
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function useChatImageUpload({
  projectId,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  allowedTypes = DEFAULT_ALLOWED_TYPES,
}: UseChatImageUploadOptions): UseChatImageUploadReturn {
  const [isUploading, setIsUploading] = useState(false)

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    if (!projectId) {
      toast.error('Cannot upload image without a project')
      return null
    }

    // Validate file type
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type', {
        description: `Allowed types: ${allowedTypes.map(t => t.split('/')[1]).join(', ')}`,
      })
      return null
    }

    // Validate file size
    if (file.size > maxSizeBytes) {
      const maxSizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(1)
      toast.error('File too large', {
        description: `Maximum size is ${maxSizeMB}MB`,
      })
      return null
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', projectId)

      const response = await fetch('/api/editor/chat/upload-image', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json().catch(() => ({ error: 'Failed to upload image' }))
      if (!response.ok || !data.url) {
        const message = data.error || 'Failed to upload image'
        console.error('Image upload error:', message)
        toast.error('Failed to upload image', {
          description: message,
        })
        return null
      }

      return data.url as string

    } catch (error) {
      console.error('Image upload error:', error)
      toast.error('Failed to upload image', {
        description: error instanceof Error ? error.message : undefined,
      })
      return null
    } finally {
      setIsUploading(false)
    }
  }, [projectId, maxSizeBytes, allowedTypes])

  return {
    uploadImage,
    isUploading,
  }
}
