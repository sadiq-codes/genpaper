/**
 * Shared Paper Formatting Utilities
 * 
 * Centralizes how papers are formatted for AI prompts across all features
 * (chat, autocomplete, generation). The key principle is:
 * 
 * - Paper IDs (UUIDs) are INTERNAL - used only for CITATIONS blocks
 * - Paper IDs are NEVER shown to users in conversational responses
 * - We use HTML comments to hide the ID mapping from the AI's "visible" context
 * 
 * This prevents the AI from including UUIDs in responses like:
 *   ❌ "Paper ID: 01054e24-3b0d-429b-8fe1-1498e05a5fc7"
 *   ✅ "Smith et al. (2023) found that..."
 */

// =============================================================================
// TYPES
// =============================================================================

export interface PaperForContext {
  id: string
  title: string
  authors?: string[]
  year?: number
  abstract?: string
}

export interface RAGChunk {
  paper_id: string
  content: string
}

// =============================================================================
// PAPER LIST FORMATTING
// =============================================================================

/**
 * Format a list of papers for AI prompt context.
 * 
 * Papers are shown with numbered references [1], [2], etc.
 * Paper IDs are hidden in an INTERNAL REFERENCE comment block.
 * 
 * @param papers - Array of papers to format
 * @param options - Formatting options
 * @returns Formatted string for prompt context
 * 
 * @example Output:
 * ```
 * ### Available Sources
 * When discussing, cite by author name (e.g., "Smith et al. (2023) found...").
 * When inserting content, use [N] markers with CITATIONS block.
 * 
 * [1] "Paper Title" (Author1, Author2, 2023)
 * [2] "Another Paper" (Smith et al., 2020)
 * 
 * <!-- INTERNAL REFERENCE (for CITATIONS block only - NEVER show in responses):
 * [1] = 01054e24-3b0d-429b-8fe1-1498e05a5fc7
 * [2] = 23f3af57-d938-42fc-92e5-650c797ff530
 * -->
 * ```
 */
export function formatPapersForContext(
  papers: PaperForContext[],
  options: {
    maxPapers?: number
    header?: string
    instructions?: string
  } = {}
): string {
  if (!papers || papers.length === 0) {
    return ''
  }

  const {
    maxPapers = 15,
    header = '### Available Sources',
    instructions = 'When discussing, cite by author name (e.g., "Smith et al. (2023) found...").\nWhen inserting content, use [N] markers with CITATIONS block.',
  } = options

  const slicedPapers = papers.slice(0, maxPapers)

  // Visible list - human-readable, no UUIDs
  const visibleEntries = slicedPapers.map((p, index) => {
    const num = index + 1
    const authorStr = formatAuthors(p.authors, 2)
    const yearStr = p.year ? `, ${p.year}` : ''
    return `[${num}] "${p.title}" (${authorStr}${yearStr})`
  }).join('\n')

  // Internal mapping - for CITATIONS block only
  const internalMapping = slicedPapers.map((p, index) => {
    return `[${index + 1}] = ${p.id}`
  }).join('\n')

  return `${header}
${instructions}

${visibleEntries}

<!-- INTERNAL REFERENCE (for CITATIONS block only - NEVER show in responses):
${internalMapping}
-->`
}

// =============================================================================
// MENTIONED PAPERS FORMATTING (@ mentions)
// =============================================================================

/**
 * Format papers that were explicitly mentioned by the user (via @ mentions).
 * These get more detailed formatting including abstracts and relevant excerpts.
 * 
 * Uses [M1], [M2] prefix to distinguish from regular papers [1], [2].
 * 
 * @param papers - Mentioned papers
 * @param ragChunks - Optional RAG chunks to include relevant excerpts
 * @returns Formatted string for prompt context
 */
export function formatMentionedPapersForContext(
  papers: PaperForContext[],
  ragChunks?: RAGChunk[]
): string {
  if (!papers || papers.length === 0) {
    return ''
  }

  const formatted = papers.map((p, index) => {
    const refNum = index + 1
    const authorStr = formatAuthors(p.authors, 3)
    const shortCite = formatShortCitation(p)

    let entry = `### [M${refNum}] ${p.title}\n`
    entry += `**Cite as:** ${shortCite}\n`
    entry += `**Authors:** ${authorStr}\n`
    if (p.year) entry += `**Year:** ${p.year}\n`

    if (p.abstract) {
      const truncatedAbstract = p.abstract.slice(0, 500)
      entry += `**Abstract:** ${truncatedAbstract}${p.abstract.length > 500 ? '...' : ''}\n`
    }

    // Add relevant excerpts from RAG if available
    if (ragChunks) {
      const paperChunks = ragChunks.filter(c => c.paper_id === p.id)
      if (paperChunks.length > 0) {
        entry += `\n**Relevant excerpts:**\n`
        for (const chunk of paperChunks.slice(0, 2)) {
          const truncatedContent = chunk.content.slice(0, 300)
          entry += `> ${truncatedContent}${chunk.content.length > 300 ? '...' : ''}\n`
        }
      }
    }

    return entry
  }).join('\n---\n\n')

  // Internal mapping
  const internalMapping = papers.map((p, index) => {
    return `[M${index + 1}] = ${p.id}`
  }).join('\n')

  return `## Papers Referenced by User (@mentions)

Prioritize these sources when responding.
- When DISCUSSING conversationally: Use author-year format like "Smith et al. (2023) found..."
- When INSERTING content: Use [M1], [M2] markers with CITATIONS block

${formatted}

<!-- INTERNAL REFERENCE (for CITATIONS block only - NEVER show in responses):
${internalMapping}
-->`
}

// =============================================================================
// RAG EVIDENCE FORMATTING
// =============================================================================

/**
 * Format RAG evidence chunks for AI prompt context.
 * 
 * Uses [E1], [E2] prefix for evidence chunks.
 * Paper IDs are hidden in internal reference.
 * 
 * @param chunks - RAG chunks with paper_id and content
 * @returns Formatted string for prompt context
 */
export function formatRAGChunksForContext(
  chunks: RAGChunk[]
): string {
  if (!chunks || chunks.length === 0) {
    return ''
  }

  // Visible chunks - no paper IDs shown
  const visibleChunks = chunks.map((chunk, i) => {
    const truncatedContent = chunk.content.slice(0, 500)
    return `[E${i + 1}] ${truncatedContent}${chunk.content.length > 500 ? '...' : ''}`
  }).join('\n\n---\n\n')

  // Internal mapping
  const internalMapping = chunks.map((chunk, i) => {
    return `[E${i + 1}] = ${chunk.paper_id}`
  }).join('\n')

  return `### Evidence Excerpts
Use these to support your responses. When discussing conversationally, paraphrase and cite by author name.
When inserting content with tool calls, use [E1], [E2] markers with CITATIONS block.

${visibleChunks}

<!-- INTERNAL REFERENCE (for CITATIONS block only - NEVER show in responses):
${internalMapping}
-->`
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format author names with "et al." suffix if needed.
 */
function formatAuthors(authors: string[] | undefined, maxAuthors: number): string {
  if (!authors || authors.length === 0) {
    return 'Unknown'
  }

  const displayedAuthors = authors.slice(0, maxAuthors).join(', ')
  const suffix = authors.length > maxAuthors ? ' et al.' : ''
  return `${displayedAuthors}${suffix}`
}

/**
 * Format a short citation like "Smith et al. (2023)" for conversational use.
 */
function formatShortCitation(paper: PaperForContext): string {
  const firstAuthor = paper.authors?.[0]?.split(',')[0] || 'Unknown'
  const etAl = (paper.authors?.length || 0) > 1 ? ' et al.' : ''
  const year = paper.year ? ` (${paper.year})` : ''
  return `${firstAuthor}${etAl}${year}`
}
