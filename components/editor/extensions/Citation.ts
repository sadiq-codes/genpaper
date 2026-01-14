import { Node, mergeAttributes } from '@tiptap/core'

export interface CitationAttributes {
  id: string
  authors?: string[]
  title?: string
  year?: number
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

/**
 * Generate APA-style citation text from attributes
 */
function formatCitation(attrs: CitationAttributes): string {
  const authors = attrs.authors || []
  const year = attrs.year

  if (authors.length === 0) {
    return `(${year || 'n.d.'})`
  }

  // Extract last name from first author
  const firstAuthor = authors[0]
  const lastName = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : firstAuthor.split(' ').pop() || firstAuthor

  if (authors.length === 1) {
    return `(${lastName}, ${year || 'n.d.'})`
  } else if (authors.length === 2) {
    const secondAuthor = authors[1]
    const lastName2 = secondAuthor.includes(',')
      ? secondAuthor.split(',')[0].trim()
      : secondAuthor.split(' ').pop() || secondAuthor
    return `(${lastName} & ${lastName2}, ${year || 'n.d.'})`
  } else {
    return `(${lastName} et al., ${year || 'n.d.'})`
  }
}

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

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
    const text = formatCitation(attrs)

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
    return formatCitation(node.attrs as CitationAttributes)
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
