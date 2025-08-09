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

// Editor/Edits feature flags
export interface EditorFlags {
  editorDiffMode: boolean
  editsApiEnabled: boolean
  citationOffsetMode: boolean
}

export function getGenerationPipelineFlags(): GenerationPipelineFlags {
  return {
    // unified citations always on
    unifiedCitations: true,
    batchedCitations: true,
    retrievalService: true,
  }
}

export function getArchitectureFlags(): ArchitectureFlags {
  return {
    citationsUnified: readBooleanFlag('CITATIONS_UNIFIED'),
    searchOrchOnly: false,
    serviceLayerOnly: true,
    projectServiceApi: false,
  }
}

export function getEditorFlags(): EditorFlags {
  return {
    editorDiffMode: true,
    editsApiEnabled: true,
    citationOffsetMode: true,
  }
}

export function isUnifiedCitationsEnabled(): boolean { return true }

export function isBatchedCitationsEnabled(): boolean { return true }

export function isRetrievalServiceEnabled(): boolean { return true }

// Architecture flag accessors
export function isCitationsUnifiedEnabled(): boolean {
  return readBooleanFlag('CITATIONS_UNIFIED')
}

export function isSearchOrchOnlyEnabled(): boolean { return false }
export function isServiceLayerOnlyEnabled(): boolean { return true }
export function isProjectServiceApiEnabled(): boolean { return false }

// Editor flag accessors
export function isEditorDiffModeEnabled(): boolean { return true }
export function isEditsApiEnabled(): boolean { return true }
export function isCitationOffsetModeEnabled(): boolean { return true }

// Dummy code path for testing
export function dummyCodePath(): string {
  const flags = getArchitectureFlags()
  if (flags.citationsUnified) {
    return 'unified-citations-path'
  }
  return 'legacy-citations-path'
}

export const __test__ = { readBooleanFlag, dummyCodePath }

