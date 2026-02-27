import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/prompts/prompt-service', () => ({
  PromptService: {
    formatEvidenceSnippets: vi.fn(() => 'mock-evidence'),
    buildUnified: vi.fn(async (data: Record<string, unknown>) => ({
      system: '',
      user: '',
      data,
    })),
  },
}))

vi.mock('@/lib/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { buildUnifiedPrompt } from '@/lib/prompts/unified/prompt-builder'

describe('unified table gating', () => {
  it('does not require tables for low-signal sections', async () => {
    const context = {
      sectionKey: 'literatureReview',
      title: 'Literature Review',
      expectedWords: 500,
      candidatePaperIds: ['p1', 'p2'],
      contextChunks: [
        { paper_id: 'p1', content: 'chunk one content with sufficient text', score: 0.9 },
        { paper_id: 'p2', content: 'chunk two content with sufficient text', score: 0.8 },
      ],
      hasSynthesisEnrichment: true,
      isLiteratureFocused: true,
      synthesisContent: {
        patterns: [
          {
            claim: 'Pattern A',
            data: { supportStatement: '2 of 5 studies support A', valuesSummary: '40%' },
            presentationApproach: 'compare',
            importance: 'notable',
            supportingPaperIds: ['p1'],
          },
        ],
        contradictions: [],
        gaps: [],
      },
    }

    const built = await buildUnifiedPrompt(context as any, {
      paperType: 'literatureReview',
      topic: 'Test topic',
      targetWords: 500,
    })

    expect((built as any).data.requiresTable).toBe(false)
  })

  it('requires tables for high-signal analytical sections', async () => {
    const context = {
      sectionKey: 'results',
      title: 'Results',
      expectedWords: 700,
      candidatePaperIds: ['p1', 'p2', 'p3'],
      contextChunks: [
        { paper_id: 'p1', content: 'result chunk one with quantified values', score: 0.9 },
        { paper_id: 'p2', content: 'result chunk two with quantified values', score: 0.85 },
        { paper_id: 'p3', content: 'result chunk three with quantified values', score: 0.8 },
      ],
      hasSynthesisEnrichment: true,
      isLiteratureFocused: true,
      synthesisContent: {
        patterns: [
          {
            claim: 'Pattern A',
            data: { supportStatement: '5 of 7 studies report A', valuesSummary: '71%' },
            presentationApproach: 'compare',
            importance: 'critical',
            supportingPaperIds: ['p1', 'p2'],
          },
          {
            claim: 'Pattern B',
            data: { supportStatement: '4 of 7 studies report B', valuesSummary: '57%' },
            presentationApproach: 'contrast',
            importance: 'notable',
            supportingPaperIds: ['p2', 'p3'],
          },
        ],
        contradictions: [
          {
            description: 'Conflicting effect magnitude',
            presentationApproach: 'balanced',
            resolutionStrategy: 'Contextual moderators',
            sides: [
              { position: 'Large effect', paperIds: ['p1'] },
              { position: 'Small effect', paperIds: ['p2'] },
            ],
          },
        ],
        gaps: [],
      },
    }

    const built = await buildUnifiedPrompt(context as any, {
      paperType: 'researchArticle',
      topic: 'Test topic',
      targetWords: 700,
    })

    expect((built as any).data.requiresTable).toBe(true)
    expect((built as any).data.tableSchemaGuidance).toContain('Derive a section-specific table schema')
    expect((built as any).data.tableSchemaGuidance).toContain('Candidate dimensions')
  })
})
