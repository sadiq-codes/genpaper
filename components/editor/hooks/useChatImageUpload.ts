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
import { createClient } from '@/lib/supabase/client'

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

const CHAT_IMAGES_BUCKET = 'chat-images'
const DEFAULT_MAX_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/**
 * Generate a unique filename for the uploaded image
 */
function generateFilename(projectId: string, file: File): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const extension = file.name.split('.').pop() || 'png'
  return `${projectId}/${timestamp}-${random}.${extension}`
}

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
      const supabase = createClient()
      const filename = generateFilename(projectId, file)

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from(CHAT_IMAGES_BUCKET)
        .upload(filename, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error('Image upload error:', uploadError)
        toast.error('Failed to upload image', {
          description: uploadError.message,
        })
        return null
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(CHAT_IMAGES_BUCKET)
        .getPublicUrl(filename)

      return urlData.publicUrl

    } catch (error) {
      console.error('Image upload error:', error)
      toast.error('Failed to upload image')
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
