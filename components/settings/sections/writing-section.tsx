'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
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
        <h2 className="font-instrument text-xl tracking-tight">Writing Preferences</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Default settings for new projects
        </p>
      </div>

      {/* Citation Style */}
      <div className="rounded-xl border border-border/40 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Citation Style</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your default citation format for new projects and autocomplete
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="citation-style" className="text-xs">Default Style</Label>
            <div className="w-full sm:max-w-md">
              <CitationStyleSelector
                value={citationStyle}
                onValueChange={handleStyleChange}
              />
            </div>
          </div>

          {/* Preview */}
          {selectedStyle && (
            <div className="rounded-lg bg-muted/50 p-3 sm:p-4 text-sm w-full sm:max-w-md border border-border/30">
              <p className="text-muted-foreground text-[11px] mb-2 font-medium uppercase tracking-wide">Example</p>
              <p className="text-foreground text-sm">
                Research shows significant findings{' '}
                <span className="font-semibold text-foreground">{selectedStyle.inlineExample}</span>.
              </p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            You can override this per project in project settings.
          </p>
        </div>
      </div>

      {/* Default Paper Type */}
      <div className="rounded-xl border border-border/40 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Default Paper Type</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The default type when creating new projects
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="paper-type" className="text-xs">Paper Type</Label>
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
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground/80 text-background text-sm font-medium hover:bg-foreground transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save Changes
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
