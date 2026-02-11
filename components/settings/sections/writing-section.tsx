'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Check, Sparkles, BookOpen, Keyboard } from 'lucide-react'
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
  initialAutoSuggestions: boolean
  initialIncludeCitations: boolean
  initialAcceptKey: 'tab' | 'ctrlEnter'
}

export function WritingSection({ 
  initialCitationStyle, 
  initialPaperType,
  initialAutoSuggestions,
  initialIncludeCitations,
  initialAcceptKey,
}: WritingSectionProps) {
  const [citationStyle, setCitationStyle] = useState(initialCitationStyle || 'apa')
  const [defaultPaperType, setDefaultPaperType] = useState(initialPaperType || 'literatureReview')
  const [autoSuggestions, setAutoSuggestions] = useState(initialAutoSuggestions)
  const [includeCitations, setIncludeCitations] = useState(initialIncludeCitations)
  const [acceptKey, setAcceptKey] = useState<'tab' | 'ctrlEnter'>(initialAcceptKey)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const checkForChanges = (
    style: string,
    paperType: string,
    auto: boolean,
    citations: boolean,
    key: 'tab' | 'ctrlEnter',
  ) => {
    setHasChanges(
      style !== initialCitationStyle || 
      paperType !== initialPaperType ||
      auto !== initialAutoSuggestions ||
      citations !== initialIncludeCitations ||
      key !== initialAcceptKey
    )
  }

  const handleStyleChange = (value: string) => {
    setCitationStyle(value)
    checkForChanges(value, defaultPaperType, autoSuggestions, includeCitations, acceptKey)
  }

  const handlePaperTypeChange = (value: string) => {
    setDefaultPaperType(value)
    checkForChanges(citationStyle, value, autoSuggestions, includeCitations, acceptKey)
  }

  const handleAutoSuggestionsChange = (value: boolean) => {
    setAutoSuggestions(value)
    checkForChanges(citationStyle, defaultPaperType, value, includeCitations, acceptKey)
  }

  const handleIncludeCitationsChange = (value: boolean) => {
    setIncludeCitations(value)
    checkForChanges(citationStyle, defaultPaperType, autoSuggestions, value, acceptKey)
  }

  const handleAcceptKeyChange = (value: 'tab' | 'ctrlEnter') => {
    setAcceptKey(value)
    checkForChanges(citationStyle, defaultPaperType, autoSuggestions, includeCitations, value)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          citationStyle,
          defaultPaperType,
          autoSuggestions,
          includeCitations,
          acceptKey,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      toast.success('Writing & editor settings saved')
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
        <h2 className="font-instrument text-xl tracking-tight">Writing & Editor</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Citation style, paper defaults, and AI autocomplete
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

      {/* AI Autocomplete */}
      <div className="rounded-xl border border-border/40 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">AI Autocomplete</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control how AI suggestions appear while you write
          </p>
        </div>

        <div className="space-y-5">
          {/* Auto Suggestions Toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <Label htmlFor="auto-suggestions" className="flex items-center gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span>Enable Auto Suggestions</span>
              </Label>
              <p className="text-[11px] text-muted-foreground ml-[22px]">
                Show AI completions as you type
              </p>
            </div>
            <Switch
              id="auto-suggestions"
              checked={autoSuggestions}
              onCheckedChange={handleAutoSuggestionsChange}
            />
          </div>

          {/* Include Citations Toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <Label htmlFor="include-citations" className="flex items-center gap-2 text-xs">
                <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span>Include Citations</span>
              </Label>
              <p className="text-[11px] text-muted-foreground ml-[22px]">
                AI suggestions include relevant citations from your library
              </p>
            </div>
            <Switch
              id="include-citations"
              checked={includeCitations}
              onCheckedChange={handleIncludeCitationsChange}
            />
          </div>

          {/* Accept Key Selector */}
          <div className="space-y-2">
            <Label htmlFor="accept-key" className="flex items-center gap-2 text-xs">
              <Keyboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Accept Suggestion Key
            </Label>
            <Select value={acceptKey} onValueChange={handleAcceptKeyChange}>
              <SelectTrigger className="w-full sm:max-w-xs">
                <SelectValue placeholder="Select key…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tab">Tab</SelectItem>
                <SelectItem value="ctrlEnter">Ctrl&nbsp;+&nbsp;Enter</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Keyboard shortcut to accept AI suggestions
            </p>
          </div>
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
