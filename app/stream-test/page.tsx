"use client"

import { useEffect, useRef, useState } from 'react'

export default function StreamTestPage() {
  const [logs, setLogs] = useState<string[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/stream-test')
    esRef.current = es
    setLogs((l) => [...l, 'Connecting...'])
    es.onmessage = (e) => {
      setLogs((l) => [...l, e.data])
    }
    es.onerror = () => {
      setLogs((l) => [...l, 'Error / closed'])
      es.close()
      esRef.current = null
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1>Streaming Test</h1>
      <p>Subscribing to /api/stream-test and printing events.</p>
      <pre style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#111', color: '#9f9' }}>
        {logs.join('\n')}
      </pre>
    </main>
  )
}

