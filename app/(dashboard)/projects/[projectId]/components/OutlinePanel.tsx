'use client'

import React from 'react'
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Sparkles,
  Plus,
  GripVertical,
  Target,
  CheckCircle,
  Clock,
  Edit3,
  RefreshCw,
  X,
  Settings,
} from "lucide-react"
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OutlinePanelErrorFallback } from '@/components/ComponentErrorFallbacks'
import type { Section, SectionStatus } from "../types"

interface OutlinePanelProps {
  sections: Section[]
  activeSection: string
  showOutline: boolean
  isGeneratingFullDraft: boolean
  sessionMinutes: number
  sessionWordCount: number
  wordsPerMinute: string
  aiSuggestionsCount: number
  onSectionChange: (sectionKey: string) => void
  onGenerateFullDraft: () => void
  onHideOutline: () => void
  onCreateOutline?: () => void
}

export default function OutlinePanel({
  sections,
  activeSection,
  showOutline,
  isGeneratingFullDraft,
  sessionMinutes,
  sessionWordCount,
  wordsPerMinute,
  aiSuggestionsCount,
  onSectionChange,
  onGenerateFullDraft,
  onHideOutline,
  onCreateOutline,
}: OutlinePanelProps) {
  if (!showOutline) return null

  const getStatusIcon = (status: SectionStatus) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case "in-progress":
        return <Clock className="w-4 h-4 text-blue-600" />
      case "draft":
        return <Edit3 className="w-4 h-4 text-orange-600" />
      case "ai_drafting":
        return <RefreshCw className="w-4 h-4 text-purple-600" />
      default:
        return <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
    }
  }

  return (
    <div className="w-80 border-r border-gray-200 bg-gray-50">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
        <h3 className="font-semibold text-gray-900">Document Outline</h3>
        <div className="flex items-center gap-2">
          {onCreateOutline && (
            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onCreateOutline}>
              <Settings className="w-3 h-3" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="w-6 h-6">
            <Target className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onHideOutline}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Sections List or Empty State */}
      {sections.length === 0 ? (
        <div className="p-4">
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-6 h-6 text-gray-400" />
            </div>
            <h4 className="text-sm font-medium text-gray-900 mb-2">No outline created yet</h4>
            <p className="text-xs text-gray-500 mb-4">
              Create an outline to structure your research paper
            </p>
            {onCreateOutline && (
              <Button onClick={onCreateOutline} size="sm">
                <Plus className="w-3 h-3 mr-1" />
                Create Outline
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {sections.map((section) => (
            <div
              key={section.id}
              className={`group p-3 rounded-lg cursor-pointer transition-colors ${
                activeSection === section.section_key
                  ? "bg-blue-50 border border-blue-200"
                  : "hover:bg-white/50 border border-transparent"
              }`}
              onClick={() => onSectionChange(section.section_key)}
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
                <span>{section.word_count} words</span>
                <span>•</span>
                <span>0 AI suggestions</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="p-4 border-t border-gray-200">
        <div className="space-y-3">
          <Button 
            className="w-full bg-blue-600 hover:bg-blue-700 justify-start text-sm" 
            onClick={onGenerateFullDraft}
            disabled={isGeneratingFullDraft || sections.length === 0}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isGeneratingFullDraft ? 'Generating...' : 'Generate Full Draft'}
          </Button>
          <Button variant="outline" className="w-full justify-start text-sm" disabled={sections.length === 0}>
            <Target className="w-4 h-4 mr-2" />
            Analyze Paper Gaps
          </Button>
          <Button variant="outline" className="w-full justify-start text-sm" disabled={sections.length === 0}>
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
              <div className="text-sm font-bold text-gray-900">{aiSuggestionsCount}</div>
              <div className="text-xs text-gray-500">AI helps</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 