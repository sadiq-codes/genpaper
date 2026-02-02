'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Loader2, Check, Sparkles, BookOpen, Keyboard } from 'lucide-react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface EditorSectionProps {
  initialAutoSuggestions: boolean
  initialIncludeCitations: boolean
  initialAcceptKey: 'tab' | 'ctrlEnter'
}

export function EditorSection({
  initialAutoSuggestions,
  initialIncludeCitations,
  initialAcceptKey,
}: EditorSectionProps) {
  const [autoSuggestions, setAutoSuggestions] = useState(initialAutoSuggestions)
  const [includeCitations, setIncludeCitations] = useState(initialIncludeCitations)
  const [acceptKey, setAcceptKey] = useState<'tab' | 'ctrlEnter'>(initialAcceptKey)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const checkForChanges = (
    auto: boolean,
    citations: boolean,
    key: 'tab' | 'ctrlEnter'
  ) => {
    setHasChanges(
      auto !== initialAutoSuggestions ||
      citations !== initialIncludeCitations ||
      key !== initialAcceptKey
    )
  }

  const handleAutoSuggestionsChange = (value: boolean) => {
    setAutoSuggestions(value)
    checkForChanges(value, includeCitations, acceptKey)
  }

  const handleIncludeCitationsChange = (value: boolean) => {
    setIncludeCitations(value)
    checkForChanges(autoSuggestions, value, acceptKey)
  }

  const handleAcceptKeyChange = (value: 'tab' | 'ctrlEnter') => {
    setAcceptKey(value)
    checkForChanges(autoSuggestions, includeCitations, value)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoSuggestions,
          includeCitations,
          acceptKey,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      toast.success('Editor settings saved')
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Editor Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure AI autocomplete behavior
        </p>
      </div>

      {/* Autocomplete Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Autocomplete</CardTitle>
          <CardDescription>
            Control how AI suggestions appear while you write
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto Suggestions Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-suggestions" className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Enable Auto Suggestions
              </Label>
              <p className="text-xs text-muted-foreground">
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
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-citations" className="flex items-center gap-2">
                <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Include Citations
              </Label>
              <p className="text-xs text-muted-foreground">
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
            <Label htmlFor="accept-key" className="flex items-center gap-2">
              <Keyboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Accept Suggestion Key
            </Label>
            <Select value={acceptKey} onValueChange={handleAcceptKeyChange}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Select key" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tab">Tab</SelectItem>
                <SelectItem value="ctrlEnter">Ctrl + Enter</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Keyboard shortcut to accept AI suggestions
            </p>
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
