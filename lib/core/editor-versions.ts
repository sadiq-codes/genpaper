import 'server-only'
import { createHash } from 'crypto'
import { getSB } from '@/lib/supabase/server'

export interface DocumentVersion {
  id: string
  document_id: string
  base_version_id: string | null
  sha: string
  content_md: string
  actor: 'user' | 'ai'
  prompt?: string | null
  model?: string | null
  created_at: string
}

export interface LatestVersion {
  id: string
  sha: string
  content_md: string
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export const VersionStore = {
  /**
   * Fetch latest version for a document.
   * If none exists, synthesize a baseline from empty content.
   */
  async getLatest(documentId: string): Promise<LatestVersion> {
    const supabase = await getSB()

    // Try to read latest from document_versions
    const { data: versions, error } = await supabase
      .from('document_versions')
      .select('id, sha, content_md, created_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!error && versions && versions.length > 0) {
      const v = versions[0] as unknown as LatestVersion & { created_at: string }
      return { id: v.id, sha: v.sha, content_md: v.content_md }
    }

    // Synthesize a baseline (empty) if table exists but no versions yet
    const baseline = ''
    return {
      id: 'baseline',
      sha: sha256(baseline),
      content_md: baseline,
    }
  },

  /**
   * Create a new version row and return its id and sha.
   */
  async createVersion(params: {
    documentId: string
    baseVersionId: string | null
    contentMd: string
    actor: 'user' | 'ai'
    prompt?: string | null
    model?: string | null
  }): Promise<{ id: string; sha: string }> {
    const supabase = await getSB()
    const sha = sha256(params.contentMd)
    const { data, error } = await supabase
      .from('document_versions')
      .insert({
        document_id: params.documentId,
        base_version_id: params.baseVersionId,
        sha,
        content_md: params.contentMd,
        actor: params.actor,
        prompt: params.prompt ?? null,
        model: params.model ?? null,
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(`createVersion failed: ${error?.message}`)
    }
    return { id: data.id as string, sha }
  },
}