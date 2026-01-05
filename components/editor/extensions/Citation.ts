import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

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
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const authors = node.attrs.authors as string[]
    const year = node.attrs.year
    
    // Format: (Author et al., 2020) or (Author, 2020)
    const authorPart = authors.length > 0 
      ? authors[0].split(' ').pop() + (authors.length > 1 ? ' et al.' : '')
      : 'Unknown'
    
    const citationText = `(${authorPart}, ${year})`

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-citation': node.attrs.id,
        'data-type': 'citation',
        class: 'citation-inline cursor-pointer text-blue-600 hover:text-blue-800 hover:underline',
        title: node.attrs.title,
      }),
      citationText,
    ]
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
