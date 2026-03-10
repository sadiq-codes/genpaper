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

export function getStoragePathFromPublicUrl(url: string, bucketName: string): string | null {
  const escapedBucket = bucketName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = url.match(new RegExp(`/${escapedBucket}/(.+?)(?:\\?|$)`))
  return match ? decodeURIComponent(match[1]) : null
}
