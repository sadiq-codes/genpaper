import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import CitationNodeView from './CitationNodeView'

export interface CitationOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      /**
       * Insert a citation at the current position
       */
      insertCitation: (citationId: string, displayText?: string) => ReturnType
      /**
       * Update an existing citation
       */
      updateCitation: (citationId: string, displayText: string) => ReturnType
    }
  }
}

export const Citation = Node.create<CitationOptions>({
  name: 'citation',

  group: 'inline',

  inline: true,

  draggable: false,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      citationId: {
        default: null,
        parseHTML: element => element.getAttribute('data-citation-id'),
        renderHTML: attributes => {
          if (!attributes.citationId) {
            return {}
          }
          return {
            'data-citation-id': attributes.citationId,
          }
        },
      },
      displayText: {
        default: null,
        parseHTML: element => element.getAttribute('data-display-text'),
        renderHTML: attributes => {
          if (!attributes.displayText) {
            return {}
          }
          return {
            'data-display-text': attributes.displayText,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-citation-id]',
      },
      {
        tag: 'cite[data-citation-id]',
      },
      // Parse existing [CITE:id] format
      {
        tag: 'span',
        getAttrs: (node) => {
          if (typeof node === 'string') return false
          const element = node as HTMLElement
          const text = element.textContent || ''
          const match = text.match(/^\[CITE:([^\]]+)\]$/)
          if (match) {
            return {
              citationId: match[1],
              displayText: text,
            }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const citationId = node.attrs.citationId
    const displayText = node.attrs.displayText || `[${citationId.substring(0, 8)}...]`
    
    return [
      'span',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          'data-citation-id': citationId,
          'data-display-text': displayText,
          'class': 'inline-citation',
          'contenteditable': 'false',
        }
      ),
      displayText,
    ]
  },

  renderText({ node }) {
    // For plain text export, use the original format
    return `[CITE:${node.attrs.citationId}]`
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView)
  },

  addCommands() {
    return {
      insertCitation: (citationId: string, displayText?: string) => ({ commands }) => {
        const attrs = {
          citationId,
          displayText: displayText || `[${citationId.substring(0, 8)}...]`,
        }
        
        return commands.insertContent({
          type: this.name,
          attrs,
        })
      },

      updateCitation: (citationId: string, displayText: string) => ({ tr, state }) => {
        const { doc } = state
        let updated = false

        doc.descendants((node, pos) => {
          if (node.type.name === this.name && node.attrs.citationId === citationId) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              displayText,
            })
            updated = true
          }
        })

        return updated
      },
    }
  },

  // Convert existing [CITE:id] text to citation nodes
  addInputRules() {
    return [
      {
        find: /\[CITE:([^\]]+)\]/g,
        handler: ({ state, range, match }) => {
          const [fullMatch, citationId] = match
          const { tr } = state
          const start = range.from
          const end = range.to

          tr.replaceWith(start, end, this.type.create({
            citationId,
            displayText: fullMatch,
          }))
        },
      },
    ]
  },
}) 