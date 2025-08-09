import { RangeSetBuilder, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

// Mark decoration for citation placeholders and resolved citations
const citePlaceholderMark = Decoration.mark({ 
  class: 'bg-blue-50 border border-blue-200 rounded px-1 text-blue-800' 
})

const citeResolvedMark = Decoration.mark({ 
  class: 'bg-amber-50 border border-amber-200 rounded px-1 text-amber-800' 
})

export const citationDecorations = StateField.define({
  create(state) { 
    return buildDecorations(state) 
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) {
      decorations = decorations.map(tr.changes)
    }
    if (tr.docChanged) {
      decorations = buildDecorations(tr.state)
    }
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

function buildDecorations(state: any) {
  const builder = new RangeSetBuilder<Decoration>()
  const text = state.doc.toString()
  
  // Match citation placeholders: [[CITE:doi:10.1234]] or [[CITE:title:Some Paper]]
  const placeholderRegex = /\[\[CITE:[^\]]+\]\]/g
  let match
  while ((match = placeholderRegex.exec(text))) {
    builder.add(match.index, match.index + match[0].length, citePlaceholderMark)
  }
  
  // Match resolved citations: (Author, Year) or [1] style
  const resolvedRegex = /\([A-Za-z][^,)]+,\s*\d{4}[a-z]?\)/g
  let resolvedMatch
  while ((resolvedMatch = resolvedRegex.exec(text))) {
    builder.add(resolvedMatch.index, resolvedMatch.index + resolvedMatch[0].length, citeResolvedMark)
  }
  
  return builder.finish()
}