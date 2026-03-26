'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw } from 'lucide-react'

interface Metrics {
  totalUsers: number
  eventCounts: Record<string, number>
  dailyEvents: Record<string, number>
  generationStats: {
    total: number
    completed: number
    failed: number
    cancelled: number
    running: number
  }
  recentFailures: Array<{
    user_id: string
    metadata: Record<string, unknown>
    created_at: string
  }>
  emailCounts: Record<string, number>
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !metrics) {
    return (
      <div className="container py-10">
        <div className="rounded-md bg-destructive/15 p-4 text-destructive">{error || 'No data'}</div>
      </div>
    )
  }

  const failureRate = metrics.generationStats.total > 0
    ? ((metrics.generationStats.failed / metrics.generationStats.total) * 100).toFixed(1)
    : '0'

  return (
    <div className="container max-w-4xl py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Metrics Dashboard</h1>
          <p className="text-muted-foreground">Last 30 days</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMetrics}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={metrics.totalUsers} />
        <StatCard label="Generations" value={metrics.generationStats.total} />
        <StatCard label="Completed" value={metrics.generationStats.completed} />
        <StatCard label="Failure Rate" value={`${failureRate}%`} alert={Number(failureRate) > 20} />
      </div>

      {/* Event Counts */}
      <Card>
        <CardHeader>
          <CardTitle>Event Counts (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(metrics.eventCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div key={type} className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm font-medium">{type.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-sm text-muted-foreground">{count}</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Email Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Emails Sent (30d)</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(metrics.emailCounts).length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails sent yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(metrics.emailCounts).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm font-medium">{type.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-sm text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generation Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Generation Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniStat label="Completed" value={metrics.generationStats.completed} color="text-green-600 dark:text-green-400" />
            <MiniStat label="Failed" value={metrics.generationStats.failed} color="text-red-600 dark:text-red-400" />
            <MiniStat label="Cancelled" value={metrics.generationStats.cancelled} color="text-yellow-600 dark:text-yellow-400" />
            <MiniStat label="Running" value={metrics.generationStats.running} color="text-blue-600 dark:text-blue-400" />
          </div>
        </CardContent>
      </Card>

      {/* Recent Failures */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Generation Failures</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures recorded.</p>
          ) : (
            <div className="space-y-3">
              {metrics.recentFailures.map((f, i) => (
                <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{f.user_id.slice(0, 8)}...</span>
                    <span className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-destructive">{(f.metadata?.error as string) || 'Unknown error'}</p>
                  {f.metadata?.projectId ? (
                    <p className="text-xs text-muted-foreground">Project: {String(f.metadata.projectId)}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${alert ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center p-3 rounded-md border">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
