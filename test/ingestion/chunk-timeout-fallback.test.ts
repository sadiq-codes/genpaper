import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/utils/embedding', () => ({
  generateEmbeddings: vi.fn(async (values: string[]) => values.map(() => new Array(4).fill(0.01)))
}))

vi.mock('@/lib/utils/text', () => ({
  normalizeText: vi.fn((value: string) => value),
  chunkByTokens: vi.fn(async (_content: string, paperId: string) => ([
    { id: `${paperId}-chunk-0`, content: 'chunk one content' },
    { id: `${paperId}-chunk-1`, content: 'chunk two content' },
  ])),
}))

vi.mock('@/lib/utils/hash', () => ({
  collisionResistantHash: vi.fn((value: string) => `hash:${value.length}`)
}))

vi.mock('@/lib/qdrant/client', () => ({
  isQdrantConfigured: vi.fn(() => false),
  upsertChunks: vi.fn(),
  deleteChunksByPaperId: vi.fn(),
}))

const fromSpy = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  getServiceClient: vi.fn(() => ({
    from: fromSpy,
  })),
}))

import { createChunksForPaper } from '@/lib/content/ingestion'

describe('createChunksForPaper timeout fallback', () => {
  beforeEach(() => {
    fromSpy.mockReset()
  })

  it('falls back to single inserts when batch upserts keep timing out', async () => {
    const insertedRows: Array<Record<string, unknown>> = []
    const timeoutMessage = 'canceling statement due to statement timeout'
    const chunkStore = new Map<string, Record<string, unknown>>()

    fromSpy.mockImplementation((table: string) => {
      if (table === 'paper_chunks') {
        return {
          select: vi.fn((columns?: string, options?: { count?: 'exact'; head?: boolean }) => ({
            eq: vi.fn((field: string, value: string) => {
              if (options?.head && columns === '*') {
                const count = Array.from(chunkStore.values()).filter(row => row.paper_id === value).length
                return Promise.resolve({ count, error: null })
              }

              if (columns === 'id' && field === 'id') {
                return {
                  limit: vi.fn(async () => ({
                    data: chunkStore.has(value) ? [{ id: value }] : [],
                    error: null,
                  })),
                }
              }

              if (columns === 'content, chunk_index' && field === 'paper_id') {
                return {
                  order: vi.fn(async () => ({
                    data: [],
                    error: null,
                  })),
                }
              }

              throw new Error(`Unexpected paper_chunks select.eq call: ${columns} ${field}`)
            }),
          })),
          upsert: vi.fn(async () => ({ error: { message: timeoutMessage } })),
          insert: vi.fn(async (row: Record<string, unknown>) => {
            insertedRows.push(row)
            chunkStore.set(String(row.id), row)
            return { data: null, error: null }
          }),
        }
      }

      if (table === 'papers') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { metadata: {} },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const count = await createChunksForPaper(
      'paper-timeout-test',
      'This is a long enough content body to trigger token chunking fallback behavior in the ingestion pipeline.'
    )

    expect(count).toBe(2)
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows.map(row => row.id)).toEqual([
      'paper-timeout-test-chunk-0',
      'paper-timeout-test-chunk-1',
    ])
  })
})
