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
  onCitationStyleChange?: (style: string) => void
}

export function ProjectSettingsModal({
  open,
  onOpenChange,
  projectId,
  onCitationStyleChange,
}: ProjectSettingsModalProps) {
  const [citationStyle, setCitationStyle] = useState<string>('apa')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Fetch current project settings when modal opens
  useEffect(() => {
    if (open && projectId) {
      setIsLoading(true)
      fetch(`/api/projects/${projectId}/settings`)
        .then(res => res.json())
        .then(data => {
          setCitationStyle(data.citationStyle || 'apa')
        })
        .catch(err => {
          console.error('Failed to load project settings:', err)
          setCitationStyle('apa')
        })
        .finally(() => setIsLoading(false))
    }
  }, [open, projectId])

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
      
      // Notify parent component of the change so it can update CitationManager
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            Configure settings for this project. Changes will apply to new content generation.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
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
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading || isSaving}>
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
