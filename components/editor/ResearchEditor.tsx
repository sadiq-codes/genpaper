'use client'

import { useState, useCallback, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorTopNav } from './EditorTopNav'
import { EditorSidebar } from './sidebar/EditorSidebar'
import { DocumentEditor } from './document/DocumentEditor'
import LibraryDrawer from '@/components/ui/library-drawer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight, Menu, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { 
  ChatMessage, 
  ProjectPaper, 
  Citation, 
  ExtractedClaim, 
  ResearchGap,
  AnalysisState,
  AnalysisOutput,
} from './types'
import { cn } from '@/lib/utils'

interface ResearchEditorProps {
  projectId?: string
  projectTitle?: string
  initialContent?: string
  initialPapers?: ProjectPaper[]
  initialAnalysis?: {
    claims: ExtractedClaim[]
    gaps: ResearchGap[]
    synthesis: AnalysisOutput | null
  }
  onSave?: (content: string) => void
}

export function ResearchEditor({
  projectId,
  projectTitle = 'Untitled Document',
  initialContent,
  initialPapers = [],
  initialAnalysis,
  onSave,
}: ResearchEditorProps) {
  // Editor state
  const [editor, setEditor] = useState<Editor | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'chat' | 'research'>('research')
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(true)
  
  // Mobile state
  const [isMobile, setIsMobile] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isChatLoading, setIsChatLoading] = useState(false)
  
  // Library state
  const [papers, setPapers] = useState<ProjectPaper[]>(initialPapers)
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false)
  
  // Analysis state
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: initialAnalysis ? 'complete' : 'idle',
    claims: initialAnalysis?.claims || [],
    gaps: initialAnalysis?.gaps || [],
    synthesis: initialAnalysis?.synthesis || null,
  })
  
  // Remove paper confirmation dialog
  const [removePaperDialog, setRemovePaperDialog] = useState<{
    open: boolean
    paperId: string
    paperTitle: string
    claimCount: number
  }>({ open: false, paperId: '', paperTitle: '', claimCount: 0 })
  
  // Content state for auto-save
  const [content, setContent] = useState(initialContent || '')

  // Check for mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      if (window.innerWidth < 768) {
        setSidebarOpen(false)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Auto-run analysis on mount if papers exist but no analysis
  useEffect(() => {
    if (
      projectId && 
      papers.length > 0 && 
      analysisState.status === 'idle' &&
      analysisState.claims.length === 0
    ) {
      handleRunAnalysis()
    }
  }, [projectId, papers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save effect
  useEffect(() => {
    if (!projectId || !content) return
    
    const timer = setTimeout(async () => {
      try {
        await fetch('/api/editor/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, content }),
        })
        onSave?.(content)
      } catch (error) {
        console.error('Auto-save failed:', error)
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [content, projectId, onSave])

  // Run analysis
  const handleRunAnalysis = useCallback(async () => {
    if (!projectId || papers.length === 0) return

    setAnalysisState(prev => ({ ...prev, status: 'analyzing' }))

    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          paperIds: papers.map(p => p.id),
          topic: projectTitle,
          analysisType: 'full',
        }),
      })

      if (!response.ok) throw new Error('Analysis failed')

      // Refetch analysis data
      const analysisResponse = await fetch(`/api/analysis?projectId=${projectId}`)
      if (analysisResponse.ok) {
        const data = await analysisResponse.json()
        
        // Flatten claims and add paper info
        const allClaims: ExtractedClaim[] = []
        for (const paperId of Object.keys(data.claims || {})) {
          const paper = papers.find(p => p.id === paperId)
          const paperClaims = (data.claims[paperId] || []).map((claim: ExtractedClaim) => ({
            ...claim,
            paper_title: paper?.title,
            paper_authors: paper?.authors,
            paper_year: paper?.year,
          }))
          allClaims.push(...paperClaims)
        }

        setAnalysisState({
          status: 'complete',
          claims: allClaims,
          gaps: data.gaps || [],
          synthesis: data.analyses?.find((a: AnalysisOutput) => a.analysis_type === 'synthesis') || null,
          lastAnalyzedAt: new Date().toISOString(),
        })

        toast.success('Analysis complete', {
          description: `${allClaims.length} claims extracted, ${(data.gaps || []).length} gaps found`,
        })
      }
    } catch (error) {
      console.error('Analysis failed:', error)
      setAnalysisState(prev => ({ 
        ...prev, 
        status: 'error',
        error: error instanceof Error ? error.message : 'Analysis failed',
      }))
      toast.error('Analysis failed', {
        description: 'Please try again',
      })
    }
  }, [projectId, papers, projectTitle])

  // Handle adding paper from library drawer
  const handleAddPaperToProject = useCallback(async (paperId: string, title: string) => {
    if (!projectId) return

    try {
      const response = await fetch('/api/editor/papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, paperId }),
      })

      const data = await response.json()

      if (response.status === 409) {
        toast.info('Paper already in project')
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add paper')
      }

      // Update local state
      setPapers(prev => [...prev, data.paper])
      
      // Close drawer
      setLibraryDrawerOpen(false)

      // Show toast with action to re-analyze
      toast.success('Paper added to project', {
        description: title.slice(0, 50) + (title.length > 50 ? '...' : ''),
        action: {
          label: 'Re-analyze',
          onClick: () => handleRunAnalysis(),
        },
      })
    } catch (error) {
      console.error('Error adding paper:', error)
      toast.error('Failed to add paper')
    }
  }, [projectId, handleRunAnalysis])

  // Handle removing paper from project
  const handleRemovePaper = useCallback((paperId: string, claimCount: number) => {
    const paper = papers.find(p => p.id === paperId)
    if (!paper) return

    setRemovePaperDialog({
      open: true,
      paperId,
      paperTitle: paper.title,
      claimCount,
    })
  }, [papers])

  const confirmRemovePaper = useCallback(async (deleteClaims: boolean) => {
    if (!projectId) return

    const { paperId, paperTitle } = removePaperDialog

    try {
      const response = await fetch(
        `/api/editor/papers?projectId=${projectId}&paperId=${paperId}&deleteClaims=${deleteClaims}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        throw new Error('Failed to remove paper')
      }

      const data = await response.json()

      // Update local state
      setPapers(prev => prev.filter(p => p.id !== paperId))
      
      // Remove claims from this paper if they were deleted
      if (deleteClaims) {
        setAnalysisState(prev => ({
          ...prev,
          claims: prev.claims.filter(c => c.paper_id !== paperId),
        }))
      }

      toast.success('Paper removed', {
        description: data.claimsDeleted > 0 
          ? `${data.claimsDeleted} claims also removed`
          : undefined,
      })
    } catch (error) {
      console.error('Error removing paper:', error)
      toast.error('Failed to remove paper')
    } finally {
      setRemovePaperDialog({ open: false, paperId: '', paperTitle: '', claimCount: 0 })
    }
  }, [projectId, removePaperDialog])

  // Handle sending chat message
  const handleSendMessage = useCallback(async (messageContent: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    }
    setChatMessages(prev => [...prev, userMessage])
    setIsChatLoading(true)

    try {
      const response = await fetch('/api/editor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: messageContent,
          documentContent: editor?.getHTML() || '',
          papers: papers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract })),
          claims: analysisState.claims.slice(0, 20),
          gaps: analysisState.gaps,
        }),
      })

      if (!response.ok) throw new Error('Failed to get AI response')

      const data = await response.json()
      
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        citations: data.citations,
      }
      setChatMessages(prev => [...prev, assistantMessage])

      if (data.edits && editor) {
        data.edits.forEach((edit: { type: string; content: string }) => {
          if (edit.type === 'insert') {
            editor.chain().focus().insertContent(edit.content).run()
          }
        })
      }
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }
      setChatMessages(prev => [...prev, errorMessage])
    } finally {
      setIsChatLoading(false)
    }
  }, [projectId, editor, papers, analysisState.claims, analysisState.gaps])

  // Handle AI edit from floating toolbar
  const handleAiEdit = useCallback((selectedText: string) => {
    setActiveTab('chat')
    if (isMobile) setMobileMenuOpen(true)
    handleSendMessage(`Please help me improve this text: "${selectedText}"`)
  }, [handleSendMessage, isMobile])

  // Handle chat from floating toolbar
  const handleChatFromToolbar = useCallback((selectedText: string) => {
    setActiveTab('chat')
    if (isMobile) setMobileMenuOpen(true)
    handleSendMessage(`I have a question about: "${selectedText}"`)
  }, [handleSendMessage, isMobile])

  // Handle citation insertion
  const handleInsertCitation = useCallback((citation: Citation) => {
    if (!editor) return
    editor.chain().focus().insertCitation(citation).run()
    if (isMobile) setMobileMenuOpen(false)
  }, [editor, isMobile])

  // Handle inserting a claim as plain text with citation
  const handleInsertClaim = useCallback((claim: ExtractedClaim) => {
    if (!editor) return
    
    const authorName = claim.paper_authors?.[0]?.split(' ').pop() || 'Unknown'
    const year = claim.paper_year || 'n.d.'
    const hasMultipleAuthors = claim.paper_authors && claim.paper_authors.length > 1
    const citationText = ` (${authorName}${hasMultipleAuthors ? ' et al.' : ''}, ${year})`
    
    editor.chain()
      .focus()
      .insertContent(claim.claim_text + citationText + ' ')
      .run()
    
    if (isMobile) setMobileMenuOpen(false)
  }, [editor, isMobile])

  // Handle inserting a gap
  const handleInsertGap = useCallback((gap: ResearchGap) => {
    if (!editor) return
    
    let gapText: string
    switch (gap.gap_type) {
      case 'unstudied':
        gapText = `Further research is needed to explore ${gap.description.toLowerCase()}`
        break
      case 'contradiction':
        gapText = `There are conflicting findings regarding ${gap.description.toLowerCase()}`
        break
      case 'limitation':
        gapText = `Current research is limited by ${gap.description.toLowerCase()}`
        break
      default:
        gapText = gap.description
    }
    
    editor.chain()
      .focus()
      .insertContent(gapText + '. ')
      .run()
    
    if (isMobile) setMobileMenuOpen(false)
  }, [editor, isMobile])

  // Handle export
  const handleExport = useCallback(async (format: 'pdf' | 'docx' | 'latex') => {
    if (!editor) return

    try {
      const response = await fetch('/api/editor/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          content: editor.getHTML(),
          title: projectTitle,
        }),
      })

      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectTitle}.${format === 'latex' ? 'tex' : format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Export failed')
    }
  }, [editor, projectTitle])

  // Sidebar content for both desktop and mobile
  const sidebarContent = (
    <EditorSidebar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      chatMessages={chatMessages}
      onSendMessage={handleSendMessage}
      isChatLoading={isChatLoading}
      papers={papers}
      analysisState={analysisState}
      onInsertCitation={handleInsertCitation}
      onInsertClaim={handleInsertClaim}
      onInsertGap={handleInsertGap}
      onRunAnalysis={handleRunAnalysis}
      onOpenLibrary={() => setLibraryDrawerOpen(true)}
      onRemovePaper={handleRemovePaper}
    />
  )

  return (
    <div className="h-screen w-full flex flex-col rounded-3xl border-2 border-foreground/10 overflow-hidden bg-background">
      {/* Top Navigation */}
      <EditorTopNav
        projectTitle={projectTitle}
        onExport={handleExport}
        onPublish={() => toast.info('Publish feature coming soon')}
        onHistory={() => toast.info('History feature coming soon')}
        onSettings={() => toast.info('Settings feature coming soon')}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Menu Button */}
        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 left-2 z-20 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        )}

        {/* Left Sidebar - Desktop */}
        {!isMobile && (
          <div 
            className={cn(
              "transition-all duration-300 ease-in-out overflow-hidden",
              sidebarOpen ? "w-[380px] min-w-[380px]" : "w-0 min-w-0"
            )}
          >
            <div className="h-full p-3 pr-0">
              {sidebarContent}
            </div>
          </div>
        )}

        {/* Mobile Sidebar Overlay */}
        {isMobile && mobileMenuOpen && (
          <>
            <div 
              className="fixed inset-0 bg-black/50 z-30"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 w-[85%] max-w-[380px] z-40 p-3">
              {sidebarContent}
            </div>
          </>
        )}

        {/* Document Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sidebar toggle - Desktop only */}
          {!isMobile && (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-2 z-10 h-7 w-7"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {/* Editor */}
          <div className={cn("flex-1 overflow-hidden", isMobile && "pt-12")}>
            <DocumentEditor
              initialContent={initialContent}
              onUpdate={setContent}
              onEditorReady={setEditor}
              autocompleteEnabled={autocompleteEnabled}
              onAutocompleteChange={setAutocompleteEnabled}
              onInsertCitation={() => setActiveTab('research')}
              onAiEdit={handleAiEdit}
              onChat={handleChatFromToolbar}
            />
          </div>
        </div>
      </div>

      {/* Library Drawer */}
      <LibraryDrawer
        isOpen={libraryDrawerOpen}
        onClose={() => setLibraryDrawerOpen(false)}
        onAddToProject={handleAddPaperToProject}
        currentProjectId={projectId}
      />

      {/* Remove Paper Confirmation Dialog */}
      <Dialog 
        open={removePaperDialog.open} 
        onOpenChange={(open) => !open && setRemovePaperDialog(prev => ({ ...prev, open: false }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove Paper
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove &ldquo;{removePaperDialog.paperTitle}&rdquo; from this project?
            </DialogDescription>
          </DialogHeader>
          
          {removePaperDialog.claimCount > 0 && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">
                This paper has {removePaperDialog.claimCount} extracted claims.
              </p>
              <p className="text-muted-foreground mt-1">
                Removing the paper will also delete these claims from your analysis.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setRemovePaperDialog(prev => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemovePaper(true)}
            >
              Remove Paper
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
