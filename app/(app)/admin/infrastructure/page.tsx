'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Activity, 
  Container, 
  Cpu, 
  Database, 
  HardDrive, 
  MemoryStick, 
  RefreshCw, 
  Server,
  CheckCircle2,
  XCircle,
  Search
} from 'lucide-react'
import { SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'
import { Progress } from '@/components/ui/progress'

interface SystemStats {
  vm: {
    ip: string
    cpu: {
      usagePercent: number
      cores: number
    }
    memory: {
      usedGb: number
      totalGb: number
      usagePercent: number
    }
    disk: {
      usedGb: number
      totalGb: number
      usagePercent: number
    }
  }
  database: {
    sizeBytes: number
    sizePretty: string
    activeConnections: number
    totalUsers: number
    totalPapers: number
    totalProjects: number
  }
  qdrant: {
    status: 'healthy' | 'unhealthy' | 'unknown'
    collections: Array<{
      name: string
      vectorCount: number
      status: string
    }>
  }
  containers: Array<{
    name: string
    status: string
    cpuPercent: string
    memoryUsage: string
  }>
  timestamp: string
}

function getHealthTone(percent: number): 'healthy' | 'warning' | 'critical' {
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  return 'healthy'
}

function HealthBadge({ tone, children }: { tone: 'healthy' | 'warning' | 'critical' | 'neutral'; children: React.ReactNode }) {
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

function ResourceCard({
  icon: Icon,
  label,
  used,
  total,
  unit,
  percent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  used: number
  total: number
  unit: string
  percent: number
}) {
  const tone = getHealthTone(percent)
  const toneClasses = {
    healthy: 'border-border/60',
    warning: 'border-amber-500/20 bg-amber-500/5',
    critical: 'border-rose-500/20 bg-rose-500/5',
  }

  return (
    <Card className={`overflow-hidden ${toneClasses[tone]}`}>
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
            <p className="mt-2 truncate font-instrument text-2xl tracking-tight">
              {used.toFixed(1)} <span className="text-base text-muted-foreground">/ {total.toFixed(1)} {unit}</span>
            </p>
          </div>
          <div className="shrink-0 rounded-2xl border border-border/50 bg-background/80 p-2.5">
            <Icon className="h-4 w-4 text-muted-foreground/70" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Usage</span>
            <span className={tone === 'critical' ? 'text-rose-500' : tone === 'warning' ? 'text-amber-500' : ''}>
              {percent.toFixed(1)}%
            </span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>
      </CardContent>
    </Card>
  )
}

function ContainerRow({ container }: { container: SystemStats['containers'][0] }) {
  const isRunning = container.status === 'running'
  
  // Parse memory usage like "605.7MiB / 15.57GiB"
  const memParts = container.memoryUsage.split(' / ')
  const memUsed = memParts[0] || 'N/A'
  
  // Clean up container name (remove prefixes)
  const displayName = container.name
    .replace('supabase-', '')
    .replace('realtime-dev.', '')

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/50 px-4 py-3">
      <div className="flex items-center gap-3">
        {isRunning ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-rose-500" />
        )}
        <span className="font-medium capitalize">{displayName}</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="font-mono">{container.cpuPercent}</span>
        <span className="font-mono">{memUsed}</span>
      </div>
    </div>
  )
}

export default function AdminInfrastructurePage() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchStats() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/system')
      if (!res.ok) throw new Error('Failed to load system stats')
      setStats(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const totalVectors = stats?.qdrant.collections.reduce((sum, c) => sum + c.vectorCount, 0) || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Infrastructure
          </Badge>
          <div>
            <h1 className="font-instrument text-3xl tracking-tight">System Health</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Real-time monitoring of Supabase VM, database, Qdrant vectors, and container status.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <div className="rounded-2xl border border-border/50 bg-background/80 px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">VM IP</p>
              <p className="font-mono text-sm">{stats.vm.ip}</p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading} className="rounded-full">
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading && !stats ? (
        <SectionLoadingState
          title="Loading system stats..."
          description="Fetching VM metrics, database info, and container status."
          className="min-h-[320px]"
        />
      ) : error ? (
        <SectionErrorState
          title="Failed to load system stats"
          description={error}
          className="min-h-[320px]"
          action={
            <Button variant="outline" size="sm" onClick={fetchStats}>
              Try again
            </Button>
          }
        />
      ) : stats && (
        <>
          {/* Overall Status */}
          <Card className="overflow-hidden border-border/60">
            <CardContent className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">System Status</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-instrument text-3xl tracking-tight">
                    {stats.qdrant.status === 'healthy' && stats.vm.cpu.usagePercent < 90 ? 'Operational' : 'Degraded'}
                  </h2>
                  <HealthBadge tone={stats.qdrant.status === 'healthy' ? 'healthy' : 'critical'}>
                    {stats.qdrant.status === 'healthy' ? 'All systems go' : 'Issues detected'}
                  </HealthBadge>
                </div>
                <p className="max-w-xl text-sm text-muted-foreground">
                  Supabase VM running {stats.containers.length} containers. Qdrant vector database {stats.qdrant.status === 'healthy' ? 'healthy' : 'needs attention'} with {totalVectors.toLocaleString()} vectors.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground/70" />
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Users</p>
                  </div>
                  <p className="font-instrument text-2xl tracking-tight">{stats.database.totalUsers.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground/70" />
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Papers</p>
                  </div>
                  <p className="font-instrument text-2xl tracking-tight">{stats.database.totalPapers.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground/70" />
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Projects</p>
                  </div>
                  <p className="font-instrument text-2xl tracking-tight">{stats.database.totalProjects.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground/70" />
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Vectors</p>
                  </div>
                  <p className="font-instrument text-2xl tracking-tight">{totalVectors.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* VM Resources */}
          <div className="grid gap-4 md:grid-cols-3">
            <ResourceCard
              icon={Cpu}
              label="CPU Usage"
              used={stats.vm.cpu.usagePercent}
              total={100}
              unit="%"
              percent={stats.vm.cpu.usagePercent}
            />
            <ResourceCard
              icon={MemoryStick}
              label="Memory"
              used={stats.vm.memory.usedGb}
              total={stats.vm.memory.totalGb}
              unit="GB"
              percent={stats.vm.memory.usagePercent}
            />
            <ResourceCard
              icon={HardDrive}
              label="Disk"
              used={stats.vm.disk.usedGb}
              total={stats.vm.disk.totalGb}
              unit="GB"
              percent={stats.vm.disk.usagePercent}
            />
          </div>

          {/* Qdrant Collections */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-instrument text-lg tracking-tight">Qdrant Vector Database</CardTitle>
                  <p className="text-sm text-muted-foreground">Vector collections for semantic paper search</p>
                </div>
                <HealthBadge tone={stats.qdrant.status === 'healthy' ? 'healthy' : 'critical'}>
                  {stats.qdrant.status}
                </HealthBadge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.qdrant.collections.length === 0 ? (
                <p className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  No collections found
                </p>
              ) : (
                stats.qdrant.collections.map((col) => (
                  <div key={col.name} className="flex items-center justify-between rounded-xl border border-border/40 bg-background/50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${col.status === 'green' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <span className="font-medium">{col.name}</span>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground">{col.vectorCount.toLocaleString()} vectors</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Containers */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="font-instrument text-lg tracking-tight">Docker Containers</CardTitle>
              <p className="text-sm text-muted-foreground">
                {stats.containers.filter(c => c.status === 'running').length} of {stats.containers.length} containers running
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.containers.length === 0 ? (
                <p className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  No containers found
                </p>
              ) : (
                stats.containers.map((container) => (
                  <ContainerRow key={container.name} container={container} />
                ))
              )}
            </CardContent>
          </Card>

          {/* Last Updated */}
          <p className="text-center text-xs text-muted-foreground">
            Last updated: {new Date(stats.timestamp).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}
