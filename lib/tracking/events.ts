import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

export type AppEventType =
  | 'signup'
  | 'project_created'
  | 'generation_started'
  | 'generation_completed'
  | 'generation_failed'
  | 'generation_stage_timing'
  | 'generation_job_claimed'
  | 'generation_retry_scheduled'
  | 'chat_message'
  | 'export'
  | 'library_upload'

export async function trackEvent(
  userId: string,
  eventType: AppEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('app_events').insert({
      user_id: userId,
      event_type: eventType,
      metadata: metadata ?? {},
    })
  } catch (e) {
    console.error(`[tracking] Failed to record ${eventType}:`, e)
  }
}
