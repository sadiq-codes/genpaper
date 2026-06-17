import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/helpers'
import { isAdmin } from '@/lib/admin'

// VM configuration - in production, these could come from env vars
const SUPABASE_VM_IP = process.env.SUPABASE_VM_IP || '52.152.144.167'
const QDRANT_URL = process.env.QDRANT_URL || 'http://52.152.144.167:6333'

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

async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } finally {
    clearTimeout(id)
  }
}

export async function GET() {
  try {
    const user = await requireAuth()
    const userIsAdmin = await isAdmin(user.id)
    if (!userIsAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all stats in parallel
    const [vmStats, dbStats, qdrantStats] = await Promise.all([
      fetchVmStats(),
      fetchDatabaseStats(),
      fetchQdrantStats(),
    ])

    const stats: SystemStats = {
      vm: vmStats,
      database: dbStats,
      qdrant: qdrantStats,
      containers: vmStats.containers || [],
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('[Admin System API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch system stats' },
      { status: 500 }
    )
  }
}

async function fetchVmStats(): Promise<SystemStats['vm'] & { containers: SystemStats['containers'] }> {
  try {
    // Fetch from stats endpoint on the VM
    const response = await fetchWithTimeout(`http://${SUPABASE_VM_IP}:9090/stats`, 5000)
    if (response.ok) {
      return await response.json()
    }
  } catch (error) {
    console.error('[fetchVmStats] Error:', error)
  }

  // Return placeholder data if stats endpoint is unavailable
  return {
    ip: SUPABASE_VM_IP,
    cpu: {
      usagePercent: 0,
      cores: 4,
    },
    memory: {
      usedGb: 0,
      totalGb: 16,
      usagePercent: 0,
    },
    disk: {
      usedGb: 0,
      totalGb: 128,
      usagePercent: 0,
    },
    containers: [],
  }
}

async function fetchDatabaseStats(): Promise<SystemStats['database']> {
  try {
    // Import createServiceClient dynamically to avoid issues
    const { createServiceClient } = await import('@/lib/supabase/service')
    const supabase = createServiceClient()

    // Fetch counts in parallel
    const [usersResult, papersResult, projectsResult] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('papers').select('id', { count: 'exact', head: true }),
      supabase.from('research_projects').select('id', { count: 'exact', head: true }),
    ])

    return {
      sizeBytes: 0, // Would need direct DB query
      sizePretty: 'N/A',
      activeConnections: 0,
      totalUsers: usersResult.count || 0,
      totalPapers: papersResult.count || 0,
      totalProjects: projectsResult.count || 0,
    }
  } catch (error) {
    console.error('[fetchDatabaseStats] Error:', error)
    return {
      sizeBytes: 0,
      sizePretty: 'N/A',
      activeConnections: 0,
      totalUsers: 0,
      totalPapers: 0,
      totalProjects: 0,
    }
  }
}

async function fetchQdrantStats(): Promise<SystemStats['qdrant']> {
  try {
    const response = await fetchWithTimeout(`${QDRANT_URL}/collections`, 5000)
    if (!response.ok) {
      return { status: 'unhealthy', collections: [] }
    }

    const data = await response.json()
    const collections: SystemStats['qdrant']['collections'] = []

    // Fetch details for each collection
    for (const col of data.result?.collections || []) {
      try {
        const colResponse = await fetchWithTimeout(`${QDRANT_URL}/collections/${col.name}`, 3000)
        if (colResponse.ok) {
          const colData = await colResponse.json()
          collections.push({
            name: col.name,
            vectorCount: colData.result?.points_count || 0,
            status: colData.result?.status || 'unknown',
          })
        }
      } catch {
        collections.push({
          name: col.name,
          vectorCount: 0,
          status: 'unknown',
        })
      }
    }

    return {
      status: 'healthy',
      collections,
    }
  } catch (error) {
    console.error('[fetchQdrantStats] Error:', error)
    return { status: 'unhealthy', collections: [] }
  }
}
