import { Extension, StateField } from '@codemirror/state'
import { EditorView, showTooltip, Tooltip } from '@codemirror/view'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { openCiteDialogEffect } from './citeBridge'

// Bubble menu component
function BubbleMenuContent({ view }: { view: EditorView }) {
  const onCite = () => {
    view.dispatch({ effects: openCiteDialogEffect.of(null) })
  }

  const onBold = () => {
    const selection = view.state.selection.main
    if (selection.empty) return
    
    const selectedText = view.state.doc.sliceString(selection.from, selection.to)
    const boldText = `**${selectedText}**`
    
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: boldText },
      selection: { anchor: selection.from + 2, head: selection.from + 2 + selectedText.length }
    })
  }

  const onItalic = () => {
    const selection = view.state.selection.main
    if (selection.empty) return
    
    const selectedText = view.state.doc.sliceString(selection.from, selection.to)
    const italicText = `*${selectedText}*`
    
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: italicText },
      selection: { anchor: selection.from + 1, head: selection.from + 1 + selectedText.length }
    })
  }

  return (
    <div className="flex items-center gap-1 rounded-xl border bg-white shadow-lg p-1">
      <button 
        className="px-2 py-1 text-sm hover:bg-gray-100 rounded font-semibold" 
        onClick={onBold}
        title="Bold (Mod+B)"
      >
        B
      </button>
      <button 
        className="px-2 py-1 text-sm hover:bg-gray-100 rounded italic" 
        onClick={onItalic}
        title="Italic (Mod+I)"
      >
        I
      </button>
      <div className="w-px h-4 bg-gray-300 mx-1" />
      <button 
        className="px-2 py-1 text-sm hover:bg-gray-100 rounded" 
        onClick={onCite}
        title="Add Citation (Mod+K)"
      >
        Cite
      </button>
    </div>
  )
}

// Imperative renderer for React inside a CM tooltip
function renderBubble(view: EditorView) {
  const dom = document.createElement('div')
  const root = ReactDOM.createRoot(dom)
  
  root.render(<BubbleMenuContent view={view} />)
  
  return { 
    dom, 
    destroy: () => root.unmount() 
  }
}

const bubbleField = StateField.define<Tooltip | null>({
  create() { 
    return null 
  },
  update(value, tr) {
    // Hide if selection became empty or doc changed in a way that invalidates pos
    if (tr.selection) {
      const sel = tr.state.selection.main
      if (!sel.empty) {
        return {
          pos: sel.from,
          end: sel.to,
          above: true,
          strictSide: false,
          create: (view: EditorView) => renderBubble(view),
        }
      }
    }
    if (tr.docChanged) return null
    return value
  },
  provide: f => showTooltip.from(f)
})

export function bubbleMenu(): Extension { 
  return [bubbleField] 
}