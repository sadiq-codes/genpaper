'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, minimalSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
// Note: VersionStore will be called from client, but it's server-only
// We'll need to create an API route for this
import { bubbleMenu } from './extensions/bubbleMenu'
import { editorKeymap } from './extensions/keymap'
import { citationDecorations } from './extensions/citationDecorations'
import { citeUIState } from './extensions/citeBridge'
import { CiteDialog } from './CiteDialog'

interface CodeMirrorEditorProps {
  documentId: string
  className?: string
  onSave?: (content: string) => void
}

export function CodeMirrorEditor({ documentId, className = '', onSave }: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    let mounted = true

    const initEditor = async () => {
      try {
        // Load latest version from server via API
        const response = await fetch(`/api/documents/${documentId}/latest`)
        const latest = await response.json()
        
        if (!mounted) return

        const state = EditorState.create({
          doc: latest.content_md || '# New Document\n\nStart writing here...',
          extensions: [
            minimalSetup,
            markdown(),
            editorKeymap(onSave),
            bubbleMenu(),
            citeUIState,
            citationDecorations,
            // Add theme based on user preference or system
            // oneDark, 
          ],
        })

        viewRef.current = new EditorView({
          state,
          parent: editorRef.current!
        })

        setLoading(false)
      } catch (err) {
        console.error('Failed to initialize editor:', err)
        setError(err instanceof Error ? err.message : 'Failed to load editor')
        setLoading(false)
      }
    }

    initEditor()

    return () => {
      mounted = false
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [documentId])

  const handleSave = () => {
    if (!viewRef.current) return
    const content = viewRef.current.state.doc.toString()
    onSave?.(content)
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-muted-foreground">Loading editor...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  return (
    <>
      <div 
        ref={editorRef} 
        className={`border rounded-lg overflow-hidden ${className}`}
      />
      <CiteDialog editorView={viewRef.current} />
    </>
  )
}