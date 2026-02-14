import 'server-only'
import { headers as nextHeaders } from 'next/headers'
import z from 'zod'

// Client-visible env (safe to expose)
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({ message: 'NEXT_PUBLIC_SUPABASE_URL must be a URL' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
})

// Server-only env (do not expose to client)
const serverSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().optional(), // e.g., 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano' - defaults to 'gpt-4.1'
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  GROBID_URL: z.string().url().optional(),
  ENABLE_GROBID: z.enum(['0', '1']).optional(), // '1' to enable, '0' to disable
  ENABLE_SERVER_OCR: z.string().optional(),
  CORE_API_KEY: z.string().optional(),
  CONTACT_EMAIL: z.string().email().optional(),
  SEMANTIC_API_KEY: z.string().optional(),
  // Polar billing
  POLAR_ACCESS_TOKEN: z.string().optional(),
  POLAR_WEBHOOK_SECRET: z.string().optional(),
  POLAR_PRODUCT_STARTER: z.string().optional(),
  POLAR_PRODUCT_RESEARCHER: z.string().optional(),
  POLAR_PRODUCT_INSTITUTION: z.string().optional(),
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

/**
 * Validate required environment variables at startup
 * Call this in server startup or middleware to fail fast
 */
export function validateProductionEnv(): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Always required
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is required')
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
  }
  
  // Required in production
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_SITE_URL) {
      errors.push('NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_SITE_URL is required in production')
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      errors.push('SUPABASE_SERVICE_ROLE_KEY is required in production')
    }
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      errors.push('At least one AI provider API key is required (OPENAI_API_KEY or ANTHROPIC_API_KEY)')
    }
  }
  
  // Warn about billing if configured partially
  const polarVars = ['POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET']
  const hasSomePolar = polarVars.some(v => process.env[v])
  const hasAllPolar = polarVars.every(v => process.env[v])
  if (hasSomePolar && !hasAllPolar) {
    errors.push('Polar billing is partially configured. Set all POLAR_* variables or none.')
  }
  
  return { valid: errors.length === 0, errors }
}

function normalizeHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined
  const normalized = value.split(',')[0]?.trim()
  return normalized || undefined
}

function isInternalHost(host: string): boolean {
  const normalizedHost = host.toLowerCase()
  const hostnameOnly = normalizedHost.replace(/:\d+$/, '')
  return hostnameOnly === '0.0.0.0'
    || hostnameOnly === '127.0.0.1'
    || hostnameOnly === 'localhost'
    || hostnameOnly === '::1'
}

// Build an absolute URL for server contexts, preferring request headers
export function getAbsoluteUrlFromHeaders(h: Headers | null | undefined, path = '/') {
  const inputPath = path.startsWith('/') ? path : `/${path}`
  const forwardedHost = normalizeHeaderValue(h?.get('x-forwarded-host') ?? null)
  const hostHeader = normalizeHeaderValue(h?.get('host') ?? null)
  const host = forwardedHost || hostHeader
  const proto = normalizeHeaderValue(h?.get('x-forwarded-proto') ?? null) || 'http'

  const shouldUseHeaderHost = host && (
    process.env.NODE_ENV !== 'production' || !isInternalHost(host)
  )

  if (shouldUseHeaderHost) {
    return `${proto}://${host}${inputPath}`
  }

  const base = clientEnv.NEXT_PUBLIC_APP_URL
    || clientEnv.NEXT_PUBLIC_SITE_URL
    || (clientEnv.VERCEL_URL ? `https://${clientEnv.VERCEL_URL}` : undefined)
    || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined)
  
  if (!base) {
    throw new Error('NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_SITE_URL must be set in production')
  }

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

