'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { CitationStyleSelector } from './CitationStyleSelector'
import { getStyleById } from '@/lib/citations/csl-styles'
import { useAutocompletePrefs } from './hooks/useAutocompletePrefs'

interface ProjectSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Current citation style - passed from parent to avoid API fetch on open */
  currentCitationStyle?: string
  onCitationStyleChange?: (style: string) => void
}

export function ProjectSettingsModal({
  open,
  onOpenChange,
  projectId,
  currentCitationStyle = 'apa',
  onCitationStyleChange,
}: ProjectSettingsModalProps) {
  // Local state for editing (initialized from prop)
  const [citationStyle, setCitationStyle] = useState<string>(currentCitationStyle)
  const [isSaving, setIsSaving] = useState(false)

  const { prefs, setAutoSuggestions, setIncludeCitations, setAcceptKey } = useAutocompletePrefs()

  // Reset to current style when modal opens (in case user canceled previous edit)
  useEffect(() => {
    if (open) {
      setCitationStyle(currentCitationStyle)
    }
  }, [open, currentCitationStyle])

  const handleSave = async () => {
    if (!citationStyle) return

    setIsSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ citationStyle }),
      })

      if (!response.ok) {
        throw new Error('Failed to save settings')
      }

      const styleInfo = getStyleById(citationStyle)
      toast.success('Settings saved', {
        description: `Citation style set to ${styleInfo?.shortName || styleInfo?.name || citationStyle}`,
      })
      
      // Notify parent component of the change
      onCitationStyleChange?.(citationStyle)
      
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedStyle = getStyleById(citationStyle)
  const hasChanges = citationStyle !== currentCitationStyle

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-instrument text-lg tracking-tight">Project Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure settings for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-0 py-2">
          {/* Citations section */}
          <div className="py-4">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-3">Citations</h4>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="citation-style" className="text-xs">Citation Style</Label>
                <CitationStyleSelector
                  value={citationStyle}
                  onValueChange={setCitationStyle}
                />
              </div>
              
              {/* Preview */}
              {selectedStyle && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm border border-border/30">
                  <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wide font-medium">Preview</p>
                  <p className="text-sm">
                    Research shows significant findings{' '}
                    <span className="font-medium text-foreground">{selectedStyle.inlineExample}</span>.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border/30" />

          {/* AI Suggestions section */}
          <div className="py-4">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-3">AI Suggestions</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="project-auto-suggestions" className="text-xs cursor-pointer">
                    Auto-suggestions
                  </Label>
                  <p className="text-[11px] text-muted-foreground">Show AI completions as you type</p>
                </div>
                <Switch
                  id="project-auto-suggestions"
                  checked={prefs.autoSuggestions}
                  onCheckedChange={setAutoSuggestions}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="project-include-citations" className="text-xs cursor-pointer">
                    Include citations
                  </Label>
                  <p className="text-[11px] text-muted-foreground">Add sources to AI suggestions</p>
                </div>
                <Switch
                  id="project-include-citations"
                  checked={prefs.includeCitations}
                  onCheckedChange={setIncludeCitations}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-xs">Accept key</Label>
                  <p className="text-[11px] text-muted-foreground">Shortcut to accept suggestions</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setAcceptKey('tab')}
                    className={`h-7 px-2.5 rounded-full text-[11px] transition-colors ${
                      prefs.acceptKey === 'tab'
                        ? 'bg-foreground/80 text-background font-medium'
                        : 'text-muted-foreground hover:text-foreground border border-border/40'
                    }`}
                  >
                    Tab
                  </button>
                  <button
                    onClick={() => setAcceptKey('ctrlEnter')}
                    className={`h-7 px-2.5 rounded-full text-[11px] transition-colors ${
                      prefs.acceptKey === 'ctrlEnter'
                        ? 'bg-foreground/80 text-background font-medium'
                        : 'text-muted-foreground hover:text-foreground border border-border/40'
                    }`}
                  >
                    Ctrl+Enter
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="h-9 px-4 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground/80 text-background text-xs font-medium hover:bg-foreground transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
