"use client"

import { useState, useCallback, useEffect } from "react"
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

import { ChevronLeft, ChevronRight, Menu, X, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import type {
  ProjectPaper,
  Citation,
} from "./types"
import { cn } from "@/lib/utils"
import { processContent } from "./utils/content-processor"
import { editorToMarkdown } from "./utils/tiptap-to-markdown"
import { GenerationProgress } from "./GenerationProgress"
import { setToolExecutorPapers } from "./services/tool-executor"

// Hooks
import {
  useEditorState,
  usePaperManagement,
  useEditorChat,
  useBackgroundPaperSearch,
} from "./hooks"

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
  /** Write mode - user wants to write themselves, papers found in background */
  isWriteMode?: boolean
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
  isWriteMode = false,
}: ResearchEditorProps) {
  // ============================================================================
  // Core State
  // ============================================================================
  
  const [editor, setEditor] = useState<Editor | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<"chat" | "research">("research")
  const [isMobile, setIsMobile] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [currentCitationStyle, setCurrentCitationStyle] = useState<CitationStyleType>(citationStyle)
  const [isGenerating, setIsGenerating] = useState(initialIsGenerating)

  // ============================================================================
  // Custom Hooks
  // ============================================================================

  // Editor content state & auto-save
  const {
    content: _content, // Content tracked for auto-save but not directly used here
    hasUnsavedChanges,
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

  // Background paper search for write mode
  // Note: isSearching could be used for sidebar loading indicator in future
  const { isSearching: _isSearchingPapers } = useBackgroundPaperSearch({
    projectId,
    topic: projectTopic || projectTitle,
    enabled: isWriteMode && papers.length === 0,
    maxPapers: 10,
    onPapersFound: (foundPapers) => {
      setPapers(prev => [...prev, ...foundPapers])
    },
  })

  // Streaming chat with tools support
  // Lazy load chat - only fetch history when chat tab is active
  // This speeds up initial editor load significantly
  const chat = useEditorChat({
    projectId: projectId || '',
    editor,
    enabled: activeTab === 'chat', // Only load chat history when chat tab is opened
  })

  // Extract chat properties
  const chatMessages = chat.messages
  const isChatLoading = chat.isLoading
  const handleSendMessage = chat.sendMessage
  const pendingTools = chat.pendingTools
  const confirmTool = chat.confirmTool
  const rejectTool = chat.rejectTool
  const clearChatHistory = chat.clearHistory

  // ============================================================================
  // Effects
  // ============================================================================

  // Sync isGenerating with prop changes (important for SSR hydration)
  useEffect(() => {
    if (initialIsGenerating) {
      setIsGenerating(true)
    }
  }, [initialIsGenerating])

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
      description: "Start writing your paper. We're finding relevant sources in the background.",
      duration: 5000,
    })
  }, [isWriteMode, projectId, projectTopic])

  // Sync papers with tool executor for markdown processing (tables, citations, etc.)
  useEffect(() => {
    setToolExecutorPapers(papers)
  }, [papers])

  // ============================================================================
  // Handlers
  // ============================================================================

  // Handle AI edit from floating toolbar
  const handleAiEdit = useCallback(
    (selectedText: string) => {
      setActiveTab("chat")
      if (isMobile) setMobileMenuOpen(true)
      handleSendMessage(`Please help me improve this text: "${selectedText}"`)
    },
    [handleSendMessage, isMobile]
  )

  // Handle chat from floating toolbar
  const handleChatFromToolbar = useCallback(
    (selectedText: string) => {
      setActiveTab("chat")
      if (isMobile) setMobileMenuOpen(true)
      handleSendMessage(`I have a question about: "${selectedText}"`)
    },
    [handleSendMessage, isMobile]
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
        const response = await fetch("/api/editor/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format,
            content: editorToMarkdown(editor),
            title: projectTitle,
          }),
        })

        if (!response.ok) throw new Error("Export failed")

        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `${projectTitle}.${format === "latex" ? "tex" : format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        toast.success(`Exported as ${format.toUpperCase()}`)
      } catch (error) {
        console.error("Export error:", error)
        toast.error("Export failed")
      }
    },
    [editor, projectTitle]
  )

  // Handle generation completion
  const handleGenerationComplete = useCallback(
    (generatedContent: string) => {
      setIsGenerating(false)

      if (editor && !editor.isDestroyed) {
        const { json, isFullDoc } = processContent(generatedContent, papers)

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
                content: [{ type: "text", text: generatedContent }],
              },
            ],
          })
        }

        setContentSilent(generatedContent)
        markAsEdited()
      } else {
        setContentSilent(generatedContent)
        markAsEdited()
      }

      toast.success("Paper generated successfully!")

      // Remove ?created=1 from URL without reload
      const url = new URL(window.location.href)
      url.searchParams.delete("created")
      window.history.replaceState({}, "", url.toString())
    },
    [editor, papers, setContentSilent, markAsEdited]
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
  // Sidebar Content
  // ============================================================================

  const sidebarContent = (
    <EditorSidebar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      chatMessages={chatMessages}
      onSendMessage={handleSendMessage}
      isChatLoading={isChatLoading}
      pendingTools={pendingTools}
      onConfirmTool={confirmTool}
      onRejectTool={rejectTool}
      onClearHistory={clearChatHistory}
      papers={papers}
      onInsertCitation={handleInsertCitation}
      onOpenLibrary={() => setLibraryDrawerOpen(true)}
      onRemovePaper={removePaper}
    />
  )

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="h-screen w-full flex flex-col rounded-3xl border-2 border-foreground/10 overflow-hidden bg-background">
      {/* Top Navigation */}
      <EditorTopNav
        projectTitle={projectTitle}
        onExport={handleExport}
        onPublish={() => toast.info("Publish feature coming soon")}
        onHistory={() => toast.info("History feature coming soon")}
        onSettings={() => setSettingsModalOpen(true)}
        saveStatus={hasUnsavedChanges ? "unsaved" : "saved"}
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

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Menu Button */}
        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 left-2 z-20 md:hidden bg-transparent"
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
            <div className="h-full p-3 pr-0">{sidebarContent}</div>
          </div>
        )}

        {/* Mobile Sidebar Overlay */}
        {isMobile && mobileMenuOpen && (
          <>
            <div className="fixed inset-0 bg-black/50 z-30" onClick={() => setMobileMenuOpen(false)} />
            <div className="fixed inset-y-0 left-0 w-[85%] max-w-[380px] z-40 p-3">{sidebarContent}</div>
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
                {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {/* Editor */}
          <div className={cn("flex-1 overflow-hidden", isMobile && "pt-12")}>
            <DocumentEditor
              initialContent={initialContent}
              onUpdate={(newContent) => {
                setContent(newContent)
              }}
              onEditorReady={setEditor}
              onInsertCitation={() => setActiveTab("research")}
              onAiEdit={handleAiEdit}
              onChat={handleChatFromToolbar}
              projectId={projectId}
              projectTopic={projectTitle}
              papers={papers}
              citationStyle={currentCitationStyle}
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
        />
      )}

      {/* Remove Paper Confirmation Dialog */}
      <Dialog
        open={removePaperDialog.open}
        onOpenChange={(open) => !open && closeRemovePaperDialog()}
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
  )
}
