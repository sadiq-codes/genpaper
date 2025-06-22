'use client'

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Minus, Save, X } from 'lucide-react'
import type { CSLItem, CSLAuthor } from '@/lib/utils/csl'

interface CitationEditorProps {
  citationId: string
  initialCsl?: CSLItem
  onSave: (csl: CSLItem) => void
  onCancel: () => void
}

const PUBLICATION_TYPES = [
  { value: 'article-journal', label: 'Journal Article' },
  { value: 'article', label: 'Article' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'paper-conference', label: 'Conference Paper' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'report', label: 'Report' },
  { value: 'webpage', label: 'Web Page' },
  { value: 'manuscript', label: 'Manuscript' }
]

export function CitationEditor({ citationId, initialCsl, onSave, onCancel }: CitationEditorProps) {
  const [csl, setCsl] = useState<CSLItem>(() => {
    if (initialCsl) {
      return { ...initialCsl }
    }
    
    // Default CSL structure
    return {
      id: citationId,
      type: 'article-journal',
      title: '',
      author: [{ family: '', given: '' }],
      issued: { 'date-parts': [[new Date().getFullYear()]] }
    }
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!csl.title?.trim()) {
      newErrors.title = 'Title is required'
    }

    if (!csl.author || csl.author.length === 0) {
      newErrors.authors = 'At least one author is required'
    } else {
      const hasValidAuthor = csl.author.some(author => 
        (author.family && author.family.trim()) || 
        (author.literal && author.literal.trim())
      )
      if (!hasValidAuthor) {
        newErrors.authors = 'At least one author must have a name'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle form submission
  const handleSave = async () => {
    if (!validateForm()) {
      return
    }

    // Clean up the CSL object
    const cleanedCsl: CSLItem = {
      ...csl,
      title: csl.title?.trim(),
      author: csl.author?.filter(author => 
        (author.family && author.family.trim()) || 
        (author.literal && author.literal.trim())
      ).map(author => ({
        ...author,
        family: author.family?.trim() || '',
        given: author.given?.trim() || ''
      }))
    }

    // Remove empty optional fields
    Object.keys(cleanedCsl).forEach(key => {
      const value = (cleanedCsl as any)[key]
      if (value === '' || value === null || value === undefined) {
        delete (cleanedCsl as any)[key]
      }
    })

    // Save citation fields to database if this is a paper citation
    if (citationId && cleanedCsl.volume || cleanedCsl.issue || cleanedCsl.page) {
      try {
        const response = await fetch('/api/papers/update-citation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paperId: citationId,
            citationData: {
              volume: cleanedCsl.volume,
              issue: cleanedCsl.issue,
              page: cleanedCsl.page,
              publisher: cleanedCsl.publisher,
              isbn: cleanedCsl.ISBN,
              issn: cleanedCsl.ISSN
            }
          })
        })

        if (!response.ok) {
          console.warn('Failed to save citation fields to database')
        }
      } catch (error) {
        console.warn('Error saving citation fields:', error)
      }
    }

    onSave(cleanedCsl)
  }

  // Update basic field
  const updateField = (field: keyof CSLItem, value: any) => {
    setCsl(prev => ({ ...prev, [field]: value }))
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  // Update author
  const updateAuthor = (index: number, field: keyof CSLAuthor, value: string) => {
    setCsl(prev => ({
      ...prev,
      author: prev.author?.map((author, i) => 
        i === index ? { ...author, [field]: value } : author
      ) || []
    }))
    // Clear authors error
    if (errors.authors) {
      setErrors(prev => ({ ...prev, authors: '' }))
    }
  }

  // Add author
  const addAuthor = () => {
    setCsl(prev => ({
      ...prev,
      author: [...(prev.author || []), { family: '', given: '' }]
    }))
  }

  // Remove author
  const removeAuthor = (index: number) => {
    setCsl(prev => ({
      ...prev,
      author: prev.author?.filter((_, i) => i !== index) || []
    }))
  }

  // Update publication year
  const updateYear = (year: string) => {
    const yearNum = parseInt(year)
    if (!isNaN(yearNum) && yearNum > 0) {
      setCsl(prev => ({
        ...prev,
        issued: { 'date-parts': [[yearNum]] }
      }))
    }
  }

  // Get current year
  const getCurrentYear = (): number => {
    return csl.issued?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
  }

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Citation</DialogTitle>
          <div className="text-sm text-gray-500">
            Citation ID: <code className="bg-gray-100 px-1 rounded">{citationId}</code>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Publication Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Publication Type</Label>
            <Select value={csl.type} onValueChange={(value) => updateField('type', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PUBLICATION_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={csl.title || ''}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Enter the title"
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && (
              <p className="text-sm text-red-600">{errors.title}</p>
            )}
          </div>

          {/* Authors */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Authors *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAuthor}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Author
              </Button>
            </div>
            
            {csl.author?.map((author, index) => (
              <div key={index} className="flex items-center space-x-2 p-3 border rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <Input
                    placeholder="First name"
                    value={author.given || ''}
                    onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                  />
                  <Input
                    placeholder="Last name"
                    value={author.family || ''}
                    onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                  />
                </div>
                {(csl.author?.length || 0) > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeAuthor(index)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            
            {errors.authors && (
              <p className="text-sm text-red-600">{errors.authors}</p>
            )}
          </div>

          {/* Publication Year */}
          <div className="space-y-2">
            <Label htmlFor="year">Publication Year</Label>
            <Input
              id="year"
              type="number"
              min="1000"
              max="2030"
              value={getCurrentYear()}
              onChange={(e) => updateYear(e.target.value)}
              placeholder="YYYY"
            />
          </div>

          {/* Journal/Container Title */}
          <div className="space-y-2">
            <Label htmlFor="container-title">
              {csl.type === 'article-journal' ? 'Journal Name' : 
               csl.type === 'book' ? 'Publisher' : 
               csl.type === 'chapter' ? 'Book Title' : 
               'Container Title'}
            </Label>
            <Input
              id="container-title"
              value={csl['container-title'] || ''}
              onChange={(e) => updateField('container-title', e.target.value)}
              placeholder={
                csl.type === 'article-journal' ? 'e.g., Nature, Science' :
                csl.type === 'book' ? 'e.g., Academic Press' :
                csl.type === 'chapter' ? 'e.g., Handbook of Research' :
                'Enter container title'
              }
            />
          </div>

          {/* Volume, Issue, Pages (for journal articles) */}
          {csl.type === 'article-journal' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="volume">Volume</Label>
                <Input
                  id="volume"
                  value={csl.volume || ''}
                  onChange={(e) => updateField('volume', e.target.value)}
                  placeholder="e.g., 123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue">Issue</Label>
                <Input
                  id="issue"
                  value={csl.issue || ''}
                  onChange={(e) => updateField('issue', e.target.value)}
                  placeholder="e.g., 4"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page">Pages</Label>
                <Input
                  id="page"
                  value={csl.page || ''}
                  onChange={(e) => updateField('page', e.target.value)}
                  placeholder="e.g., 123-145"
                />
              </div>
            </div>
          )}

          {/* DOI */}
          <div className="space-y-2">
            <Label htmlFor="doi">DOI</Label>
            <Input
              id="doi"
              value={csl.DOI || ''}
              onChange={(e) => updateField('DOI', e.target.value)}
              placeholder="e.g., 10.1000/182"
            />
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              type="url"
              value={csl.URL || ''}
              onChange={(e) => updateField('URL', e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          {/* Abstract */}
          <div className="space-y-2">
            <Label htmlFor="abstract">Abstract</Label>
            <Textarea
              id="abstract"
              value={csl.abstract || ''}
              onChange={(e) => updateField('abstract', e.target.value)}
              placeholder="Enter abstract (optional)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" />
            Save Citation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 