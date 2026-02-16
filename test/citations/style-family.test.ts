import { describe, expect, it } from 'vitest'
import {
  isNumericLikeCitationStyle,
  resolveCitationStyleFamily,
} from '@/lib/citations/style-family'

describe('citation style family resolution', () => {
  it('maps extended chicago and mla IDs to correct families', () => {
    expect(resolveCitationStyleFamily('chicago-author-date')).toBe('chicago')
    expect(resolveCitationStyleFamily('modern-language-association')).toBe('mla')
  })

  it('treats numeric and note styles as numeric-like', () => {
    expect(isNumericLikeCitationStyle('ieee')).toBe(true)
    expect(isNumericLikeCitationStyle('vancouver')).toBe(true)
    expect(isNumericLikeCitationStyle('oscola')).toBe(true)
  })

  it('falls back to apa for unknown author-date styles', () => {
    expect(resolveCitationStyleFamily('unknown-custom-style')).toBe('apa')
  })
})

