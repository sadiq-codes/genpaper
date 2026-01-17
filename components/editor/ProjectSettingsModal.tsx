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
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { CitationStyleSelector } from './CitationStyleSelector'
import { getStyleById } from '@/lib/citations/csl-styles'

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
      // Citation formatting is now 100% local - no API re-fetch needed
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Configure settings for this project. Changes will apply to new content generation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Citation Style */}
          <div className="space-y-3">
            <Label htmlFor="citation-style">Citation Style</Label>
            <CitationStyleSelector
              value={citationStyle}
              onValueChange={setCitationStyle}
            />
            
            {/* Preview */}
            {selectedStyle && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="text-muted-foreground text-xs mb-1">Preview:</p>
                <p>
                  Research shows significant findings in this area{' '}
                  <span className="font-medium text-primary">{selectedStyle.inlineExample}</span>.
                </p>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground">
              This style will be used for autocomplete suggestions and paper generation.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
