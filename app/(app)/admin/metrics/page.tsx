'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, RefreshCw, Users, Zap, CheckCircle2, AlertTriangle } from 'lucide-react'

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
      <div className="rounded-md bg-destructive/15 p-4 text-destructive">{error || 'No data'}</div>
    )
  }

  const { generationStats: gs } = metrics
  const failureRate = gs.total > 0 ? ((gs.failed / gs.total) * 100).toFixed(1) : '0'
  const successRate = gs.total > 0 ? ((gs.completed / gs.total) * 100).toFixed(1) : '0'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Metrics</h1>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={loading}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <OverviewCard icon={Users} label="Total Users" value={metrics.totalUsers} />
        <OverviewCard icon={Zap} label="Generations" value={gs.total} />
        <OverviewCard icon={CheckCircle2} label="Success Rate" value={`${successRate}%`} />
        <OverviewCard icon={AlertTriangle} label="Failure Rate" value={`${failureRate}%`} warn={Number(failureRate) > 20} />
      </div>

      {/* Generation bar */}
      {gs.total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Generation Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-3">
              <Legend color="bg-green-500" label={`Completed ${gs.completed}`} />
              <Legend color="bg-red-500" label={`Failed ${gs.failed}`} />
              <Legend color="bg-yellow-500" label={`Cancelled ${gs.cancelled}`} />
              {gs.running > 0 && <Legend color="bg-blue-500" label={`Running ${gs.running}`} />}
            </div>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
              {gs.completed > 0 && <div className="bg-green-500" style={{ width: `${(gs.completed / gs.total) * 100}%` }} />}
              {gs.failed > 0 && <div className="bg-red-500" style={{ width: `${(gs.failed / gs.total) * 100}%` }} />}
              {gs.cancelled > 0 && <div className="bg-yellow-500" style={{ width: `${(gs.cancelled / gs.total) * 100}%` }} />}
              {gs.running > 0 && <div className="bg-blue-500" style={{ width: `${(gs.running / gs.total) * 100}%` }} />}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Event counts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Events</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right w-20">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(metrics.eventCounts).length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No events yet</TableCell></TableRow>
                ) : (
                  Object.entries(metrics.eventCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <TableRow key={type}>
                        <TableCell className="font-medium">{type.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{count}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Email stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right w-20">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(metrics.emailCounts).length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No emails sent yet</TableCell></TableRow>
                ) : (
                  Object.entries(metrics.emailCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <TableRow key={type}>
                        <TableCell className="font-medium">{type.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{count}</TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Recent failures */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Failures</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Time</TableHead>
                  <TableHead className="w-[100px]">User</TableHead>
                  <TableHead className="w-[100px]">Project</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.recentFailures.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No failures recorded</TableCell></TableRow>
                ) : (
                  metrics.recentFailures.map((f, i) => {
                    const errorMsg = String(f.metadata?.error || 'Unknown error')
                    const projectId = f.metadata?.projectId ? String(f.metadata.projectId) : null
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(f.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{f.user_id.slice(0, 8)}...</TableCell>
                        <TableCell className="font-mono text-xs">
                          {projectId ? (
                            <a href={`/editor/${projectId}`} className="text-primary hover:underline">{projectId.slice(0, 8)}...</a>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-destructive cursor-default truncate block max-w-[300px]">{errorMsg}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm">
                              <p className="text-xs break-all">{errorMsg}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  )
}

function OverviewCard({ icon: Icon, label, value, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground/60" />
        </div>
        <p className={`text-2xl font-bold tracking-tight ${warn ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </div>
  )
}
