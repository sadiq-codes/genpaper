'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, Activity, ArrowUpRight, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldAlert, TrendingUp, Zap } from 'lucide-react'
import { SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'

type HealthTone = 'healthy' | 'warning' | 'critical' | 'neutral'

const SENTRY_THRESHOLDS = {
  failureRate: { warning: 10, critical: 20 },
  queueLatencySeconds: { warning: 60, critical: 180 },
  retryRate: { warning: 5, critical: 15 },
} as const

interface Metrics {
  generationStats: {
    total: number
    completed: number
    failed: number
    cancelled: number
    running: number
    pending: number
  }
  stageCounts: Record<string, number>
  paperTypeCounts: Record<string, number>
  startsByDay: Record<string, number>
  completionsByDay: Record<string, number>
  failuresByDay: Record<string, number>
  latency: {
    medianMinutes: number | null
    p95Minutes: number | null
    sampleSize: number
  }
  failureReasons: Array<{
    reason: string
    count: number
  }>
  failureCategories: Array<{
    category: string
    count: number
  }>
  stageTimings: Array<{
    stage: string
    count: number
    averageSeconds: number | null
    p95Seconds: number | null
  }>
  queueLatency: {
    medianSeconds: number | null
    p95Seconds: number | null
    sampleSize: number
  }
  retryStats: {
    totalRetries: number
    retriedRuns: number
    maxAttemptsObserved: number
  }
  activeRuns: Array<{
    runId: string
    projectId: string
    projectTitle: string
    status: string
    progress: number
    stage: string | null
    section: string | null
    ageMinutes: number
  }>
  stuckJobs: Array<{
    jobId: string
    runId: string
    projectId: string
    projectTitle: string
    attempts: number
    maxAttempts: number
    startedAt: string
    leaseUntil: string | null
    lastHeartbeatAt: string | null
    errorMessage: string | null
  }>
  recentFailures: Array<{
    runId: string
    projectId: string | null
    projectTitle: string | null
    userId: string
    createdAt: string
    stage: string | null
    message: string
    category: string
    substep: string | null
  }>
  topProjects: Array<{
    projectId: string
    topic: string
    count: number
  }>
}

export default function AdminMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchMetrics() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/metrics')
      if (!res.ok) throw new Error('Failed to load metrics')
      setMetrics(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMetrics() }, [])

  const derived = useMemo(() => {
    if (!metrics) return null

    const stats = metrics.generationStats
    const failureRate = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0
    const successRate = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0
    const retryRate = stats.total > 0 ? (metrics.retryStats.retriedRuns / stats.total) * 100 : 0
    const stageRows = Object.entries(metrics.stageCounts).sort(([, a], [, b]) => b - a)
    const typeRows = Object.entries(metrics.paperTypeCounts).sort(([, a], [, b]) => b - a)
    const days = Array.from(new Set([
      ...Object.keys(metrics.startsByDay),
      ...Object.keys(metrics.completionsByDay),
      ...Object.keys(metrics.failuresByDay),
    ])).sort()
    const trendDays = days.slice(-14).map((day) => ({
      day,
      started: metrics.startsByDay[day] || 0,
      completed: metrics.completionsByDay[day] || 0,
      failed: metrics.failuresByDay[day] || 0,
    }))
    const trendMax = Math.max(1, ...trendDays.map((day) => Math.max(day.started, day.completed, day.failed)))
    const topStage = stageRows[0]?.[0] || null
    const signalStates: Array<{
      label: string
      value: string
      detail: string
      tone: HealthTone
    }> = [
      {
        label: 'Failure Rate',
        value: `${failureRate.toFixed(1)}%`,
        detail: `${stats.failed} failed out of ${stats.total} runs`,
        tone:
          failureRate >= SENTRY_THRESHOLDS.failureRate.critical
            ? 'critical'
            : failureRate >= SENTRY_THRESHOLDS.failureRate.warning
              ? 'warning'
              : 'healthy',
      },
      {
        label: 'Queue Wait',
        value:
          metrics.queueLatency.medianSeconds !== null
            ? `${metrics.queueLatency.medianSeconds.toFixed(0)}s`
            : 'N/A',
        detail:
          metrics.queueLatency.sampleSize > 0
            ? `p95 ${metrics.queueLatency.p95Seconds?.toFixed(0) || 'N/A'}s across ${metrics.queueLatency.sampleSize} claims`
            : 'Waiting for queue samples',
        tone:
          metrics.queueLatency.medianSeconds === null
            ? 'neutral'
            : metrics.queueLatency.medianSeconds >= SENTRY_THRESHOLDS.queueLatencySeconds.critical
              ? 'critical'
              : metrics.queueLatency.medianSeconds >= SENTRY_THRESHOLDS.queueLatencySeconds.warning
                ? 'warning'
                : 'healthy',
      },
      {
        label: 'Retry Pressure',
        value: `${retryRate.toFixed(1)}%`,
        detail: `${metrics.retryStats.totalRetries} retries across ${metrics.retryStats.retriedRuns} runs`,
        tone:
          retryRate >= SENTRY_THRESHOLDS.retryRate.critical
            ? 'critical'
            : retryRate >= SENTRY_THRESHOLDS.retryRate.warning || metrics.retryStats.maxAttemptsObserved >= 3
              ? 'warning'
              : 'healthy',
      },
      {
        label: 'Stuck Work',
        value: `${metrics.stuckJobs.length}`,
        detail:
          metrics.stuckJobs.length > 0
            ? 'Stale leases or worker heartbeats need attention'
            : 'No stuck jobs detected',
        tone: metrics.stuckJobs.length > 0 ? 'critical' : 'healthy',
      },
    ]
    const overallTone: HealthTone = signalStates.some((signal) => signal.tone === 'critical')
      ? 'critical'
      : signalStates.some((signal) => signal.tone === 'warning')
        ? 'warning'
        : 'healthy'
    const topRisk = signalStates.find((signal) => signal.tone === 'critical' || signal.tone === 'warning') || null

    return {
      stats,
      failureRate,
      successRate,
      retryRate,
      stageRows,
      typeRows,
      trendDays,
      trendMax,
      topStage,
      signalStates,
      overallTone,
      topRisk,
    }
  }, [metrics])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Generation Sentry
          </Badge>
        <div>
            <h1 className="font-instrument text-3xl tracking-tight">Paper Generation Health</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Real-time visibility into generation throughput, latency, failures, and stuck work.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-2xl border border-border/50 bg-background/80 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Observation Window</p>
            <p className="text-sm font-medium">Rolling 30 days</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={loading} className="rounded-full">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
        </Button>
        </div>
      </div>

      {loading ? (
        <SectionLoadingState
          title="Loading metrics..."
          description="Fetching the latest admin analytics."
          className="min-h-[320px]"
        />
      ) : error || !metrics ? (
        <SectionErrorState
          title="Failed to load metrics"
          description={error || 'No metrics data is available right now.'}
          className="min-h-[320px]"
          action={(
            <Button variant="outline" size="sm" onClick={fetchMetrics}>
              Try again
            </Button>
          )}
        />
      ) : (
        derived && (
          <>
            <Card className="overflow-hidden border-border/60">
              <CardContent className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sentry Status</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-instrument text-3xl tracking-tight">
                      {derived.overallTone === 'critical' ? 'Critical' : derived.overallTone === 'warning' ? 'Watch closely' : 'Stable'}
                    </h2>
                    <HealthBadge tone={derived.overallTone}>
                      {derived.overallTone === 'critical' ? 'Immediate attention' : derived.overallTone === 'warning' ? 'Warning' : 'Healthy'}
                    </HealthBadge>
                  </div>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {derived.topRisk
                      ? `${derived.topRisk.label} is the primary risk right now. Open any active or failed run to inspect queue wait, retries, stage timing, and failure context.`
                      : 'Queue wait, retries, failures, and stuck work are all within healthy thresholds right now.'}
                  </p>
      </div>

                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                  {derived.signalStates.map((signal) => (
                    <HealthSignalCard
                      key={signal.label}
                      label={signal.label}
                      value={signal.value}
                      detail={signal.detail}
                      tone={signal.tone}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <MetricCard
                icon={Zap}
                label="Runs Started"
                value={derived.stats.total}
                detail={`${derived.stats.completed} completed, ${derived.stats.cancelled} cancelled`}
              />
              <MetricCard
                icon={Activity}
                label="Active Right Now"
                value={derived.stats.running + derived.stats.pending}
                detail={`${derived.stats.running} running, ${derived.stats.pending} queued`}
              />
              <MetricCard
                icon={Clock3}
                label="Median Runtime"
                value={metrics.latency.medianMinutes ? `${metrics.latency.medianMinutes.toFixed(1)}m` : 'N/A'}
                detail={metrics.latency.sampleSize > 0 ? `p95 ${metrics.latency.p95Minutes?.toFixed(1) || 'N/A'}m across ${metrics.latency.sampleSize} runs` : 'Waiting for completed run samples'}
              />
              <MetricCard
                icon={Loader2}
                label="Queue Latency"
                value={metrics.queueLatency.medianSeconds !== null ? `${metrics.queueLatency.medianSeconds.toFixed(0)}s` : 'N/A'}
                detail={metrics.queueLatency.sampleSize > 0 ? `p95 ${metrics.queueLatency.p95Seconds?.toFixed(0) || 'N/A'}s before worker claim` : 'Waiting for queue samples'}
                accent={
                  metrics.queueLatency.medianSeconds !== null && metrics.queueLatency.medianSeconds >= SENTRY_THRESHOLDS.queueLatencySeconds.critical
                    ? 'danger'
                    : metrics.queueLatency.medianSeconds !== null && metrics.queueLatency.medianSeconds >= SENTRY_THRESHOLDS.queueLatencySeconds.warning
                      ? 'warning'
                      : 'default'
                }
              />
              <MetricCard
                icon={RefreshCw}
                label="Retries Scheduled"
                value={metrics.retryStats.totalRetries}
                detail={`${metrics.retryStats.retriedRuns} runs retried, max observed attempt ${metrics.retryStats.maxAttemptsObserved || 0}`}
                accent={
                  derived.retryRate >= SENTRY_THRESHOLDS.retryRate.critical
                    ? 'danger'
                    : derived.retryRate >= SENTRY_THRESHOLDS.retryRate.warning || metrics.retryStats.maxAttemptsObserved >= 3
                      ? 'warning'
                      : 'success'
                }
              />
              <MetricCard
                icon={ShieldAlert}
                label="Failure Rate"
                value={`${derived.failureRate.toFixed(1)}%`}
                detail={`${metrics.stuckJobs.length} stuck job${metrics.stuckJobs.length === 1 ? '' : 's'} need attention`}
                accent={
                  derived.failureRate >= SENTRY_THRESHOLDS.failureRate.critical
                    ? 'danger'
                    : derived.failureRate >= SENTRY_THRESHOLDS.failureRate.warning
                      ? 'warning'
                      : 'success'
                }
              />
            </div>

            <Card className="overflow-hidden border-border/60">
              <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Throughput Trend</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <h2 className="font-instrument text-4xl tracking-tight">{derived.successRate.toFixed(1)}%</h2>
                      <p className="pb-1 text-sm text-muted-foreground">completion success across the last 30 days</p>
                    </div>
                  </div>

                  {derived.trendDays.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Legend color="bg-sky-500" label="Started" />
                        <Legend color="bg-emerald-500" label="Completed" />
                        <Legend color="bg-rose-500" label="Failed" />
                      </div>
                      <div className="grid grid-cols-7 gap-3 sm:grid-cols-14">
                        {derived.trendDays.map((day) => (
                          <div key={day.day} className="flex min-w-0 flex-col items-center gap-2">
                            <div className="flex h-32 w-full items-end justify-center gap-1 rounded-2xl border border-border/40 bg-muted/20 px-2 py-3">
                              <TrendBar color="bg-sky-500" value={day.started} max={derived.trendMax} />
                              <TrendBar color="bg-emerald-500" value={day.completed} max={derived.trendMax} />
                              <TrendBar color="bg-rose-500" value={day.failed} max={derived.trendMax} />
                            </div>
                            <div className="text-center">
                              <p className="text-[10px] font-medium text-foreground">{day.day.slice(5)}</p>
                              <p className="text-[10px] text-muted-foreground">{day.started}/{day.completed}/{day.failed}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No generation traffic has been recorded yet.</p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <InsightCard
                    icon={AlertTriangle}
                    label="Top Risk"
                    value={derived.topRisk ? derived.topRisk.label : 'Stable'}
                    detail={derived.topRisk ? derived.topRisk.detail : 'No sentry thresholds are currently in warning or critical range'}
                    tone={derived.topRisk?.tone || 'healthy'}
                  />
                  <InsightCard
                    icon={TrendingUp}
                    label="Dominant Stage"
                    value={derived.topStage ? derived.topStage.replace(/_/g, ' ') : 'N/A'}
                    detail={derived.topStage ? 'Most common active stage observed in recent runs' : 'No recent stage data'}
                  />
                  <InsightCard
                    icon={Clock3}
                    label="P95 Runtime"
                    value={metrics.latency.p95Minutes ? `${metrics.latency.p95Minutes.toFixed(1)}m` : 'N/A'}
                    detail={metrics.latency.sampleSize > 0 ? '95th percentile completion time' : 'Waiting for completed run samples'}
                  />
            </div>
          </CardContent>
        </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <MetricsTableCard
                title="Top Failure Reasons"
                description="Most frequent failure signatures captured from generation events."
                rows={metrics.failureReasons.map((entry) => [entry.reason, entry.count])}
                emptyLabel="No generation failures recorded yet"
              />
              <MetricsTableCard
                title="Paper Type Mix"
                description="What kinds of papers are being generated most often."
                rows={derived.typeRows}
                emptyLabel="No paper type telemetry recorded yet"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <MetricsTableCard
                title="Failure Categories"
                description="Structured buckets for generation failures."
                rows={metrics.failureCategories.map((entry) => [entry.category.replace(/_/g, ' '), entry.count])}
                emptyLabel="No structured failure categories recorded yet"
              />
              <MetricsTableCard
                title="Slowest Stages"
                description="Average and p95 timings for completed pipeline stages."
                rows={metrics.stageTimings.map((entry) => [
                  entry.stage,
                  entry.averageSeconds !== null
                    ? `${entry.averageSeconds.toFixed(1)}s avg / ${entry.p95Seconds?.toFixed(1) || 'N/A'}s p95`
                    : 'N/A',
                ])}
                emptyLabel="No stage timing telemetry recorded yet"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <RunStateCard
                title="Active Runs"
                description="Runs that are currently queued or in progress."
                emptyLabel="No active runs right now."
              >
                {metrics.activeRuns.map((run) => (
                  <RunRow
                    key={run.runId}
                    title={run.projectTitle}
                    status={run.status}
                    detail={`${run.progress}% · ${run.stage || 'stage unavailable'}${run.section ? ` · ${run.section}` : ''}`}
                    href={`/admin/metrics/${run.runId}`}
                    meta={`${run.ageMinutes} min old`}
                  />
                ))}
              </RunStateCard>

              <RunStateCard
                title="Stuck Jobs"
                description="Running jobs with stale heartbeats, expired leases, or unusually long duration."
                emptyLabel="No stuck jobs detected."
              >
                {metrics.stuckJobs.map((job) => (
                  <RunRow
                    key={job.jobId}
                    title={job.projectTitle}
                    status="stuck"
                    detail={job.errorMessage || `Attempt ${job.attempts} of ${job.maxAttempts}`}
                    href={`/admin/metrics/${job.runId}`}
                    meta={job.lastHeartbeatAt ? `Heartbeat ${new Date(job.lastHeartbeatAt).toLocaleTimeString()}` : 'No heartbeat'}
                  />
                ))}
              </RunStateCard>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <MetricsTableCard
                title="Top Projects"
                description="Projects generating the most paper runs in the reporting window."
                rows={metrics.topProjects.map((project) => [project.topic, project.count])}
                emptyLabel="No projects have started generation yet"
              />
              <MetricsTableCard
                title="Stage Activity"
                description="Most common pipeline stages observed across recent generation runs."
                rows={derived.stageRows}
                emptyLabel="No stage activity recorded yet"
              />
            </div>

            <Card className="border-border/60">
          <CardHeader className="pb-3">
                <CardTitle className="font-instrument text-lg tracking-tight">Recent Incidents</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Latest failed runs with project links, stage context, and error details.
                </p>
          </CardHeader>
              <CardContent className="space-y-3">
                {metrics.recentFailures.length === 0 ? (
                  <p className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                    No incidents recorded in the current reporting window.
                  </p>
                ) : (
                  metrics.recentFailures.map((failure) => (
                    <div key={failure.runId} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <Link href={`/admin/metrics/${failure.runId}`} className="font-medium hover:underline">
                            {failure.projectTitle || 'Unknown project'}
                          </Link>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {failure.stage ? `Failed during ${failure.stage.replace(/_/g, ' ')}` : 'Failed without stage context'}
                          </p>
                          {failure.substep ? (
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              {failure.substep.replace(/_/g, ' ')}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {failure.category.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(failure.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-destructive">{failure.message}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border/40 px-3 py-1 font-mono">run {failure.runId.slice(0, 8)}...</span>
                        <span className="rounded-full border border-border/40 px-3 py-1 font-mono">user {failure.userId.slice(0, 8)}...</span>
                        <Link
                          href={`/admin/metrics/${failure.runId}`}
                          className="inline-flex items-center gap-1 rounded-full border border-border/40 px-3 py-1 font-medium transition-colors hover:border-border hover:text-foreground"
                        >
                          Open run
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  detail: string
  accent?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const accentClasses = {
    default: 'border-border/60',
    success: 'border-emerald-500/20 bg-emerald-500/5',
    warning: 'border-amber-500/20 bg-amber-500/5',
    danger: 'border-rose-500/20 bg-rose-500/5',
  }

  return (
    <Card className={`overflow-hidden ${accentClasses[accent]}`}>
      <CardContent className="p-5">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
            <p className="mt-3 truncate font-instrument text-3xl tracking-tight">{value}</p>
          </div>
          <div className="shrink-0 rounded-2xl border border-border/50 bg-background/80 p-2.5">
            <Icon className="h-4 w-4 text-muted-foreground/70" />
          </div>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
  )
}

function InsightCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  detail: string
  tone?: HealthTone
}) {
  const toneClasses = {
    healthy: 'border-emerald-500/20 bg-emerald-500/5',
    warning: 'border-amber-500/20 bg-amber-500/5',
    critical: 'border-rose-500/20 bg-rose-500/5',
    neutral: 'border-border/50 bg-background/80',
  }

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone]}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground/70" />
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="font-instrument text-2xl tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function HealthBadge({ tone, children }: { tone: HealthTone; children: React.ReactNode }) {
  const toneClasses = {
    healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    critical: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    neutral: 'border-border/50 bg-background/80 text-muted-foreground',
  }

  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}

function HealthSignalCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone: HealthTone
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <HealthBadge tone={tone}>
          {tone === 'critical' ? 'Crit' : tone === 'warning' ? 'Warn' : tone === 'healthy' ? 'OK' : '—'}
        </HealthBadge>
      </div>
      <p className="wrap-break-word font-instrument text-2xl tracking-tight">{value}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

function TrendBar({ color, value, max }: { color: string; value: number; max: number }) {
  const height = value === 0 ? 6 : Math.max(10, (value / max) * 100)
  return <div className={`w-3 rounded-full ${color}`} style={{ height: `${height}%` }} title={`${value}`} />
}

function MetricsTableCard({
  title,
  description,
  rows,
  emptyLabel,
}: {
  title: string
  description: string
  rows: Array<[string, string | number]>
  emptyLabel: string
}) {
  return (
    <Card className="border-border/60">
          <CardHeader className="pb-3">
        <CardTitle className="font-instrument text-lg tracking-tight">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
              <TableHead className="w-40 text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(([type, count], index) => (
                <TableRow key={`${type}-${index}`}>
                        <TableCell className="font-medium">{type.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{count}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
  )
}

function RunStateCard({
  title,
  description,
  emptyLabel,
  children,
}: {
  title: string
  description: string
  emptyLabel: string
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="font-instrument text-lg tracking-tight">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.filter(Boolean).length > 0 ? items : (
          <p className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function RunRow({
  title,
  status,
  detail,
  href,
  meta,
}: {
  title: string
  status: string
  detail: string
  href: string
  meta: string
}) {
  const badgeVariant = status === 'stuck' ? 'destructive' : status === 'running' ? 'default' : 'secondary'

  return (
    <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={href} className="font-medium hover:underline">{title}</Link>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <Badge variant={badgeVariant} className="rounded-full capitalize">{status}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{meta}</p>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          Open run
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground">
      <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </div>
  )
}
