import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CitationNodeView } from './CitationNodeView'

export interface CitationAttributes {
  id: string
  authors: string[]
  title: string
  year: number
  journal?: string
  doi?: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationAttributes) => ReturnType
    }
  }
}

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: {
        default: null,
      },
      authors: {
        default: [],
      },
      title: {
        default: '',
      },
      year: {
        default: null,
      },
      journal: {
        default: null,
      },
      doi: {
        default: null,
      },
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
            // Try to parse other attributes from data attributes if present
            authors: element.getAttribute('data-authors') 
              ? JSON.parse(element.getAttribute('data-authors') || '[]') 
              : [],
            title: element.getAttribute('data-title') || element.getAttribute('title') || '',
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
    const authors = node.attrs.authors as string[]
    const year = node.attrs.year
    
    // Format: (Author et al., 2020) or (Author, 2020)
    const authorPart = authors?.length > 0 
      ? authors[0].split(' ').pop() + (authors.length > 1 ? ' et al.' : '')
      : 'Unknown'
    
    const citationText = `(${authorPart}, ${year || 'n.d.'})`

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-citation': node.attrs.id,
        'data-type': 'citation',
        'data-authors': JSON.stringify(node.attrs.authors),
        'data-title': node.attrs.title,
        'data-year': node.attrs.year?.toString(),
        'data-journal': node.attrs.journal,
        'data-doi': node.attrs.doi,
        class: 'citation-inline',
        title: node.attrs.title,
      }),
      citationText,
    ]
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
    }
  },
})
