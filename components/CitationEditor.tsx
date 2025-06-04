'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Save, 
  X, 
  Plus, 
  Minus, 
  AlertCircle, 
  CheckCircle2,
  Calendar,
  User,
  Building,
  ExternalLink,
  FileText,
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
  [key: string]: any
}

interface CitationEditorProps {
  citation: {
    id: string
    key: string
    csl_json: Record<string, any>
    project_id: string
  } | null
  isOpen: boolean
  onClose: () => void
  onSave: (updatedCitation: any) => void
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
        if (cleanedData[key] === '' || cleanedData[key] === null) {
          delete cleanedData[key]
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
    const yearNum = parseInt(year)
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
            {citation ? 'Edit Citation' : 'Add Citation'}
          </DialogTitle>
          <DialogDescription>
            Edit the citation metadata. All changes will be reflected in your bibliography.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Error Messages */}
            {error && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {validationErrors.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <p className="font-medium">Please fix the following errors:</p>
                    <ul className="list-disc list-inside text-sm">
                      {validationErrors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="type">Publication Type *</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CSL_TYPES.map(type => (
                        <SelectItem key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Textarea
                    id="title"
                    value={formData.title || ''}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Enter the publication title"
                    rows={2}
                  />
                </div>

                <div>
                  <Label htmlFor="abstract">Abstract</Label>
                  <Textarea
                    id="abstract"
                    value={formData.abstract || ''}
                    onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                    placeholder="Enter the abstract (optional)"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Authors */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Authors *
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {formData.author?.map((author, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 border rounded-lg">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Given Name</Label>
                        <Input
                          value={author.given || ''}
                          onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                          placeholder="First name"
                          size="sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Family Name</Label>
                        <Input
                          value={author.family || ''}
                          onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                          placeholder="Last name"
                          size="sm"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAuthor(index)}
                      disabled={(formData.author?.length || 0) <= 1}
                      className="h-8 w-8 p-0"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAuthor}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Author
                </Button>
              </CardContent>
            </Card>

            {/* Publication Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Publication Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="year">Publication Year</Label>
                    <Input
                      id="year"
                      type="number"
                      value={currentYear}
                      onChange={(e) => updateYear(e.target.value)}
                      placeholder="2024"
                      min="1800"
                      max={new Date().getFullYear() + 10}
                    />
                  </div>
                  <div>
                    <Label htmlFor="container-title">Journal/Container</Label>
                    <Input
                      id="container-title"
                      value={formData['container-title'] || ''}
                      onChange={(e) => setFormData({ ...formData, 'container-title': e.target.value })}
                      placeholder="Journal or conference name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="volume">Volume</Label>
                    <Input
                      id="volume"
                      value={formData.volume || ''}
                      onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                      placeholder="Vol. number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="issue">Issue</Label>
                    <Input
                      id="issue"
                      value={formData.issue || ''}
                      onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                      placeholder="Issue number"
                    />
                  </div>
                  <div>
                    <Label htmlFor="page">Page Range</Label>
                    <Input
                      id="page"
                      value={formData.page || ''}
                      onChange={(e) => setFormData({ ...formData, page: e.target.value })}
                      placeholder="123-456"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="publisher">Publisher</Label>
                    <Input
                      id="publisher"
                      value={formData.publisher || ''}
                      onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                      placeholder="Publisher name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="publisher-place">Publisher Location</Label>
                    <Input
                      id="publisher-place"
                      value={formData['publisher-place'] || ''}
                      onChange={(e) => setFormData({ ...formData, 'publisher-place': e.target.value })}
                      placeholder="City, Country"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Identifiers & Links */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Identifiers & Links
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="doi">DOI</Label>
                  <Input
                    id="doi"
                    value={formData.DOI || ''}
                    onChange={(e) => setFormData({ ...formData, DOI: e.target.value })}
                    placeholder="10.1000/xyz123"
                  />
                </div>

                <div>
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    value={formData.URL || ''}
                    onChange={(e) => setFormData({ ...formData, URL: e.target.value })}
                    placeholder="https://example.com/article"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="issn">ISSN</Label>
                    <Input
                      id="issn"
                      value={formData.ISSN || ''}
                      onChange={(e) => setFormData({ ...formData, ISSN: e.target.value })}
                      placeholder="1234-5678"
                    />
                  </div>
                  <div>
                    <Label htmlFor="isbn">ISBN</Label>
                    <Input
                      id="isbn"
                      value={formData.ISBN || ''}
                      onChange={(e) => setFormData({ ...formData, ISBN: e.target.value })}
                      placeholder="978-0-123456-78-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Additional Fields */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="keyword">Keywords</Label>
                  <Input
                    id="keyword"
                    value={formData.keyword || ''}
                    onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                    placeholder="keyword1, keyword2, keyword3"
                  />
                </div>

                <div>
                  <Label htmlFor="note">Notes</Label>
                  <Textarea
                    id="note"
                    value={formData.note || ''}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    placeholder="Additional notes about this citation"
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />}
            {citation ? 'Update Citation' : 'Add Citation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 