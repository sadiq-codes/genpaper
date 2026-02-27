import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const {
  generateObjectMock,
  createClientMock,
  checkAutocompleteUsageMock,
} = vi.hoisted(() => ({
  generateObjectMock: vi.fn(),
  createClientMock: vi.fn(),
  checkAutocompleteUsageMock: vi.fn(),
}))

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/ai/vercel-client', () => ({
  getFastAutocompleteLanguageModel: vi.fn(() => ({})),
  getAutocompleteLanguageModel: vi.fn(() => ({})),
}))

vi.mock('@/lib/billing/usage-limits', () => ({
  checkAutocompleteUsage: checkAutocompleteUsageMock,
  formatTimeUntilReset: vi.fn(() => '24h'),
}))

// Not exercised in these early-return heading tests, but imported by route module.
vi.mock('@/lib/rag', () => ({
  retrieveEditorContext: vi.fn(),
  formatEditorContextForPrompt: vi.fn(() => ({ chunksText: '', claimsText: '' })),
}))
vi.mock('@/lib/citations/unified-service', () => ({
  processNumberedCitations: vi.fn(),
}))
vi.mock('@/lib/citations/citation-settings', () => ({
  getProjectCitationStyle: vi.fn(),
}))

import { POST } from '@/app/api/editor/complete/route'

function createSupabaseMock(projectRow: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = []

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'research_projects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: projectRow,
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            }
          }),
        }
      }

      if (table === 'library_papers') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return { supabase, updates }
}

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/editor/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function parseSSEData(response: Response) {
  const text = await response.text()
  const dataLine = text
    .split('\n')
    .find(line => line.startsWith('data: '))

  if (!dataLine) {
    throw new Error(`Expected SSE data line, got: ${text}`)
  }

  return JSON.parse(dataLine.slice(6))
}

describe('editor complete outline flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkAutocompleteUsageMock.mockResolvedValue({
      allowed: true,
      currentUses: 0,
      dailyLimit: 10,
      resetsAt: new Date(Date.now() + 60 * 60 * 1000),
      isUnlimited: false,
    })
  })

  it('bootstraps and persists outline from title-only context, then suggests first heading', async () => {
    const { supabase, updates } = createSupabaseMock({
      id: 'project-1',
      topic: 'AI in healthcare',
      paper_type: 'researchArticle',
      generation_config: null,
    })
    createClientMock.mockResolvedValue(supabase)

    generateObjectMock.mockResolvedValueOnce({
      object: {
        sections: [
          { heading: 'Abstract', goal: 'Summarize the research focus', targetWords: 180 },
          { heading: 'Introduction', goal: 'Motivate the problem context', targetWords: 320 },
          { heading: 'Methodology', goal: 'Describe methods used', targetWords: 300 },
          { heading: 'Results', goal: 'Present the findings', targetWords: 300 },
          { heading: 'Conclusion', goal: 'Summarize implications', targetWords: 180 },
        ],
      },
    })

    const response = await POST(createRequest({
      projectId: 'project-1',
      topic: 'AI in healthcare',
      paperIds: [],
      skipRAG: true,
      context: {
        precedingText: '',
        followingText: '',
        currentParagraph: '',
        currentSection: 'Untitled Section',
        documentOutline: ['AI in healthcare'],
        isSectionOpening: false,
        currentSectionText: '',
        currentSectionWordCount: 0,
      },
    }) as any)

    const payload = await parseSSEData(response)
    expect(payload.isHeadingSuggestion).toBe(true)
    expect(payload.sentences[0].text).toContain('## Abstract')

    expect(updates).toHaveLength(1)
    const generationConfig = updates[0].generation_config as Record<string, unknown>
    expect(generationConfig.plannedOutline).toEqual(
      expect.arrayContaining(['Abstract', 'Introduction', 'Methodology', 'Results', 'Conclusion'])
    )
    expect(generationConfig.outlineBlueprint).toBeTruthy()
  })

  it('persists section summary when advancing to next heading', async () => {
    const generationConfig = {
      plannedOutline: ['Abstract', 'Introduction', 'Methodology'],
      outlineBlueprint: {
        version: 1,
        source: 'generation',
        createdAt: new Date().toISOString(),
        sections: [
          { heading: 'Abstract', goal: 'Summarize the study', targetWords: 180 },
          { heading: 'Introduction', goal: 'Introduce core problem', targetWords: 320 },
          { heading: 'Methodology', goal: 'Describe methods', targetWords: 300 },
        ],
      },
    }

    const { supabase, updates } = createSupabaseMock({
      id: 'project-2',
      topic: 'AI in healthcare',
      paper_type: 'researchArticle',
      generation_config: generationConfig,
    })
    createClientMock.mockResolvedValue(supabase)

    const response = await POST(createRequest({
      projectId: 'project-2',
      topic: 'AI in healthcare',
      paperIds: [],
      skipRAG: true,
      context: {
        precedingText: 'This abstract summarizes the primary findings.',
        followingText: '',
        currentParagraph: '',
        currentSection: 'Abstract',
        documentOutline: ['AI in healthcare', 'Abstract'],
        isSectionOpening: false,
        currentSectionText: 'This abstract summarizes the primary findings. The study reports measurable improvements.',
        currentSectionWordCount: 120,
      },
    }) as any)

    const payload = await parseSSEData(response)
    expect(payload.isHeadingSuggestion).toBe(true)
    expect(payload.sentences[0].text).toContain('## Introduction')

    expect(updates).toHaveLength(1)
    const updatedConfig = updates[0].generation_config as Record<string, any>
    expect(updatedConfig.sectionSummaries).toBeTruthy()
    expect(updatedConfig.sectionSummaries.abstract).toMatch(/This abstract summarizes the primary findings/i)
  })
})
