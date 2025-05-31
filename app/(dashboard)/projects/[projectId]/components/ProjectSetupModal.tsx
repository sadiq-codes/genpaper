'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, BookOpen, Plus, X, Edit3 } from 'lucide-react'
import { toast } from 'sonner'
import { PREDEFINED_TEMPLATES, type OutlineTemplate } from './OutlineCreationModal'

interface ProjectSetupModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (data: {
    title: string
    sections: OutlineTemplate['sections']
    outlineText?: string
  }) => Promise<void>
  initialTitle: string
  isLoading?: boolean
}

export function ProjectSetupModal({
  isOpen,
  onClose,
  onComplete,
  initialTitle,
  isLoading = false
}: ProjectSetupModalProps) {
  const [projectTitle, setProjectTitle] = useState(initialTitle)
  const [outlineType, setOutlineType] = useState<'ai' | 'template' | 'custom'>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard-research')
  const [customSections, setCustomSections] = useState<string[]>([''])
  const [aiPrompt, setAiPrompt] = useState('')
  const [generatedOutline, setGeneratedOutline] = useState<string>('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiSections, setAiSections] = useState<OutlineTemplate['sections']>([])

  const handleGenerateAiOutline = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please provide requirements for your outline')
      return
    }

    setAiGenerating(true)
    try {
      const response = await fetch('/api/research/generate/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicTitle: projectTitle,
          requirements: aiPrompt
        })
      })

      if (!response.ok) throw new Error('Failed to generate outline')

      const data = await response.json()
      setGeneratedOutline(data.outline)
      
      // Parse the generated outline into sections
      const parsedSections = parseAiOutlineToSections(data.outline)
      setAiSections(parsedSections)
      
      toast.success('AI outline generated successfully!')
    } catch (error) {
      console.error('Error generating AI outline:', error)
      toast.error('Failed to generate AI outline')
    } finally {
      setAiGenerating(false)
    }
  }

  const parseAiOutlineToSections = (outline: string): OutlineTemplate['sections'] => {
    const lines = outline.split('\n').filter(line => line.trim())
    const sections: OutlineTemplate['sections'] = []
    let order = 1

    for (const line of lines) {
      const trimmed = line.trim()
      // Match numbered sections like "1. Introduction" or "1) Introduction"
      const match = trimmed.match(/^\d+[\.\)]\s*(.+)$/)
      if (match) {
        const title = match[1].trim()
        const section_key = title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_')
        
        sections.push({
          section_key,
          title,
          order: order++
        })
      }
    }

    return sections
  }

  const handleAddCustomSection = () => {
    setCustomSections([...customSections, ''])
  }

  const handleUpdateCustomSection = (index: number, value: string) => {
    const updated = [...customSections]
    updated[index] = value
    setCustomSections(updated)
  }

  const handleRemoveCustomSection = (index: number) => {
    if (customSections.length > 1) {
      const updated = customSections.filter((_, i) => i !== index)
      setCustomSections(updated)
    }
  }

  const handleComplete = async () => {
    if (!projectTitle.trim()) {
      toast.error('Please provide a project title')
      return
    }

    let sections: OutlineTemplate['sections'] = []
    let outlineText: string | undefined

    switch (outlineType) {
      case 'template':
        const template = PREDEFINED_TEMPLATES.find(t => t.id === selectedTemplate)
        if (template) {
          sections = template.sections
        }
        break
      
      case 'ai':
        if (!generatedOutline) {
          toast.error('Please generate an AI outline first')
          return
        }
        sections = aiSections
        outlineText = generatedOutline
        break
      
      case 'custom':
        const validSections = customSections.filter(s => s.trim())
        if (validSections.length === 0) {
          toast.error('Please add at least one section')
          return
        }
        sections = validSections.map((title, index) => ({
          section_key: title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_'),
          title: title.trim(),
          order: index + 1
        }))
        break
    }

    if (sections.length === 0) {
      toast.error('No sections to create')
      return
    }

    await onComplete({
      title: projectTitle.trim(),
      sections,
      outlineText
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            Complete Project Setup
          </DialogTitle>
          <DialogDescription>
            Let&apos;s finish setting up your research project with a title and outline structure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Project Title */}
          <div className="space-y-2">
            <Label htmlFor="project-title" className="flex items-center gap-2">
              <Edit3 className="w-4 h-4" />
              Project Title
            </Label>
            <Input
              id="project-title"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="Enter your research paper title..."
              className="text-lg"
            />
            <p className="text-xs text-gray-500">
              Provide a clear, specific title for your research paper
            </p>
          </div>

          {/* Outline Creation */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Create Paper Outline
            </h3>

            {/* Outline Type Selection */}
            <RadioGroup value={outlineType} onValueChange={(value) => setOutlineType(value as typeof outlineType)}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="template" id="template" />
                    <Label htmlFor="template" className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4" />
                      Standard Templates
                    </Label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    Use proven academic paper structures
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="ai" id="ai" />
                    <Label htmlFor="ai" className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      AI Generated
                    </Label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    Let AI create a custom outline for your topic
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="custom" id="custom" />
                    <Label htmlFor="custom" className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Custom Sections
                    </Label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    Define your own section structure
                  </p>
                </div>
              </div>
            </RadioGroup>

            {/* Template Selection */}
            {outlineType === 'template' && (
              <div className="space-y-4">
                <h4 className="font-medium">Choose a Template</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PREDEFINED_TEMPLATES.map((template) => (
                    <div
                      key={template.id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedTemplate === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedTemplate(template.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h5 className="font-medium text-sm">{template.name}</h5>
                          <p className="text-xs text-gray-600 mt-1">{template.description}</p>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {template.sections.length} sections
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Generation */}
            {outlineType === 'ai' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="ai-prompt">Outline Requirements</Label>
                  <Textarea
                    id="ai-prompt"
                    placeholder="Describe your research focus, methodology, key areas to cover, or any specific requirements for your paper structure..."
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    className="mt-1"
                    rows={3}
                  />
                </div>

                <Button 
                  onClick={handleGenerateAiOutline}
                  disabled={aiGenerating || !aiPrompt.trim()}
                  className="w-full"
                >
                  {aiGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate AI Outline
                    </>
                  )}
                </Button>

                {/* Generated Outline Preview */}
                {generatedOutline && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h5 className="font-medium text-sm mb-3">Generated Outline</h5>
                    <div className="bg-white p-3 rounded border text-sm max-h-32 overflow-y-auto">
                      <pre className="whitespace-pre-wrap font-sans">{generatedOutline}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Custom Sections */}
            {outlineType === 'custom' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Custom Sections</h4>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleAddCustomSection}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Section
                  </Button>
                </div>

                <div className="space-y-3">
                  {customSections.map((section, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <span className="text-sm text-gray-500 w-8">{index + 1}.</span>
                      <Input
                        placeholder="Section title"
                        value={section}
                        onChange={(e) => handleUpdateCustomSection(index, e.target.value)}
                        className="flex-1"
                      />
                      {customSections.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCustomSection(index)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button 
            onClick={handleComplete}
            disabled={isLoading || (outlineType === 'ai' && !generatedOutline)}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting up project...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Complete Setup & Start Writing
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 