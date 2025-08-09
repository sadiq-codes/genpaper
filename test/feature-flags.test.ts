/// <reference types="node" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  __test__, 
  getGenerationPipelineFlags, 
  getArchitectureFlags,
  isUnifiedCitationsEnabled, 
  isBatchedCitationsEnabled, 
  isRetrievalServiceEnabled,
  isCitationsUnifiedEnabled,
  isSearchOrchOnlyEnabled,
  isServiceLayerOnlyEnabled,
  isProjectServiceApiEnabled
} from '@/lib/config/feature-flags'

describe('Generation Pipeline Feature Flags', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.GENPIPE_UNIFIED_CITATIONS
    delete process.env.GENPIPE_BATCHED_CITES
    delete process.env.GENPIPE_RETRIEVAL_SVC
    delete process.env.CITATIONS_UNIFIED
    delete process.env.SEARCH_ORCH_ONLY
    delete process.env.SERVICE_LAYER_ONLY
    delete process.env.PROJECT_SERVICE_API
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('parses boolean flags with common truthy variants', () => {
    const { readBooleanFlag } = __test__
    ;(process.env as any).TEST_TRUE = 'TrUe'
    ;(process.env as any).TEST_ONE = '1'
    ;(process.env as any).TEST_ON = 'on'
    ;(process.env as any).TEST_YES = 'Yes'
    ;(process.env as any).TEST_FALSE = 'no'

    expect(readBooleanFlag('TEST_TRUE')).toBe(true)
    expect(readBooleanFlag('TEST_ONE')).toBe(true)
    expect(readBooleanFlag('TEST_ON')).toBe(true)
    expect(readBooleanFlag('TEST_YES')).toBe(true)
    expect(readBooleanFlag('TEST_FALSE')).toBe(false)
    expect(readBooleanFlag('MISSING')).toBe(false)
  })

  it('returns structured flags object from env', () => {
    process.env.GENPIPE_UNIFIED_CITATIONS = 'true'
    process.env.GENPIPE_BATCHED_CITES = '0'
    process.env.GENPIPE_RETRIEVAL_SVC = 'yes'

    const flags = getGenerationPipelineFlags()
    expect(flags.unifiedCitations).toBe(true)
    expect(flags.batchedCitations).toBe(false)
    expect(flags.retrievalService).toBe(true)
  })

  it('individual helpers reflect env at call time', () => {
    process.env.GENPIPE_UNIFIED_CITATIONS = 'false'
    expect(isUnifiedCitationsEnabled()).toBe(false)
    process.env.GENPIPE_UNIFIED_CITATIONS = 'on'
    expect(isUnifiedCitationsEnabled()).toBe(true)

    process.env.GENPIPE_BATCHED_CITES = 'true'
    expect(isBatchedCitationsEnabled()).toBe(true)

    process.env.GENPIPE_RETRIEVAL_SVC = 'no'
    expect(isRetrievalServiceEnabled()).toBe(false)
  })
})

describe('Architecture Feature Flags', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CITATIONS_UNIFIED
    delete process.env.SEARCH_ORCH_ONLY
    delete process.env.SERVICE_LAYER_ONLY
    delete process.env.PROJECT_SERVICE_API
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns structured architecture flags from env', () => {
    process.env.CITATIONS_UNIFIED = 'true'
    process.env.SEARCH_ORCH_ONLY = 'false'
    process.env.SERVICE_LAYER_ONLY = 'yes'
    process.env.PROJECT_SERVICE_API = '0'

    const flags = getArchitectureFlags()
    expect(flags.citationsUnified).toBe(true)
    expect(flags.searchOrchOnly).toBe(false)
    expect(flags.serviceLayerOnly).toBe(true)
    expect(flags.projectServiceApi).toBe(false)
  })

  it('individual architecture helpers work correctly', () => {
    process.env.CITATIONS_UNIFIED = 'on'
    expect(isCitationsUnifiedEnabled()).toBe(true)

    process.env.SEARCH_ORCH_ONLY = '1'
    expect(isSearchOrchOnlyEnabled()).toBe(true)

    process.env.SERVICE_LAYER_ONLY = 'no'
    expect(isServiceLayerOnlyEnabled()).toBe(false)

    process.env.PROJECT_SERVICE_API = 'true'
    expect(isProjectServiceApiEnabled()).toBe(true)
  })

  it('toggles dummy code path based on flag', () => {
    const { dummyCodePath } = __test__

    process.env.CITATIONS_UNIFIED = 'false'
    expect(dummyCodePath()).toBe('legacy-citations-path')

    process.env.CITATIONS_UNIFIED = 'true'
    expect(dummyCodePath()).toBe('unified-citations-path')
  })
})

