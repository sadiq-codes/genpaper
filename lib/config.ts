import 'server-only'
import { headers as nextHeaders } from 'next/headers'
import z from 'zod'

// Client-visible env (safe to expose)
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({ message: 'NEXT_PUBLIC_SUPABASE_URL must be a URL' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
})

// Server-only env (do not expose to client)
const serverSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  GROBID_URL: z.string().url().optional(),
  ENABLE_SERVER_OCR: z.string().optional(),
  CORE_API_KEY: z.string().optional(),
  CONTACT_EMAIL: z.string().email().optional(),
  SEMANTIC_API_KEY: z.string().optional(),
})

function parseEnv<T extends z.ZodTypeAny>(schema: T) {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // Only throw on client required keys; server keys are optional above
    const formatted = parsed.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid environment configuration: ${formatted}`)
  }
  return parsed.data as z.infer<T>
}

export const clientEnv = parseEnv(clientSchema)
export const serverEnv = parseEnv(serverSchema)

// Build an absolute URL for server contexts, preferring request headers
export function getAbsoluteUrlFromHeaders(h: Headers | null | undefined, path = '/') {
  const inputPath = path.startsWith('/') ? path : `/${path}`
  const host = h?.get('x-forwarded-host') || h?.get('host')
  const proto = h?.get('x-forwarded-proto') || 'http'

  if (host) {
    return `${proto}://${host}${inputPath}`
  }

  const base = clientEnv.NEXT_PUBLIC_SITE_URL
    || (clientEnv.VERCEL_URL ? `https://${clientEnv.VERCEL_URL}` : undefined)
    || 'http://localhost:3000'

  return new URL(inputPath, base).toString()
}

// Convenience: when used without explicit headers() in a server action/route
export function getAbsoluteUrl(path = '/') {
  try {
    const h = nextHeaders()
    // nextHeaders() returns a readonly HeaderStore which implements Headers
    // Cast to Headers for our function signature
    return getAbsoluteUrlFromHeaders(h as unknown as Headers, path)
  } catch {
    return getAbsoluteUrlFromHeaders(undefined, path)
  }
}

