export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServiceClient } from '@/lib/supabase/service'
import { clientEnv, serverEnv } from '@/lib/config'

export async function GET() {
  const startedAt = Date.now()
  const checks: Record<string, unknown> = {}

  // Env presence checks (no secrets returned)
  checks.env = {
    NEXT_PUBLIC_SUPABASE_URL: !!clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    OPENAI_API_KEY: !!serverEnv.OPENAI_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    GROBID_URL: !!serverEnv.GROBID_URL,
    ENABLE_GROBID: process.env.ENABLE_GROBID ?? null,
    ENABLE_SERVER_OCR: process.env.ENABLE_SERVER_OCR ?? null,
  }

  // Supabase anon client (SSR) basic read
  let anonOk = false
  try {
    const sb = await createClient()
    const { error } = await sb.from('papers').select('id', { count: 'exact', head: true }).limit(1)
    anonOk = !error
  } catch {
    anonOk = false
  }

  // Supabase service client (if configured)
  let serviceOk = false
  try {
    if (serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
      const sb = getServiceClient()
      const { error } = await sb.from('papers').select('id', { count: 'exact', head: true }).limit(1)
      serviceOk = !error
    } else {
      serviceOk = false
    }
  } catch {
    serviceOk = false
  }

  const result = {
    ok: true,
    supabase: {
      anon_query_ok: anonOk,
      service_query_ok: serviceOk,
    },
    timing_ms: Date.now() - startedAt,
  }

  return NextResponse.json(result)
}

