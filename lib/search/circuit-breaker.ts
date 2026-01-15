/**
 * Circuit Breaker for Academic API Sources
 * 
 * Prevents cascading failures by tracking source health and failing fast
 * when a source is unhealthy. Uses a sliding window for failure counting.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Source unhealthy, requests fail immediately
 * - HALF_OPEN: Testing if source recovered, allows one request through
 */

import type { PaperSource } from '@/types/simplified'

export type CircuitState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 3) */
  failureThreshold: number
  /** Time in ms before attempting recovery (default: 5 minutes) */
  cooldownMs: number
  /** Sliding window for counting failures (default: 5 minutes) */
  windowMs: number
  /** Log state transitions (default: true) */
  logTransitions: boolean
}

interface CircuitStats {
  state: CircuitState
  failures: number[]  // Timestamps of failures within window
  lastFailure: number | null
  openedAt: number | null
  successesSinceOpen: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,  // 5 minutes
  windowMs: 5 * 60 * 1000,    // 5 minutes
  logTransitions: true,
}

// Singleton state - persists for app lifetime (resets on server restart)
const circuits = new Map<string, CircuitStats>()

function getCircuit(source: string): CircuitStats {
  if (!circuits.has(source)) {
    circuits.set(source, {
      state: 'closed',
      failures: [],
      lastFailure: null,
      openedAt: null,
      successesSinceOpen: 0,
    })
  }
  return circuits.get(source)!
}

/**
 * Clean up old failures outside the sliding window
 */
function pruneOldFailures(circuit: CircuitStats, windowMs: number): void {
  const cutoff = Date.now() - windowMs
  circuit.failures = circuit.failures.filter(t => t > cutoff)
}

/**
 * Check if a source is available for requests
 * Returns true if request can proceed, false if circuit is open
 */
export function isSourceAvailable(
  source: PaperSource | string,
  config: Partial<CircuitBreakerConfig> = {}
): boolean {
  const opts = { ...DEFAULT_CONFIG, ...config }
  const circuit = getCircuit(source)
  const now = Date.now()
  
  // Clean up old failures
  pruneOldFailures(circuit, opts.windowMs)
  
  switch (circuit.state) {
    case 'closed':
      return true
      
    case 'open':
      // Check if cooldown has passed
      if (circuit.openedAt && now - circuit.openedAt >= opts.cooldownMs) {
        // Transition to half-open
        circuit.state = 'half_open'
        if (opts.logTransitions) {
          console.log(`[CircuitBreaker] ${source}: OPEN → HALF_OPEN (testing recovery)`)
        }
        return true
      }
      return false
      
    case 'half_open':
      // Only allow one request at a time in half-open state
      // (already allowed by returning true once when transitioning)
      return true
      
    default:
      return true
  }
}

/**
 * Record a successful request - may close circuit if in half-open state
 */
export function recordSuccess(
  source: PaperSource | string,
  config: Partial<CircuitBreakerConfig> = {}
): void {
  const opts = { ...DEFAULT_CONFIG, ...config }
  const circuit = getCircuit(source)
  
  if (circuit.state === 'half_open') {
    // Recovery confirmed - close circuit
    circuit.state = 'closed'
    circuit.failures = []
    circuit.openedAt = null
    circuit.successesSinceOpen = 0
    if (opts.logTransitions) {
      console.log(`[CircuitBreaker] ${source}: HALF_OPEN → CLOSED (recovered)`)
    }
  }
}

/**
 * Record a failed request - may open circuit if threshold exceeded
 */
export function recordFailure(
  source: PaperSource | string,
  error?: Error,
  config: Partial<CircuitBreakerConfig> = {}
): void {
  const opts = { ...DEFAULT_CONFIG, ...config }
  const circuit = getCircuit(source)
  const now = Date.now()
  
  // Clean up old failures
  pruneOldFailures(circuit, opts.windowMs)
  
  // Record new failure
  circuit.failures.push(now)
  circuit.lastFailure = now
  
  if (circuit.state === 'half_open') {
    // Recovery failed - reopen circuit
    circuit.state = 'open'
    circuit.openedAt = now
    if (opts.logTransitions) {
      console.warn(`[CircuitBreaker] ${source}: HALF_OPEN → OPEN (recovery failed)`, error?.message)
    }
    return
  }
  
  // Check if we should open the circuit
  if (circuit.state === 'closed' && circuit.failures.length >= opts.failureThreshold) {
    circuit.state = 'open'
    circuit.openedAt = now
    if (opts.logTransitions) {
      console.warn(
        `[CircuitBreaker] ${source}: CLOSED → OPEN (${circuit.failures.length} failures in ${opts.windowMs}ms)`,
        error?.message
      )
    }
  }
}

/**
 * Get current circuit state for a source
 */
export function getCircuitState(source: PaperSource | string): CircuitState {
  return getCircuit(source).state
}

/**
 * Get all circuit states (for monitoring/debugging)
 */
export function getAllCircuitStates(): Record<string, { state: CircuitState; failureCount: number }> {
  const result: Record<string, { state: CircuitState; failureCount: number }> = {}
  for (const [source, circuit] of circuits) {
    result[source] = {
      state: circuit.state,
      failureCount: circuit.failures.length,
    }
  }
  return result
}

/**
 * Reset a specific circuit (for testing or manual recovery)
 */
export function resetCircuit(source: PaperSource | string): void {
  circuits.delete(source)
}

/**
 * Reset all circuits (for testing)
 */
export function resetAllCircuits(): void {
  circuits.clear()
}

/**
 * Wrapper that applies circuit breaker logic to an async function
 * 
 * @example
 * const protectedSearch = withCircuitBreaker('openalex', searchOpenAlex)
 * const results = await protectedSearch(query, options)
 */
export function withCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  source: PaperSource | string,
  fn: T,
  config: Partial<CircuitBreakerConfig> = {}
): T {
  return (async (...args: Parameters<T>) => {
    if (!isSourceAvailable(source, config)) {
      throw new CircuitOpenError(source)
    }
    
    try {
      const result = await fn(...args)
      recordSuccess(source, config)
      return result
    } catch (error) {
      recordFailure(source, error instanceof Error ? error : new Error(String(error)), config)
      throw error
    }
  }) as T
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(public source: string) {
    super(`Circuit breaker open for source: ${source}`)
    this.name = 'CircuitOpenError'
  }
}
