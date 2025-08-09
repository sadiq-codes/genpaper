"use client"
import React, { useEffect, useState } from 'react'
import { isEditorDiffModeEnabled } from '@/lib/config/feature-flags'
import { CodeMirrorEditor } from '@/components/editor/CodeMirrorEditor'
// VersionStore calls will be made via API routes
import { toast } from 'sonner'

export default function GeneratePage() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    setEnabled(isEditorDiffModeEnabled())
  }, [])

  const handleSave = async (content: string) => {
    try {
      // For now, use a demo document ID - in real app this would come from route params
      const documentId = 'demo-document-id'
      
      const response = await fetch(`/api/documents/${documentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentMd: content,
          actor: 'user'
        })
      })

      if (!response.ok) {
        throw new Error(`Save failed: ${response.statusText}`)
      }

      const version = await response.json()

      toast.success(`Document saved successfully (Version ${version.id})`)
    } catch (error) {
      console.error('Failed to save:', error)
      toast.error(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  if (!enabled) {
    return <div className="p-6 text-sm text-muted-foreground">Editor diff mode is disabled.</div>
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="p-6 border-b">
        <h1 className="text-lg font-semibold">Diff-Driven Editor</h1>
        <p className="text-sm text-muted-foreground">
          CodeMirror 6 with Markdown support, citations, and AI-powered editing
        </p>
      </div>
      
      <div className="flex-1 p-6">
        <CodeMirrorEditor
          documentId="demo-document-id"
          onSave={handleSave}
          className="h-full"
        />
      </div>
    </div>
  )
}