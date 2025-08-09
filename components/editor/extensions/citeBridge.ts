import { StateEffect, StateField } from '@codemirror/state'

// Effects to open/close the citation dialog
export const openCiteDialogEffect = StateEffect.define<null>()
export const closeCiteDialogEffect = StateEffect.define<null>()

// Store minimal UI state in editor
export const citeUIState = StateField.define<{ open: boolean }>({
  create: () => ({ open: false }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openCiteDialogEffect)) return { open: true }
      if (effect.is(closeCiteDialogEffect)) return { open: false }
    }
    return value
  }
})