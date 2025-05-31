"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Zap,
  HelpCircle,
  Save,
  Download,
  Undo,
  Redo,
  Sparkles,
  Plus,
  Quote,
  Search,
  ThumbsUp,
  ThumbsDown,
  Send,
  Paperclip,
  Mic,
  Bold,
  Italic,
  Underline,
  Link,
  List,
  MessageSquare,
  Maximize2,
  Minimize2,
  Eye,
  ArrowLeft,
  FileText,
  BookOpen,
  CheckCircle,
} from "lucide-react"
import { useSectionAutosave } from "./hooks/useSectionAutosave"
import SmartEditor from "./components/SmartEditor"
import OutlinePanel from "./components/OutlinePanel"
import CitationPanel from "./components/CitationPanel"
import { ProjectSetupModal } from "./components/ProjectSetupModal"
import { ProjectWorkspaceErrorBoundary } from "./components/ProjectWorkspaceErrorBoundary"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { 
  EditorErrorFallback, 
  OutlinePanelErrorFallback, 
  CitationPanelErrorFallback 
} from "@/components/ComponentErrorFallbacks"
import { useSections, useProjectNeedsSetup, sectionKeys } from "@/lib/tanstack-query/hooks/useSections"
import { useCitations } from "@/lib/tanstack-query/hooks/useCitations"
import { useProject, useProjectDetails } from "@/lib/tanstack-query/hooks/useProjects"
import { completeProjectSetup } from "./actions"
import { usePaperStream } from "@/hooks/usePaperStream"
import { useRealtimeCitations } from "@/hooks/useRealtimeCitations"
import type { 
  AISuggestion, 
  ProjectWorkspaceProps 
} from "./types"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"

// Mock AI suggestions for demo
const mockAiSuggestions: AISuggestion[] = [
  {
    id: 1,
    type: "text",
    content:
      "Furthermore, recent advances in transformer architectures have shown remarkable improvements in medical text analysis, with models achieving accuracy rates exceeding 92% in clinical note classification tasks.",
    position: { line: 15, char: 45 },
    confidence: 0.89,
  },
  {
    id: 2,
    type: "citation",
    content: "Consider citing Zhang et al. (2023) here to support this claim about deep learning accuracy.",
    position: { line: 12, char: 120 },
    suggestedCitation: {
      id: "1",
      project_id: "",
      title: "Deep Learning in Medical Diagnosis: A Systematic Review",
      authors: "Zhang, L., Wang, M., Chen, S.",
      year: "2023",
      journal: "Nature Medicine",
      abstract: "This systematic review examines the application of deep learning techniques in medical diagnosis...",
      source_type: "journal",
      relevance_score: 95,
      status: "suggested",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  },
  {
    id: 3,
    type: "style",
    content:
      "This sentence could be more concise. Suggested revision: 'ML algorithms demonstrate superior performance in diagnostic tasks.'",
    position: { line: 8, char: 25 },
    original:
      "Machine learning algorithms have been shown to demonstrate superior performance when applied to various diagnostic tasks in clinical settings.",
    suggested: "ML algorithms demonstrate superior performance in diagnostic tasks.",
  },
]

export default function ProjectWorkspace({ projectId, initialProject }: ProjectWorkspaceProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  
  // TanStack Query hooks
  const { data: project, isLoading: projectLoading } = useProject(projectId, initialProject)
  const { data: projectDetails, isLoading: detailsLoading } = useProjectDetails(projectId)
  const { data: sectionsResponse, isLoading: sectionsLoading, error: sectionsError } = useSections(projectId)
  const { data: citationsResponse, isLoading: citationsLoading } = useCitations(projectId)
  
  // Real-time streaming hooks
  const {
    content: streamedContent,
    isLoading: isStreamingGeneration,
    error: streamingError,
    chunkCount,
    startGeneration: startStreamGeneration,
    stopGeneration
  } = usePaperStream(projectId)

  const {
    citations: realtimeCitations,
    isLoading: realtimeCitationsLoading,
    error: realtimeCitationsError
  } = useRealtimeCitations(projectId)
  
  // Check if project needs initial setup
  const { needsSetup, isLoading: setupCheckLoading, hasError: setupCheckError } = useProjectNeedsSetup(projectId)
  
  // Extract data from responses
  const sections = sectionsResponse?.sections || []
  const citations = citationsResponse?.citations || []
  
  // Use real-time citations when available, fall back to regular citations
  const displayCitations = realtimeCitations.length > 0 ? realtimeCitations : citations
  
  // Convert real-time citations to database citation format for CitationPanel compatibility
  const convertRealtimeCitationsToDisplay = (rtCitations: any[]) => {
    return rtCitations.map(citation => ({
      id: citation.id,
      project_id: citation.project_id,
      citation_key: citation.key,
      title: citation.data?.title || 'Untitled',
      authors: citation.data?.author || [],
      year: citation.data?.issued?.['date-parts']?.[0]?.[0] || null,
      journal: citation.data?.['container-title'] || null,
      doi: citation.data?.DOI || null,
      abstract: citation.data?.abstract || null,
      source_type: citation.source_type || 'article',
      relevance_score: 95,
      status: 'active' as const,
      created_at: citation.created_at,
      updated_at: citation.updated_at,
      links: citation.links || []
    }))
  }
  
  // Final citations for display (converted if real-time)
  const finalDisplayCitations = realtimeCitations.length > 0 
    ? convertRealtimeCitationsToDisplay(realtimeCitations)
    : citations
  
  const [aiSuggestions] = useState<AISuggestion[]>(mockAiSuggestions)
  
  const [focusMode, setFocusMode] = useState(false)
  const [showCitations, setShowCitations] = useState(true)
  const [showOutline, setShowOutline] = useState(true)
  const [activeSection, setActiveSection] = useState("introduction")
  const [selectedText, setSelectedText] = useState("")
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [aiMessage, setAiMessage] = useState("")
  const [showAiSuggestion, setShowAiSuggestion] = useState(true)
  const [currentSuggestion, setCurrentSuggestion] = useState(aiSuggestions[0])
  const [editorContent, setEditorContent] = useState("")
  const [wordCount, setWordCount] = useState(0)
  const [sessionStartTime] = useState(Date.now())
  const [sessionWordCount, setSessionWordCount] = useState(0)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [isSettingUp, setIsSettingUp] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)

  // Use the TanStack Query-enabled section auto-save hook
  const sectionAutosave = useSectionAutosave({ debounceMs: 800 })

  // Cleanup auto-save on unmount
  useEffect(() => {
    return () => {
      sectionAutosave.cleanup()
    }
  }, [sectionAutosave])

  // Show setup modal if project needs setup (no sections exist)
  useEffect(() => {
    console.log('🔍 Setup check:', { 
      needsSetup, 
      hasProject: !!project, 
      showSetupModal, 
      sectionsCount: sections.length,
      isLoading: setupCheckLoading 
    })
    
    if (needsSetup && project && !showSetupModal) {
      console.log('🎯 Project needs setup - showing setup modal')
      setShowSetupModal(true)
    }
  }, [needsSetup, project, showSetupModal, sections.length, setupCheckLoading])

  // Set active section to first available section if current one doesn't exist
  useEffect(() => {
    if (sections.length > 0) {
      setActiveSection(prevActiveSection => {
        const sectionExists = sections.some(s => s.section_key === prevActiveSection)
        if (!sectionExists) {
          return sections[0].section_key
        }
        return prevActiveSection
      })
    }
  }, [sections])

  // Handle section changes and load content
  useEffect(() => {
    const currentSection = sections.find(s => s.section_key === activeSection)
    if (currentSection && currentSection.content !== undefined) {
      setEditorContent(currentSection.content || '')
      setWordCount((currentSection.content || '').split(/\s+/).filter(Boolean).length)
    } else {
      // Clear editor if no content or section not found
      setEditorContent('')
      setWordCount(0)
    }
  }, [activeSection, sections])

  // Set initial content from project details if available
  useEffect(() => {
    if (projectDetails?.content && !editorContent) {
      setEditorContent(projectDetails.content)
      setWordCount(projectDetails.content.split(/\s+/).filter(Boolean).length)
    }
  }, [projectDetails, editorContent])

  // Handle content changes from SmartEditor
  const handleContentChange = (content: string, wordCount: number, charCount: number) => {
    setEditorContent(content)
    setWordCount(wordCount)
    
    // Update session word count based on current section
    const currentSection = sections.find(s => s.section_key === activeSection)
    if (currentSection) {
      const originalWords = (currentSection.content || '').split(/\s+/).filter(Boolean).length
      setSessionWordCount(wordCount - originalWords)
    }
    
    // Use the TanStack Query-enabled auto-save hook
    if (activeSection) {
      sectionAutosave.handleContentChange({
        projectId,
        sectionKey: activeSection,
        content,
        wordCount,
      })
    }
  }

  // Handle blur from SmartEditor
  const handleEditorBlur = () => {
    if (activeSection && editorContent) {
      const words = editorContent.split(/\s+/).filter(Boolean).length
      sectionAutosave.handleBlur({
        projectId,
        sectionKey: activeSection,
        content: editorContent,
        wordCount: words,
      })
    }
  }

  const acceptAiSuggestion = (suggestionId: number) => {
    const suggestion = aiSuggestions.find(s => s.id === suggestionId)
    if (suggestion && suggestion.type === 'text') {
      // Simply append the suggestion to current content
      const newContent = editorContent + '\n\n' + suggestion.content
      
      setEditorContent(newContent)
      handleContentChange(newContent, newContent.split(/\s+/).filter(Boolean).length, 0)
    }
    setShowAiSuggestion(false)
  }

  const rejectAiSuggestion = (suggestionId: number) => {
    setShowAiSuggestion(false)
    // Move to next suggestion if available
    const currentIndex = aiSuggestions.findIndex(s => s.id === suggestionId)
    if (currentIndex < aiSuggestions.length - 1) {
      setCurrentSuggestion(aiSuggestions[currentIndex + 1])
      setTimeout(() => setShowAiSuggestion(true), 500)
    }
  }

  const handleAiAction = (action: string) => {
    // Enhanced logging for find-sources action as required by MKB-04
    if (action === 'find-sources') {
      console.log('AI Action: find-sources on text:', {
        selectedText: selectedText,
        activeSection: activeSection,
        sectionTitle: sections.find(s => s.section_key === activeSection)?.title || 'Unknown',
        projectId: projectId,
        projectTitle: project?.title || 'Unknown',
        timestamp: new Date().toISOString()
      })
    } else {
      // General logging for other actions
      console.log(`AI Action: ${action} on text: ${selectedText}`)
    }
    
    // Hide the context menu as required
    setShowContextMenu(false)
    
    // Here you would trigger the actual AI action
  }

  const handleAiMessage = async () => {
    if (!aiMessage.trim()) return
    
    // Log the message with context as required by MKB-03
    console.log('AI Assistant Message:', {
      message: aiMessage,
      projectId: projectId,
      projectTitle: project?.title || 'Unknown',
      activeSection: activeSection,
      sectionTitle: sections.find(s => s.section_key === activeSection)?.title || 'Unknown',
      wordCount: wordCount,
      timestamp: new Date().toISOString()
    })
    
    // Clear the message input
    setAiMessage('')
  }

  // Handle Generate Full Draft with pre-flight checks
  const handleGenerateFullDraft = async () => {
    if (!project) return

    // Pre-flight check: abort if any section status = 'ai_drafting' or if already streaming
    const hasAIDrafting = sections.some(section => section.status === 'ai_drafting')
    if (hasAIDrafting || isStreamingGeneration) {
      console.log('Cannot generate full draft: AI is already drafting')
      alert('Cannot generate full draft while AI is already working. Please wait for current operations to complete.')
      return
    }

    try {
      console.log('Starting real-time streaming generation for project:', project.title)
      
      // Use the streaming hook instead of the old action
      await startStreamGeneration(projectId, project.title)
      
      console.log('Streaming generation started successfully')
      toast.success('Started generating your research paper with real-time streaming!')
      
    } catch (error) {
      console.error('Error starting streaming generation:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(`Failed to start generation: ${errorMessage}`)
    }
  }

  // Copy bibliography handler
  const handleCopyBibliography = () => {
    const bibliography = `Smith, J., & Johnson, R. (2022). Machine Learning Applications in Healthcare. JAMA, 45(3), 123-135.

Zhang, L., Wang, M., & Chen, S. (2023). Deep Learning in Medical Diagnosis: A Systematic Review. Nature Medicine, 29(4), 456-467.`
    
    navigator.clipboard.writeText(bibliography).then(() => {
      console.log('Bibliography copied to clipboard')
    }).catch(err => {
      console.error('Failed to copy bibliography:', err)
    })
  }

  // Calculate session stats
  const sessionMinutes = Math.floor((Date.now() - sessionStartTime) / 60000)
  const wordsPerMinute = sessionMinutes > 0 ? (Math.abs(sessionWordCount) / sessionMinutes).toFixed(1) : '0'

  // Loading state - include setup check
  const isLoading = projectLoading || detailsLoading || sectionsLoading || citationsLoading || setupCheckLoading

  // Handle project setup completion
  const handleCompleteSetup = async (data: {
    title: string
    sections: Array<{
      section_key: string
      title: string
      order: number
      description?: string
    }>
    outlineText?: string
  }) => {
    setIsSettingUp(true)
    try {
      const result = await completeProjectSetup(projectId, data)
      
      if (result.success) {
        toast.success('Project setup completed successfully!')
        setShowSetupModal(false)
        // Invalidate queries to refresh sections and setup check
        queryClient.invalidateQueries({ queryKey: sectionKeys.byProject(projectId) })
        queryClient.invalidateQueries({ queryKey: ['sectionsWithAutoCreate', projectId] })
      } else {
        toast.error(result.error || 'Failed to complete project setup')
      }
    } catch (error) {
      console.error('Error completing project setup:', error)
      toast.error('An unexpected error occurred')
    } finally {
      setIsSettingUp(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading project...</p>
        </div>
      </div>
    )
  }

  // Error state for sections
  if (sectionsError || setupCheckError) {
    const errorMessage = sectionsError ? 'Error loading sections' : 'Error checking project setup'
    console.error('ProjectWorkspace error:', { sectionsError, setupCheckError })
    
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{errorMessage}</p>
          <Button onClick={() => router.push('/projects')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Button>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Project not found</p>
          <Button onClick={() => router.push('/projects')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ProjectWorkspaceErrorBoundary projectId={projectId} projectTitle={project?.title}>
      {/* Header with Breadcrumb */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-blue-600 hover:text-blue-700 p-0"
              onClick={() => router.push('/projects')}
            >
              Projects
            </Button>
            <span>→</span>
            <span className="text-gray-900">Workspace</span>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <h1 className="text-xl font-semibold text-gray-900">{project.title}</h1>
            <Badge className="bg-blue-100 text-blue-800">
              {project.status === 'ai-drafting' ? 'AI Drafting' : 'In Progress'}
            </Badge>
            {activeSection && (
              <Badge className="bg-purple-100 text-purple-800">
                {sections.find(s => s.section_key === activeSection)?.title}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <Undo className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <Redo className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-gray-200"></div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="w-8 h-8" 
              onClick={handleEditorBlur}
              disabled={sectionAutosave.isValidating}
            >
              <Save className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <Download className="w-4 h-4" />
            </Button>
          </div>
          <div className="w-px h-6 bg-gray-200"></div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setFocusMode(!focusMode)}>
              {focusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className={`w-8 h-8 ${!showOutline ? 'bg-gray-100 text-gray-700' : ''}`}
              onClick={() => setShowOutline(!showOutline)}
              title={showOutline ? "Hide Document Outline" : "Show Document Outline"}
            >
              <FileText className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className={`w-8 h-8 ${!showCitations ? 'bg-gray-100 text-gray-700' : ''}`}
              onClick={() => setShowCitations(!showCitations)}
              title={showCitations ? "Hide Citations & Sources" : "Show Citations & Sources"}
            >
              <BookOpen className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm">
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
          </div>
          <div className="w-px h-6 bg-gray-200"></div>
          <Button className="bg-black text-white hover:bg-gray-800">
            <Zap className="w-4 h-4 mr-2" />
            Upgrade
          </Button>
          <Button variant="ghost" size="icon">
            <HelpCircle className="w-4 h-4 text-gray-500" />
          </Button>
          <Avatar className="w-8 h-8">
            <AvatarImage src="/placeholder.svg?height=32&width=32" />
            <AvatarFallback className="bg-purple-200 text-purple-800">U</AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex">
        {/* Left Sidebar - Section Outline */}
        {!focusMode && (
          <ErrorBoundary fallback={<OutlinePanelErrorFallback />}>
            <OutlinePanel
              sections={sections}
              activeSection={activeSection}
              showOutline={showOutline}
              isGeneratingFullDraft={isStreamingGeneration}
              sessionMinutes={sessionMinutes}
              sessionWordCount={sessionWordCount}
              wordsPerMinute={wordsPerMinute}
              aiSuggestionsCount={aiSuggestions.length}
              onSectionChange={setActiveSection}
              onGenerateFullDraft={handleGenerateFullDraft}
              onHideOutline={() => setShowOutline(false)}
            />
          </ErrorBoundary>
        )}

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* Editor Toolbar */}
          <div className="border-b border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm">
                  <Bold className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Italic className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Underline className="w-4 h-4" />
                </Button>
                <div className="w-px h-6 bg-gray-200 mx-2"></div>
                <Button variant="ghost" size="sm">
                  <Link className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <Quote className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  <List className="w-4 h-4" />
                </Button>
                <div className="w-px h-6 bg-gray-200 mx-2"></div>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Ask AI
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>
                  {sectionAutosave.isValidating ? 'Saving...' : 'Auto-saved'}
                  {sectionAutosave.isError && ' (Error)'}
                </span>
              </div>
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 relative">
            <div className="h-full p-8 overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {sections.find(s => s.section_key === activeSection)?.title || 'Document'}
                  </h2>
                  <p className="text-gray-600">
                    Section {sections.findIndex(s => s.section_key === activeSection) + 1} of {sections.length} • {wordCount} words
                  </p>
                </div>

                <div className="relative">
                  <div 
                    onMouseUp={() => {
                      const selection = window.getSelection()
                      if (selection && selection.toString().length > 0) {
                        setSelectedText(selection.toString())
                        const range = selection.getRangeAt(0)
                        const rect = range.getBoundingClientRect()
                        setContextMenuPosition({ x: rect.left, y: rect.bottom + 10 })
                        setShowContextMenu(true)
                      } else {
                        setShowContextMenu(false)
                      }
                    }}
                  >
                    <ErrorBoundary fallback={<EditorErrorFallback />}>
                      <SmartEditor
                        ref={editorRef}
                        projectId={projectId}
                        content={editorContent}
                        placeholder="Start writing your research paper..."
                        onChange={(content, wordCount, charCount) => handleContentChange(content, wordCount, charCount)}
                        onBlur={handleEditorBlur}
                      />
                    </ErrorBoundary>
                  </div>

                  {/* Real-time Streaming Content Display */}
                  {isStreamingGeneration && streamedContent && (
                    <div className="mt-8 border-t border-gray-200 pt-8">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                        <h3 className="text-lg font-semibold text-gray-900">AI Generated Content (Real-time)</h3>
                        <Badge className="bg-blue-100 text-blue-800">
                          {chunkCount} chunks • {realtimeCitations.length} citations
                        </Badge>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={stopGeneration}
                          className="ml-auto"
                        >
                          Stop Generation
                        </Button>
                      </div>
                      <div className="prose max-w-none bg-blue-50 border border-blue-200 rounded-lg p-6">
                        <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                          {streamedContent}
                          <span className="animate-pulse">▋</span>
                        </div>
                      </div>
                      {streamingError && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-sm text-red-800">
                            <strong>Streaming Error:</strong> {streamingError}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Suggestion Overlay */}
                  {showAiSuggestion && currentSuggestion && currentSuggestion.type === "text" && (
                    <div className="absolute top-96 left-0 right-0">
                      <Card className="border-blue-200 bg-blue-50 mx-4">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Sparkles className="w-5 h-5 text-blue-600 mt-0.5" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-medium text-blue-900">AI Suggestion</span>
                                <Badge className="bg-blue-100 text-blue-800 text-xs">
                                  {Math.round((currentSuggestion.confidence || 0) * 100)}% confidence
                                </Badge>
                              </div>
                              <p className="text-sm text-blue-800 mb-3 italic">&quot;{currentSuggestion.content}&quot;</p>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  className="bg-blue-600 hover:bg-blue-700 text-white h-7"
                                  onClick={() => acceptAiSuggestion(currentSuggestion.id)}
                                >
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  onClick={() => rejectAiSuggestion(currentSuggestion.id)}
                                >
                                  Reject
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7">
                                  Edit
                                </Button>
                                <div className="flex items-center gap-1 ml-auto">
                                  <Button variant="ghost" size="icon" className="w-6 h-6">
                                    <ThumbsUp className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="w-6 h-6">
                                    <ThumbsDown className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Citation Suggestion */}
                  {showAiSuggestion && currentSuggestion && currentSuggestion.type === "citation" && (
                    <div className="absolute top-72 left-0 right-0">
                      <Card className="border-green-200 bg-green-50 mx-4">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Quote className="w-5 h-5 text-green-600 mt-0.5" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-medium text-green-900">Citation Suggestion</span>
                                <Badge className="bg-green-100 text-green-800 text-xs">High relevance</Badge>
                              </div>
                              <p className="text-sm text-green-800 mb-3">{currentSuggestion.content}</p>
                              {currentSuggestion.suggestedCitation && (
                                <div className="bg-white p-3 rounded border border-green-200 mb-3">
                                  <h4 className="font-medium text-sm text-gray-900 mb-1">
                                    {currentSuggestion.suggestedCitation.title}
                                  </h4>
                                  <p className="text-xs text-gray-600">
                                    {Array.isArray(currentSuggestion.suggestedCitation.authors) 
                                      ? currentSuggestion.suggestedCitation.authors.join(', ')
                                      : currentSuggestion.suggestedCitation.authors} (
                                    {currentSuggestion.suggestedCitation.year})
                                  </p>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7">
                                  Insert Citation
                                </Button>
                                <Button size="sm" variant="outline" className="h-7">
                                  View Source
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7">
                                  Not Relevant
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Context Menu for Selected Text */}
            {showContextMenu && selectedText && (
              <div
                className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
                style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
              >
                <div className="space-y-1">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => handleAiAction('rephrase')}
                  >
                    <Sparkles className="w-3 h-3 mr-2" />
                    Rephrase
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => handleAiAction('summarize')}
                  >
                    <MessageSquare className="w-3 h-3 mr-2" />
                    Summarize
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => handleAiAction('elaborate')}
                  >
                    <Plus className="w-3 h-3 mr-2" />
                    Elaborate
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => handleAiAction('find-sources')}
                  >
                    <Search className="w-3 h-3 mr-2" />
                    Find Sources
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start text-xs"
                    onClick={() => handleAiAction('check-cohesion')}
                  >
                    <CheckCircle className="w-3 h-3 mr-2" />
                    Check Cohesion
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* AI Assistant Input */}
          <div className="border-t border-gray-200 p-6">
            <div className="max-w-3xl mx-auto">
              <div className="relative">
                <Input
                  placeholder="Ask AI to help with writing, research, or analysis..."
                  value={aiMessage}
                  onChange={(e) => setAiMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAiMessage()}
                  className="pr-12 h-12 rounded-xl border-2 border-blue-200 focus:border-blue-400"
                />
                <Button 
                  size="icon" 
                  className="absolute right-2 top-2 w-8 h-8 bg-black text-white hover:bg-gray-800"
                  onClick={handleAiMessage}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-6">
                  <Button variant="ghost" size="sm" className="text-gray-500">
                    <Paperclip className="w-4 h-4 mr-2" />
                    Attach
                  </Button>
                  <Button variant="ghost" size="sm" className="text-gray-500">
                    <Mic className="w-4 h-4 mr-2" />
                    Voice
                  </Button>
                  <Button variant="ghost" size="sm" className="text-gray-500">
                    <FileText className="w-4 h-4 mr-2" />
                    Templates
                  </Button>
                </div>
                <div className="text-sm text-gray-500">
                  {sections.find(s => s.section_key === activeSection)?.title} • {wordCount} words
                </div>
              </div>

              <div className="text-xs text-center mt-3 text-gray-400">
                GenPaper AI will help you write, research, and cite. Model: GenPaper AI v1.0
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Citation Manager */}
        {!focusMode && (
          <ErrorBoundary fallback={<CitationPanelErrorFallback />}>
            <CitationPanel
              projectId={projectId}
              citations={finalDisplayCitations}
              showCitations={showCitations}
              onHideCitations={() => setShowCitations(false)}
              onCopyBibliography={handleCopyBibliography}
            />
          </ErrorBoundary>
        )}
      </div>

      {/* Project Setup Modal */}
      <ProjectSetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        onComplete={handleCompleteSetup}
        initialTitle={project?.title || ''}
        isLoading={isSettingUp}
      />
    </ProjectWorkspaceErrorBoundary>
  )
} 