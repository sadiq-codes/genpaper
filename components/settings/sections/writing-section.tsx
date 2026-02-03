'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { CitationStyleSelector } from '@/components/editor/CitationStyleSelector'
import { getStyleById } from '@/lib/citations/csl-styles'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PAPER_TYPES = [
  { value: 'literatureReview', label: 'Literature Review' },
  { value: 'researchArticle', label: 'Research Article' },
  { value: 'capstoneProject', label: 'Capstone Project' },
  { value: 'mastersThesis', label: "Master's Thesis" },
  { value: 'phdDissertation', label: 'PhD Dissertation' },
]

interface WritingSectionProps {
  initialCitationStyle: string
  initialPaperType: string
}

export function WritingSection({ 
  initialCitationStyle, 
  initialPaperType 
}: WritingSectionProps) {
  const [citationStyle, setCitationStyle] = useState(initialCitationStyle || 'apa')
  const [defaultPaperType, setDefaultPaperType] = useState(initialPaperType || 'literatureReview')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleStyleChange = (value: string) => {
    setCitationStyle(value)
    checkForChanges(value, defaultPaperType)
  }

  const handlePaperTypeChange = (value: string) => {
    setDefaultPaperType(value)
    checkForChanges(citationStyle, value)
  }

  const checkForChanges = (style: string, paperType: string) => {
    setHasChanges(
      style !== initialCitationStyle || 
      paperType !== initialPaperType
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          citationStyle,
          defaultPaperType 
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      const styleInfo = getStyleById(citationStyle)
      toast.success('Writing preferences saved', {
        description: `Citation style: ${styleInfo?.shortName || citationStyle}`,
      })
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedStyle = getStyleById(citationStyle)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Writing Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Default settings for new projects
        </p>
      </div>

      {/* Citation Style Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Citation Style</CardTitle>
          <CardDescription>
            Your default citation format for new projects and autocomplete
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6">
          <div className="space-y-2">
            <Label htmlFor="citation-style">Default Style</Label>
            <div className="w-full sm:max-w-md">
              <CitationStyleSelector
                value={citationStyle}
                onValueChange={handleStyleChange}
              />
            </div>
          </div>

          {/* Preview */}
          {selectedStyle && (
            <div className="rounded-lg bg-muted p-3 sm:p-4 text-sm w-full sm:max-w-md">
              <p className="text-muted-foreground text-xs mb-2 font-medium">Example:</p>
              <p className="text-foreground">
                Research shows significant findings{' '}
                <span className="font-semibold text-primary">{selectedStyle.inlineExample}</span>.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            You can override this per project in project settings.
          </p>
        </CardContent>
      </Card>

      {/* Default Paper Type Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Paper Type</CardTitle>
          <CardDescription>
            The default type when creating new projects
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="paper-type">Paper Type</Label>
            <Select value={defaultPaperType} onValueChange={handlePaperTypeChange}>
              <SelectTrigger className="w-full sm:max-w-md">
                <SelectValue placeholder="Select paper type…" />
              </SelectTrigger>
              <SelectContent>
                {PAPER_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
