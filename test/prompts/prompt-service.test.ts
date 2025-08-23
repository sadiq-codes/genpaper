import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// Mock Next.js server-only guard in test environment
vi.mock('server-only', () => ({}), { virtual: true })
// Mock fs/promises so we can control YAML loading
vi.mock('fs/promises', () => {
  return { default: { readFile: vi.fn() } }
}, { virtual: true })

// NOTE: We do not import server-only here; PromptService itself does not call it.

describe('PromptService.buildUnified', () => {
  beforeEach(async () => {
    // Ensure cache is clean between tests
    const { PromptService } = await import('@/lib/prompts/prompt-service')
    PromptService.clearCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders YAML template when available', async () => {
    // Arrange: mock fs to return a simple YAML template
    const fsMod: any = await import('fs/promises')
    ;(fsMod.default.readFile as any).mockResolvedValueOnce(
      Buffer.from(`system: "Test system {{paperTitle}}"\nuser: "Write {{sectionPath}} with {{targetWords}} words. {{#isRewrite}}REWRITE{{/isRewrite}}"\n`)
    )

    // Act
    const { PromptService } = await import('@/lib/prompts/prompt-service')
    const built = await PromptService.buildUnified({
      paperTitle: 'My Paper',
      paperObjectives: 'Goals',
      outlineTree: '• Intro',
      previousSectionsSummary: 'None',
      sectionPath: 'Intro',
      targetWords: 123,
      minCitations: 2,
      isRewrite: false,
      evidenceSnippets: '[]',
    })

    // Assert
    expect(built.system).toContain('Test system My Paper')
    expect(built.user).toContain('Write Intro with 123 words')
    expect(built.user).not.toContain('REWRITE')

    ;(fsMod.default.readFile as any).mockReset()
  })

  it('falls back to default template when YAML load fails', async () => {
    // Arrange: force readFile to throw
    const fsMod: any = await import('fs/promises')
    ;(fsMod.default.readFile as any).mockRejectedValueOnce(new Error('boom'))

    // Act
    const { PromptService } = await import('@/lib/prompts/prompt-service')
    const built = await PromptService.buildUnified({
      paperTitle: 'Fallback Paper',
      paperObjectives: 'Goals',
      outlineTree: '• Intro',
      previousSectionsSummary: 'None',
      sectionPath: 'Methods',
      targetWords: 300,
      minCitations: 1,
      isRewrite: true,
      currentText: 'draft text',
      evidenceSnippets: '[]',
    })

    // Assert: uses default template structure (from core builder)
    expect(built.system).toBeTypeOf('string')
    expect(built.user).toContain('TARGET LENGTH: 300')
    expect(built.user).toContain('CURRENT TEXT TO IMPROVE')

    ;(fsMod.default.readFile as any).mockReset()
  })
})


