"use client"

import { useEffect, useState } from 'react'

type Health = {
  ok: boolean
  supabase: { anon_query_ok: boolean; service_query_ok: boolean }
  timing_ms: number
  env?: Record<string, unknown>
}

export default function HealthPage() {
  const [data, setData] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      })
      .then((json) => mounted && setData(json))
      .catch((e) => mounted && setError(String(e)))
    return () => {
      mounted = false
    }
  }, [])

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>App Health</h1>
      {error && (
        <p style={{ color: 'crimson' }}>
          Failed to load health: {error}
        </p>
      )}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <div style={{ marginTop: 16 }}>
          <div>
            <strong>Supabase (anon)</strong>:{' '}
            <span style={{ color: data.supabase.anon_query_ok ? 'green' : 'crimson' }}>
              {data.supabase.anon_query_ok ? 'OK' : 'Fail'}
            </span>
          </div>
          <div>
            <strong>Supabase (service)</strong>:{' '}
            <span style={{ color: data.supabase.service_query_ok ? 'green' : 'orange' }}>
              {data.supabase.service_query_ok ? 'OK' : 'Unavailable'}
            </span>
          </div>
          <div>
            <small>Latency: {data.timing_ms} ms</small>
          </div>
          <p style={{ marginTop: 12, color: '#555' }}>
            If anon fails, check NEXT_PUBLIC_SUPABASE_*. If service fails, verify SUPABASE_SERVICE_ROLE_KEY.
          </p>
        </div>
      )}
    </main>
  )
}

