/// <reference types="node" />
import 'server-only'

/**
 * Generation Pipeline Feature Flags
 *
 * Flags are read from process.env at call time to reflect current values.
 * Accepted truthy values: "1", "true", "on", "yes" (case-insensitive).
 */

function readBooleanFlag(envVarName: string): boolean {
  const raw = process.env[envVarName]
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes'
}

export interface GenerationPipelineFlags {
  unifiedCitations: boolean
  batchedCitations: boolean
  retrievalService: boolean
}

export interface ArchitectureFlags {
  citationsUnified: boolean
  searchOrchOnly: boolean
  serviceLayerOnly: boolean
  projectServiceApi: boolean
}

export function getGenerationPipelineFlags(): GenerationPipelineFlags {
  return {
    unifiedCitations: readBooleanFlag('GENPIPE_UNIFIED_CITATIONS'),
    batchedCitations: readBooleanFlag('GENPIPE_BATCHED_CITES'),
    retrievalService: readBooleanFlag('GENPIPE_RETRIEVAL_SVC'),
  }
}

export function getArchitectureFlags(): ArchitectureFlags {
  return {
    citationsUnified: readBooleanFlag('CITATIONS_UNIFIED'),
    searchOrchOnly: readBooleanFlag('SEARCH_ORCH_ONLY'),
    serviceLayerOnly: readBooleanFlag('SERVICE_LAYER_ONLY'),
    projectServiceApi: readBooleanFlag('PROJECT_SERVICE_API'),
  }
}

export function isUnifiedCitationsEnabled(): boolean {
  return readBooleanFlag('GENPIPE_UNIFIED_CITATIONS')
}

export function isBatchedCitationsEnabled(): boolean {
  return readBooleanFlag('GENPIPE_BATCHED_CITES')
}

export function isRetrievalServiceEnabled(): boolean {
  return readBooleanFlag('GENPIPE_RETRIEVAL_SVC')
}

// Architecture flag accessors
export function isCitationsUnifiedEnabled(): boolean {
  return readBooleanFlag('CITATIONS_UNIFIED')
}

export function isSearchOrchOnlyEnabled(): boolean {
  return readBooleanFlag('SEARCH_ORCH_ONLY')
}

export function isServiceLayerOnlyEnabled(): boolean {
  return readBooleanFlag('SERVICE_LAYER_ONLY')
}

export function isProjectServiceApiEnabled(): boolean {
  return readBooleanFlag('PROJECT_SERVICE_API')
}

// Dummy code path for testing
export function dummyCodePath(): string {
  const flags = getArchitectureFlags()
  if (flags.citationsUnified) {
    return 'unified-citations-path'
  }
  return 'legacy-citations-path'
}

export const __test__ = { readBooleanFlag, dummyCodePath }

