'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  Sparkles,
  BookOpen,
  Search,
  Plus,
  GripVertical,
  Target,
  CheckCircle,
  Clock,
  Edit3,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  Copy,
  Download,
  Mic,
  Paperclip,
  FileText,
} from "lucide-react"
import { usePaperStream } from '@/hooks/usePaperStream'
import { useRealtimeCitations } from '@/hooks/useRealtimeCitations'

interface ProjectWorkspaceNewProps {
  projectId: string
  initialProject: {
    id: string
    title: string
    status?: string
    created_at: string
  }
}

export default function ProjectWorkspaceNew({ projectId, initialProject }: ProjectWorkspaceNewProps) {
  // UI State
  const [focusMode, setFocusMode] = useState(false)
  const [showOutline, setShowOutline] = useState(true)
  const [showCitations, setShowCitations] = useState(true)
  const [activeSection, setActiveSection] = useState('introduction')

  // Real-time data hooks
  const {
    content,
    isLoading: isGenerating,
    error: generationError,
    chunkCount,
    lastUpdated,
    startGeneration,
    stopGeneration
  } = usePaperStream(projectId)

  const {
    citations,
    isLoading: citationsLoading,
    error: citationsError
  } = useRealtimeCitations(projectId)

  // Mock sections for UI (these could come from paper_sections table)
  const defaultSections = [
    { id: 'abstract', title: 'Abstract', status: 'pending' as const, wordCount: 0 },
    { id: 'introduction', title: 'Introduction', status: 'pending' as const, wordCount: 0 },
    { id: 'literature', title: 'Literature Review', status: 'pending' as const, wordCount: 0 },
    { id: 'methodology', title: 'Methodology', status: 'pending' as const, wordCount: 0 },
    { id: 'results', title: 'Results', status: 'pending' as const, wordCount: 0 },
    { id: 'discussion', title: 'Discussion', status: 'pending' as const, wordCount: 0 },
    { id: 'conclusion', title: 'Conclusion', status: 'pending' as const, wordCount: 0 },
  ]

  // Calculate stats
  const wordCount = Math.round(content.length / 5) // Rough approximation
  const sessionMinutes = 5 // Mock data
  const sessionWordCount = wordCount
  const wordsPerMinute = sessionMinutes > 0 ? Math.round(sessionWordCount / sessionMinutes).toString() : '0'

  const getStatusIcon = (status: 'pending' | 'in-progress' | 'completed' | 'draft') => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case "in-progress":
        return <Clock className="w-4 h-4 text-blue-600" />
      case "draft":
        return <Edit3 className="w-4 h-4 text-orange-600" />
      default:
        return <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
    }
  }

  const handleGenerateFullDraft = async () => {
    try {
      await startGeneration(projectId, initialProject.title)
    } catch (error) {
      console.error('Error starting generation:', error)
    }
  }

  const formatAuthors = (authors: any[]) => {
    if (!authors || authors.length === 0) return 'Unknown Authors'
    if (authors.length === 1) return `${authors[0].given} ${authors[0].family}`
    if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`
    return `${authors[0].family} et al.`
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Sidebar - Document Outline */}
      {!focusMode && showOutline && (
        <div className="w-80 border-r border-gray-200 bg-gray-50">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
            <h3 className="font-semibold text-gray-900">Document Outline</h3>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-6 h-6">
                <Target className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setShowOutline(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Sections List */}
          <div className="p-4 space-y-2">
            {defaultSections.map((section) => (
              <div
                key={section.id}
                className={`group p-3 rounded-lg cursor-pointer transition-colors ${
                  activeSection === section.id
                    ? "bg-blue-50 border border-blue-200"
                    : "hover:bg-white/50 border border-transparent"
                }`}
                onClick={() => setActiveSection(section.id)}
              >
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100" />
                  {getStatusIcon(section.status)}
                  <span className="font-medium text-sm text-gray-900 flex-1">{section.title}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="w-5 h-5">
                      <Sparkles className="w-3 h-3 text-blue-600" />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-5 h-5">
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>{section.wordCount} words</span>
                  <span>•</span>
                  <span>0 AI suggestions</span>
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-gray-200">
            <div className="space-y-3">
              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700 justify-start text-sm" 
                onClick={handleGenerateFullDraft}
                disabled={isGenerating}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {isGenerating ? 'Generating...' : 'Generate Full Draft'}
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm">
                <Target className="w-4 h-4 mr-2" />
                Analyze Paper Gaps
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm">
                <CheckCircle className="w-4 h-4 mr-2" />
                Check Cohesion
              </Button>
            </div>
          </div>

          {/* Writing Session Stats */}
          <div className="p-4 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">Writing Session</h4>
            <div className="space-y-3">
              <div className="bg-white p-3 rounded border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-700">Session Progress</span>
                  <span className="text-xs text-gray-500">{sessionMinutes} min</span>
                </div>
                <div className="text-lg font-bold text-gray-900 mb-1">{Math.abs(sessionWordCount)} words</div>
                <Progress value={Math.min((Math.abs(sessionWordCount) / 500) * 100, 100)} className="h-1.5" />
                <div className="text-xs text-gray-500 mt-1">Target: 500 words</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white p-2 rounded border border-gray-200 text-center">
                  <div className="text-sm font-bold text-gray-900">{wordsPerMinute}</div>
                  <div className="text-xs text-gray-500">WPM</div>
                </div>
                <div className="bg-white p-2 rounded border border-gray-200 text-center">
                  <div className="text-sm font-bold text-gray-900">{citations.length}</div>
                  <div className="text-xs text-gray-500">Citations</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-gray-900">{initialProject.title}</h1>
              <Badge variant="secondary">Draft</Badge>
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setFocusMode(!focusMode)}>
                {focusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                {focusMode ? 'Exit Focus' : 'Focus Mode'}
              </Button>
              <Button variant="outline" size="sm">
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex">
          {/* Document Editor */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-6">
              {/* Real-time Content Display */}
              <div className="prose max-w-none">
                {content ? (
                  <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                    {content}
                    {isGenerating && <span className="animate-pulse">▋</span>}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-12">
                    <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <h3 className="text-lg font-medium mb-2">Ready to Generate Your Research Paper</h3>
                    <p className="text-sm mb-4">Click "Generate Full Draft" to start writing with AI assistance.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Generation Status */}
            {isGenerating && (
              <div className="border-t border-gray-200 bg-blue-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                    <span className="text-sm font-medium text-blue-800">AI is writing your research paper...</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-blue-700">
                    <span>Chunks: {chunkCount}</span>
                    <span>Citations: {citations.length}</span>
                    <Button variant="outline" size="sm" onClick={stopGeneration}>
                      Stop
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Error Display */}
            {generationError && (
              <div className="border-t border-gray-200 bg-red-50 p-4">
                <div className="text-sm text-red-800">
                  <strong>Generation Error:</strong> {generationError}
                </div>
              </div>
            )}

            {/* AI Assistant Input */}
            <div className="border-t border-gray-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-blue-500 text-white text-xs">AI</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Ask AI to revise, expand, or improve your paper..."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isGenerating}
                  />
                </div>
                <Button size="sm" disabled={isGenerating}>
                  Send
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
                  {wordCount} words • Real-time • Function calling citations
                </div>
              </div>

              <div className="text-xs text-center mt-3 text-gray-400">
                GenPaper AI v2.0 - SaaS Grade with Real-time Streaming & Function Calling
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Citations */}
      {!focusMode && showCitations && (
        <div className="w-80 border-l border-gray-200 bg-white">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Citations & Sources</h3>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-6 h-6">
                <Search className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setShowCitations(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Citations List */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              {citationsLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mx-auto"></div>
                  <p className="text-sm text-gray-500 mt-2">Loading citations...</p>
                </div>
              ) : citations.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-500">No citations yet</p>
                  <p className="text-xs text-gray-400 mt-1">Citations will appear here as AI generates content</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {citations.map((citation, index) => (
                    <div key={citation.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="flex items-start space-x-3 mb-2">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-200 text-blue-800 rounded-full text-xs font-medium flex items-center justify-center">
                          {index + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <h5 className="text-sm font-medium text-gray-900 leading-tight">
                            {citation.data?.title || 'Untitled'}
                          </h5>
                          <p className="text-xs text-gray-600 mt-1">
                            {citation.data?.author ? formatAuthors(citation.data.author) : 'Unknown Authors'}
                            {citation.data?.issued && (
                              <span> ({citation.data.issued['date-parts']?.[0]?.[0] || 'n.d.'})</span>
                            )}
                          </p>
                          {citation.data?.['container-title'] && (
                            <p className="text-xs text-gray-500 italic">{citation.data['container-title']}</p>
                          )}
                        </div>
                      </div>
                      
                      {citation.links && citation.links.length > 0 && (
                        <div className="ml-9 mt-2">
                          <p className="text-xs text-gray-600">
                            Used in: {citation.links.map(link => link.section).join(', ')}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bibliography Preview */}
          <div className="border-t border-gray-200 p-4 bg-gray-50">
            <h4 className="font-semibold text-gray-900 mb-2 text-sm">Bibliography Preview</h4>
            <div className="text-xs text-gray-600 space-y-1">
              {citations.slice(0, 3).map((citation, index) => (
                <div key={citation.id} className="line-clamp-2">
                  {formatAuthors(citation.data?.author || [])} ({citation.data?.issued?.['date-parts']?.[0]?.[0] || 'n.d.'}). {citation.data?.title}. {citation.data?.['container-title']}.
                </div>
              ))}
              {citations.length > 3 && (
                <div className="text-gray-500">...and {citations.length - 3} more</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 