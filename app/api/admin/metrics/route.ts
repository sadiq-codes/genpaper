import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { isAdmin } from '@/lib/admin'
import { reconcileRunHealth } from '@/lib/generation/run-recovery'
import { classifyGenerationFailure } from '@/lib/generation/telemetry'

function getDurationMinutes(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const completedMs = new Date(completedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs) || completedMs < startedMs) return null
  return (completedMs - startedMs) / 1000 / 60
}

function getDurationSeconds(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const completedMs = new Date(completedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs) || completedMs < startedMs) return null
  return (completedMs - startedMs) / 1000
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function trimReason(reason: string) {
  return reason
    .replace(/\s+/g, ' ')
    .replace(/run id [a-f0-9-]+/gi, 'run id')
    .replace(/project id [a-f0-9-]+/gi, 'project id')
    .trim()
    .slice(0, 140)
}

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function GET() {
  try {
    const user = await requireAuth()
    const userIsAdmin = await isAdmin(user.id)
    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

  const svc = createServiceClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    const [
      { data: rawRuns },
      { data: events },
      { data: jobs },
    ] = await Promise.all([
      svc
        .from('generation_runs')
        .select(`
        id,
        project_id,
        user_id,
        status,
        progress,
        current_stage,
        current_section,
        error_message,
        started_at,
        completed_at,
        created_at,
        research_projects:project_id (
          id,
          topic
        )
      `)
      .gte('created_at', thirtyDaysAgo),
    svc
    .from('app_events')
      .select('event_type, created_at, user_id, metadata')
      .in('event_type', [
        'generation_started',
        'generation_completed',
        'generation_failed',
        'generation_stage_timing',
        'generation_job_claimed',
        'generation_retry_scheduled',
      ])
      .gte('created_at', thirtyDaysAgo),
    svc
      .from('generation_jobs')
      .select(`
        id,
        run_id,
        project_id,
        user_id,
        status,
        attempts,
        max_attempts,
        worker_id,
        lease_until,
        last_heartbeat_at,
        error_message,
        started_at,
        completed_at,
        created_at,
        updated_at,
        research_projects:project_id (
          id,
          topic
        )
      `)
        .gte('created_at', thirtyDaysAgo),
    ])

  const runsById = new Map((rawRuns || []).map((run) => [run.id, run]))
  const inconsistentRunIds = (jobs || [])
    .filter((job) => {
      const run = runsById.get(job.run_id)
      if (!run) return false
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return false
      }
      return (
        job.status === 'failed' ||
        job.status === 'cancelled' ||
        job.status === 'completed' ||
        job.attempts >= job.max_attempts
      )
    })
    .map((job) => job.run_id)

  const reconciledRuns = inconsistentRunIds.length > 0
    ? await Promise.all(inconsistentRunIds.map((runId) => reconcileRunHealth(runId)))
    : []

  const reconciledRunMap = new Map(
    reconciledRuns
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .map((run) => [run.id, run])
  )

  const runs = (rawRuns || []).map((run) => {
    const reconciled = reconciledRunMap.get(run.id)
    return reconciled
      ? {
          ...run,
          status: reconciled.status,
          progress: reconciled.progress,
          current_stage: reconciled.current_stage,
          current_section: reconciled.current_section,
          error_message: reconciled.error_message,
          started_at: reconciled.started_at,
          completed_at: reconciled.completed_at,
          created_at: reconciled.created_at,
        }
      : run
  })

  const generationStats = { total: 0, completed: 0, failed: 0, cancelled: 0, running: 0, pending: 0 }
  const stageCounts: Record<string, number> = {}
  const paperTypeCounts: Record<string, number> = {}
  const durations: number[] = []
  const projectRunCounts = new Map<string, { projectId: string; topic: string; count: number }>()
  const recentFailures: Array<{
    runId: string
    projectId: string | null
    projectTitle: string | null
    userId: string
    createdAt: string
    stage: string | null
    message: string
    category: string
    substep: string | null
  }> = []

  for (const run of runs || []) {
    generationStats.total += 1
    if (run.status === 'completed') generationStats.completed += 1
    else if (run.status === 'failed') generationStats.failed += 1
    else if (run.status === 'cancelled') generationStats.cancelled += 1
    else if (run.status === 'pending') generationStats.pending += 1
    else generationStats.running += 1

    if (run.current_stage) {
      stageCounts[run.current_stage] = (stageCounts[run.current_stage] || 0) + 1
    }

    const duration = getDurationMinutes(run.started_at || run.created_at, run.completed_at)
    if (duration !== null && run.status === 'completed') {
      durations.push(duration)
    }

    const project = Array.isArray(run.research_projects) ? run.research_projects[0] : run.research_projects
    const projectKey = run.project_id
    if (projectKey) {
      const existing = projectRunCounts.get(projectKey)
      if (existing) existing.count += 1
      else projectRunCounts.set(projectKey, {
        projectId: projectKey,
        topic: project?.topic || 'Untitled project',
        count: 1,
      })
    }

    if (run.status === 'failed') {
      const classified = classifyGenerationFailure(run.error_message || 'Generation failed', run.current_stage)
      const relatedFailureEvent = (events || []).find((event) =>
        event.event_type === 'generation_failed' &&
        event.metadata?.runId === run.id
      )
      recentFailures.push({
        runId: run.id,
        projectId: run.project_id,
        projectTitle: project?.topic || null,
        userId: run.user_id,
        createdAt: run.completed_at || run.created_at,
        stage: run.current_stage,
        message: run.error_message || 'Generation failed',
        category: classified.category,
        substep: typeof relatedFailureEvent?.metadata?.failureSubstep === 'string'
          ? relatedFailureEvent.metadata.failureSubstep
          : null,
      })
    }
  }

  const startsByDay: Record<string, number> = {}
  const completionsByDay: Record<string, number> = {}
  const failuresByDay: Record<string, number> = {}
  const failureReasons = new Map<string, number>()
  const failureCategories = new Map<string, number>()
  const stageTimingMap = new Map<string, number[]>()
  const queueLatencyValues: number[] = []
  let retryEvents = 0

  for (const event of events || []) {
    const day = event.created_at.slice(0, 10)
    if (event.event_type === 'generation_started') {
      startsByDay[day] = (startsByDay[day] || 0) + 1
      const paperType = typeof event.metadata?.paperType === 'string' ? event.metadata.paperType : null
      if (paperType) {
        paperTypeCounts[paperType] = (paperTypeCounts[paperType] || 0) + 1
      }
    } else if (event.event_type === 'generation_completed') {
      completionsByDay[day] = (completionsByDay[day] || 0) + 1
    } else if (event.event_type === 'generation_failed') {
      failuresByDay[day] = (failuresByDay[day] || 0) + 1
      const rawMessage = typeof event.metadata?.error === 'string' ? event.metadata.error : 'Unknown failure'
      const stage = typeof event.metadata?.failureStage === 'string' ? event.metadata.failureStage : null
      const classified = classifyGenerationFailure(rawMessage, stage)
      const message = typeof event.metadata?.failureReason === 'string'
        ? trimReason(event.metadata.failureReason)
        : trimReason(classified.reason)
      failureReasons.set(message, (failureReasons.get(message) || 0) + 1)
      const category = typeof event.metadata?.failureCategory === 'string'
        ? event.metadata.failureCategory
        : classified.category
      failureCategories.set(category, (failureCategories.get(category) || 0) + 1)
    } else if (event.event_type === 'generation_stage_timing') {
      const stage = typeof event.metadata?.stage === 'string' ? event.metadata.stage : null
      const durationMs = typeof event.metadata?.durationMs === 'number' ? event.metadata.durationMs : null
      if (stage && durationMs !== null && Number.isFinite(durationMs) && durationMs >= 0) {
        const values = stageTimingMap.get(stage) || []
        values.push(durationMs)
        stageTimingMap.set(stage, values)
      }
    } else if (event.event_type === 'generation_job_claimed') {
      const queueLatencyMs = typeof event.metadata?.queueLatencyMs === 'number'
        ? event.metadata.queueLatencyMs
        : null
      if (queueLatencyMs !== null && Number.isFinite(queueLatencyMs) && queueLatencyMs >= 0) {
        queueLatencyValues.push(queueLatencyMs / 1000)
      }
    } else if (event.event_type === 'generation_retry_scheduled') {
      retryEvents += 1
    }
  }

  if (queueLatencyValues.length === 0) {
    for (const job of jobs || []) {
      const queueLatencySeconds = getDurationSeconds(job.created_at, job.started_at)
      if (queueLatencySeconds !== null) {
        queueLatencyValues.push(queueLatencySeconds)
      }
    }
  }

  const totalRetriesFromJobs = (jobs || []).reduce((sum, job) => sum + Math.max(0, job.attempts - 1), 0)
  const retriedRuns = (jobs || []).filter((job) => job.attempts > 1).length
  const stageTimings = Array.from(stageTimingMap.entries())
    .map(([stage, values]) => {
      const avg = average(values)
      const p95 = percentile(values, 95)
      return {
        stage,
        count: values.length,
        averageSeconds: avg !== null ? avg / 1000 : null,
        p95Seconds: p95 !== null ? p95 / 1000 : null,
      }
    })
    .sort((a, b) => (b.averageSeconds || 0) - (a.averageSeconds || 0))
    .slice(0, 10)

  const activeRuns = (runs || [])
    .filter((run) => run.status === 'running' || run.status === 'pending')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)
    .map((run) => {
      const project = Array.isArray(run.research_projects) ? run.research_projects[0] : run.research_projects
      const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(run.created_at).getTime()) / 1000 / 60))
      return {
        runId: run.id,
        projectId: run.project_id,
        projectTitle: project?.topic || 'Untitled project',
        status: run.status,
        progress: run.progress,
        stage: run.current_stage,
        section: run.current_section,
        ageMinutes,
      }
    })

  const stuckJobs = (jobs || [])
    .filter((job) => {
      if (job.status !== 'running') return false
      const leaseExpired = !!job.lease_until && job.lease_until < tenMinutesAgo
      const heartbeatStale = !!job.last_heartbeat_at && job.last_heartbeat_at < tenMinutesAgo
      const startedTooLongAgo = !!job.started_at && job.started_at < twentyMinutesAgo
      return leaseExpired || heartbeatStale || startedTooLongAgo
    })
    .sort((a, b) => new Date(a.started_at || a.created_at).getTime() - new Date(b.started_at || b.created_at).getTime())
    .slice(0, 8)
    .map((job) => {
      const project = Array.isArray(job.research_projects) ? job.research_projects[0] : job.research_projects
      return {
        jobId: job.id,
        runId: job.run_id,
        projectId: job.project_id,
        projectTitle: project?.topic || 'Untitled project',
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        startedAt: job.started_at || job.created_at,
        leaseUntil: job.lease_until,
        lastHeartbeatAt: job.last_heartbeat_at,
        errorMessage: job.error_message,
      }
    })

  recentFailures.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json({
    generationStats,
      stageCounts,
      paperTypeCounts,
      startsByDay,
      completionsByDay,
      failuresByDay,
      latency: {
        medianMinutes: percentile(durations, 50),
        p95Minutes: percentile(durations, 95),
        sampleSize: durations.length,
      },
      failureReasons: Array.from(failureReasons.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([reason, count]) => ({ reason, count })),
      activeRuns,
      stuckJobs,
      recentFailures: recentFailures.slice(0, 12),
      stageTimings,
      queueLatency: {
        medianSeconds: percentile(queueLatencyValues, 50),
        p95Seconds: percentile(queueLatencyValues, 95),
        sampleSize: queueLatencyValues.length,
      },
      retryStats: {
        totalRetries: Math.max(retryEvents, totalRetriesFromJobs),
        retriedRuns,
        maxAttemptsObserved: Math.max(0, ...(jobs || []).map((job) => job.attempts)),
      },
      failureCategories: Array.from(failureCategories.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([category, count]) => ({ category, count })),
      topProjects: Array.from(projectRunCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    })
  } catch (error) {
    return handleError(error, 'Error in admin metrics API')
  }
}
