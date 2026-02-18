"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import type { Editor } from "@tiptap/react"
import { EditorTopNav } from "./EditorTopNav"
import { EditorSidebar } from "./sidebar/EditorSidebar"
import { DocumentEditor } from "./document/DocumentEditor"
import LibraryDrawer from "@/components/ui/library-drawer"
import { ProjectSettingsModal } from "./ProjectSettingsModal"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { AlertTriangle, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import type {
  ProjectPaper,
  Citation,
} from "./types"
import { cn } from "@/lib/utils"
import { useSubscription } from "@/lib/hooks/use-subscription"
import { getVisibleReferencesCount } from "@/types/subscription"
import { ResearchEditorProvider, type ResearchEditorContextValue } from "./research-editor-context"
import { processContent } from "./utils/content-processor"
import { editorToMarkdown } from "./utils/tiptap-to-markdown"
import { GenerationProgress } from "./GenerationProgress"
import { setToolExecutorPapers, setToolExecutorProjectId, processFailedCitationQueue } from "./services/tool-executor"
import dynamic from "next/dynamic"

const VersionHistoryPanel = dynamic(
  () => import("./history/VersionHistoryPanel").then(m => m.VersionHistoryPanel),
  { ssr: false }
)

const GENERATION_COMPLETION_TOAST_KEY = "genpaper:generation-complete-project"

// Hooks
import {
  useEditorState,
  usePaperManagement,
  useEditorChat,
} from "./hooks"
import { useResizablePanel } from "./hooks/useResizablePanel"
import { usePaperProcessingStatus } from "./hooks/usePaperProcessingStatus"
import { useAutocompletePrefs, DEFAULT_PREFS, type AutocompletePrefs } from "./hooks/useAutocompletePrefs"

// CitationStyleType now accepts any CSL style ID string
export type CitationStyleType = string

interface ResearchEditorProps {
  projectId?: string
  projectTitle?: string
  projectTopic?: string
  paperType?: "researchArticle" | "literatureReview" | "capstoneProject" | "mastersThesis" | "phdDissertation"
  initialContent?: string
  initialPapers?: ProjectPaper[]
  citationStyle?: string
  onSave?: (content: string) => void
  isGenerating?: boolean
  /** Project failed mid-generation — show regenerate option */
  isFailed?: boolean
  /** Write mode - user wants to write themselves, papers found in background */
  isWriteMode?: boolean
  /** Server-fetched autocomplete preferences (DB-backed) */
  initialAutocompletePrefs?: AutocompletePrefs
}

export function ResearchEditor({
  projectId,
  projectTitle = "Untitled Document",
  projectTopic,
  paperType = "literatureReview",
  initialContent,
  initialPapers = [],
  citationStyle = "apa",
  onSave,
  isGenerating: initialIsGenerating = false,
  isFailed = false,
  isWriteMode = false,
  initialAutocompletePrefs = DEFAULT_PREFS,
}: ResearchEditorProps) {
  // ============================================================================
  // Core State
  // ============================================================================
  
  const [editor, setEditor] = useState<Editor | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('editor-sidebar-open')
    return stored === null ? true : stored === '1'
  })
  const [activeTab, setActiveTab] = useState<"chat" | "research">("research")
  const [isMobile, setIsMobile] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [chatComposerPrefill, setChatComposerPrefill] = useState<{ id: number; text: string } | null>(null)
  const [chatSelectionContext, setChatSelectionContext] = useState<string | null>(null)
  const [currentCitationStyle, setCurrentCitationStyle] = useState<CitationStyleType>(citationStyle)
  const [isGenerating, setIsGenerating] = useState(initialIsGenerating)
  const [currentTitle, setCurrentTitle] = useState(projectTitle)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const lastGenerationCompleteRef = useRef<{ key: string; at: number } | null>(null)
  const { subscription } = useSubscription()
  // Default to unlocked while loading so paid users are never blocked by a slow fetch.
  // Server-side export API still enforces tier check.
  const exportLocked = subscription ? subscription.tier === 'free' : false

  // Persist sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('editor-sidebar-open', sidebarOpen ? '1' : '0')
  }, [sidebarOpen])

  // Autocomplete preferences (DB-backed, initialized from server props)
  const autocompletePrefsHook = useAutocompletePrefs(initialAutocompletePrefs)

  // Rename project title (optimistic update + persist to API)
  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (!projectId) return
    setCurrentTitle(newTitle)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTitle }),
      })
      if (!res.ok) {
        setCurrentTitle(projectTitle)
        toast.error('Failed to rename project')
      }
    } catch {
      setCurrentTitle(projectTitle)
      toast.error('Failed to rename project')
    }
  }, [projectId, projectTitle])
  
  // Resizable sidebar — default to ~1/3 of viewport, clamped to min/max
  const { width: sidebarWidth, isDragging, handleProps } = useResizablePanel({
    minWidth: 300,
    maxWidth: 600,
    defaultWidth: typeof window !== 'undefined' ? Math.min(600, Math.max(300, Math.round(window.innerWidth / 3))) : 400,
    storageKey: 'genpaper-sidebar-width',
  })

  // ============================================================================
  // Custom Hooks
  // ============================================================================

  // Editor content state & auto-save
  const {
    content: _content, // Content tracked for auto-save but not directly used here
    hasUnsavedChanges,
    isOffline,
    setContent,
    markAsEdited,
    setContentSilent,
  } = useEditorState({
    projectId,
    initialContent,
    onSave,
  })

  // Paper management
  const {
    papers,
    setPapers,
    addPaper,
    removePaper,
    confirmRemovePaper,
    removePaperDialog,
    closeRemovePaperDialog,
  } = usePaperManagement({
    projectId,
    initialPapers,
  })

  // Update a paper's metadata locally (used when user edits a citation)
  const handlePaperUpdated = useCallback((paperId: string, updates: Partial<ProjectPaper>) => {
    setPapers(prev =>
      prev.map(p => (p.id === paperId ? { ...p, ...updates } : p))
    )
  }, [setPapers])

  // Paper processing status tracking
  // Polls for status updates whenever papers exist (not just in write mode)
  const processingStatus = usePaperProcessingStatus({
    projectId,
    enabled: papers.length > 0,
    pollInterval: 3000,
    stopWhenComplete: true,
    onAllProcessed: () => {
      toast.success("All papers processed!", {
        description: "Your papers are ready for citations and autocomplete.",
        duration: 4000,
      })
    },
    onPaperFailed: (paperId) => {
      const paper = papers.find(p => p.id === paperId)
      toast.error(`Paper processing failed`, {
        description: paper?.title?.slice(0, 50) || paperId,
      })
    },
  })

  // Streaming chat with tools support
  // Always enabled - prefetches chat history in background after editor loads
  // React Query caches the result, so switching to chat tab is instant
  const chat = useEditorChat({
    projectId: projectId || '',
    editor,
    enabled: true, // Always prefetch chat history in background
  })

  // Extract chat properties
  const chatMessages = chat.messages
  const isChatLoading = chat.isLoading
  const isChatLoadingHistory = chat.isLoadingHistory
  const chatError = chat.error
  const handleSendMessage = chat.sendMessage
  const pendingTools = chat.pendingTools
  const confirmTool = chat.confirmTool
  const rejectTool = chat.rejectTool
  const clearChatHistory = chat.clearHistory
  const confirmAllTools = chat.confirmAllTools
  const rejectAllTools = chat.rejectAllTools
  const activeEditIndex = chat.activeEditIndex
  const navigateEdit = chat.navigateEdit
  const stopGeneration = chat.stopGeneration

  // ============================================================================
  // Effects
  // ============================================================================

  // Sync isGenerating with prop changes (important for SSR hydration)
  useEffect(() => {
    if (initialIsGenerating) {
      setIsGenerating(true)
    }
  }, [initialIsGenerating])

  // Show completion toast after server-truth reload.
  useEffect(() => {
    if (!projectId || typeof window === "undefined") return

    const completedProjectId = window.sessionStorage.getItem(GENERATION_COMPLETION_TOAST_KEY)
    if (completedProjectId !== projectId) return

    window.sessionStorage.removeItem(GENERATION_COMPLETION_TOAST_KEY)
    toast.success("Paper generated successfully!")
  }, [projectId])

  // Check for mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      if (window.innerWidth < 768) {
        setSidebarOpen(false)
      }
    }
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  // Write mode: Show welcome toast
  useEffect(() => {
    if (!isWriteMode || !projectId || !projectTopic) return
    
    toast.success("Ready to write!", {
      description: "Start writing your paper. We're processing your sources in the background.",
      duration: 5000,
    })
  }, [isWriteMode, projectId, projectTopic])

  // Trigger background processing of project papers when papers exist
  // This runs on mount and whenever new papers are added to ensure all papers get processed
  const processedPaperCountRef = useRef<number>(0)
  
  useEffect(() => {
    if (!projectId || papers.length === 0) return
    
    // Only trigger if we have new papers that haven't been seen
    // This prevents re-triggering on every render while still catching new additions
    if (papers.length <= processedPaperCountRef.current) return
    processedPaperCountRef.current = papers.length
    
    // Start background processing of all papers in this project
    const triggerProcessing = async () => {
      try {
        console.log('[ResearchEditor] Triggering background paper processing for project:', projectId, 'papers:', papers.length)
        const response = await fetch('/api/papers/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            waitForCompletion: false, // Don't wait - process in background
          }),
        })
        
        if (!response.ok) {
          console.error('[ResearchEditor] Background processing trigger failed:', await response.text())
        } else {
          const result = await response.json()
          console.log('[ResearchEditor] Background processing started:', result)
        }
      } catch (error) {
        console.error('[ResearchEditor] Failed to trigger background processing:', error)
      }
    }
    
    triggerProcessing()
  }, [projectId, papers.length])

  // Sync papers and projectId with tool executor for markdown processing and citation saving
  useEffect(() => {
    setToolExecutorPapers(papers)
  }, [papers])
  
  useEffect(() => {
    if (projectId) {
      setToolExecutorProjectId(projectId)
    }
  }, [projectId])

  // Process any failed citation saves from previous sessions
  useEffect(() => {
    processFailedCitationQueue()
  }, [])

  // ============================================================================
  // Handlers
  // ============================================================================

  // Handle chat from floating toolbar
  const clearChatComposerPrefill = useCallback(() => {
    setChatComposerPrefill(null)
    setChatSelectionContext(null)
  }, [])

  const handleChatFromToolbar = useCallback(
    (selectedText: string) => {
      const normalizedSelection = selectedText.replace(/\s+/g, " ").trim()
      setActiveTab("chat")
      if (isMobile) setMobileMenuOpen(true)

      if (!normalizedSelection) {
        clearChatComposerPrefill()
        return
      }

      const trimmedSelection =
        normalizedSelection.length > 600
          ? `${normalizedSelection.slice(0, 600)}…`
          : normalizedSelection

      setChatSelectionContext(trimmedSelection)
      setChatComposerPrefill({
        id: Date.now(),
        text: `Question about this selected text:\n"${trimmedSelection}"\n\n`,
      })
    },
    [clearChatComposerPrefill, isMobile]
  )

  // Handle citation insertion
  const handleInsertCitation = useCallback(
    (citation: Citation) => {
      if (!editor) return
      editor.chain().focus().insertCitation(citation).run()
      if (isMobile) setMobileMenuOpen(false)
    },
    [editor, isMobile]
  )

  // Handle export
  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "latex") => {
      if (!editor) return

      try {
        // Show loading toast for PDF (can be slow)
        const loadingToast = format === 'pdf' 
          ? toast.loading('Generating PDF... This may take a few seconds.')
          : null

        // Get editor JSON and citation metadata
        const editorDocument = editor.getJSON()
        const citationStorage = (editor.storage as unknown as Record<string, unknown>).citation as {
          citationStyle?: string
          papers?: Array<{
            id: string
            title?: string
            authors?: string[]
            year?: number
            journal?: string
            venue?: string
            doi?: string
          }>
        } | undefined

        const response = await fetch("/api/editor/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format,
            document: editorDocument,
            papers: citationStorage?.papers || papers,
            citationStyle: citationStorage?.citationStyle || 'apa',
            title: projectTitle,
          }),
        })

        if (loadingToast) toast.dismiss(loadingToast)

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Export failed' }))
          throw new Error(error.error || 'Export failed')
        }

        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        
        // LaTeX export is now a ZIP file
        const extension = format === "latex" ? "zip" : format
        a.download = `${projectTitle}.${extension}`
        
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        toast.success(`Exported as ${format.toUpperCase()}${format === 'latex' ? ' (ZIP with .tex and .bib files)' : ''}`)
      } catch (error) {
        console.error("Export error:", error)
        const message = error instanceof Error ? error.message : "Export failed"
        toast.error(message)
      }
    },
    [editor, projectTitle, papers]
  )

  // Handle generation completion
  const handleGenerationComplete = useCallback(
    async (generatedContent: string) => {
      const safeGeneratedContent =
        typeof generatedContent === "string"
          ? generatedContent
          : String(generatedContent ?? "")
      const completionKey = `${safeGeneratedContent.length}:${safeGeneratedContent.slice(0, 120)}:${safeGeneratedContent.slice(-120)}`
      const now = Date.now()
      const lastCompletion = lastGenerationCompleteRef.current

      // Ignore duplicate completion callbacks for the same payload in a short window.
      if (
        lastCompletion &&
        lastCompletion.key === completionKey &&
        now - lastCompletion.at < 15000
      ) {
        return
      }
      lastGenerationCompleteRef.current = { key: completionKey, at: now }

      try {
        if (!projectId) {
          throw new Error("Missing project ID for generation completion")
        }

        // New completion UX: always reload editor from server truth.
        // This removes fragile in-memory apply paths and guarantees consistency.
        const url = new URL(window.location.href)
        url.searchParams.delete("created")
        try {
          window.sessionStorage.setItem(GENERATION_COMPLETION_TOAST_KEY, projectId)
        } catch (storageError) {
          console.warn("[Generation] Unable to persist completion toast marker:", storageError)
        }
        window.location.replace(url.toString())
      } catch (err) {
        console.error("[Generation] Failed to finalize generated content:", err)
        toast.error("Paper was generated, but opening the final draft failed.")
        setIsGenerating(false)
      }
    },
    [projectId]
  )

  // Handle generation error
  const handleGenerationError = useCallback((error: string) => {
    setIsGenerating(false)

    if (error === "GENERATION_IN_PROGRESS") {
      toast.info("Generation is already in progress. Please wait...")
    } else {
      toast.error(`Generation failed: ${error}`)
    }
  }, [])

  // Handle generation cancel
  const handleGenerationCancel = useCallback(() => {
    setIsGenerating(false)
    window.location.href = "/projects"
  }, [])

  // Handle regenerate for failed projects
  const handleRegenerate = useCallback(() => {
    setIsGenerating(true)
  }, [])

  // Handle version restore from history panel
  const handleRestoreVersion = useCallback(
    (restoredContent: string) => {
      // Update internal state (for auto-save tracking)
      setContentSilent(restoredContent)
      markAsEdited()

      // Update TipTap editor with restored content
      if (editor && !editor.isDestroyed) {
        const { json, isFullDoc } = processContent(restoredContent, papers)

        if (isFullDoc && json) {
          editor.commands.setContent(json)
        } else if (Array.isArray(json) && json.length > 0) {
          editor.commands.setContent({
            type: "doc",
            content: [{ type: "paragraph", content: json }],
          })
        } else {
          editor.commands.setContent({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: restoredContent }],
              },
            ],
          })
        }
      }

      // Close the history panel after restore
      setHistoryPanelOpen(false)
    },
    [editor, papers, setContentSilent, markAsEdited]
  )

  // Handle adding paper from library drawer
  const handleAddPaperToProject = useCallback(
    (paperId: string, title: string) => {
      addPaper(paperId, title)
      setLibraryDrawerOpen(false)
    },
    [addPaper]
  )

  // ============================================================================
  // Citation formatting is now 100% local via CitationNodeView + local-formatter
  // No more CitationManager or server-side rendering needed
  // ============================================================================

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue: ResearchEditorContextValue = {
    // Project
    projectId,
    projectTitle: currentTitle,
    papers,
    citationStyle: currentCitationStyle,

    // Autocomplete preferences
    autocompletePrefs: autocompletePrefsHook.prefs,

    // Chat
    chatMessages,
    isChatLoading,
    isChatLoadingHistory,
    chatError,
    pendingTools,
    sendMessage: handleSendMessage,
    clearChatHistory,
    stopGeneration,
    chatComposerPrefill,
    chatSelectionContext,
    clearChatComposerPrefill,

    // UI
    isMobile,
    mobileMenuOpen: isMobile ? mobileMenuOpen : sidebarOpen,
    sidebarOpen,
    activeTab,
    setActiveTab,
    toggleSidebar: () => isMobile ? setMobileMenuOpen(!mobileMenuOpen) : setSidebarOpen(!sidebarOpen),
    openLibraryDrawer: () => setLibraryDrawerOpen(true),

    // Actions
    insertCitation: handleInsertCitation,
    removePaper,

    // Processing status
    getProcessingStatus: processingStatus.getStatus,
    processingSummary: processingStatus.summary,
    retryPaper: processingStatus.retryPaper,
    isProcessingPolling: processingStatus.isPolling,

    // Review toolbar
    pendingEditCount: pendingTools.length,
    activeEditIndex,
    navigateEdit,
    acceptAllEdits: confirmAllTools,
    rejectAllEdits: rejectAllTools,
  }

  const sidebarContent = <EditorSidebar />

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <ResearchEditorProvider value={contextValue}>
      <div className="h-screen w-full flex flex-col rounded-xl border border-border/40 overflow-hidden bg-background">
        {/* Top Navigation */}
        <EditorTopNav
          projectTitle={currentTitle}
          projectId={projectId}
          onTitleChange={handleTitleChange}
          onExport={handleExport}
          onPublish={() => toast.info("Publish feature coming soon")}
          onHistory={() => setHistoryPanelOpen(true)}
          onSettings={() => setSettingsModalOpen(true)}
          saveStatus={hasUnsavedChanges ? "unsaved" : "saved"}
          isOffline={isOffline}
          exportLocked={exportLocked}
        />

        {/* Generation Progress Overlay */}
        {isGenerating && projectId && (
          <GenerationProgress
            projectId={projectId}
            topic={projectTopic || projectTitle}
            paperType={paperType}
            onComplete={handleGenerationComplete}
            onError={handleGenerationError}
            onCancel={handleGenerationCancel}
          />
        )}

        {/* Failed generation banner */}
        {isFailed && !isGenerating && (
          <div className="flex items-center justify-center gap-3 px-4 py-3 bg-destructive/5 border-b border-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">
              Generation failed. You can try again or start writing manually.
            </p>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleRegenerate}>
              <RotateCcw className="h-3.5 w-3.5" />
              Regenerate
            </Button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left Sidebar - Desktop */}
          {!isMobile && (
            <div
              className={cn(
                "relative shrink-0 overflow-hidden",
                !isDragging && "transition-[width] duration-300 ease-in-out",
                !sidebarOpen && "w-0 min-w-0"
              )}
              style={{ width: sidebarOpen ? sidebarWidth : 0 }}
            >
              <div className="h-full p-3 pr-0">{sidebarContent}</div>
              
              {/* Resize Handle */}
              {sidebarOpen && (
                <div
                  {...handleProps}
                  className={cn(
                    "absolute top-0 right-0 w-1 h-full cursor-col-resize z-10",
                    "hover:bg-foreground/10 active:bg-foreground/15",
                    "transition-colors duration-150",
                    isDragging && "bg-foreground/15"
                  )}
                  title="Drag to resize"
                >
                  <div className={cn(
                    "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                    "w-0.5 h-8 rounded-full bg-border/60",
                    "opacity-0 hover:opacity-100 transition-opacity",
                    isDragging && "opacity-100 bg-foreground/30"
                  )} />
                </div>
              )}
            </div>
          )}

          {/* Mobile Sidebar Overlay */}
          {isMobile && mobileMenuOpen && (
            <>
              <div className="fixed inset-0 bg-black/50 z-30" role="button" tabIndex={0} aria-label="Close sidebar" onClick={() => setMobileMenuOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setMobileMenuOpen(false)} />
              <div className="fixed inset-y-0 left-0 w-[85%] max-w-[380px] z-40 p-3">{sidebarContent}</div>
            </>
          )}

          {/* Document Editor Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              <DocumentEditor
                initialContent={initialContent}
                onUpdate={(newContent) => {
                  setContent(newContent)
                }}
                onEditorReady={setEditor}
                onChat={handleChatFromToolbar}
                onPaperUpdated={handlePaperUpdated}
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

        {/* Project Settings Modal */}
        {projectId && (
          <ProjectSettingsModal
            open={settingsModalOpen}
            onOpenChange={setSettingsModalOpen}
            projectId={projectId}
            currentCitationStyle={currentCitationStyle}
            onCitationStyleChange={(style) => setCurrentCitationStyle(style as CitationStyleType)}
            autocompletePrefs={autocompletePrefsHook.prefs}
            onAutocompletePrefsChange={autocompletePrefsHook.updatePrefs}
          />
        )}

        {/* Version History Panel */}
        {projectId && (
          <VersionHistoryPanel
            projectId={projectId}
            papers={papers}
            citationStyle={currentCitationStyle}
            open={historyPanelOpen}
            onOpenChange={setHistoryPanelOpen}
            onRestore={handleRestoreVersion}
          />
        )}

        {/* Remove Paper Confirmation Dialog */}
        <Dialog
          open={removePaperDialog.open}
          onOpenChange={(open) => !open && closeRemovePaperDialog()}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-instrument tracking-tight">
                <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
                Remove Paper
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to remove &ldquo;{removePaperDialog.paperTitle}&rdquo; from this project?
              </DialogDescription>
            </DialogHeader>

            {removePaperDialog.claimCount > 0 && (
              <div className="rounded-xl bg-destructive/5 border border-destructive/10 p-3 text-sm">
                <p className="font-medium text-destructive">
                  This paper has {removePaperDialog.claimCount} extracted claims.
                </p>
                <p className="text-muted-foreground mt-1">
                  Removing the paper will also delete these claims from your analysis.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={closeRemovePaperDialog}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => confirmRemovePaper(true)}>
                Remove Paper
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResearchEditorProvider>
  )
}
