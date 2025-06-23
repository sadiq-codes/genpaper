import { describe, it, expect } from 'vitest'
import { createCanonicalId } from '@/lib/utils/paper-id'

describe('createCanonicalId', () => {
  it('uses normalised DOI when provided', () => {
    const id1 = createCanonicalId('Some Title', 2024, '10.1234/ABC.DEF', 'crossref')
    const id2 = createCanonicalId('Different title', 1999, 'https://doi.org/10.1234/abc.def', 'openalex')
    expect(id1).toBe(id2)
  })
}) 