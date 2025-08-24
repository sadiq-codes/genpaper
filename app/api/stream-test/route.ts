export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET() {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }
      send({ type: 'progress', progress: 0, message: 'Stream connected' })
      for (let i = 1; i <= 5; i++) {
        await new Promise(r => setTimeout(r, 400))
        send({ type: 'progress', progress: i * 20, message: `Step ${i}/5` })
      }
      send({ type: 'complete', message: 'Done' })
      controller.close()
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    }
  })
}

