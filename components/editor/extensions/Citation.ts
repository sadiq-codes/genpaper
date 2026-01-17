import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CitationNodeView, formatCitationByStyle, type CitationStyleType } from './CitationNodeView'

export interface CitationAttributes {
  id: string
  authors?: string[]
  title?: string
  year?: number
  journal?: string
  doi?: string
}

export interface CitationOptions {
  /** Citation style: apa, mla, chicago, ieee, harvard, etc. */
  citationStyle: CitationStyleType
  /** Map of paper IDs to citation numbers (for IEEE/Vancouver styles) */
  citationNumbers: Map<string, number>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationAttributes) => ReturnType
      setCitationStyle: (style: CitationStyleType) => ReturnType
    }
  }
}

/**
 * Generate citation text based on current style
 * Used for renderHTML (SSR) and renderText (clipboard)
 */
function formatCitation(attrs: CitationAttributes, style: CitationStyleType = 'apa'): string {
  return formatCitationByStyle(attrs, style)
}

export const Citation = Node.create<CitationOptions>({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      citationStyle: 'apa' as CitationStyleType,
      citationNumbers: new Map<string, number>(),
    }
  },

  addStorage() {
    return {
      citationStyle: this.options.citationStyle,
      citationNumbers: this.options.citationNumbers,
    }
  },

  addAttributes() {
    return {
      id: { default: null },
      authors: { default: [] },
      title: { default: '' },
      year: { default: null },
      journal: { default: null },
      doi: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-citation]',
        getAttrs: (dom) => {
          if (typeof dom === 'string') return {}
          const element = dom as HTMLElement
          return {
            id: element.getAttribute('data-citation'),
            authors: element.getAttribute('data-authors')
              ? JSON.parse(element.getAttribute('data-authors') || '[]')
              : [],
            title: element.getAttribute('data-title') || '',
            year: element.getAttribute('data-year')
              ? parseInt(element.getAttribute('data-year') || '0')
              : null,
            journal: element.getAttribute('data-journal') || null,
            doi: element.getAttribute('data-doi') || null,
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as CitationAttributes
    const style = this.storage?.citationStyle || this.options.citationStyle
    const citationNumber = this.storage?.citationNumbers?.get(attrs.id)
    const text = formatCitationByStyle(attrs, style, citationNumber)

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-citation': attrs.id,
        'data-type': 'citation',
        'data-authors': JSON.stringify(attrs.authors || []),
        'data-title': attrs.title || '',
        'data-year': attrs.year?.toString() || '',
        'data-journal': attrs.journal || '',
        'data-doi': attrs.doi || '',
        'class': 'citation-inline',
        'title': attrs.title || '',
      }),
      text,
    ]
  },

  // This is what gets copied to clipboard as plain text
  renderText({ node }) {
    const style = this.storage?.citationStyle || this.options.citationStyle
    const citationNumber = this.storage?.citationNumbers?.get(node.attrs.id)
    return formatCitationByStyle(node.attrs as CitationAttributes, style, citationNumber)
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView)
  },

  addCommands() {
    return {
      insertCitation: (attrs: CitationAttributes) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs,
        })
      },
      setCitationStyle: (style: CitationStyleType) => ({ editor }) => {
        // Update storage
        this.storage.citationStyle = style
        
        // Check if this is a numeric style (IEEE, Vancouver, Nature, etc.)
        const isNumericStyle = ['ieee', 'vancouver', 'nature', 'science', 'numbered']
          .some(s => style.toLowerCase().includes(s))
        
        // Build citation numbers for numeric styles
        if (isNumericStyle) {
          const numbers = new Map<string, number>()
          let counter = 1
          
          // Traverse document to assign numbers in order of appearance
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'citation') {
              const id = node.attrs.id
              if (id && !numbers.has(id)) {
                numbers.set(id, counter++)
              }
            }
          })
          
          this.storage.citationNumbers = numbers
        } else {
          // Clear numbers for non-numeric styles
          this.storage.citationNumbers = new Map<string, number>()
        }
        
        // Force re-render by dispatching a transaction
        // Using setMeta to mark this as a style change
        const tr = editor.state.tr.setMeta('citationStyleChange', style)
        editor.view.dispatch(tr)
        
        return true
      },
    }
  },
})
