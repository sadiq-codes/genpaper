const TRANSIENT_NETWORK_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
])

interface RetryOptions {
  retries?: number
  retryDelayMs?: number
}

function createTransientAuthFailureResponse(): Response {
  return new Response(
    JSON.stringify({
      msg: 'fetch failed (transient auth network error)',
      error: 'transient_network_error',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const methodFromInit = init?.method
  if (methodFromInit) return methodFromInit.toUpperCase()
  if (typeof input === 'string' || input instanceof URL) return 'GET'
  return input.method.toUpperCase()
}

function shouldRetryAuthRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = getRequestUrl(input)
  if (!url.includes('/auth/v1/')) return false

  // Scope retries to user/session refresh endpoints (idempotent auth checks).
  const isUserOrTokenCall = url.includes('/auth/v1/user') || url.includes('/auth/v1/token')
  if (!isUserOrTokenCall) return false

  const method = getRequestMethod(input, init)
  return method === 'GET' || method === 'POST'
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as { code?: unknown; cause?: unknown }
  if (typeof err.code === 'string') return err.code
  if (
    err.cause &&
    typeof err.cause === 'object' &&
    typeof (err.cause as { code?: unknown }).code === 'string'
  ) {
    return (err.cause as { code: string }).code
  }
  return undefined
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

export function isTransientAuthNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name
    if (name === 'AuthRetryableFetchError') return true
  }

  const code = extractErrorCode(error)
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true

  const message = extractErrorMessage(error).toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('connect timeout')
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createSupabaseAuthRetryFetch(
  baseFetch: typeof fetch = fetch,
  options: RetryOptions = {}
): typeof fetch {
  const retries = options.retries ?? 1
  const retryDelayMs = options.retryDelayMs ?? 150

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!shouldRetryAuthRequest(input, init)) {
      return baseFetch(input, init)
    }

    // Request bodies are single-use. Prepare clones only when needed.
    const requestClones =
      typeof Request !== 'undefined' && input instanceof Request
        ? Array.from({ length: retries + 1 }, () => input.clone())
        : null

    let lastError: unknown = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const attemptInput = requestClones ? requestClones[attempt] : input
        return await baseFetch(attemptInput, init)
      } catch (error) {
        lastError = error

        if (!isTransientAuthNetworkError(error)) {
          throw error
        }

        if (attempt === retries) {
          // Return a retryable HTTP response instead of throwing, so callers
          // can handle this as transient auth unavailability without noisy
          // low-level fetch stack traces.
          return createTransientAuthFailureResponse()
        }

        await delay(retryDelayMs * (attempt + 1))
      }
    }

    throw lastError ?? new Error('Auth fetch failed after retries')
  }) as typeof fetch
}

