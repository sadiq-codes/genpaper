/**
 * Liveness probe for container health checks
 * 
 * This endpoint returns immediately to indicate the process is running.
 * Use this for Docker HEALTHCHECK and Azure Container Apps liveness probe.
 * 
 * For detailed health status including database connectivity,
 * use the parent /api/health endpoint (readiness probe).
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  })
}
