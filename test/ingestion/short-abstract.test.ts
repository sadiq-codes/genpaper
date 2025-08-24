import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock embedding to avoid network calls
vi.mock('@/lib/utils/embedding', () => ({
  generateEmbeddings: vi.fn(async (values: string[]) => values.map(() => new Array(384).fill(0.01)))
}))

// Supabase client mock
const insertSpy = vi.fn(async (_rows: any) => ({ data: null, error: null }))
const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  in: vi.fn(() => chain),
  limit: vi.fn(async () => ({ data: [], error: null })),
}
const fromSpy = vi.fn((table: string) => {
  if (table === 'paper_chunks') {
    return { ...chain, insert: insertSpy }
  }
  return { ...chain }
})
vi.mock('@/lib/supabase/server', () => ({
  getSB: vi.fn(async () => ({ from: (table: string) => fromSpy(table) }))
}))

import { createChunksForPaper } from '@/lib/content/ingestion'

describe('Short abstract chunking', () => {
  beforeEach(() => {
    insertSpy.mockClear()
    fromSpy.mockClear()
  })

  it('creates a single chunk for short content (<100 chars)', async () => {
    const paperId = '00000000-0000-0000-0000-000000000001'
    const shortContent = 'Brief abstract about a topic.'
    const count = await createChunksForPaper(paperId, shortContent)
    expect(count).toBe(1)
    expect(fromSpy).toHaveBeenCalledWith('paper_chunks')
    const [row] = insertSpy.mock.calls[0][0] ? insertSpy.mock.calls[0] : [insertSpy.mock.calls[0]]
    const inserted = (Array.isArray(row) ? row[0] : row) as any
    expect(inserted.paper_id).toBe(paperId)
    expect(inserted.chunk_index).toBe(0)
    expect(typeof inserted.id).toBe('string')
    expect(typeof inserted.embedding).toBe('object')
  })
})
