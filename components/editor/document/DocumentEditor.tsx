'use client'

import { useCallback, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Image } from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import { PrimaryToolbar } from './PrimaryToolbar'
import { FloatingToolbar } from './FloatingToolbar'
import { Citation } from '../extensions/Citation'
import { Mathematics } from '../extensions/Mathematics'
import type { Editor } from '@tiptap/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import katex from 'katex'

interface DocumentEditorProps {
  initialContent?: string
  onUpdate?: (content: string) => void
  onEditorReady?: (editor: Editor) => void
  autocompleteEnabled: boolean
  onAutocompleteChange: (enabled: boolean) => void
  onInsertCitation: () => void
  onAiEdit: (text: string) => void
  onChat: (text: string) => void
}

const DEFAULT_CONTENT = `
<h1>Untitled Research Paper</h1>
<p>Start writing your research paper here...</p>
`

export function DocumentEditor({
  initialContent = DEFAULT_CONTENT,
  onUpdate,
  onEditorReady,
  autocompleteEnabled,
  onAutocompleteChange,
  onInsertCitation,
  onAiEdit,
  onChat,
}: DocumentEditorProps) {
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathLatex, setMathLatex] = useState('')
  const [mathDisplayMode, setMathDisplayMode] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 hover:text-blue-800 underline cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg my-4',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'bg-muted font-semibold border border-border p-2 text-left',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border p-2',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing your research paper...',
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Typography,
      Citation,
      Mathematics,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[calc(100vh-200px)] px-12 py-8',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML())
    },
    onCreate: ({ editor }) => {
      onEditorReady?.(editor)
    },
  })

  const handleInsertMath = useCallback(() => {
    setMathDialogOpen(true)
  }, [])

  const confirmInsertMath = useCallback(() => {
    if (editor && mathLatex) {
      editor.chain().focus().insertMath(mathLatex, mathDisplayMode).run()
      setMathLatex('')
      setMathDisplayMode(false)
      setMathDialogOpen(false)
    }
  }, [editor, mathLatex, mathDisplayMode])

  const renderMathPreview = () => {
    try {
      return katex.renderToString(mathLatex, {
        displayMode: mathDisplayMode,
        throwOnError: false,
      })
    } catch {
      return `<span class="text-red-500">${mathLatex}</span>`
    }
  }

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading editor...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <PrimaryToolbar
        editor={editor}
        autocompleteEnabled={autocompleteEnabled}
        onAutocompleteChange={onAutocompleteChange}
        onInsertCitation={onInsertCitation}
        onInsertMath={handleInsertMath}
      />
      
      <div className="flex-1 overflow-auto">
        <FloatingToolbar
          editor={editor}
          onAiEdit={onAiEdit}
          onInsertCitation={onInsertCitation}
          onChat={onChat}
        />
        <EditorContent editor={editor} className="h-full" />
      </div>

      {/* Math Input Dialog */}
      <Dialog open={mathDialogOpen} onOpenChange={setMathDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert Math Formula</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="latex">LaTeX Expression</Label>
              <Input
                id="latex"
                value={mathLatex}
                onChange={(e) => setMathLatex(e.target.value)}
                placeholder="e.g., E = mc^2"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="displayMode"
                checked={mathDisplayMode}
                onChange={(e) => setMathDisplayMode(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="displayMode">Display mode (block)</Label>
            </div>
            {mathLatex && (
              <div className="p-4 bg-muted rounded-lg text-center">
                <span className="text-sm text-muted-foreground">Preview:</span>
                <div 
                  className="mt-2"
                  dangerouslySetInnerHTML={{ __html: renderMathPreview() }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMathDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmInsertMath} disabled={!mathLatex}>
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
