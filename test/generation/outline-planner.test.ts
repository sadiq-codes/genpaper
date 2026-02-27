import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('ai', () => ({ generateObject: vi.fn() }))
vi.mock('@/lib/ai/vercel-client', () => ({
  getFastAutocompleteLanguageModel: vi.fn(() => ({})),
}))

import {
  buildOutlineBlueprintFromProfileSections,
  dedupePlannedOutline,
  getSectionTransitionThreshold,
} from '@/lib/generation/outline-planner'

describe('outline-planner', () => {
  it('dedupes planned headings with loose matching', () => {
    const deduped = dedupePlannedOutline([
      '## Introduction',
      '1. introduction',
      'Literature Review',
      'Methodology',
      'Conclusion',
      ' conclusion ',
    ])

    expect(deduped).toEqual([
      'Introduction',
      'Literature Review',
      'Methodology',
      'Conclusion',
    ])
  })

  it('computes adaptive section transition thresholds from target words', () => {
    const threshold = getSectionTransitionThreshold({
      currentSection: 'Abstract',
      plannedOutline: ['Abstract', 'Introduction', 'Methodology'],
      blueprintSections: [
        { heading: 'Abstract', goal: 'Summarize the study', targetWords: 180 },
        { heading: 'Introduction', goal: 'Motivate the problem', targetWords: 320 },
      ],
      fallbackWords: 140,
    })

    expect(threshold).toBe(99) // 180 * 0.55
  })

  it('falls back when section target words are missing', () => {
    const threshold = getSectionTransitionThreshold({
      currentSection: 'Results',
      plannedOutline: ['Introduction', 'Results'],
      blueprintSections: [
        { heading: 'Introduction', goal: 'Intro text' },
        { heading: 'Results', goal: 'Present findings' },
      ],
      fallbackWords: 140,
    })

    expect(threshold).toBe(140)
  })

  it('builds generation-sourced blueprint from profile sections', () => {
    const blueprint = buildOutlineBlueprintFromProfileSections([
      { title: 'Introduction', keyPoints: ['State the core problem'], expectedWords: 300 },
      { title: 'Results', keyPoints: ['Present measured outcomes'], expectedWords: 320 },
    ])

    expect(blueprint.source).toBe('generation')
    expect(blueprint.sections).toHaveLength(2)
    expect(blueprint.sections[0]).toMatchObject({
      heading: 'Introduction',
      goal: 'State the core problem',
      targetWords: 300,
    })
  })
})
