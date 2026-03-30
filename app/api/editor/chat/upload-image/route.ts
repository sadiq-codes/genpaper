export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { CHAT_IMAGES_BUCKET, ensureStorageBucket } from '@/lib/supabase/storage-buckets'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function generateFilename(projectId: string, file: File): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const extension = file.name.split('.').pop() || 'png'
  return `${projectId}/${timestamp}-${random}.${extension}`
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth()

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5MB' }, { status: 413 })
    }

    const serviceClient = createServiceClient()
    await ensureStorageBucket(serviceClient, CHAT_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_SIZE,
    })

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = generateFilename(projectId, file)

    const { error: uploadError } = await serviceClient.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(filename, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || 'Failed to upload image' }, { status: 500 })
    }

    const { data: urlData } = serviceClient.storage
      .from(CHAT_IMAGES_BUCKET)
      .getPublicUrl(filename)

    return NextResponse.json({ success: true, url: urlData.publicUrl })
  } catch (error) {
    return handleError(error, 'Chat image upload error')
  }
}
