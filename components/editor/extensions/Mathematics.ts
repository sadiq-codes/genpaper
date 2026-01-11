import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

export interface MathAttributes {
  latex: string
  displayMode: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathematics: {
      insertMath: (latex: string, displayMode?: boolean) => ReturnType
    }
  }
}

export const Mathematics = Node.create({
  name: 'mathematics',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
      },
      displayMode: {
        default: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-math]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = node.attrs.latex as string
    const displayMode = node.attrs.displayMode as boolean

    let rendered = ''
    try {
      rendered = katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        output: 'html',
      })
    } catch {
      rendered = `<span class="text-red-500">${latex}</span>`
    }

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-math': 'true',
        'data-latex': latex,
        'data-display-mode': displayMode ? 'true' : 'false',
        class: displayMode ? 'block my-4 text-center' : 'inline-block',
      }),
      rendered,
    ]
  },

  addCommands() {
    return {
      insertMath: (latex: string, displayMode = false) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: {
            latex,
            displayMode,
          },
        })
      },
    }
  },
})
