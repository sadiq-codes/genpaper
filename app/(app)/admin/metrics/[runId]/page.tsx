'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'
import { ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Zap } from 'lucide-react'

interface RunDetails {
  run: {
    id: string
    projectId: string
    projectTitle: string
    userId: string
    status: string
    progress: number
    stage: string | null
    section: string | null
    errorMessage: string | null
    createdAt: string
    startedAt: string | null
    completedAt: string | null
    ageMinutes: number
    durationMinutes: number | null
  }
  queue: {
    latencySeconds: number | null
    source: string
  }
  job: {
    id: string
    status: string
    attempts: number
    maxAttempts: number
    workerId: string | null
    leaseUntil: string | null
    lastHeartbeatAt: string | null
    createdAt: string
    startedAt: string | null
    completedAt: string | null
    updatedAt: string
    errorMessage: string | null
  } | null
  pipeline: {
    totalSections: number
    completedSections: number
    discoveredPapers: number
  }
  failure: {
    category: string
    reason: string
    stage: string | null
    substep: string | null
  } | null
  retryHistory: Array<{
    createdAt: string
    attempt: number | null
    retryCount: number | null
    completedSections: number | null
    totalSections: number | null
    failureCategory: string | null
    failureReason: string | null
    failureStage: string | null
    failureSubstep: string | null
  }>
  stageTimeline: Array<{
    createdAt: string
    stage: string
    durationSeconds: number | null
    success: boolean | null
  }>
  activity: Array<{
    id: number
    createdAt: string
    type: string
    label: string
    detail: string
  }>
}

export default function AdminRunDrilldownPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = use(params)
  const [details, setDetails] = useState<RunDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRun = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/metrics/${runId}`)
      if (!res.ok) throw new Error(res.status === 404 ? 'Run not found' : 'Failed to load run details')
      setDetails(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run details')
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => {
    fetchRun()
  }, [fetchRun])

  const derived = useMemo(() => {
    if (!details) return null

    const retryCount = details.job ? Math.max(0, details.job.attempts - 1) : details.retryHistory.length
    const statusTone: 'default' | 'success' | 'warning' | 'danger' =
      details.run.status === 'failed'
        ? 'danger'
        : details.run.status === 'cancelled'
          ? 'warning'
          : details.run.status === 'completed'
            ? 'success'
            : 'default'

    return {
      retryCount,
      statusTone,
      outcomeLabel:
        details.run.status === 'failed'
          ? 'Failed'
          : details.run.status === 'completed'
            ? 'Completed'
            : details.run.status === 'cancelled'
              ? 'Cancelled'
              : 'Active',
    }
  }, [details])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Link href="/admin/metrics" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to sentry
          </Link>
          <div className="space-y-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Run Drilldown
            </Badge>
            <div>
              <h1 className="font-instrument text-3xl tracking-tight">
                {details?.run.projectTitle || 'Generation run'}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Stage timeline, retries, queue wait, and failure context for run <span className="font-mono">{runId.slice(0, 8)}...</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {details?.run.projectId ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href={`/editor/${details.run.projectId}`}>
                Open project
                <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={fetchRun} disabled={loading} className="rounded-full">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <SectionLoadingState
          title="Loading run details..."
          description="Pulling timeline, retry, and queue telemetry for this run."
          className="min-h-[320px]"
        />
      ) : error || !details || !derived ? (
        <SectionErrorState
          title="Failed to load run details"
          description={error || 'No run details are available right now.'}
          className="min-h-[320px]"
          action={(
            <Button variant="outline" size="sm" onClick={fetchRun}>
              Try again
            </Button>
          )}
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DetailMetricCard
              icon={Zap}
              label="Run Status"
              value={`${derived.outcomeLabel} · ${details.run.progress}%`}
              detail={`${details.run.stage || 'stage unavailable'}${details.run.section ? ` · ${details.run.section}` : ''}`}
              tone={derived.statusTone}
            />
            <DetailMetricCard
              icon={Clock3}
              label="Queue Wait"
              value={details.queue.latencySeconds !== null ? `${details.queue.latencySeconds.toFixed(0)}s` : 'N/A'}
              detail={`Source: ${details.queue.source.replace(/-/g, ' ')}`}
              tone={
                details.queue.latencySeconds !== null && details.queue.latencySeconds >= 180
                  ? 'danger'
                  : details.queue.latencySeconds !== null && details.queue.latencySeconds >= 60
                    ? 'warning'
                    : 'default'
              }
            />
            <DetailMetricCard
              icon={RefreshCw}
              label="Retries"
              value={`${derived.retryCount}`}
              detail={details.job ? `Attempt ${details.job.attempts} of ${details.job.maxAttempts}` : 'No job row available'}
              tone={derived.retryCount > 0 ? 'warning' : 'success'}
            />
            <DetailMetricCard
              icon={ShieldAlert}
              label="Failure Category"
              value={details.failure ? details.failure.category.replace(/_/g, ' ') : 'None'}
              detail={details.failure ? details.failure.reason : 'No failure recorded for this run'}
              tone={details.failure ? 'danger' : 'success'}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="font-instrument text-lg tracking-tight">Stage Timeline</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Ordered stage timings captured for this specific run.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {details.stageTimeline.length === 0 ? (
                  <EmptyCardMessage message="No stage timing telemetry has been recorded for this run yet." />
                ) : (
                  details.stageTimeline.map((entry, index) => (
                    <div key={`${entry.stage}-${entry.createdAt}-${index}`} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">{entry.stage.replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {entry.durationSeconds !== null ? `${entry.durationSeconds.toFixed(1)}s` : 'Duration unavailable'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge
                            tone={entry.success === false ? 'danger' : entry.success === true ? 'success' : 'default'}
                            label={entry.success === false ? 'failed' : entry.success === true ? 'ok' : 'unknown'}
                          />
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="font-instrument text-lg tracking-tight">Run Snapshot</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Current state of the run, job, and in-memory pipeline progress.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SnapshotRow label="Status" value={details.run.status} />
                  <SnapshotRow label="Age" value={`${details.run.ageMinutes} min`} />
                  <SnapshotRow
                    label="Duration"
                    value={details.run.durationMinutes !== null ? `${details.run.durationMinutes.toFixed(1)} min` : 'N/A'}
                  />
                  <SnapshotRow
                    label="Sections"
                    value={`${details.pipeline.completedSections}/${details.pipeline.totalSections || 0}`}
                  />
                  <SnapshotRow
                    label="Papers"
                    value={`${details.pipeline.discoveredPapers}`}
                  />
                  <SnapshotRow
                    label="Last heartbeat"
                    value={details.job?.lastHeartbeatAt ? new Date(details.job.lastHeartbeatAt).toLocaleString() : 'N/A'}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="font-instrument text-lg tracking-tight">Failure Context</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Structured failure metadata for this run.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {details.failure ? (
                    <>
                      <StatusBadge tone="danger" label={details.failure.category.replace(/_/g, ' ')} />
                      {details.failure.substep ? (
                        <StatusBadge tone="warning" label={details.failure.substep.replace(/_/g, ' ')} />
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {details.failure.stage ? `Stage: ${details.failure.stage.replace(/_/g, ' ')}` : 'No stage attached'}
                      </p>
                      <p className="text-sm text-destructive">{details.failure.reason}</p>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                      No structured failure recorded for this run.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="font-instrument text-lg tracking-tight">Retry History</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Each time the worker re-queued this run after a recoverable error.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {details.retryHistory.length === 0 ? (
                  <EmptyCardMessage message="This run has not been re-queued." />
                ) : (
                  details.retryHistory.map((retry, index) => (
                    <div key={`${retry.createdAt}-${index}`} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <p className="font-medium">
                            Retry {retry.retryCount ?? index + 1}
                            {retry.attempt ? ` · attempt ${retry.attempt}` : ''}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {retry.completedSections !== null && retry.totalSections !== null
                              ? `${retry.completedSections}/${retry.totalSections} sections preserved`
                              : 'Section resume data unavailable'}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(retry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {retry.failureCategory ? (
                          <StatusBadge tone="warning" label={retry.failureCategory.replace(/_/g, ' ')} />
                        ) : null}
                        {retry.failureSubstep ? (
                          <StatusBadge tone="danger" label={retry.failureSubstep.replace(/_/g, ' ')} />
                        ) : null}
                        {retry.failureStage ? (
                          <StatusBadge tone="default" label={retry.failureStage.replace(/_/g, ' ')} />
                        ) : null}
                      </div>
                      {retry.failureReason ? (
                        <p className="mt-3 text-sm text-muted-foreground">{retry.failureReason}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="font-instrument text-lg tracking-tight">Run Activity</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Recent generation events emitted by the pipeline for this run.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {details.activity.length === 0 ? (
                  <EmptyCardMessage message="No generation events are available for this run." />
                ) : (
                  details.activity.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">{event.label.replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function DetailMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClasses = {
    default: 'border-border/60',
    success: 'border-emerald-500/20 bg-emerald-500/5',
    warning: 'border-amber-500/20 bg-amber-500/5',
    danger: 'border-rose-500/20 bg-rose-500/5',
  }

  return (
    <Card className={toneClasses[tone]}>
      <CardContent className="p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
            <p className="mt-3 font-instrument text-2xl tracking-tight">{value}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/80 p-2.5">
            <Icon className="h-4 w-4 text-muted-foreground/70" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  tone,
  label,
}: {
  tone: 'default' | 'success' | 'warning' | 'danger'
  label: string
}) {
  const toneClasses = {
    default: 'border-border/50 bg-background/80 text-muted-foreground',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    danger: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium capitalize ${toneClasses[tone]}`}>
      {tone === 'success' ? <CheckCircle2 className="mr-1.5 h-3 w-3" /> : null}
      {label}
    </span>
  )
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-background/70 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function EmptyCardMessage({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}
