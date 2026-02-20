import { getServiceClient } from '@/lib/supabase/service'
import { canMarkFullTextReady, type PaperProcessingStatus } from './processing-status'

interface SetProcessingStatusOptions {
  pdfContent?: string | null
  contentSource?: string | null
  serviceClient?: ReturnType<typeof getServiceClient>
}

/**
 * Centralized status setter for paper processing state.
 * Enforces full_text_ready invariants at write time.
 */
export async function setPaperProcessingStatus(
  paperId: string,
  status: PaperProcessingStatus,
  options: SetProcessingStatusOptions = {}
): Promise<void> {
  const serviceClient = options.serviceClient || getServiceClient()

  if (status === 'full_text_ready') {
    let pdfContent = options.pdfContent
    let contentSource = options.contentSource

    if (pdfContent === undefined || contentSource === undefined) {
      const { data, error } = await serviceClient
        .from('papers')
        .select('pdf_content, content_source')
        .eq('id', paperId)
        .single()

      if (error) {
        throw new Error(`Failed to validate full_text_ready for ${paperId}: ${error.message}`)
      }

      if (pdfContent === undefined) {
        pdfContent = data?.pdf_content ?? null
      }
      if (contentSource === undefined) {
        contentSource = data?.content_source ?? null
      }
    }

    if (!canMarkFullTextReady(pdfContent, contentSource)) {
      throw new Error(
        `Invalid full_text_ready state for ${paperId}: missing/invalid pdf_content or content_source`
      )
    }
  }

  const { error } = await serviceClient
    .from('papers')
    .update({ processing_status: status })
    .eq('id', paperId)

  if (error) {
    throw new Error(`Failed to set processing_status=${status} for ${paperId}: ${error.message}`)
  }
}
