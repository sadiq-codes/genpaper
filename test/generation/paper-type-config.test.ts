import { describe, it, expect } from 'vitest'
import {
  inferSectionType,
  resolveSectionType,
  getPaperTypeConfig,
  getPaperTypeGuardrails,
  PAPER_TYPE_CONFIGS,
  type SectionType,
} from '@/lib/generation/paper-type-config'

describe('inferSectionType', () => {
  const cases: Array<[string, string | undefined, SectionType]> = [
    ['introduction', undefined, 'introduction'],
    ['backgroundAndContext', undefined, 'introduction'],
    ['literatureReview', undefined, 'literature'],
    ['thematicAnalysis', 'Thematic Analysis of Studies', 'literature'],
    ['relatedWork', undefined, 'literature'],
    ['methodology', undefined, 'methodology'],
    ['researchDesign', 'Research Design and Approach', 'methodology'],
    ['results', undefined, 'results'],
    ['findings', 'Key Findings', 'results'],
    ['discussion', undefined, 'discussion'],
    ['implications', 'Implications and Interpretation', 'discussion'],
    ['conclusion', undefined, 'conclusion'],
    ['futureDirections', 'Summary and Future Work', 'conclusion'],
    ['references', undefined, 'non-content'],
    ['appendixA', 'Appendix A: Supplementary Tables', 'non-content'],
  ]

  it.each(cases)('infers "%s" (title: %s) as %s', (key, title, expected) => {
    expect(inferSectionType(key, title)).toBe(expected)
  })

  it('returns non-content for unrecognized section names', () => {
    expect(inferSectionType('xyzzy')).toBe('non-content')
  })
})

describe('resolveSectionType', () => {
  it('returns explicit sectionType when set', () => {
    expect(
      resolveSectionType({ key: 'introduction', sectionType: 'results' })
    ).toBe('results')
  })

  it('falls back to inference when sectionType is undefined', () => {
    expect(resolveSectionType({ key: 'literatureReview' })).toBe('literature')
  })

  it('uses title for inference when key is ambiguous', () => {
    expect(
      resolveSectionType({ key: 'section1', title: 'Literature Review' })
    ).toBe('literature')
  })
})

describe('getPaperTypeConfig', () => {
  it('returns config for known paper types', () => {
    const cfg = getPaperTypeConfig('literatureReview')
    expect(cfg.label).toBe('Literature Review')
    expect(cfg.safetyMinSources).toBe(25)
    expect(cfg.academicLevel).toBe('masters')
  })

  it('falls back to researchArticle for unknown types', () => {
    const cfg = getPaperTypeConfig('unknownType')
    expect(cfg.label).toBe('Research Article')
  })

  it('covers all PaperTypeKey entries', () => {
    const keys = Object.keys(PAPER_TYPE_CONFIGS)
    expect(keys.length).toBeGreaterThanOrEqual(5)
    for (const key of keys) {
      const cfg = getPaperTypeConfig(key)
      expect(cfg.label).toBeTruthy()
      expect(cfg.sectionLimits.min).toBeLessThanOrEqual(cfg.sectionLimits.max)
    }
  })
})

describe('getPaperTypeGuardrails', () => {
  it('returns base guardrails by default', () => {
    const rails = getPaperTypeGuardrails('researchArticle')
    expect(rails).toContain('Research Article')
  })

  it('returns original-research variant when flag is true', () => {
    const rails = getPaperTypeGuardrails('researchArticle', true)
    expect(rails).toContain('Primary Empirical')
  })

  it('returns base guardrails when no original-research variant exists', () => {
    const rails = getPaperTypeGuardrails('literatureReview', true)
    expect(rails).toContain('Literature Review')
  })
})
