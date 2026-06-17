import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { isAdmin } from '@/lib/admin'
import { reconcileRunHealth } from '@/lib/generation/run-recovery'
import { classifyGenerationFailure } from '@/lib/generation/telemetry'

function getMinutesBetween(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const endedMs = new Date(endedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs) || endedMs < startedMs) return null
  return (endedMs - startedMs) / 1000 / 60
}

function getSecondsBetween(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null
  const startedMs = new Date(startedAt).getTime()
  const endedMs = new Date(endedAt).getTime()
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs) || endedMs < startedMs) return null
  return (endedMs - startedMs) / 1000
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const user = await requireAuth()
    const userIsAdmin = await isAdmin(user.id)
    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const svc = createServiceClient()
    const { data: run, error: runError } = await svc
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
      pipeline_state,
      research_projects:project_id (
        id,
        topic
      )
    `)
      .eq('id', runId)
      .maybeSingle()

    if (runError) {
      return NextResponse.json({ error: runError.message }, { status: 500 })
    }

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

  const [
    { data: job, error: jobError },
    { data: generationEvents, error: generationEventsError },
    { data: allTelemetryEvents, error: telemetryError },
  ] = await Promise.all([
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
        updated_at
      `)
      .eq('run_id', runId)
      .maybeSingle(),
    svc
      .from('generation_events')
      .select('id, event_type, payload, created_at')
      .eq('run_id', runId)
      .order('id', { ascending: true })
      .limit(120),
    svc
      .from('app_events')
      .select('event_type, created_at, metadata')
      .in('event_type', [
        'generation_started',
        'generation_completed',
        'generation_failed',
        'generation_stage_timing',
        'generation_job_claimed',
        'generation_retry_scheduled',
      ])
      .gte('created_at', run.created_at)
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  if (jobError || generationEventsError || telemetryError) {
    return NextResponse.json(
      { error: jobError?.message || generationEventsError?.message || telemetryError?.message || 'Failed to load run details' },
      { status: 500 }
    )
  }

  const shouldReconcile =
    run.status !== 'completed' &&
    run.status !== 'failed' &&
    run.status !== 'cancelled' &&
    !!job &&
    (
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'completed' ||
      job.attempts >= job.max_attempts
    )

  const reconciledRun = shouldReconcile
    ? await reconcileRunHealth(runId)
    : null

  const effectiveRun = reconciledRun
    ? {
        ...run,
        status: reconciledRun.status,
        progress: reconciledRun.progress,
        current_stage: reconciledRun.current_stage,
        current_section: reconciledRun.current_section,
        error_message: reconciledRun.error_message,
        started_at: reconciledRun.started_at,
        completed_at: reconciledRun.completed_at,
        created_at: reconciledRun.created_at,
      }
    : run

  const telemetryEvents = (allTelemetryEvents || []).filter((event) => {
    const metadata = asRecord(event.metadata)
    return metadata.runId === runId
  })

  const jobClaimEvent = telemetryEvents.find((event) => event.event_type === 'generation_job_claimed')
  const retryEvents = telemetryEvents
    .filter((event) => event.event_type === 'generation_retry_scheduled')
    .map((event) => {
      const metadata = asRecord(event.metadata)
      return {
        createdAt: event.created_at,
        attempt: typeof metadata.attempt === 'number' ? metadata.attempt : null,
        retryCount: typeof metadata.retryCount === 'number' ? metadata.retryCount : null,
        completedSections: typeof metadata.completedSections === 'number' ? metadata.completedSections : null,
        totalSections: typeof metadata.totalSections === 'number' ? metadata.totalSections : null,
        failureCategory:
          typeof metadata.failureCategory === 'string' ? metadata.failureCategory : null,
        failureReason: typeof metadata.failureReason === 'string' ? metadata.failureReason : null,
        failureStage: typeof metadata.failureStage === 'string' ? metadata.failureStage : null,
        failureSubstep: typeof metadata.failureSubstep === 'string' ? metadata.failureSubstep : null,
      }
    })
    .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const stageTimeline = telemetryEvents
    .filter((event) => event.event_type === 'generation_stage_timing')
    .map((event) => {
      const metadata = asRecord(event.metadata)
      return {
        createdAt: event.created_at,
        stage: typeof metadata.stage === 'string' ? metadata.stage : 'unknown',
        durationSeconds:
          typeof metadata.durationMs === 'number' ? metadata.durationMs / 1000 : null,
        success: typeof metadata.success === 'boolean' ? metadata.success : null,
      }
    })
    .toSorted((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const failureEvent = [...telemetryEvents]
    .reverse()
    .find((event) => event.event_type === 'generation_failed')
  const failureMetadata = asRecord(failureEvent?.metadata)
  const fallbackFailure = classifyGenerationFailure(
    effectiveRun.error_message || job?.error_message || 'Generation failed',
    effectiveRun.current_stage
  )

  const failure = effectiveRun.status === 'failed'
    ? {
        category:
          typeof failureMetadata.failureCategory === 'string'
            ? failureMetadata.failureCategory
            : fallbackFailure.category,
        reason:
          typeof failureMetadata.failureReason === 'string'
            ? failureMetadata.failureReason
            : fallbackFailure.reason,
        stage:
          typeof failureMetadata.failureStage === 'string'
            ? failureMetadata.failureStage
            : effectiveRun.current_stage,
        substep:
          typeof failureMetadata.failureSubstep === 'string'
            ? failureMetadata.failureSubstep
            : null,
      }
    : null

  const queueLatencySeconds =
    typeof asRecord(jobClaimEvent?.metadata).queueLatencyMs === 'number'
      ? (asRecord(jobClaimEvent?.metadata).queueLatencyMs as number) / 1000
      : getSecondsBetween(job?.created_at || null, job?.started_at || null)

  const pipelineState = asRecord(effectiveRun.pipeline_state)
  const contextSummaries = Array.isArray(pipelineState.contextSummaries)
    ? pipelineState.contextSummaries
    : []
  const completedSectionIndices = Array.isArray(pipelineState.completedSectionIndices)
    ? pipelineState.completedSectionIndices
    : []
  const paperIds = Array.isArray(pipelineState.paperIds) ? pipelineState.paperIds : []

  const activity = (generationEvents || [])
    .map((event) => {
      const payload = asRecord(event.payload)

      if (event.event_type === 'progress') {
        return {
          id: event.id,
          createdAt: event.created_at,
          type: 'progress',
          label: typeof payload.stage === 'string' ? payload.stage : 'progress',
          detail: typeof payload.message === 'string' ? payload.message : 'Progress updated',
        }
      }

      if (event.event_type === 'section_start') {
        return {
          id: event.id,
          createdAt: event.created_at,
          type: 'section_start',
          label: typeof payload.section === 'string' ? payload.section : 'section',
          detail: 'Section generation started',
        }
      }

      if (event.event_type === 'section_complete') {
        return {
          id: event.id,
          createdAt: event.created_at,
          type: 'section_complete',
          label: typeof payload.section === 'string' ? payload.section : 'section',
          detail: 'Section completed',
        }
      }

      if (event.event_type === 'complete') {
        return {
          id: event.id,
          createdAt: event.created_at,
          type: 'complete',
          label: 'completed',
          detail: 'Run finished successfully',
        }
      }

      if (event.event_type === 'cancelled') {
        return {
          id: event.id,
          createdAt: event.created_at,
          type: 'cancelled',
          label: 'cancelled',
          detail: 'Run was cancelled',
        }
      }

      return {
        id: event.id,
        createdAt: event.created_at,
        type: 'error',
        label: 'error',
        detail: typeof payload.message === 'string' ? payload.message : 'Run failed',
      }
    })
    .slice(-30)
    .reverse()

  const project = Array.isArray(effectiveRun.research_projects) ? effectiveRun.research_projects[0] : effectiveRun.research_projects
  const durationMinutes =
    effectiveRun.status === 'completed' || effectiveRun.status === 'failed' || effectiveRun.status === 'cancelled'
      ? getMinutesBetween(effectiveRun.started_at || effectiveRun.created_at, effectiveRun.completed_at)
      : getMinutesBetween(effectiveRun.started_at || effectiveRun.created_at, new Date().toISOString())

    return NextResponse.json({
      run: {
        id: effectiveRun.id,
        projectId: effectiveRun.project_id,
        projectTitle: project?.topic || 'Untitled project',
        userId: effectiveRun.user_id,
        status: effectiveRun.status,
        progress: effectiveRun.progress,
        stage: effectiveRun.current_stage,
        section: effectiveRun.current_section,
        errorMessage: effectiveRun.error_message,
        createdAt: effectiveRun.created_at,
        startedAt: effectiveRun.started_at,
        completedAt: effectiveRun.completed_at,
        ageMinutes: Math.max(0, Math.round((Date.now() - new Date(effectiveRun.created_at).getTime()) / 1000 / 60)),
        durationMinutes,
      },
      queue: {
        latencySeconds: queueLatencySeconds,
        source: jobClaimEvent ? 'claim-event' : job?.started_at ? 'job-started-at' : 'unknown',
      },
      job: job
        ? {
            id: job.id,
            status: job.status,
            attempts: job.attempts,
            maxAttempts: job.max_attempts,
            workerId: job.worker_id,
            leaseUntil: job.lease_until,
            lastHeartbeatAt: job.last_heartbeat_at,
            createdAt: job.created_at,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            updatedAt: job.updated_at,
            errorMessage: job.error_message,
          }
        : null,
      pipeline: {
        totalSections: contextSummaries.length,
        completedSections: completedSectionIndices.length,
        discoveredPapers: paperIds.length,
      },
      failure,
      retryHistory: retryEvents,
      stageTimeline,
      activity,
    })
  } catch (error) {
    return handleError(error, 'Error in admin metrics run API')
  }
}
