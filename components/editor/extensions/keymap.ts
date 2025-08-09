import { keymap } from '@codemirror/view'
import { openCiteDialogEffect } from './citeBridge'

export function editorKeymap(onSave?: (content: string) => void) {
  return keymap.of([
    // Mod-K to open citation dialog
    {
      key: 'Mod-k',
      run(view) {
        view.dispatch({ effects: openCiteDialogEffect.of(null) })
        return true
      }
    },
    // Mod-S to save
    {
      key: 'Mod-s',
      run(view) {
        if (onSave) {
          const content = view.state.doc.toString()
          onSave(content)
        }
        return true
      }
    }
  ])
}