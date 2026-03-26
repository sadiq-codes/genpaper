import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch event counts by type (last 30 days)
  const { data: events } = await svc
    .from('app_events')
    .select('event_type, created_at')
    .gte('created_at', thirtyDaysAgo)

  const eventCounts: Record<string, number> = {}
  const dailyEvents: Record<string, number> = {}
  for (const e of events || []) {
    eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1
    const day = e.created_at.slice(0, 10)
    dailyEvents[day] = (dailyEvents[day] || 0) + 1
  }

  // Total users
  const { count: totalUsers } = await svc
    .from('profiles')
    .select('id', { count: 'exact', head: true })

  // Generation stats from generation_runs
  const { data: runs } = await svc
    .from('generation_runs')
    .select('status, created_at')
    .gte('created_at', thirtyDaysAgo)

  const generationStats = { total: 0, completed: 0, failed: 0, cancelled: 0, running: 0 }
  for (const r of runs || []) {
    generationStats.total++
    if (r.status === 'completed') generationStats.completed++
    else if (r.status === 'failed') generationStats.failed++
    else if (r.status === 'cancelled') generationStats.cancelled++
    else generationStats.running++
  }

  // Recent failures with details
  const { data: recentFailures } = await svc
    .from('app_events')
    .select('user_id, metadata, created_at')
    .eq('event_type', 'generation_failed')
    .order('created_at', { ascending: false })
    .limit(20)

  // Email stats
  const { data: emailStats } = await svc
    .from('email_log')
    .select('email_type, sent_at')
    .gte('sent_at', thirtyDaysAgo)

  const emailCounts: Record<string, number> = {}
  for (const e of emailStats || []) {
    emailCounts[e.email_type] = (emailCounts[e.email_type] || 0) + 1
  }

  return NextResponse.json({
    totalUsers: totalUsers || 0,
    eventCounts,
    dailyEvents,
    generationStats,
    recentFailures: recentFailures || [],
    emailCounts,
  })
}
