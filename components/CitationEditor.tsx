'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Plus, 
  Minus, 
  AlertCircle, 
  User,
  Edit
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// CSL-JSON types
interface CSLAuthor {
  family?: string
  given?: string
  literal?: string
}

interface CSLDate {
  'date-parts'?: number[][]
  literal?: string
}

interface CSLItem {
  id?: string
  type: string
  title?: string
  author?: CSLAuthor[]
  issued?: CSLDate
  'container-title'?: string
  volume?: string | number
  issue?: string | number
  page?: string
  DOI?: string
  URL?: string
  ISSN?: string
  ISBN?: string
  publisher?: string
  'publisher-place'?: string
  abstract?: string
  keyword?: string
  note?: string
}

interface CitationEditorProps {
  citation: {
    id: string
    key: string
    csl_json: CSLItem
    project_id: string
  } | null
  isOpen: boolean
  onClose: () => void
  onSave: (updatedCitation: { id: string; key: string; csl_json: CSLItem; project_id: string }) => void
}

const CSL_TYPES = [
  'article',
  'article-journal',
  'article-magazine',
  'article-newspaper',
  'book',
  'chapter',
  'paper-conference',
  'thesis',
  'webpage',
  'report',
  'dataset',
  'software',
  'patent',
  'manuscript',
  'personal_communication'
]

export default function CitationEditor({ citation, isOpen, onClose, onSave }: CitationEditorProps) {
  const [formData, setFormData] = useState<CSLItem>({
    type: 'article-journal',
    title: '',
    author: [{ given: '', family: '' }],
    issued: { 'date-parts': [[new Date().getFullYear()]] }
  })
  const [loading, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Initialize form data when citation changes
  useEffect(() => {
    if (citation?.csl_json) {
      setFormData({ ...citation.csl_json })
    } else {
      setFormData({
        type: 'article-journal',
        title: '',
        author: [{ given: '', family: '' }],
        issued: { 'date-parts': [[new Date().getFullYear()]] }
      })
    }
    setError(null)
    setValidationErrors([])
  }, [citation])

  // Validate form
  const validateForm = (): string[] => {
    const errors: string[] = []

    if (!formData.title?.trim()) {
      errors.push('Title is required')
    }

    if (!formData.author || formData.author.length === 0) {
      errors.push('At least one author is required')
    } else {
      const hasValidAuthor = formData.author.some(author => 
        (author.family?.trim() || author.given?.trim() || author.literal?.trim())
      )
      if (!hasValidAuthor) {
        errors.push('At least one author must have a name')
      }
    }

    if (!formData.type) {
      errors.push('Publication type is required')
    }

    if (formData.DOI && !/^10\.\d+\//.test(formData.DOI)) {
      errors.push('DOI format is invalid')
    }

    if (formData.URL && !/^https?:\/\//.test(formData.URL)) {
      errors.push('URL must start with http:// or https://')
    }

    return errors
  }

  // Handle form submission
  const handleSave = async () => {
    const errors = validateForm()
    setValidationErrors(errors)

    if (errors.length > 0) {
      return
    }

    try {
      setSaving(true)
      setError(null)

      // Clean up form data
      const cleanedData = { ...formData }
      
      // Remove empty authors
      if (cleanedData.author) {
        cleanedData.author = cleanedData.author.filter(author =>
          author.family?.trim() || author.given?.trim() || author.literal?.trim()
        )
      }

      // Remove empty fields
      Object.keys(cleanedData).forEach(key => {
        const K = key as keyof CSLItem;
        if (cleanedData[K] === '' || cleanedData[K] === null) {
          delete cleanedData[K]
        }
      })

      if (citation) {
        // Update existing citation
        const supabase = createClient()
        const { error: updateError } = await supabase
          .from('citations')
          .update({ 
            csl_json: cleanedData,
            updated_at: new Date().toISOString()
          })
          .eq('id', citation.id)

        if (updateError) throw updateError

        onSave({
          ...citation,
          csl_json: cleanedData
        })
      }

      onClose()
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save citation')
    } finally {
      setSaving(false)
    }
  }

  // Handle author changes
  const updateAuthor = (index: number, field: keyof CSLAuthor, value: string) => {
    const newAuthors = [...(formData.author || [])]
    newAuthors[index] = { ...newAuthors[index], [field]: value }
    setFormData({ ...formData, author: newAuthors })
  }

  const addAuthor = () => {
    const newAuthors = [...(formData.author || []), { given: '', family: '' }]
    setFormData({ ...formData, author: newAuthors })
  }

  const removeAuthor = (index: number) => {
    if ((formData.author?.length || 0) <= 1) return
    const newAuthors = formData.author?.filter((_, i) => i !== index) || []
    setFormData({ ...formData, author: newAuthors })
  }

  // Handle date changes
  const updateYear = (year: string) => {
    const yearNum = parseInt(year, 10)
    if (!isNaN(yearNum)) {
      setFormData({
        ...formData,
        issued: { 'date-parts': [[yearNum]] }
      })
    }
  }

  const currentYear = formData.issued?.['date-parts']?.[0]?.[0] || new Date().getFullYear()

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            {citation ? 'Edit Citation' : 'Create New Citation'}
          </DialogTitle>
          <DialogDescription>
            Modify the citation details below. Fields marked with an asterisk are required.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] p-4">
          <div className="space-y-6">
            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Core Fields */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Core Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Publication Type *</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CSL_TYPES.map(type => (
                        <SelectItem key={type} value={type}>
                          {type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={formData.title || ''}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Year *</Label>
                  <Input
                    type="number"
                    value={currentYear}
                    onChange={(e) => updateYear(e.target.value)}
                    placeholder="YYYY"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Authors */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Authors *</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {formData.author?.map((author, index) => (
                  <div key={index} className="flex items-start gap-2 p-2 border rounded">
                    <User className="h-5 w-5 mt-2 text-muted-foreground" />
                    <div className="flex-grow space-y-2">
                       <div className="flex gap-2">
                         <Input
                          placeholder="Given Name"
                          value={author.given || ''}
                          onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                        />
                        <Input
                          placeholder="Family Name"
                          value={author.family || ''}
                          onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                        />
                       </div>
                       <Input
                        placeholder="Or, Literal Name (e.g., 'OpenAI Team')"
                        value={author.literal || ''}
                        onChange={(e) => updateAuthor(index, 'literal', e.target.value)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAuthor(index)}
                      disabled={(formData.author?.length || 0) <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addAuthor}>
                  <Plus className="h-4 w-4 mr-2" /> Add Author
                </Button>
              </CardContent>
            </Card>

            {/* Publication Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Publication Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="container-title">Journal / Book Title</Label>
                      <Input
                        id="container-title"
                        value={formData['container-title'] || ''}
                        onChange={(e) => setFormData({ ...formData, 'container-title': e.target.value })}
                      />
                    </div>
                     <div className="space-y-2">
                      <Label htmlFor="publisher">Publisher</Label>
                      <Input
                        id="publisher"
                        value={formData.publisher || ''}
                        onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="volume">Volume</Label>
                      <Input
                        id="volume"
                        value={formData.volume || ''}
                        onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="issue">Issue</Label>
                      <Input
                        id="issue"
                        value={formData.issue || ''}
                        onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="page">Pages</Label>
                      <Input
                        id="page"
                        value={formData.page || ''}
                        onChange={(e) => setFormData({ ...formData, page: e.target.value })}
                      />
                    </div>
                 </div>
              </CardContent>
            </Card>

            {/* Identifiers */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Identifiers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="DOI">DOI</Label>
                      <Input
                        id="DOI"
                        value={formData.DOI || ''}
                        onChange={(e) => setFormData({ ...formData, DOI: e.target.value })}
                        placeholder="e.g., 10.1109/5.771073"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="URL">URL</Label>
                      <Input
                        id="URL"
                        value={formData.URL || ''}
                        onChange={(e) => setFormData({ ...formData, URL: e.target.value })}
                        placeholder="https://example.com/paper.pdf"
                      />
                    </div>
                 </div>
              </CardContent>
            </Card>

            {/* Abstract & Notes */}
            <Card>
               <CardHeader>
                <CardTitle className="text-lg">Abstract & Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="space-y-2">
                    <Label htmlFor="abstract">Abstract</Label>
                    <Textarea
                      id="abstract"
                      value={formData.abstract || ''}
                      onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                      rows={5}
                    />
                  </div>
                   <div className="space-y-2">
                    <Label htmlFor="note">Notes</Label>
                    <Textarea
                      id="note"
                      value={formData.note || ''}
                      onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      rows={3}
                    />
                  </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
        
        <DialogFooter className="pt-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Citation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 