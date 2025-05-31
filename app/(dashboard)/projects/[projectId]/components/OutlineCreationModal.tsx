'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, BookOpen, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

export interface OutlineTemplate {
  id: string
  name: string
  description: string
  sections: Array<{
    section_key: string
    title: string
    order: number
    description?: string
  }>
}

export const PREDEFINED_TEMPLATES: OutlineTemplate[] = [
  {
    id: 'standard-research',
    name: 'Standard Research Paper',
    description: 'Traditional academic research paper structure',
    sections: [
      { section_key: 'abstract', title: 'Abstract', order: 1, description: 'Brief summary of the research' },
      { section_key: 'introduction', title: 'Introduction', order: 2, description: 'Background and research questions' },
      { section_key: 'literature', title: 'Literature Review', order: 3, description: 'Review of existing research' },
      { section_key: 'methodology', title: 'Methodology', order: 4, description: 'Research methods and approach' },
      { section_key: 'results', title: 'Results', order: 5, description: 'Findings and data analysis' },
      { section_key: 'discussion', title: 'Discussion', order: 6, description: 'Interpretation of results' },
      { section_key: 'conclusion', title: 'Conclusion', order: 7, description: 'Summary and future work' },
      { section_key: 'references', title: 'References', order: 8, description: 'Bibliography' }
    ]
  },
  {
    id: 'experimental-study',
    name: 'Experimental Study',
    description: 'Structure for experimental research papers',
    sections: [
      { section_key: 'abstract', title: 'Abstract', order: 1 },
      { section_key: 'introduction', title: 'Introduction', order: 2 },
      { section_key: 'background', title: 'Background & Related Work', order: 3 },
      { section_key: 'hypothesis', title: 'Hypothesis', order: 4 },
      { section_key: 'experimental_design', title: 'Experimental Design', order: 5 },
      { section_key: 'results', title: 'Results', order: 6 },
      { section_key: 'analysis', title: 'Analysis', order: 7 },
      { section_key: 'discussion', title: 'Discussion', order: 8 },
      { section_key: 'limitations', title: 'Limitations', order: 9 },
      { section_key: 'conclusion', title: 'Conclusion', order: 10 },
      { section_key: 'references', title: 'References', order: 11 }
    ]
  },
  {
    id: 'review-paper',
    name: 'Review Paper',
    description: 'Systematic or narrative review structure',
    sections: [
      { section_key: 'abstract', title: 'Abstract', order: 1 },
      { section_key: 'introduction', title: 'Introduction', order: 2 },
      { section_key: 'scope', title: 'Scope & Criteria', order: 3 },
      { section_key: 'methodology', title: 'Review Methodology', order: 4 },
      { section_key: 'findings', title: 'Key Findings', order: 5 },
      { section_key: 'synthesis', title: 'Synthesis', order: 6 },
      { section_key: 'gaps', title: 'Research Gaps', order: 7 },
      { section_key: 'recommendations', title: 'Recommendations', order: 8 },
      { section_key: 'conclusion', title: 'Conclusion', order: 9 },
      { section_key: 'references', title: 'References', order: 10 }
    ]
  },
  {
    id: 'case-study',
    name: 'Case Study',
    description: 'Case study research paper structure',
    sections: [
      { section_key: 'abstract', title: 'Abstract', order: 1 },
      { section_key: 'introduction', title: 'Introduction', order: 2 },
      { section_key: 'literature', title: 'Literature Review', order: 3 },
      { section_key: 'case_background', title: 'Case Background', order: 4 },
      { section_key: 'methodology', title: 'Methodology', order: 5 },
      { section_key: 'case_description', title: 'Case Description', order: 6 },
      { section_key: 'analysis', title: 'Analysis', order: 7 },
      { section_key: 'discussion', title: 'Discussion', order: 8 },
      { section_key: 'implications', title: 'Implications', order: 9 },
      { section_key: 'conclusion', title: 'Conclusion', order: 10 },
      { section_key: 'references', title: 'References', order: 11 }
    ]
  }
]

interface OutlineCreationModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateOutline: (sections: OutlineTemplate['sections'], outlineText?: string) => Promise<void>
  projectTitle: string
  isLoading?: boolean
}

export function OutlineCreationModal({
  isOpen,
  onClose,
  onCreateOutline,
  projectTitle,
  isLoading = false
}: OutlineCreationModalProps) {
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

  const handleCreateOutline = async () => {
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

    await onCreateOutline(sections, outlineText)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project Outline</DialogTitle>
          <DialogDescription>
            Choose how you'd like to structure your research paper: "{projectTitle}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
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
              <h3 className="font-medium">Choose a Template</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PREDEFINED_TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedTemplate === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedTemplate(template.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-sm">{template.name}</h4>
                        <p className="text-xs text-gray-600 mt-1">{template.description}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {template.sections.length} sections
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <div className="text-xs text-gray-500">
                        {template.sections.slice(0, 4).map(s => s.title).join(' • ')}
                        {template.sections.length > 4 && ' • ...'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Preview Selected Template */}
              {selectedTemplate && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium text-sm mb-3">Template Preview</h4>
                  <div className="space-y-2">
                    {PREDEFINED_TEMPLATES.find(t => t.id === selectedTemplate)?.sections.map((section, index) => (
                      <div key={section.section_key} className="flex items-center gap-3 text-sm">
                        <span className="text-gray-500 w-6">{index + 1}.</span>
                        <span className="font-medium">{section.title}</span>
                        {section.description && (
                          <span className="text-gray-500 text-xs">— {section.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                  <h4 className="font-medium text-sm mb-3">Generated Outline</h4>
                  <div className="bg-white p-3 rounded border text-sm">
                    <pre className="whitespace-pre-wrap font-sans">{generatedOutline}</pre>
                  </div>
                  
                  {aiSections.length > 0 && (
                    <div className="mt-3">
                      <h5 className="font-medium text-xs text-gray-700 mb-2">Parsed Sections:</h5>
                      <div className="space-y-1">
                        {aiSections.map((section, index) => (
                          <div key={section.section_key} className="flex items-center gap-3 text-xs">
                            <span className="text-gray-500 w-6">{index + 1}.</span>
                            <span className="font-medium">{section.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Custom Sections */}
          {outlineType === 'custom' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Custom Sections</h3>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateOutline}
            disabled={isLoading || (outlineType === 'ai' && !generatedOutline)}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Outline'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 