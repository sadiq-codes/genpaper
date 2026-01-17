'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { FileText } from 'lucide-react'

// =============================================================================
// TYPES
// =============================================================================

export interface PaperMentionAttrs {
  paperId: string
  title: string
  authors: string
  year: number | null
}

export interface MentionedPaper {
  id: string
  title: string
  authors: string[]
  year?: number
}

// =============================================================================
// NODE VIEW COMPONENT
// =============================================================================

function PaperMentionNodeView({ node }: NodeViewProps) {
  const attrs = node.attrs as PaperMentionAttrs
  const { title, authors, year } = attrs
  
  // Format display: "Author et al. (2024)" or just "Title" if no authors
  const authorPart = authors || 'Unknown'
  const yearPart = year ? ` (${year})` : ''
  const displayText = `${authorPart}${yearPart}`
  
  return (
    <NodeViewWrapper as="span" className="paper-mention-wrapper">
      <span
        className="paper-mention"
        title={title}
        contentEditable={false}
      >
        <FileText className="h-3 w-3 inline-block mr-0.5 -mt-0.5" />
        <span className="paper-mention-text">{displayText}</span>
      </span>
    </NodeViewWrapper>
  )
}

// =============================================================================
// TIPTAP EXTENSION
// =============================================================================

export const PaperMentionPluginKey = new PluginKey('paperMention')

export interface PaperMentionOptions {
  suggestion: Omit<SuggestionOptions<MentionedPaper>, 'editor'>
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paperMention: {
      /**
       * Insert a paper mention
       */
      insertPaperMention: (paper: MentionedPaper) => ReturnType
    }
  }
}

export const PaperMention = Node.create<PaperMentionOptions>({
  name: 'paperMention',

  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '@',
        pluginKey: PaperMentionPluginKey,
        command: ({ editor, range, props }) => {
          // Replace the @ query with the mention node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertPaperMention(props)
            .run()
        },
        allow: ({ state, range }) => {
          // Allow mentions anywhere
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name !== 'codeBlock'
        },
      },
    }
  },

  addAttributes() {
    return {
      paperId: {
        default: null,
        parseHTML: element => element.getAttribute('data-paper-id'),
        renderHTML: attributes => ({
          'data-paper-id': attributes.paperId,
        }),
      },
      title: {
        default: null,
        parseHTML: element => element.getAttribute('data-title'),
        renderHTML: attributes => ({
          'data-title': attributes.title,
        }),
      },
      authors: {
        default: null,
        parseHTML: element => element.getAttribute('data-authors'),
        renderHTML: attributes => ({
          'data-authors': attributes.authors,
        }),
      },
      year: {
        default: null,
        parseHTML: element => {
          const year = element.getAttribute('data-year')
          return year ? parseInt(year, 10) : null
        },
        renderHTML: attributes => ({
          'data-year': attributes.year?.toString() || null,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="paper-mention"]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { authors, year, title } = node.attrs
    const displayText = authors 
      ? `@${authors}${year ? ` (${year})` : ''}`
      : `@${title?.slice(0, 30) || 'Paper'}...`
    
    return [
      'span',
      mergeAttributes(
        { 'data-type': 'paper-mention', class: 'paper-mention' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      displayText,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperMentionNodeView)
  },

  addCommands() {
    return {
      insertPaperMention:
        (paper: MentionedPaper) =>
        ({ commands }) => {
          // Format authors for display
          const authorDisplay = paper.authors.length > 0
            ? paper.authors.length === 1
              ? paper.authors[0]
              : `${paper.authors[0]} et al.`
            : 'Unknown'

          return commands.insertContent({
            type: this.name,
            attrs: {
              paperId: paper.id,
              title: paper.title,
              authors: authorDisplay,
              year: paper.year || null,
            },
          })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Extract all mentioned paper IDs from editor JSON content
 */
export function extractMentionedPaperIds(json: Record<string, unknown>): string[] {
  const paperIds: string[] = []
  
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'paperMention' && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>
      if (attrs.paperId && typeof attrs.paperId === 'string') {
        paperIds.push(attrs.paperId)
      }
    }
    
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child as Record<string, unknown>)
      }
    }
  }
  
  traverse(json)
  return [...new Set(paperIds)] // Deduplicate
}

/**
 * Extract mentioned papers with full details from editor JSON content
 */
export function extractMentionedPapers(json: Record<string, unknown>): PaperMentionAttrs[] {
  const papers: PaperMentionAttrs[] = []
  const seenIds = new Set<string>()
  
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'paperMention' && node.attrs) {
      const attrs = node.attrs as PaperMentionAttrs
      if (attrs.paperId && !seenIds.has(attrs.paperId)) {
        seenIds.add(attrs.paperId)
        papers.push(attrs)
      }
    }
    
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child as Record<string, unknown>)
      }
    }
  }
  
  traverse(json)
  return papers
}
