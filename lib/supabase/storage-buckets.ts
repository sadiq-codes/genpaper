import type { SupabaseClient } from '@supabase/supabase-js'

export const PAPER_PDFS_BUCKET = 'papers'
export const CHAT_IMAGES_BUCKET = 'chat-images'

export interface EnsureBucketOptions {
  public?: boolean
  fileSizeLimit?: number
}

export async function ensureStorageBucket(
  supabase: SupabaseClient<any>,
  bucketName: string,
  options: EnsureBucketOptions = {}
): Promise<void> {
  const { error } = await supabase.storage.createBucket(bucketName, {
    public: options.public ?? true,
    fileSizeLimit: options.fileSizeLimit,
  })

  if (!error) return

  const normalized = error.message.toLowerCase()
  if (
    normalized.includes('already exists') ||
    normalized.includes('duplicate') ||
    normalized.includes('violates unique constraint')
  ) {
    return
  }

  throw error
}

export function parseStorageObjectUrl(url: string): { bucketName: string; path: string } | null {
  try {
    const parsed = new URL(url)
    const match = parsed.pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
    )
    if (!match) {
      return null
    }

    return {
      bucketName: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    }
  } catch {
    return null
  }
}

export function getStoragePathFromPublicUrl(url: string, bucketName: string): string | null {
  const parsed = parseStorageObjectUrl(url)
  if (!parsed || parsed.bucketName !== bucketName) {
    return null
  }
  return parsed.path
}
