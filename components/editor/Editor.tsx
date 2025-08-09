'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { 
  FileText, 
  Edit3, 
  Zap, 
  Save,
  Download,
  Eye,
  Sparkles,
  MessageSquare,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { HunkList } from './HunkList'
import { DiffOverlay } from '@/lib/ui/DiffOverlay'
import type { CSLItem } from '@/lib/utils/csl'
import type { EditOp, EditProposal } from '@/lib/schemas/edits'

// AI Command types
interface AICommand {
  label: string
  description: string
  icon: React.ReactNode
  action: string
}

interface AIProgress {
  isGenerating: boolean
  progress: number
  message: string
}

interface EditorProps {
  className?: string
  initialContent?: string
  documentId: string
  initialTopic?: string
  onSave?: (content: string) => void
  citations?: Map<string, CSLItem>
}

const AI_COMMANDS: AICommand[] = [
  {
    label: 'Write',
    description: 'Generate new content from scratch',
    icon: <Edit3 className="h-4 w-4" />,
    action: 'write'
  },
  {
    label: 'Rewrite',
    description: 'Improve and refine selected text',
    icon: <RefreshCw className="h-4 w-4" />,
    action: 'rewrite'
  },
  {
    label: 'Expand',
    description: 'Add more detail to selected content',
    icon: <Zap className="h-4 w-4" />,
    action: 'expand'
  },
  {
    label: 'Summarize',
    description: 'Condense selected text',
    icon: <FileText className="h-4 w-4" />,
    action: 'summarize'
  },
  {
    label: 'Comment',
    description: 'Add analysis or commentary',
    icon: <MessageSquare className="h-4 w-4" />,
    action: 'comment'
  },
  {
    label: 'Outline',
    description: 'Generate section outline',
    icon: <Sparkles className="h-4 w-4" />,
    action: 'outline'
  }
]

export default function Editor({ 
  className, 
  initialContent = '', 
  documentId,
  initialTopic = '',
  onSave,
  citations = new Map()
}: EditorProps) {
  const [topic, setTopic] = useState(initialTopic)
  const [content, setContent] = useState(initialContent)
  const [baseSha, setBaseSha] = useState<string>('')
  const [currentProposal, setCurrentProposal] = useState<EditProposal | null>(null)
  const [acceptedOperations, setAcceptedOperations] = useState<Set<string>>(new Set())
  const [aiProgress, setAiProgress] = useState<AIProgress>({
    isGenerating: false,
    progress: 0,
    message: ''
  })
  const [showAICommands, setShowAICommands] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleSave = useCallback(async (newContent: string) => {
    setContent(newContent)
    onSave?.(newContent)
  }, [onSave])

  const handleAICommand = useCallback(async (action: string, selection?: { start: number; end: number }) => {
    if (!documentId || !baseSha) {
      toast.error('Document not ready for AI commands')
      return
    }

    setAiProgress({ isGenerating: true, progress: 20, message: `Generating ${action}...` })
    
    try {
      // Abort any ongoing generation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()

      const response = await fetch('/api/edits/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          baseSha,
          prompt: `${action}: ${topic || 'Improve the content'}`,
          selection,
          model: 'gpt-4'
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`AI command failed: ${response.statusText}`)
      }

      const proposal: EditProposal = await response.json()
      setCurrentProposal(proposal)
      setAcceptedOperations(new Set()) // Reset selections
      
      setAiProgress({ isGenerating: false, progress: 100, message: 'Proposal ready for review' })
      toast.success(`${action} proposal generated with ${proposal.operations.length} edits`)
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setAiProgress({ isGenerating: false, progress: 0, message: '' })
        return
      }
      
      console.error('AI command failed:', error)
      toast.error(`${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setAiProgress({ isGenerating: false, progress: 0, message: '' })
    }
  }, [documentId, baseSha, topic])

  const handleApplyEdits = useCallback(async () => {
    if (!currentProposal || acceptedOperations.size === 0) {
      toast.error('No edits selected to apply')
      return
    }

    try {
      const selectedOps = currentProposal.operations.filter(op => acceptedOperations.has(op.id))
      
      const response = await fetch('/api/edits/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          baseSha: currentProposal.baseSha,
          operations: selectedOps
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Apply failed')
      }

      const result = await response.json()
      
      // Fetch the new content
      const latestResponse = await fetch(`/api/documents/${documentId}/latest`)
      const latest = await latestResponse.json()
      
      setContent(latest.content_md)
      setBaseSha(latest.sha)
      setCurrentProposal(null)
      setAcceptedOperations(new Set())
      
      toast.success(`Applied ${selectedOps.length} edits (Version ${result.newVersionId})`)
      
    } catch (error) {
      console.error('Apply edits failed:', error)
      toast.error(`Apply failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [currentProposal, acceptedOperations, documentId])

  const handleToggleOperation = useCallback((opId: string) => {
    setAcceptedOperations(prev => {
      const next = new Set(prev)
      if (next.has(opId)) {
        next.delete(opId)
      } else {
        next.add(opId)
      }
      return next
    })
  }, [])

  const handleCancelProposal = useCallback(() => {
    setCurrentProposal(null)
    setAcceptedOperations(new Set())
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setAiProgress({ isGenerating: false, progress: 0, message: '' })
  }, [])

  // Load initial document version
  useEffect(() => {
    const loadDocument = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/latest`)
        const latest = await response.json()
        setContent(latest.content_md)
        setBaseSha(latest.sha)
      } catch (error) {
        console.error('Failed to load document:', error)
      }
    }

    if (documentId) {
      loadDocument()
    }
  }, [documentId])

  return (
    <div className={`flex h-screen ${className}`}>
      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <h2 className="text-lg font-semibold">Document Editor</h2>
                <p className="text-sm text-muted-foreground">
                  AI-powered collaborative editing with diff review
                </p>
              </div>
              {topic && (
                <Badge variant="outline" className="text-xs">
                  {topic}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAICommands(!showAICommands)}
                disabled={aiProgress.isGenerating}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                AI Commands
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave(content)}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </div>

          {/* AI Progress */}
          {aiProgress.isGenerating && (
            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LoadingSpinner size="sm" />
                  <span className="text-sm text-blue-800">{aiProgress.message}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelProposal}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* AI Commands Panel */}
          {showAICommands && !aiProgress.isGenerating && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg border">
              <div className="grid grid-cols-3 gap-2">
                {AI_COMMANDS.map((command) => (
                  <Button
                    key={command.action}
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      handleAICommand(command.action)
                      setShowAICommands(false)
                    }}
                  >
                    {command.icon}
                    <div className="ml-2 text-left">
                      <div className="font-medium">{command.label}</div>
                      <div className="text-xs text-muted-foreground">{command.description}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 relative">
          <CodeMirrorEditor
            documentId={documentId}
            onSave={handleSave}
            className="h-full"
          />
          
          {/* Diff Overlay */}
          {currentProposal && (
            <div className="absolute inset-0 bg-white/90 backdrop-blur-sm">
              <div className="h-full p-4">
                <DiffOverlay
                  baseText={content}
                  operations={currentProposal.operations}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar - Diff Review */}
      {currentProposal && (
        <div className="w-80 border-l bg-background flex flex-col">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Proposed Changes</h3>
            <p className="text-sm text-muted-foreground">
              Review and accept/reject individual edits
            </p>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto">
            <HunkList
              operations={currentProposal.operations}
              acceptedIds={acceptedOperations}
              onToggle={handleToggleOperation}
            />
          </div>
          
          <div className="p-4 border-t">
            <div className="flex gap-2">
              <Button
                onClick={handleApplyEdits}
                disabled={acceptedOperations.size === 0}
                className="flex-1"
              >
                Apply {acceptedOperations.size} Changes
              </Button>
              <Button
                variant="outline"
                onClick={handleCancelProposal}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}