import type { AnalysisResult } from './types'

export function getAnalysisReadinessIssue(analysis: AnalysisResult): string | null {
  const completeness = analysis.completeness?.status
  if (!completeness || completeness !== 'complete') {
    return `Analysis is not ready for synthesis (completeness=${completeness || 'missing'})`
  }

  const integrityErrors = analysis.diagnostics?.integrityErrors || []
  if (integrityErrors.length > 0) {
    return `Analysis integrity failed (${integrityErrors.length} issue(s))`
  }

  return null
}

export function isAnalysisReadyForSynthesis(analysis: AnalysisResult): boolean {
  return getAnalysisReadinessIssue(analysis) === null
}
